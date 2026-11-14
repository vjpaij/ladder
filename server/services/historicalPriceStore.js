import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import YF from 'yahoo-finance2';
import { resolveCanonicalTicker, getCleanSymbol } from './stockIntelligence/symbolAliasService.js';
import { getLastTradingDay, getTodayIST } from './marketCalendar.js';

const yahooFinance = new YF();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORICAL_PRICES_FILE = path.join(__dirname, '../../data/historical_prices.json');

let historicalPricesCache = {};
let isLoaded = false;
let loadPromise = null;
let isSaving = false;
let lastLoadedMtime = 0;

/**
 * Asynchronously loads the historical prices file without blocking the event loop.
 * Automatically detects if the disk file has been updated via file mtime and reloads.
 */
export async function loadHistoricalPricesAsync(forceReload = false) {
  try {
    if (fs.existsSync(HISTORICAL_PRICES_FILE)) {
      const stats = await fs.promises.stat(HISTORICAL_PRICES_FILE);
      if (stats.mtimeMs > lastLoadedMtime) {
        forceReload = true;
      }
    }
  } catch (_) {}

  if (isLoaded && !forceReload) return historicalPricesCache;
  if (loadPromise && !forceReload) return loadPromise;

  loadPromise = (async () => {
    try {
      if (fs.existsSync(HISTORICAL_PRICES_FILE)) {
        const stats = await fs.promises.stat(HISTORICAL_PRICES_FILE);
        const raw = await fs.promises.readFile(HISTORICAL_PRICES_FILE, 'utf-8');
        historicalPricesCache = JSON.parse(raw);
        lastLoadedMtime = stats.mtimeMs;
        isLoaded = true;
        console.log(`[Historical Pricing] Async-loaded cache for ${Object.keys(historicalPricesCache).length} assets.`);
      } else {
        historicalPricesCache = {};
        lastLoadedMtime = 0;
        isLoaded = true;
      }
    } catch (e) {
      console.error('[Historical Pricing] Failed to async-load cache:', e.message);
      historicalPricesCache = {};
      isLoaded = true;
    } finally {
      loadPromise = null;
    }
    return historicalPricesCache;
  })();

  return loadPromise;
}

/**
 * Force reload cache from disk
 */
export async function reloadHistoricalPricesCache() {
  lastLoadedMtime = 0;
  isLoaded = false;
  return loadHistoricalPricesAsync(true);
}

/**
 * Explicitly invalidate historical price cache
 */
export function invalidateHistoricalPriceCache() {
  lastLoadedMtime = 0;
  isLoaded = false;
}

/**
 * Get full cache map (or empty object if not yet loaded)
 */
export function getHistoricalPricesMap() {
  return historicalPricesCache;
}

/**
 * Persist historical prices cache to disk atomically
 */
