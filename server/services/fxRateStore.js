import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Persistent FX Rate Store
 * 
 * Maintains a self-healing, persisted "last known good" FX rate for any currency pair.
 * Eliminates ALL hardcoded fallback rates throughout the project.
 * 
 * Architecture:
 * 1. On boot: loads persisted rates from data/fx_rates_persistent.json
 * 2. On every successful live fetch: persists the new rate to disk + memory
 * 3. On failure: returns the last persisted rate (never a magic number)
 * 4. Background self-healing: retries failed fetches on a configurable interval
 */

const PERSIST_FILE = path.join(__dirname, '../../data/fx_rates_persistent.json');

// In-memory store: { [pair]: { rate: number, updatedAt: string, source: string } }
let rateStore = {};

// Retry queue for failed fetches: Set of pair strings to retry
const retryQueue = new Set();
let retryTimer = null;
const RETRY_INTERVAL_MS = 60 * 1000; // Retry failed fetches every 60 seconds

/**
 * Load persisted rates from disk on startup.
 */
export function loadPersistedRates() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const content = fs.readFileSync(PERSIST_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        rateStore = parsed;
        const pairs = Object.keys(rateStore);
        console.log(`[FX Persistent Store] Loaded ${pairs.length} persisted rate(s): ${pairs.map(p => `${p}=${rateStore[p].rate}`).join(', ')}`);
      }
    }
  } catch (e) {
    console.warn('[FX Persistent Store] Failed to load persisted rates:', e.message);
  }
}

/**
 * Persist current in-memory rates to disk.
 */
function persistRates() {
  try {
    const dir = path.dirname(PERSIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(rateStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[FX Persistent Store] Failed to persist rates:', e.message);
  }
}

/**
 * Store a successfully fetched rate. Persists to memory + disk.
 * 
 * @param {string} pair - Currency pair key (e.g. 'USD_INR')
 * @param {number} rate - The exchange rate
 * @param {string} source - Where the rate came from (e.g. 'yahoo', 'openexchangerates')
 */
export function storeRate(pair, rate, source = 'live') {
  if (!pair || typeof rate !== 'number' || rate <= 0 || !isFinite(rate)) return;
  rateStore[pair] = {
    rate: Number(rate.toFixed(4)),
    updatedAt: new Date().toISOString(),
    source
  };
  retryQueue.delete(pair); // Clear from retry queue on success
  persistRates();
}

/**
 * Get the last known good rate for a currency pair.
 * Returns null ONLY if no rate has ever been fetched or persisted.
 * 
 * @param {string} pair - Currency pair key (e.g. 'USD_INR')
 * @returns {number|null} The persisted rate or null if never fetched
 */
export function getPersistedRate(pair) {
  const entry = rateStore[pair];
  if (entry && typeof entry.rate === 'number' && entry.rate > 0) {
    return entry.rate;
  }
  return null;
}

/**
 * Get the persisted rate with metadata (rate, updatedAt, source, age).
 * 
 * @param {string} pair - Currency pair key
 * @returns {Object|null} { rate, updatedAt, source, ageMs } or null
 */
export function getPersistedRateInfo(pair) {
  const entry = rateStore[pair];
  if (!entry) return null;
  return {
    ...entry,
    ageMs: Date.now() - new Date(entry.updatedAt).getTime()
  };
}

/**
 * Mark a pair for background retry. Used when a live fetch fails.
 * The retry system will attempt to fetch fresh rates periodically.
 * 
 * @param {string} pair - Currency pair to retry
 */
export function scheduleRetry(pair) {
  retryQueue.add(pair);
  if (!retryTimer) {
    startRetryLoop();
  }
}

/**
 * Register a fetch function for a pair. Used by the retry loop.
 * fetchFn should return a number (the rate) or null/throw on failure.
 */
const fetchFunctions = new Map();

export function registerFetchFunction(pair, fetchFn) {
  fetchFunctions.set(pair, fetchFn);
}

/**
 * Start the background retry loop. Runs every RETRY_INTERVAL_MS.
 * Only retries pairs in the retryQueue. Self-stops when queue is empty.
 */
function startRetryLoop() {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    if (retryQueue.size === 0) {
      clearInterval(retryTimer);
      retryTimer = null;
      return;
    }
    for (const pair of retryQueue) {
      const fetchFn = fetchFunctions.get(pair);
      if (fetchFn) {
        try {
          const rate = await fetchFn();
          if (rate && rate > 0) {
            storeRate(pair, rate, 'background-retry');
            console.log(`[FX Persistent Store] Background retry succeeded for ${pair}: ${rate}`);
          }
        } catch (e) {
          // Still failing, will retry next interval
        }
      }
    }
  }, RETRY_INTERVAL_MS);
  // Don't prevent Node.js from exiting
  if (retryTimer.unref) retryTimer.unref();
}

/**
 * Get the best available FX rate for USD/INR with the following priority:
 * 1. A freshly fetched live rate (caller provides)
 * 2. The persisted last-known-good rate
 * 3. null (never returns a hardcoded magic number)
 * 
 * @param {number|null} liveRate - A freshly fetched rate, if available
 * @returns {number|null}
 */
export function getBestFxRate(liveRate = null) {
  if (liveRate && liveRate > 0) return liveRate;
  return getPersistedRate('USD_INR');
}

// -----------------------------------------------------------------------------
// Historical FX Cache & Lookup
// -----------------------------------------------------------------------------
const HISTORICAL_FX_FILE = path.join(__dirname, '../../data/historical_fx_rates.json');
let historicalFxCache = {};

export function loadHistoricalFxRates() {
  try {
    if (fs.existsSync(HISTORICAL_FX_FILE)) {
      historicalFxCache = JSON.parse(fs.readFileSync(HISTORICAL_FX_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[FX Store] Failed to load historical FX rates:', e.message);
  }
}

export function getHistoricalFxRatesMap() {
  return historicalFxCache;
}

export function getHistoricalFxRate(dateStr) {
  if (!dateStr) {
    const persisted = getPersistedRate('USD_INR');
    if (persisted) return persisted;
    return null;
  }
  if (historicalFxCache[dateStr]) return historicalFxCache[dateStr];
  const prevDates = Object.keys(historicalFxCache).filter(d => d < dateStr).sort().reverse();
  if (prevDates.length > 0) {
    return historicalFxCache[prevDates[0]];
  }
  const futureDates = Object.keys(historicalFxCache).filter(d => d > dateStr).sort();
  if (futureDates.length > 0) {
    return historicalFxCache[futureDates[0]];
  }
  return getPersistedRate('USD_INR') || null;
}

export function recordDailyFxRate(dateStr, rate) {
  if (!dateStr || typeof rate !== 'number' || rate <= 0 || !isFinite(rate)) return;
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  historicalFxCache[cleanDate] = Number(rate.toFixed(2));
  try {
    const dir = path.dirname(HISTORICAL_FX_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORICAL_FX_FILE, JSON.stringify(historicalFxCache, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[FX Store] Failed to save historical FX file:', e.message);
  }
}

// Load on module import
loadPersistedRates();
loadHistoricalFxRates();
