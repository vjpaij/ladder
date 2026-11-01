import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { saveCacheSnapshotToDisk, warmCache } from '../server/db.js';
import { normalizeSector } from '../src/components/reports/reportsConstants.js';
import { resolveCanonicalSector } from '../server/services/stockIntelligence/buyAnalysisService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const US_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', mcapCategory: 'Mega Cap', mcapCr: 484921, sector: 'Consumer Electronics & Hardware' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', mcapCategory: 'Mega Cap', mcapCr: 368032, sector: 'Enterprise Cloud & Internet' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', mcapCategory: 'Mega Cap', mcapCr: 527105, sector: 'Semiconductors & Hardware' },
  { symbol: 'GOOG', name: 'Alphabet Inc.', mcapCategory: 'Mega Cap', mcapCr: 410253, sector: 'Enterprise Cloud & Internet' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', mcapCategory: 'Mega Cap', mcapCr: 276971, sector: 'Enterprise Cloud & Internet' },
  { symbol: 'META', name: 'Meta Platforms Inc.', mcapCategory: 'Mega Cap', mcapCr: 165086, sector: 'Enterprise Cloud & Internet' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Co.', mcapCategory: 'Mega Cap', mcapCr: 224699, sector: 'Semiconductors & Hardware' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', mcapCategory: 'Mega Cap', mcapCr: 172801, sector: 'Semiconductors & Hardware' },
  { symbol: 'CRM', name: 'Salesforce Inc.', mcapCategory: 'Large Cap', mcapCr: 20387, sector: 'Enterprise Cloud & Internet' },
  { symbol: 'PLTR', name: 'Palantir Technologies Inc.', mcapCategory: 'Large Cap', mcapCr: 40186, sector: 'Enterprise Cloud & Internet' },
  { symbol: 'ANET', name: 'Arista Networks Inc.', mcapCategory: 'Large Cap', mcapCr: 25173, sector: 'Enterprise Cloud & Internet' }
];

