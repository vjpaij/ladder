import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
import { supabase } from '../server/supabaseClient.js';
import { db, initDatabase } from '../server/db.js';
import { normalizeSector } from './sync_mf_holdings.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/asset_metadata.json');

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Known US Stocks fallback
const US_STOCKS_METADATA = {
  MSFT: { name: 'Microsoft Corporation', market_cap: 2650000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Software - Infrastructure' },
  NVDA: { name: 'NVIDIA Corporation', market_cap: 2750000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Semiconductors' },
  AAPL: { name: 'Apple Inc.', market_cap: 2900000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Consumer Electronics' },
  GOOG: { name: 'Alphabet Inc.', market_cap: 1850000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Internet Content & Information' },
  AMZN: { name: 'Amazon.com, Inc.', market_cap: 1950000, mcap_category: 'Mega Cap', sector: 'Consumer Discretionary', industry: 'Internet Retail & Cloud' },
  META: { name: 'Meta Platforms, Inc.', market_cap: 1450000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Internet Content & Information' },
  TSM:  { name: 'Taiwan Semiconductor', market_cap: 850000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Semiconductors' },
  AVGO: { name: 'Broadcom Inc.', market_cap: 780000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Semiconductors' },
  CRM:  { name: 'Salesforce, Inc.', market_cap: 260000, mcap_category: 'Mega Cap', sector: 'Information Technology', industry: 'Software - Application' },
  PLTR: { name: 'Palantir Technologies', market_cap: 150000, mcap_category: 'Large Cap', sector: 'Information Technology', industry: 'Software - Application' },
  ANET: { name: 'Arista Networks, Inc.', market_cap: 110000, mcap_category: 'Large Cap', sector: 'Information Technology', industry: 'Computer Hardware & Networking' }
};

export async function fetchStockMetadata(symbol, category_id = 'in_stocks') {
  const cleanSym = symbol.replace(/\.(NS|BO)$/i, '').trim();

  // 1. Try Yahoo Finance primary
  const symbolsToTry = category_id === 'us_stocks' 
    ? [cleanSym] 
    : [`${cleanSym}.NS`, `${cleanSym}.BO`];

  for (const sym of symbolsToTry) {
    try {
      const res = await yf.quoteSummary(sym, { modules: ['summaryProfile', 'price'] });
      if (res && (res.summaryProfile?.sector || res.summaryProfile?.industry)) {
        const rawSector = res.summaryProfile.sector || res.summaryProfile.industry;
        const sector = normalizeSector(rawSector);
        const industry = res.summaryProfile.industry || sector;
        const marketCapRaw = res.price?.marketCap || 0;
        const mcapCr = Math.round(marketCapRaw / 1e7);

        let mcap_category = 'Small Cap';
        if (mcapCr >= 200000) mcap_category = 'Mega Cap';
        else if (mcapCr >= 60000) mcap_category = 'Large Cap';
        else if (mcapCr >= 20000) mcap_category = 'Mid Cap';
        else if (mcapCr >= 3000) mcap_category = 'Small Cap';
        else if (mcapCr > 0) mcap_category = 'Micro Cap';

        return {
          symbol: cleanSym,
          name: res.price?.shortName || res.price?.longName || cleanSym,
          market_cap: mcapCr || 5000,
          mcap_category,
          sector,
          industry
        };
      }
    } catch (e) {
      // try next
    }
  }

  // 2. Fallback to Screener for Indian stocks
  if (category_id === 'in_stocks') {
    try {
      const urls = [
        `https://www.screener.in/company/${cleanSym}/consolidated/`,
        `https://www.screener.in/company/${cleanSym}/`
      ];

      let html = null;
      for (const u of urls) {
        try {
          const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            redirect: 'follow',
            signal: AbortSignal.timeout(4000)
          });
          if (res.ok) {
            const text = await res.text();
            if (text.includes('Market Cap')) {
              html = text;
              break;
            }
          }
        } catch (e) {}
      }

      if (html) {
        const mCapMatch = html.match(/Market Cap[\s\S]*?class="number">([\d,]+)/i);
        const mcapCr = mCapMatch ? Number(mCapMatch[1].replace(/,/g, '')) : null;

        const sectorMatch = html.match(/title="Broad Sector">([^<]+)<\/a>/i) || html.match(/Sector:[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        const industryMatch = html.match(/title="Industry">([^<]+)<\/a>/i) || html.match(/Industry:[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const name = nameMatch ? nameMatch[1].trim() : cleanSym;

        let sector = sectorMatch ? sectorMatch[1].trim() : null;
        let industry = industryMatch ? industryMatch[1].trim() : null;
        if (!sector && industry) sector = industry;
        sector = normalizeSector(sector);

        let mcap_category = 'Small Cap';
        if (mcapCr >= 200000) mcap_category = 'Mega Cap';
        else if (mcapCr >= 60000) mcap_category = 'Large Cap';
        else if (mcapCr >= 20000) mcap_category = 'Mid Cap';
        else if (mcapCr >= 3000) mcap_category = 'Small Cap';
        else if (mcapCr) mcap_category = 'Micro Cap';

        return {
          symbol: cleanSym,
          name,
          market_cap: mcapCr || 5000,
          mcap_category,
          sector,
          industry: industry || sector
        };
      }
    } catch (e) {}
  }

  // 3. Fallback catalogue
  if (category_id === 'us_stocks' && US_STOCKS_METADATA[cleanSym]) {
    const us = US_STOCKS_METADATA[cleanSym];
    return {
      symbol: cleanSym,
      name: us.name,
      market_cap: us.market_cap,
      mcap_category: us.mcap_category,
      sector: us.sector,
      industry: us.industry
    };
  }

  return null;
}

export async function syncAssetMetadata(forceRefreshAll = false) {
  console.log('[Metadata Sync] Initializing Database & Holdings...');
  await initDatabase();

  const holdings = await db.select('holdings');

  // Read existing metadata from DB
  const { data: existingDb } = await supabase.from('asset_metadata').select('*');
  const existingMap = {};
  if (existingDb) {
    existingDb.forEach(m => { existingMap[m.symbol] = m; });
  }

  const results = [];
  const symbolsToSync = [];

  holdings.forEach(h => {
    if (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') {
      const sym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim();
      if (!sym) return;

      const existing = existingMap[sym];
      // Keep existing if already has a valid sector and market_cap
      const isFresh = existing && existing.market_cap && existing.sector && existing.sector !== 'Unknown' && existing.sector !== 'Industrials' && existing.last_updated && (Date.now() - new Date(existing.last_updated).getTime() < 30 * 24 * 3600 * 1000);

      if (!forceRefreshAll && isFresh) {
        results.push(existing);
      } else {
        symbolsToSync.push({ symbol: sym, category_id: h.category_id, name: h.name });
      }
    }
  });

  // Deduplicate symbols to sync
  const uniqueToSync = [];
  const seen = new Set();
  symbolsToSync.forEach(item => {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      uniqueToSync.push(item);
    }
  });

  console.log(`[Metadata Sync] Need to sync ${uniqueToSync.length} assets from market sources (${results.length} already up-to-date)...`);

  // Process in concurrent batches of 8 for lightning speed
  const BATCH_SIZE = 8;
  for (let i = 0; i < uniqueToSync.length; i += BATCH_SIZE) {
    const chunk = uniqueToSync.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (item) => {
      const sym = item.symbol;
      let meta = await fetchStockMetadata(sym, item.category_id);
      
      if (!meta) {
        meta = {
          symbol: sym,
          name: item.name || sym,
          market_cap: 5000,
          mcap_category: 'Small Cap',
          sector: 'Diversified & Other',
          industry: 'Diversified'
        };
      }

      const record = {
        symbol: sym,
        name: meta.name || item.name || sym,
        category_id: item.category_id,
        market_cap: meta.market_cap,
        mcap_category: meta.mcap_category,
        sector: meta.sector,
        industry: meta.industry,
        last_updated: new Date().toISOString()
      };

      results.push(record);
      await supabase.from('asset_metadata').upsert(record);
      console.log(`Synced ${sym}: ₹${meta.market_cap} Cr (${meta.mcap_category}) | ${meta.sector}`);
    }));
  }

  // Save local JSON cache
  fs.writeFileSync(DATA_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log(`[Metadata Sync] Successfully saved ${results.length} asset metadata records to Supabase & ${DATA_FILE}`);
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('sync_asset_metadata.mjs')) {
  syncAssetMetadata(true).then(() => {
    console.log('Sync complete!');
    process.exit(0);
  }).catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
