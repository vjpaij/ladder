/**
 * clear_derived_cache.mjs
 *
 * Safely purges derived calculation snapshots without affecting expensive raw source caches.
 *
 * Preserved Raw Sources (NOT touched):
 *  - data/screener_cache/*.json (Company fundamentals)
 *  - data/historical_prices.json (Historical OHLCV candle series)
 *  - data/db_cache_snapshot.json (Supabase relational table snapshot)
 *
 * Purged Derived Artifacts:
 *  - data/buy_analysis_snapshot.json (Computed buy signals snapshot)
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT_DIR = process.cwd();
const BUY_SNAPSHOT = path.join(ROOT_DIR, 'data', 'buy_analysis_snapshot.json');
const SCREENER_DIR = path.join(ROOT_DIR, 'data', 'screener_cache');
const HISTORICAL_PRICES = path.join(ROOT_DIR, 'data', 'historical_prices.json');
const DB_SNAPSHOT = path.join(ROOT_DIR, 'data', 'db_cache_snapshot.json');

console.log('====================================================');
console.log('SAFE DERIVED CACHE PURGE UTILITY');
console.log('====================================================');

// 1. Purge derived buy analysis snapshot
if (fs.existsSync(BUY_SNAPSHOT)) {
  fs.unlinkSync(BUY_SNAPSHOT);
  console.log(' [PURGED] data/buy_analysis_snapshot.json');
} else {
  console.log(' [OK] data/buy_analysis_snapshot.json does not exist (already clean)');
}

// 2. Audit and confirm raw source integrity
const screenerCount = fs.existsSync(SCREENER_DIR) ? fs.readdirSync(SCREENER_DIR).filter(f => f.endsWith('.json')).length : 0;
console.log(` [SAFE] data/screener_cache/ (${screenerCount} company profiles preserved)`);

if (fs.existsSync(HISTORICAL_PRICES)) {
  const hpStat = fs.statSync(HISTORICAL_PRICES);
  console.log(` [SAFE] data/historical_prices.json (${(hpStat.size / 1024 / 1024).toFixed(2)} MB preserved)`);
}

if (fs.existsSync(DB_SNAPSHOT)) {
  const dbStat = fs.statSync(DB_SNAPSHOT);
  console.log(` [SAFE] data/db_cache_snapshot.json (${(dbStat.size / 1024).toFixed(1)} KB preserved)`);
}

console.log('====================================================');
console.log('Derived cache successfully purged. Raw source data 100% intact.');
console.log('Next request to /api/buy-analysis will recompute from fresh business rules.');
console.log('====================================================');
