import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../supabaseClient.js';
import db from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexKeys = ['NIFTY_50', 'NIFTY_MIDCAP_150', 'NIFTY_SMALLCAP_250', 'SP_500', 'NASDAQ'];
const BENCHMARK_EXCLUDED_CATS = new Set(['bank']);

// -----------------------------------------------------------------------------
// In-Memory Global Caches for High-Performance Re-use
// -----------------------------------------------------------------------------
let eodLogsCache = null;
let indexHistoryCache = null;
let indexSortedDates = null; // { [indexKey]: string[] sorted ascending }

let cachedHoldings = null;
let cachedHoldingsTime = 0;

let cachedBuySellTxns = null;
let cachedTxnsTime = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in-memory TTL

export function invalidateBenchmarkCache() {
  cachedHoldings = null;
  cachedHoldingsTime = 0;
  cachedBuySellTxns = null;
  cachedTxnsTime = 0;
  eodLogsCache = null;
  indexHistoryCache = null;
  indexSortedDates = null;
}

// -----------------------------------------------------------------------------
// Lazy loaders for static / semi-static files
// -----------------------------------------------------------------------------
function loadEodLogs() {
  if (!eodLogsCache) {
    const eodFile = path.join(__dirname, '../../data/portfolio_eod_logs.json');
    if (fs.existsSync(eodFile)) {
      try {
        eodLogsCache = JSON.parse(fs.readFileSync(eodFile, 'utf8'));
      } catch (err) {
        console.error('[BenchmarkEngine] Error reading portfolio_eod_logs.json:', err.message);
        eodLogsCache = [];
      }
    } else {
      eodLogsCache = [];
    }
  }
  return eodLogsCache;
}

function loadIndexHistory() {
  if (!indexHistoryCache || !indexSortedDates) {
    const idxFile = path.join(__dirname, '../../data/index_history.json');
    indexHistoryCache = {};
    indexSortedDates = {};
    if (fs.existsSync(idxFile)) {
      try {
        indexHistoryCache = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
      } catch (err) {
        console.error('[BenchmarkEngine] Error reading index_history.json:', err.message);
        indexHistoryCache = {};
      }
    }
    // Pre-sort dates ONCE per index key
    indexKeys.forEach(k => {
      const closes = indexHistoryCache[k]?.closes || {};
      indexSortedDates[k] = Object.keys(closes).sort();
    });
  }
  return { indexHistory: indexHistoryCache, indexSortedDates };
}

// -----------------------------------------------------------------------------
// O(log N) Binary Search for Nearest Preceding Index Close Price
// -----------------------------------------------------------------------------
function getIndexPriceOnDateFast(indexKey, targetDate) {
  loadIndexHistory();
  const closes = indexHistoryCache[indexKey]?.closes || {};
  if (closes[targetDate] !== undefined && closes[targetDate] > 0) {
    return closes[targetDate];
  }
  const dates = indexSortedDates[indexKey];
  if (!dates || dates.length === 0) return null;

  let low = 0;
  let high = dates.length - 1;
  let best = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (dates[mid] <= targetDate) {
      best = mid;
      low = mid + 1; // Try to find a later date that is still <= targetDate
    } else {
      high = mid - 1;
    }
  }

  if (best >= 0) {
    return closes[dates[best]];
  }
  // Fallback to earliest available future date
  return closes[dates[0]] || null;
}

// -----------------------------------------------------------------------------
// Cached Supabase Data Fetching
// -----------------------------------------------------------------------------
async function getCachedHoldings() {
  const now = Date.now();
  if (cachedHoldings && (now - cachedHoldingsTime < CACHE_TTL_MS)) {
    return cachedHoldings;
  }
  const holdings = await db.select('holdings');
  cachedHoldings = Array.isArray(holdings) ? holdings : [];
  cachedHoldingsTime = now;
  return cachedHoldings;
}

async function getCachedBuySellTxns() {
  const now = Date.now();
  if (cachedBuySellTxns && (now - cachedTxnsTime < CACHE_TTL_MS)) {
    return cachedBuySellTxns;
  }

  // Paginated fetch of all BUY and SELL transactions
  const allTxns = [];
  const BATCH_SIZE = 1000;
  let fromRow = 0;
  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('transactions')
      .select('date, type, total_amount, currency, fx_rate, holding_id')
      .in('type', ['BUY', 'SELL'])
      .order('date', { ascending: true })
      .range(fromRow, fromRow + BATCH_SIZE - 1);

    if (batchErr || !batch || batch.length === 0) break;
    allTxns.push(...batch);
    if (batch.length < BATCH_SIZE) break;
    fromRow += BATCH_SIZE;
  }

  cachedBuySellTxns = allTxns;
  cachedTxnsTime = now;
  return cachedBuySellTxns;
}

