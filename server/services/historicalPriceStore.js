import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORICAL_PRICES_FILE = path.join(__dirname, '../../data/historical_prices.json');

let historicalPricesCache = {};
let isLoaded = false;
let loadPromise = null;

/**
 * Asynchronously loads the 38 MB historical prices file without blocking the event loop.
 */
export async function loadHistoricalPricesAsync() {
  if (isLoaded) return historicalPricesCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (fs.existsSync(HISTORICAL_PRICES_FILE)) {
        const raw = await fs.promises.readFile(HISTORICAL_PRICES_FILE, 'utf-8');
        historicalPricesCache = JSON.parse(raw);
        isLoaded = true;
        console.log(`[Historical Pricing] Async-loaded cache for ${Object.keys(historicalPricesCache).length} assets.`);
      } else {
        historicalPricesCache = {};
        isLoaded = true;
      }
    } catch (e) {
      console.error('[Historical Pricing] Failed to async-load cache:', e.message);
      historicalPricesCache = {};
      isLoaded = true;
    }
    return historicalPricesCache;
  })();

  return loadPromise;
}

/**
 * Get full cache map (or empty object if not yet loaded)
 */
export function getHistoricalPricesMap() {
  return historicalPricesCache;
}

/**
 * Get historical price for symbol on a date
 */
export function getHistoricalPrice(symbol, dateStr) {
  if (!symbol || !dateStr) return null;
  const cleanSym = symbol.replace(/\.(NS|BO)$/i, '');
  const hist = historicalPricesCache[symbol] || 
               historicalPricesCache[cleanSym] || 
               historicalPricesCache[`${cleanSym}.NS`] || 
               historicalPricesCache[`${cleanSym}.BO`] || {};
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
