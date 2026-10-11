import fs from 'node:fs';
import crypto from 'node:crypto';
import { runWalkForwardBacktest } from '../server/services/stockIntelligence/backtestEngine.js';

const snapshotPath = new URL('../data/db_cache_snapshot.json', import.meta.url);
const pricesPath = new URL('../data/historical_prices.json', import.meta.url);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
if (!snapshot.tables || !snapshot.checksum) throw new Error('Database cache snapshot is missing its integrity checksum.');
const checksum = crypto.createHash('sha256').update(JSON.stringify(snapshot.tables)).digest('hex');
if (checksum !== snapshot.checksum) throw new Error('Database cache snapshot checksum failed; refusing to backtest unverified holdings.');

const holdings = snapshot.tables.holdings?.data || [];
const activeIndianSymbols = [...new Set(holdings
  .filter(row => row.category_id === 'in_stocks' && Number(row.quantity) > 0)
  .map(row => row.symbol).filter(Boolean))];
const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
const report = runWalkForwardBacktest(prices, activeIndianSymbols);
console.log(JSON.stringify({ sampleSymbols: activeIndianSymbols.length, ...report }, null, 2));