async function main() {
  console.log('[SeedFullNSE] Starting full 3,200+ NSE universe & SEBI ranking ingestion...');

  // 1. Load NSE universe & existing metadata
  const nseUni = JSON.parse(fs.readFileSync('data/nse_universe.json', 'utf8'));
  const existingMeta = JSON.parse(fs.readFileSync('data/asset_metadata.json', 'utf8'));
  const existingMap = new Map(existingMeta.map(m => [m.symbol.toUpperCase(), m]));

  const screenerDir = 'data/screener_cache';
  const screenerFiles = fs.readdirSync(screenerDir);
  const screenerMap = new Map();

  screenerFiles.forEach(f => {
    if (!f.endsWith('.json')) return;
    const sym = f.replace('.json', '').toUpperCase();
    try {
      const d = JSON.parse(fs.readFileSync(path.join(screenerDir, f), 'utf8'));
      screenerMap.set(sym, d);
    } catch (_) {}
  });

  console.log(`[SeedFullNSE] Loaded ${nseUni.length} NSE symbols, ${screenerMap.size} screener cache entries.`);

  // 2. Build complete list of Indian stocks
  const indianStocks = [];
  const processedSymbols = new Set();

  nseUni.forEach(sym => {
    const cleanSym = String(sym).trim().toUpperCase();
    if (processedSymbols.has(cleanSym)) return;
    processedSymbols.add(cleanSym);

    const scr = screenerMap.get(cleanSym) || {};
    const ext = existingMap.get(cleanSym) || {};

    const name = ext.name || scr.name || cleanSym;
    const marketCapCr = Number(ext.market_cap) || Number(scr.marketCapCr) || 0;
    const rawSector = ext.sector || scr.sector || scr.industry || 'Diversified & Other';
    const sector = normalizeSector(rawSector, name, cleanSym);
    const industry = ext.industry || scr.industry || sector;

    indianStocks.push({
      symbol: cleanSym,
      name,
      category_id: 'in_stocks',
      exchange: ext.exchange || 'NSE',
      isin: ext.isin || null,
      listing_date: ext.listing_date || null,
      series: ext.series || 'EQ',
      sector,
      industry,
      market_cap: marketCapCr,
      mcap_category: 'Micro Cap' // Will be calculated by SEBI rank below
    });
  });

  // Also include any symbols from existing metadata not in nse_universe (e.g. BSE or legacy)
  existingMeta.forEach(ext => {
    const sym = (ext.symbol || '').toUpperCase().trim();
    if (!sym || processedSymbols.has(sym) || ext.category_id === 'us_stocks') return;
    processedSymbols.add(sym);
    const scr = screenerMap.get(sym) || {};
    indianStocks.push({
      symbol: sym,
      name: ext.name || scr.name || sym,
      category_id: 'in_stocks',
      exchange: ext.exchange || 'NSE',
      isin: ext.isin || null,
      listing_date: ext.listing_date || null,
      series: ext.series || 'EQ',
      sector: normalizeSector(ext.sector || scr.sector || scr.industry || 'Diversified & Other', ext.name, sym),
      industry: ext.industry || scr.industry || ext.sector || 'Diversified',
      market_cap: Number(ext.market_cap) || Number(scr.marketCapCr) || 0,
      mcap_category: 'Micro Cap'
    });
  });

  // 3. Sort Indian stocks by market_cap descending to establish exact SEBI tiers
  indianStocks.sort((a, b) => b.market_cap - a.market_cap);

  // SEBI Tiers:
  // Rank 1-100: Mega Cap (>= ₹5,00,000 Cr) + Large Cap (rest of Top 100) = 100 stocks
  // Rank 101-250: Mid Cap = 150 stocks (Nifty Midcap 150)
  // Rank 251-500: Small Cap = 250 stocks (Nifty Smallcap 250)
  // Rank 501+: Micro Cap = all remaining stocks (< ₹5,000 Cr)
  let megaCount = 0, largeCount = 0, midCount = 0, smallCount = 0, microCount = 0;

  indianStocks.forEach((s, idx) => {
    const rank = idx + 1;
    if (rank <= 100) {
      if (s.market_cap >= 500000) {
        s.mcap_category = 'Mega Cap';
        megaCount++;
      } else {
        s.mcap_category = 'Large Cap';
        largeCount++;
      }
    } else if (rank <= 250) {
      s.mcap_category = 'Mid Cap';
      midCount++;
    } else if (rank <= 500) {
      s.mcap_category = 'Small Cap';
      smallCount++;
    } else {
      s.mcap_category = 'Micro Cap';
      microCount++;
    }
    s.capitalisation = s.mcap_category;
    s.sebi_rank = rank;
  });

  console.log(`[SeedFullNSE] SEBI Tiers assigned for Indian stocks:`);
  console.log(`  - Mega Cap: ${megaCount} stocks (Market Cap >= ₹5 Lakh Cr)`);
  console.log(`  - Large Cap: ${largeCount} stocks (SEBI Top 100, Mega + Large = ${megaCount + largeCount})`);
  console.log(`  - Mid Cap: ${midCount} stocks (SEBI Rank 101-250, Nifty Midcap 150)`);
  console.log(`  - Small Cap: ${smallCount} stocks (SEBI Rank 251-500, Nifty Smallcap 250)`);
  console.log(`  - Micro Cap: ${microCount} stocks (SEBI Rank 501+, All remaining equities)`);
  console.log(`  - Total Indian Equities: ${indianStocks.length}`);

  // 4. Merge US Equities
  const usFormatted = US_STOCKS.map(us => ({
    symbol: us.symbol,
    name: us.name,
    category_id: 'us_stocks',
    exchange: 'NASDAQ',
    isin: null,
    listing_date: null,
    series: 'EQ',
    sector: us.sector,
    industry: us.sector,
    market_cap: us.mcapCr,
    mcap_category: us.mcapCategory,
    capitalisation: us.mcapCategory,
    sebi_rank: null
  }));

  const fullMetadata = [...indianStocks, ...usFormatted];
  console.log(`[SeedFullNSE] Total full universe metadata: ${fullMetadata.length} stocks.`);

  // 5. Save to data/asset_metadata.json
  fs.writeFileSync('data/asset_metadata.json', JSON.stringify(fullMetadata, null, 2), 'utf8');
  console.log('[SeedFullNSE] Saved data/asset_metadata.json successfully.');

  // 6. Sync to db cache snapshot
  await warmCache();
  const cacheSnap = JSON.parse(fs.readFileSync('data/db_cache_snapshot.json', 'utf8'));
  if (cacheSnap.tables) {
    cacheSnap.tables.asset_metadata = {
      data: fullMetadata,
      timestamp: Date.now()
    };
    fs.writeFileSync('data/db_cache_snapshot.json', JSON.stringify(cacheSnap, null, 2), 'utf8');
  }

  saveCacheSnapshotToDisk();
  console.log('[SeedFullNSE] db_cache_snapshot.json updated and checksum verified.');
  process.exit(0);
}

main().catch(err => {
  console.error('[SeedFullNSE] Fatal error:', err);
  process.exit(1);
});