// -----------------------------------------------------------------------------
// Core Growth Benchmarks Computation Engine
// -----------------------------------------------------------------------------
export async function computeGrowthBenchmarks({ timeframe = '1Y', scope = 'all', startDate: customStart, endDate: customEnd } = {}) {
  const eodLogs = loadEodLogs();
  if (!Array.isArray(eodLogs) || eodLogs.length === 0) {
    return { series: [] };
  }

  const { indexHistory } = loadIndexHistory();
  const scopeParts = (scope || 'all').toLowerCase().split(',');

  // Helper to extract portfolio valuation based on requested scope
  const getScopeValue = (log) => {
    if (!scope || scope === 'all' || scope === 'consolidated') {
      return Number(log.total_assets || log.total_wealth || log.wealth || 0);
    }
    let total = 0;
    if (scopeParts.some(s => s.includes('india') || s.includes('indian'))) {
      total += Number(log.indian_stocks || 0);
    }
    if (scopeParts.some(s => s.includes('us'))) {
      total += Number(log.us_stocks || 0);
    }
    if (scopeParts.some(s => s.includes('mf') || s.includes('mutual'))) {
      total += Number(log.mutual_funds || 0);
    }
    if (scopeParts.some(s => s.includes('nps'))) {
      total += Number(log.nps || 0);
    }
    if (scopeParts.some(s => s.includes('epf'))) {
      total += Number(log.epf || 0);
    }
    if (scopeParts.some(s => s.includes('bank'))) {
      total += Number(log.bank || 0);
    }
    return total;
  };

  const isCategoryInScope = (cat) => {
    if (scope === 'all' || scope === 'consolidated') return true;
    if (scopeParts.some(s => s.includes('india') || s.includes('indian')) && cat === 'in_stocks') return true;
    if (scopeParts.some(s => s.includes('us')) && cat === 'us_stocks') return true;
    if (scopeParts.some(s => s.includes('mf') || s.includes('mutual')) && cat === 'mutual_funds') return true;
    if (scopeParts.some(s => s.includes('nps')) && cat === 'nps') return true;
    if (scopeParts.some(s => s.includes('epf')) && cat === 'epf') return true;
    if (scopeParts.some(s => s.includes('bank')) && cat === 'bank') return true;
    return false;
  };

  // 1. Fetch cached holdings and map categories
  const holdings = await getCachedHoldings();
  let scopeInvestedCost = 0;
  const holdingCategoryMap = {};
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    holdingCategoryMap[h.id] = h.category_id;
    const qty = Number(h.quantity) || 0;
    if (qty <= 0) continue;
    if (!isCategoryInScope(h.category_id)) continue;
    const buyPrice = Number(h.avg_buy_price) || 0;
    if (h.currency === 'USD') {
      scopeInvestedCost += qty * buyPrice * 82.5;
    } else {
      scopeInvestedCost += qty * buyPrice;
    }
  }

  // 2. Fetch cached transactions
  const allTxns = await getCachedBuySellTxns();

  // 3. Time window filtering
  const investmentAssetLogs = eodLogs.filter(l =>
    (Number(l.indian_stocks) || 0) > 0 ||
    (Number(l.mutual_funds) || 0) > 0 ||
    (Number(l.us_stocks) || 0) > 0 ||
    (Number(l.nps) || 0) > 0 ||
    (Number(l.epf) || 0) > 0
  );
  const nonZeroLogs = eodLogs.filter(l => getScopeValue(l) > 0);
  const earliestInvestmentDate = investmentAssetLogs.length > 0 ? investmentAssetLogs[0].date : null;
  const earliestDataDate = (scope === 'all' || scope === 'consolidated')
    ? (earliestInvestmentDate || (nonZeroLogs.length > 0 ? nonZeroLogs[0].date : eodLogs[0].date))
    : (nonZeroLogs.length > 0 ? nonZeroLogs[0].date : eodLogs[0].date);

  const now = new Date();
  let startDate = new Date();
  let endDate = new Date();

  if (timeframe === 'CUSTOM' && customStart) {
    startDate = new Date(customStart);
    if (customEnd) endDate = new Date(customEnd);
  } else if (timeframe === '1M') startDate.setMonth(now.getMonth() - 1);
  else if (timeframe === '3M') startDate.setMonth(now.getMonth() - 3);
  else if (timeframe === '6M') startDate.setMonth(now.getMonth() - 6);
  else if (timeframe === '1Y') startDate.setFullYear(now.getFullYear() - 1);
  else if (timeframe === 'ALL') startDate = new Date(earliestDataDate);

  const startIso = startDate.toISOString().split('T')[0];
  const endIso = endDate.toISOString().split('T')[0];

  const filteredLogs = eodLogs.filter(log => log.date >= startIso && log.date <= endIso && getScopeValue(log) > 0);
  if (filteredLogs.length === 0) {
    return { series: [] };
  }

  const firstLog = filteredLogs[0];
  const actualStartIso = firstLog.date;
  const basePortfolio = Math.max(1, getScopeValue(firstLog));

  // Initialize running index prices
  const runningIndexPrices = {};
  indexKeys.forEach(k => {
    runningIndexPrices[k] = getIndexPriceOnDateFast(k, actualStartIso) || 1;
  });

  const baseIndexPrices = {};
  indexKeys.forEach(k => {
    baseIndexPrices[k] = runningIndexPrices[k];
  });

  // Filter scoped transactions (non-bank, in-scope)
  const scopedTxns = allTxns.filter(txn => {
    const cat = holdingCategoryMap[txn.holding_id];
    return cat && isCategoryInScope(cat) && !BENCHMARK_EXCLUDED_CATS.has(cat);
  });

  const virtualUnits = {};
  indexKeys.forEach(k => { virtualUnits[k] = 0; });

  let txnPtr = 0;
  const consumeTxnsUpTo = (dateIso) => {
    while (txnPtr < scopedTxns.length && scopedTxns[txnPtr].date <= dateIso) {
      const txn = scopedTxns[txnPtr++];
      let amountInr = Number(txn.total_amount) || 0;
      if ((txn.currency || 'INR') === 'USD') {
        amountInr *= (Number(txn.fx_rate) || 82.5);
      }
      if (amountInr <= 0) continue;
      const txnDate = txn.date;
      const type = txn.type;

      for (let ki = 0; ki < indexKeys.length; ki++) {
        const k = indexKeys[ki];
        const price = getIndexPriceOnDateFast(k, txnDate);
        if (!price || price <= 0) continue;
        if (type === 'BUY') {
          virtualUnits[k] += amountInr / price;
        } else if (type === 'SELL') {
          if (virtualUnits[k] > 0) {
            const unitsToSell = amountInr / price;
            virtualUnits[k] = Math.max(0, virtualUnits[k] - unitsToSell);
          }
        }
      }
    }
  };

  const step = Math.max(1, Math.floor(filteredLogs.length / 80));
  const sampled = [];

  const buildPoint = (log) => {
    const d = log.date;
    const val = getScopeValue(log);

    // Update running index prices
    for (let ki = 0; ki < indexKeys.length; ki++) {
      const k = indexKeys[ki];
      const closes = indexHistory[k]?.closes || {};
      if (closes[d] !== undefined && closes[d] > 0) {
        runningIndexPrices[k] = closes[d];
      }
    }

    const point = {
      date: d,
      Portfolio: Number(val.toFixed(2)),
      PortfolioGrowthPct: basePortfolio > 0 ? Number((((val - basePortfolio) / basePortfolio) * 100).toFixed(2)) : 0
    };

    for (let ki = 0; ki < indexKeys.length; ki++) {
      const k = indexKeys[ki];
      const currentP = runningIndexPrices[k];
      const baseP = baseIndexPrices[k];

      const benchmarkValue = Number((virtualUnits[k] * currentP).toFixed(2));
      const indexGrowthPct = baseP > 0 ? Number((((currentP - baseP) / baseP) * 100).toFixed(2)) : 0;

      point[k] = currentP;
      point[`${k}_Normalized`] = benchmarkValue;
      point[`${k}_GrowthPct`] = indexGrowthPct;
    }

    return point;
  };

  for (let i = 0; i < filteredLogs.length; i += step) {
    const log = filteredLogs[i];
    consumeTxnsUpTo(log.date);
    sampled.push(buildPoint(log));
  }

  const lastLog = filteredLogs[filteredLogs.length - 1];
  if (sampled.length > 0 && sampled[sampled.length - 1].date !== lastLog.date) {
    consumeTxnsUpTo(lastLog.date);
    sampled.push(buildPoint(lastLog));
  }

  return {
    timeframe,
    scope,
    baseDate: actualStartIso,
    basePortfolio,
    baseBenchmarkCapital: scopeInvestedCost,
    scopeInvestedCost,
    series: sampled
  };
}
