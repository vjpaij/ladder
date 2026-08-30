import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../server/supabaseClient.js';
import { db, initDatabase } from '../server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/asset_metadata.json');

import { normalizeSector } from './sync_mf_holdings.mjs';

// US Stocks Metadata Catalog with Normalized Sectors
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

export async function fetchIndianStockMetadata(symbol) {
  const cleanSym = symbol.replace(/\.(NS|BO)$/i, '').trim();
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
        signal: AbortSignal.timeout(6000)
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

  // If direct URL failed, use Screener search API to find exact URL slug
  if (!html) {
    try {
      const searchRes = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(cleanSym)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(6000)
      });
      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data && data.length > 0 && data[0].url) {
          const pageRes = await fetch(`https://www.screener.in${data[0].url}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            redirect: 'follow',
            signal: AbortSignal.timeout(6000)
          });
          if (pageRes.ok) html = await pageRes.text();
        }
      }
    } catch (e) {}
  }

  if (!html) return null;

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
  if (mcapCr) {
    if (mcapCr >= 200000) mcap_category = 'Mega Cap';
    else if (mcapCr >= 60000) mcap_category = 'Large Cap';
    else if (mcapCr >= 20000) mcap_category = 'Mid Cap';
    else if (mcapCr >= 3000) mcap_category = 'Small Cap';
    else mcap_category = 'Micro Cap';
  }

  return {
    symbol: cleanSym,
    name,
    market_cap: mcapCr || 5000,
    mcap_category,
    sector,
    industry: industry || sector
  };
}

export async function syncAssetMetadata(forceRefreshAll = false) {
  console.log('[Metadata Sync] Initializing Database & Holdings...');
  await initDatabase();

  const holdings = await db.select('holdings');
  const activeHoldings = holdings.filter(h => Number(h.quantity) > 0);

  // Read existing metadata from DB
  const { data: existingDb } = await supabase.from('asset_metadata').select('*');
  const existingMap = {};
  if (existingDb) {
    existingDb.forEach(m => { existingMap[m.symbol] = m; });
  }

  const results = [];
  const symbolsToSync = [];

  activeHoldings.forEach(h => {
    if (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') {
      const sym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim();
      if (!sym) return;

      const existing = existingMap[sym];
      // Only skip if already has valid market_cap and sector and was updated recently
      const isFresh = existing && existing.market_cap && existing.sector && existing.sector !== 'Unknown' && existing.last_updated && (Date.now() - new Date(existing.last_updated).getTime() < 7 * 24 * 3600 * 1000);

      if (!forceRefreshAll && isFresh) {
        results.push(existing);
      } else {
        symbolsToSync.push({ symbol: sym, category_id: h.category_id, name: h.name });
      }
    }
  });

  console.log(`[Metadata Sync] Need to sync ${symbolsToSync.length} assets from internet (${results.length} already up-to-date)...`);

  for (let i = 0; i < symbolsToSync.length; i++) {
    const item = symbolsToSync[i];
    const sym = item.symbol;

    if (item.category_id === 'us_stocks') {
      const usMeta = US_STOCKS_METADATA[sym] || {
        name: item.name || sym,
        market_cap: 100000,
        mcap_category: 'Large Cap',
        sector: 'Technology',
        industry: 'Software'
      };
      const record = {
        symbol: sym,
        name: usMeta.name,
        category_id: 'us_stocks',
        market_cap: usMeta.market_cap,
        mcap_category: usMeta.mcap_category,
        sector: usMeta.sector,
        industry: usMeta.industry,
        last_updated: new Date().toISOString()
      };
      results.push(record);
      await supabase.from('asset_metadata').upsert(record);
    } else {
      const meta = await fetchIndianStockMetadata(sym);
      if (meta) {
        const record = {
          symbol: sym,
          name: meta.name || item.name || sym,
          category_id: 'in_stocks',
          market_cap: meta.market_cap,
          mcap_category: meta.mcap_category,
          sector: meta.sector,
          industry: meta.industry,
          last_updated: new Date().toISOString()
        };
        results.push(record);
        await supabase.from('asset_metadata').upsert(record);
        console.log(`[${i + 1}/${symbolsToSync.length}] Synced ${sym}: ₹${meta.market_cap} Cr (${meta.mcap_category}) | ${meta.sector}`);
      } else {
        const record = {
          symbol: sym,
          name: item.name || sym,
          category_id: 'in_stocks',
          market_cap: 4500,
          mcap_category: 'Small Cap',
          sector: 'Industrials',
          industry: 'Industrial Equipment',
          last_updated: new Date().toISOString()
        };
        results.push(record);
        await supabase.from('asset_metadata').upsert(record);
        console.log(`[${i + 1}/${symbolsToSync.length}] Defaulted ${sym}: Small Cap | Industrials`);
      }
      await new Promise(r => setTimeout(r, 150));
    }
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