export async function saveHistoricalPricesToFile() {
  if (isSaving) return;
  isSaving = true;
  const tempPath = `${HISTORICAL_PRICES_FILE}.${Date.now()}.tmp`;
  try {
    // Monotonic disk merge: read existing disk file to ensure we never drop symbols or historical dates written by other processes
    let diskData = {};
    if (fs.existsSync(HISTORICAL_PRICES_FILE)) {
      try {
        const raw = await fs.promises.readFile(HISTORICAL_PRICES_FILE, 'utf-8');
        diskData = JSON.parse(raw);
      } catch (_) {}
    }
    // Merge: union of disk data and memory cache (memory updates matching dates, but older/extra disk dates are never lost)
    const merged = { ...diskData };
    for (const [sym, series] of Object.entries(historicalPricesCache)) {
      if (!merged[sym]) {
        merged[sym] = series;
      } else {
        merged[sym] = { ...merged[sym], ...series };
      }
    }
    historicalPricesCache = merged;
    await fs.promises.writeFile(tempPath, JSON.stringify(historicalPricesCache, null, 2), 'utf-8');
    try {
      await fs.promises.rename(tempPath, HISTORICAL_PRICES_FILE);
    } catch (renameErr) {
      // Windows EPERM / EBUSY fallback
      await fs.promises.copyFile(tempPath, HISTORICAL_PRICES_FILE);
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  } catch (e) {
    console.error('[Historical Pricing] Failed to save historical prices to disk:', e.message);
    try {
      if (fs.existsSync(tempPath)) await fs.promises.unlink(tempPath);
    } catch (_) {}
  } finally {
    isSaving = false;
  }
}

/**
 * Fetch historical prices for a specific symbol from official sources
 */
export async function fetchHistoricalPricesForSymbol(symbol, category = 'in_stocks', startDate = null) {
  if (!symbol) return {};
  const prices = {};

  try {
    if (category === 'mutual_funds' || /^\d{5,7}$/.test(String(symbol).trim())) {
      const res = await axios.get(`https://api.mfapi.in/mf/${symbol}`, { timeout: 10000 });
      if (res.data && Array.isArray(res.data.data)) {
        res.data.data.forEach(item => {
          if (!item.date || item.nav == null) return;
          const parts = item.date.split('-');
          if (parts.length === 3) {
            const dStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
            const nav = parseFloat(item.nav);
            if (!isNaN(nav) && nav > 0) prices[dStr] = nav;
          }
        });
      }
      return prices;
    }

    if (category === 'nps' || String(symbol).startsWith('SM') || String(symbol).startsWith('POP')) {
      const res = await axios.get(`https://npsnav.in/api/historical/${symbol}`, { timeout: 10000 });
      if (res.data && Array.isArray(res.data.data)) {
        res.data.data.forEach(item => {
          if (!item.date || item.nav == null) return;
          const parts = item.date.split('-');
          if (parts.length === 3) {
            const dStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
            const nav = parseFloat(item.nav);
            if (!isNaN(nav) && nav > 0) prices[dStr] = nav;
          }
        });
      }
      return prices;
    }

    // Equity (Indian & US stocks)
    const isIndian = category === 'in_stocks' || (category !== 'us_stocks' && !symbol.includes('.') && !['AAPL', 'MSFT', 'GOOG', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'PLTR', 'AVGO', 'ANET', 'CRM', 'TSM'].includes(symbol.toUpperCase()));
    const symbolMap = {
      'TATAMOTORS': 'TMPV.NS',
      'TATAMTRDVR': 'TMPV.NS',
      'SWANENERGY': '503310.BO',
      'RINFRA': 'RELINFRA.NS',
      'GMRINFRA': 'GMRAIRPORT.NS',
      'BARBEQUE': '543283.BO',
      'DRONEACHARYA': 'DRONACHARYA.BO',
      'ADORWELD': 'ADOR.NS'
    };

    const resolved = resolveCanonicalTicker(symbol);
    let fetchSym = (resolved && resolved !== symbol) ? resolved : (symbolMap[symbol] || symbol);
    if (isIndian && !fetchSym.endsWith('.NS') && !fetchSym.endsWith('.BO')) {
      fetchSym = `${fetchSym}.NS`;
    }

    const startMs = startDate ? new Date(startDate).getTime() - (86400000 * 5) : new Date('2024-01-01T00:00:00Z').getTime();
    const endMs = Date.now() + 86400000;
    const p1 = new Date(startMs).toISOString().split('T')[0];
    const p2 = new Date(endMs).toISOString().split('T')[0];

    let quotesFound = false;
    let earliestQuoteTime = Infinity;

    const fetchYahooUrl = async (s) => {
      const result = await yahooFinance.chart(s, {
        period1: p1,
        period2: p2,
        interval: '1d'
      });
      
      if (result && result.quotes && result.quotes.length > 0) {
        result.quotes.forEach(quote => {
          if (!quote.date) return;
          const offsetDate = new Date(quote.date.getTime() - (quote.date.getTimezoneOffset() * 60000));
          const dStr = offsetDate.toISOString().split('T')[0];
          // Always prioritize actual market closing price (quote.close) matching GoCharting, TradingView, and exchange executions
          // If close/adjclose is null (e.g. circuit freeze or post-market), gracefully fall back to open, high, or regularMarketPrice
          const val = (quote.close !== null && quote.close !== undefined && !isNaN(quote.close) && quote.close > 0)
            ? quote.close
            : (quote.adjclose !== null && quote.adjclose !== undefined && !isNaN(quote.adjclose) && quote.adjclose > 0)
              ? quote.adjclose
              : (quote.open !== null && quote.open !== undefined && !isNaN(quote.open) && quote.open > 0)
                ? quote.open
                : (quote.high !== null && quote.high !== undefined && !isNaN(quote.high) && quote.high > 0)
                  ? quote.high
                  : (Number(result?.meta?.regularMarketPrice) > 0 ? Number(result.meta.regularMarketPrice) : null);

          if (val !== null && val !== undefined && !isNaN(val) && val > 0) {
            if (!prices[dStr]) prices[dStr] = Number(Number(val).toFixed(2));
            const qTime = quote.date.getTime();
            if (qTime < earliestQuoteTime) earliestQuoteTime = qTime;
          }
        });
        if (Object.keys(prices).length > 0) quotesFound = true;
      }
    };

    try {
      await fetchYahooUrl(fetchSym);

      // If no quotes found, OR if the earliest quote is significantly later than requested start date (e.g. recently listed on NSE but traded on BSE before)
      const isIncompleteCoverage = quotesFound && (earliestQuoteTime - startMs > 86400000 * 15);
      
      if ((!quotesFound || isIncompleteCoverage) && fetchSym.endsWith('.NS')) {
        const boSym = fetchSym.replace(/\.NS$/, '.BO');
        try {
          await fetchYahooUrl(boSym);
        } catch (e2) {
          console.warn(`[Yahoo Fallback] Failed for ${boSym}:`, e2.message);
        }
      }
    } catch (err) {
      // If .NS failed, fallback to .BO for Indian stocks
      if (isIndian && fetchSym.endsWith('.NS')) {
        const boSym = fetchSym.replace(/\.NS$/, '.BO');
        try {
          await fetchYahooUrl(boSym);
        } catch (e2) {
          console.warn(`[Yahoo Fallback] Failed for ${boSym}:`, e2.message);
        }
      }
    }
  } catch (err) {
    console.warn(`[Historical Pricing] Fetch error for ${symbol}:`, err.message);
  }

  return prices;
}

/**
 * Ensure historical prices exist for a symbol, automatically fetching and caching if missing.
 * Supports options object { forceRefresh: boolean, startDate: string } or startDate string for backwards compatibility.
 */
export async function ensureHistoricalPricesForSymbol(symbol, category = 'in_stocks', optionsOrStartDate = null) {
  if (!symbol) return {};
  await loadHistoricalPricesAsync();

  const options = typeof optionsOrStartDate === 'object' && optionsOrStartDate !== null
    ? optionsOrStartDate
    : { startDate: optionsOrStartDate, forceRefresh: false };
  const forceRefresh = Boolean(options.forceRefresh);
  const startDate = options.startDate || null;

  const cleanSym = symbol.replace(/\.(NS|BO)$/i, '');
  const canonicalTicker = resolveCanonicalTicker(symbol);
  const cleanCanonical = getCleanSymbol(canonicalTicker);

  const existingKey = [symbol, cleanSym, `${cleanSym}.NS`, `${cleanSym}.BO`, canonicalTicker, cleanCanonical, `${cleanCanonical}.NS`, `${cleanCanonical}.BO`].find(k => k && historicalPricesCache[k] && Object.keys(historicalPricesCache[k]).length > 0);
  const existing = existingKey ? historicalPricesCache[existingKey] : {};

  const isIndian = category === 'in_stocks' || (category !== 'us_stocks' && !symbol.includes('.') && !['AAPL', 'MSFT', 'GOOG', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'PLTR', 'AVGO', 'ANET', 'CRM', 'TSM'].includes(symbol.toUpperCase()));
  const lastTradingDay = getLastTradingDay(getTodayIST(), isIndian ? 'NSE' : 'NYSE');
  const neededStart = startDate ? String(startDate).slice(0, 10) : '2024-01-01';

  const dates = Object.keys(existing).sort();
  const latestDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const earliestDate = dates.length > 0 ? dates[0] : null;

  const isUpToDate = Boolean(latestDate && latestDate >= lastTradingDay);
  const hasHistoryBaseline = Boolean((earliestDate && earliestDate <= neededStart) || dates.length >= 200);

  const hasCoverage = !forceRefresh && isUpToDate && hasHistoryBaseline;

  if (hasCoverage) {
    return existing;
  }

  // If we already have a long baseline history, we only need to fetch from a few days before latestDate to bridge the gap
  let fetchStart = neededStart;
  if (!forceRefresh && hasHistoryBaseline && latestDate) {
    const fetchStartDateObj = new Date(`${latestDate}T00:00:00Z`);
    fetchStartDateObj.setUTCDate(fetchStartDateObj.getUTCDate() - 5);
    fetchStart = fetchStartDateObj.toISOString().slice(0, 10);
  }

  console.log(`[Historical Pricing] Auto-fetching historical prices for ${symbol} (${category}) from ${fetchStart} (forceRefresh=${forceRefresh}, latestCached=${latestDate || 'none'}, lastTradingDay=${lastTradingDay})...`);
  const fresh = await fetchHistoricalPricesForSymbol(symbol, category, fetchStart);

  if (Object.keys(fresh).length > 0) {
    const targetKey = cleanSym;
    historicalPricesCache[targetKey] = { ...(historicalPricesCache[targetKey] || {}), ...fresh };
    if (symbol !== targetKey) {
      historicalPricesCache[symbol] = historicalPricesCache[targetKey];
    }
    if (cleanCanonical && cleanCanonical !== targetKey) {
      historicalPricesCache[cleanCanonical] = { ...(historicalPricesCache[cleanCanonical] || {}), ...fresh };
    }
    const freshDates = Object.keys(fresh).sort();
    console.log(`[Historical Pricing] Auto-populated ${freshDates.length} historical quotes for ${symbol}. Latest: ${freshDates[freshDates.length - 1]}`);
    // Save to disk atomically
    await saveHistoricalPricesToFile();
    return historicalPricesCache[targetKey];
  }

  return existing;
}

/**
 * Get historical price for symbol on a date
 */
export function getHistoricalPrice(symbol, dateStr) {
  if (!symbol || !dateStr) return null;
  const cleanSym = symbol.replace(/\.(NS|BO)$/i, '');
  const canonicalTicker = resolveCanonicalTicker(symbol);
  const cleanCanonical = getCleanSymbol(canonicalTicker);
  const hist = historicalPricesCache[symbol] || 
               historicalPricesCache[cleanSym] || 
               historicalPricesCache[`${cleanSym}.NS`] || 
               historicalPricesCache[`${cleanSym}.BO`] ||
               (cleanCanonical && historicalPricesCache[cleanCanonical]) ||
               {};
  return hist[dateStr] ?? null;
}

/**
 * Helper to format date string to DD-MM-YYYY
 */
export function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '—';
  const str = String(dateStr).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {
    console.warn('[HistoricalPriceStore] Date parsing error for', dateStr, e.message);
  }

  const parts = str.split(/[-T /]/);
  if (parts.length >= 3) {
    if (parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    }
  }
  return str;
}

// Start loading asynchronously on module load
loadHistoricalPricesAsync();
