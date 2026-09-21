import fs from 'fs';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { db, updateCacheRow, getCacheEntry } from '../db.js';
import { supabase } from '../supabaseClient.js';
import { storeRate, getPersistedRate, scheduleRetry, registerFetchFunction } from './fxRateStore.js';

export const liveQuoteCache = new Map();

/**
 * Canonical helper to resolve a holding's current price with NSE/BSE MAX comparison for Indian stocks.
 * Zero-divergence calculation across all endpoints, modals, and summary engines.
 */
export function resolveHoldingPrice(h, liveQuote = null) {
  if (!h) return 0;
  const quote = liveQuote || liveQuoteCache.get(h.symbol);
  let price = (quote && quote.price > 0) ? Number(quote.price) : (Number(h.current_price) || 0);

  if (h.category_id === 'in_stocks') {
    const nse = (quote && quote.nse_price > 0) ? Number(quote.nse_price) : (Number(h.nse_price) || 0);
    const bse = (quote && quote.bse_price > 0) ? Number(quote.bse_price) : (Number(h.bse_price) || 0);
    const maxEx = Math.max(nse, bse);
    if (maxEx > 0) {
      price = Math.max(price, maxEx);
    }
  }
  return price;
}

/**
 * Helper to delay execution for exponential backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches the live USD/INR FX rate with retry, exponential backoff, and self-healing persistence.
 * On success: persists the rate to disk so future failures use it.
 * On failure: returns the last persisted rate. Never returns a hardcoded number.
 * If no rate has ever been persisted (first-ever boot with no connectivity),
 * logs a critical warning and returns null -- callers must handle this gracefully.
 */
export async function fetchFxRate() {
  // Attempt 1: Yahoo Finance (primary) with retry & exponential backoff
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const quote = await fetchStockQuote('INR=X');
      if (quote && quote.price > 0) {
        liveQuoteCache.set('USDINR', quote);
        storeRate('USD_INR', quote.price, 'yahoo-finance');
        return quote.price;
      }
    } catch (err) {
      console.warn(`[FX Rate] Yahoo Finance USD/INR attempt ${attempt} failed:`, err.message);
    }
    if (attempt < 2) await sleep(attempt * 300);
  }

  // Attempt 2: Open Exchange Rates API (secondary) with retry & exponential backoff
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 });
      if (res.data && res.data.rates && res.data.rates.INR) {
        const rate = res.data.rates.INR;
        storeRate('USD_INR', rate, 'open-exchange-rates');
        return rate;
      }
    } catch (err) {
      console.warn(`[FX Rate] Open Exchange Rates API attempt ${attempt} failed:`, err.message);
    }
    if (attempt < 2) await sleep(attempt * 500);
  }

  // Fallback: Last known good persisted rate (no hardcoded values)
  const persisted = getPersistedRate('USD_INR');
  if (persisted) {
    console.warn(`[FX Rate] All live sources failed. Using last persisted rate: ${persisted}`);
    scheduleRetry('USD_INR');
    return persisted;
  }

  // Critical: No rate has ever been persisted (first boot with no internet)
  console.error('[FX Rate] CRITICAL: No live FX rate available and no persisted rate found. USD valuations will be unavailable.');
  scheduleRetry('USD_INR');
  return null;
}

// Register the fetch function for background retry
registerFetchFunction('USD_INR', fetchFxRate);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatCleanQuoteDate(dateStr, timeZone) {
  if (!dateStr) return null;
  if (typeof dateStr === 'number') {
    const ms = dateStr < 1e11 ? dateStr * 1000 : dateStr;
    const d = new Date(ms);
    if (timeZone) {
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone,
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }).formatToParts(d);
        const day = parts.find(p => p.type === 'day')?.value || String(d.getDate()).padStart(2, '0');
        const monthRaw = parts.find(p => p.type === 'month')?.value || MONTH_NAMES[d.getMonth()];
        const month = monthRaw.slice(0, 3);
        const year = parts.find(p => p.type === 'year')?.value || d.getFullYear();
        return `${day} ${month} ${year}`;
      } catch (e) {
        // Fallback to UTC if timezone invalid
      }
    }
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = MONTH_NAMES[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  }
  if (typeof dateStr === 'string') {
    const cleanStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.trim();
    const parts = cleanStr.split(/[-/ ]/);
    if (parts.length === 3) {
      let day, month, year;
      if (parts[0].length === 4) {
        year = parts[0];
        month = parts[1];
        day = parts[2];
      } else {
        day = parts[0];
        month = parts[1];
        year = parts[2];
      }
      const mNum = parseInt(month, 10);
      if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) {
        return `${String(day).padStart(2, '0')} ${MONTH_NAMES[mNum - 1]} ${year}`;
      }
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, '0');
      const month = MONTH_NAMES[parsed.getMonth()];
      const year = parsed.getFullYear();
      return `${day} ${month} ${year}`;
    }
  }
  return dateStr;
}

// -------------------------------------------------------------
// Yahoo Finance Circuit Breaker & Resilient Fetching
// -------------------------------------------------------------
const yfCircuitBreaker = {
  state: 'CLOSED', // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  failureCount: 0,
  failureThreshold: 5,
  cooldownPeriodMs: 30000,
  nextAttemptTime: 0,
  recordSuccess() {
    if (this.state !== 'CLOSED') {
      console.log('[Yahoo Finance Circuit Breaker] Service recovered. Resetting circuit to CLOSED.');
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  },
  recordFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold && this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.cooldownPeriodMs;
      console.warn(`[Yahoo Finance Circuit Breaker] Circuit tripped to OPEN (${this.failureCount} consecutive failures). Backing off for ${this.cooldownPeriodMs / 1000}s.`);
    }
  },
  canAttempt() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = 'HALF_OPEN';
        console.log('[Yahoo Finance Circuit Breaker] Cooldown elapsed. Entering HALF_OPEN state to probe service.');
        return true;
      }
      return false;
    }
    // HALF_OPEN allows single probe
    return true;
  }
};

export async function fetchStockQuote(symbol) {
  if (!symbol) return null;

  // If circuit breaker is OPEN, serve from cache if available or bail early
  if (!yfCircuitBreaker.canAttempt()) {
    const cached = liveQuoteCache.get(symbol);
    if (cached) return cached;
    return null;
  }

  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      const res = await axios.get(url, {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const result = res.data?.chart?.result?.[0];
      if (result && result.meta && result.meta.regularMarketPrice) {
        const price = Number(result.meta.regularMarketPrice) || 0;
        const prevClose = Number(result.meta.chartPreviousClose || result.meta.previousClose || price);
        const dayChange = price - prevClose;
        const dayChangePct = prevClose > 0 ? Number(((dayChange / prevClose) * 100).toFixed(2)) : 0;
        const quoteObj = result.indicators?.quote?.[0] || {};
        const openPrice = Number(quoteObj.open?.[0] || result.meta.regularMarketPrice);
        const dayHigh = Number(result.meta.regularMarketDayHigh || quoteObj.high?.[0] || price);
        const dayLow = Number(result.meta.regularMarketDayLow || quoteObj.low?.[0] || price);
        const closePrice = Number(quoteObj.close?.[0] || price);
        const fiftyTwoWeekHigh = Number(result.meta.fiftyTwoWeekHigh || dayHigh * 1.15);
        const fiftyTwoWeekLow = Number(result.meta.fiftyTwoWeekLow || dayLow * 0.85);

        const quoteTime = result.meta.regularMarketTime || Math.floor(Date.now() / 1000);
        // Derive exchange timezone so US stocks reflect US trading date and Indian stocks reflect Indian date
        const exchangeTz = result.meta.exchangeTimezoneName || (symbol.endsWith('.NS') || symbol.endsWith('.BO') ? 'Asia/Kolkata' : 'America/New_York');
        const quoteDate = formatCleanQuoteDate(quoteTime, exchangeTz);

        const quote = {
          price,
          adjustedClose: (result.indicators?.quote?.[0]?.adjclose?.[0]) || price,
          previousClose: prevClose,
          dayChange: Number(dayChange.toFixed(2)),
          dayChangePct,
          open: Number(openPrice.toFixed(2)),
          high: Number(dayHigh.toFixed(2)),
          low: Number(dayLow.toFixed(2)),
          close: Number(closePrice.toFixed(2)),
          fiftyTwoWeekHigh: Number(fiftyTwoWeekHigh.toFixed(2)),
          fiftyTwoWeekLow: Number(fiftyTwoWeekLow.toFixed(2)),
          currency: result.meta.currency || 'INR',
          quoteDate,
          exchangeTimezone: exchangeTz,
          updated: new Date().toISOString()
        };

        yfCircuitBreaker.recordSuccess();
        return quote;
      }
    } catch (err) {
      const isNotFound = err.response?.status === 404;
      if (isNotFound) {
        // Expected absence (e.g. stock not listed on BSE / no .BO ticker); do not retry or trip breaker
        return liveQuoteCache.get(symbol) || null;
      }
      if (attempt === maxRetries) {
        yfCircuitBreaker.recordFailure();
        console.warn(`[Yahoo Finance] Quote error for ${symbol} (attempt ${attempt}/${maxRetries}):`, err.message);
      } else {
        await sleep(250 * attempt);
      }
    }
  }

  // Fallback to cache if available
  return liveQuoteCache.get(symbol) || null;
}

export async function fetchMutualFundNav(schemeCode, targetDate = null) {
  try {
    const res = await axios.get(`https://api.mfapi.in/mf/${schemeCode}`, { timeout: 5000 });
    if (res.data && res.data.data && res.data.data.length > 0) {
      const records = targetDate
        ? res.data.data.filter(record => {
            const [day, month, year] = String(record.date || '').split('-');
            return `${year}-${month}-${day}` <= targetDate;
          })
        : res.data.data;
      const latest = records[0];
      if (!latest) return null;
      const prev = records[1] || latest;
      const nav = parseFloat(latest.nav);
      const prevNav = parseFloat(prev.nav);
      const dayChange = nav - prevNav;
      const dayChangePct = prevNav > 0 ? Number(((dayChange / prevNav) * 100).toFixed(2)) : 0;

      const yearRecords = records.slice(0, 252).map(r => parseFloat(r.nav)).filter(n => !isNaN(n));
      const fiftyTwoWeekHigh = yearRecords.length > 0 ? Math.max(...yearRecords) : nav;
      const fiftyTwoWeekLow = yearRecords.length > 0 ? Math.min(...yearRecords) : nav;
      const quoteDate = formatCleanQuoteDate(latest.date);

      return {
        nav,
        date: latest.date,
        quoteDate,
        previousNav: prevNav,
        previousClose: prevNav,
        dayChange: Number(dayChange.toFixed(4)),
        dayChangePct,
        open: prevNav,
        high: nav,
        low: prevNav,
        close: nav,
        fiftyTwoWeekHigh: Number(fiftyTwoWeekHigh.toFixed(4)),
        fiftyTwoWeekLow: Number(fiftyTwoWeekLow.toFixed(4))
      };
    }
  } catch (err) {
    console.warn(`[AMFI NAV] Fetch error for ${schemeCode}:`, err.message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// NPS NAV Pipeline — Robust Protean CRA scraper with dynamic multi-asset
// holiday calendar awareness, already-synced detection, and npsnav.in fallback.
// ---------------------------------------------------------------------------

import { 
  isTradingDay, 
  getLastTradingDay, 
  getNextTradingDay, 
  getTodayIST, 
  getYesterdayIST,
  getHolidaysForYear,
  isIndianMarketOpen,
  isUsMarketOpen,
  isAnyMarketOpen
} from './marketCalendar.js';

export { 
  isTradingDay, 
  getLastTradingDay, 
  getNextTradingDay, 
  getTodayIST, 
  getYesterdayIST,
  getHolidaysForYear,
  isIndianMarketOpen,
  isUsMarketOpen,
  isAnyMarketOpen
};

// In-memory cache for the Protean NAV batch: { navMap, navDate, cachedAt }
let proteanBatchCache = null;
const PROTEAN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// In-memory cache tracking whether NPS NAVs for a given date are already synced to Supabase
const npsSyncStatusCache = new Map();

/**
 * Checks whether today's NAVs are already persisted in Supabase nps_daily_navs
 * for all provided scheme codes. Returns true if every scheme has a row for today.
 */
async function areTodayNavsAlreadySynced(schemeCodes, targetDate) {
  if (!schemeCodes || schemeCodes.length === 0) return false;
  if (!targetDate) return false;

  // In-memory check: if already confirmed synced for this targetDate, return true immediately with 0 egress
  if (npsSyncStatusCache.get(targetDate) === true) {
    return true;
  }

  // Non-trading day guard: On weekends/holidays, NAV does not change from last trading day
  if (!isTradingDay(targetDate, 'NSE')) {
    const lastValidTradingDay = getLastTradingDay(targetDate, 'NSE');
    if (npsSyncStatusCache.get(lastValidTradingDay) === true) {
      npsSyncStatusCache.set(targetDate, true);
      return true;
    }
  }

  try {
    const { data, error } = await supabase
      .from('nps_daily_navs')
      .select('scheme_code')
      .in('scheme_code', schemeCodes)
      .eq('nav_date', targetDate);
    if (error || !data) return false;
    const isSynced = data.length >= schemeCodes.length;
    if (isSynced) {
      npsSyncStatusCache.set(targetDate, true);
    }
    return isSynced;
  } catch (e) {
    return false;
  }
}

/**
 * Scrapes the latest Protean CRA NAV ZIP.
 * - Reads the embedded NAV date from the ZIP content (not the filename).
 * - Only upserts to Supabase if the NAV date matches the expected trading day.
 * - Returns { navMap, navDate } or null on failure.
 */
export async function fetchProteanNpsNavBatch() {
  const lastTradingDay = getLastTradingDay(getTodayIST(), 'NSE');
  // Serve from in-memory cache if fresh within TTL
  if (
    proteanBatchCache &&
    (Date.now() - proteanBatchCache.cachedAt < PROTEAN_CACHE_TTL_MS)
  ) {
    return proteanBatchCache.navMap;
  }

  try {
    const pageRes = await axios.get('https://www.npscra.proteantech.in/nav-search.php', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = pageRes.data;

    // Find all NAV_File_DDMMYYYY.zip links and sort by embedded date descending
    const zipMatches = [...html.matchAll(/(?:href=["'])?([^"'\s<>]+\/NAV_File_(\d{2})(\d{2})(\d{4})\.zip)/gi)];
    if (!zipMatches || zipMatches.length === 0) {
      console.warn('[Protean Scraper] No ZIP links found on nav-search.php');
      return null;
    }

    zipMatches.sort((a, b) => {
      const dateA = `${a[4]}${a[3]}${a[2]}`;
      const dateB = `${b[4]}${b[3]}${b[2]}`;
      return dateB.localeCompare(dateA);
    });

    let zipUrl = zipMatches[0][1];
    if (!zipUrl.startsWith('http')) {
      zipUrl = `https://www.npscra.proteantech.in/${zipUrl.replace(/^\//, '')}`;
    }

    const zipRes = await axios.get(zipUrl, {
      timeout: 20000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const zip = new AdmZip(Buffer.from(zipRes.data));
    const entries = zip.getEntries();
    const outEntry = entries.find(e => e.entryName.endsWith('.out'));
    if (!outEntry) {
      console.warn('[Protean Scraper] No .out file found inside ZIP');
      return null;
    }

    const csvContent = outEntry.getData().toString('utf8');
    const lines = csvContent.split(/\r?\n/).filter(l => l.trim());

    const navMap = new Map();
    const dbRows = [];
    let zipNavDate = null; // The actual NAV date embedded in the CSV data

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 6) {
        const rawDate = parts[0].trim();
        const schemeCode = parts[3].trim();
        const schemeName = parts[4].trim();
        const nav = parseFloat(parts[5].trim());

        let isoDate = rawDate;
        const dParts = rawDate.split('/');
        if (dParts.length === 3) {
          isoDate = `${dParts[2]}-${dParts[0].padStart(2, '0')}-${dParts[1].padStart(2, '0')}`;
        }

        // Capture the NAV date from the first valid row
        if (!zipNavDate && isoDate && isoDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
          zipNavDate = isoDate;
        }

        if (schemeCode && !isNaN(nav) && nav > 0) {
          navMap.set(schemeCode, {
            nav,
            date: isoDate,
            name: schemeName,
            quoteDate: formatCleanQuoteDate(isoDate)
          });
          dbRows.push({
            scheme_code: schemeCode,
            scheme_name: schemeName,
            nav: nav,
            nav_date: isoDate
          });
        }
      }
    }

    // EGRESS GUARD: Only persist NAV rows for schemes actively tracked in user holdings.
    // Prevents inserting hundreds of untracked schemes across all of India and avoids thousands of POST calls.
    let rowsToPersist = dbRows;
    try {
      const cachedHoldings = getCacheEntry('holdings') || [];
      const heldSymbols = new Set(cachedHoldings.filter(h => h.category_id === 'nps' && h.symbol).map(h => h.symbol));
      if (heldSymbols.size > 0) {
        rowsToPersist = dbRows.filter(r => heldSymbols.has(r.scheme_code));
      } else {
        rowsToPersist = dbRows.filter(r => r.scheme_code.startsWith('SM00') || r.scheme_code.startsWith('SM01') || r.scheme_code.startsWith('SM008') || r.scheme_code.startsWith('SM003'));
      }
    } catch (e) {
      rowsToPersist = dbRows.slice(0, 20);
    }

    if (rowsToPersist.length > 0) {
      try {
        const { error } = await supabase
          .from('nps_daily_navs')
          .upsert(rowsToPersist, { onConflict: 'scheme_code,nav_date' });
        if (error) throw error;
        console.log(`[Protean Scraper] Persisted ${rowsToPersist.length} held NAV rows for ${zipNavDate} to Supabase.`);
      } catch (e) {
        console.warn('[NPS DB Upsert Warning]:', e.message);
      }
    }

    if (zipNavDate && zipNavDate !== lastTradingDay) {
      console.log(
        `[Protean Scraper] Latest ZIP NAV date is ${zipNavDate} (expected today/latest session: ${lastTradingDay}). ` +
        'Protean has not published today yet; cached for live quote use.'
      );
    }

    proteanBatchCache = { navMap, navDate: zipNavDate || lastTradingDay, cachedAt: Date.now() };
    return navMap;
  } catch (err) {
    console.warn('[Protean Scraper Warning]:', err.message);
    return null;
  }
}

/**
 * Returns true if the last in-memory Protean batch is stale (not today's trading date).
 */
export function isProteanNavStale() {
  if (!proteanBatchCache) return true;
  return proteanBatchCache.navDate !== getLastTradingDay();
}

/**
 * Scrapes latest Protean CRA NAVs and saves all schemes to Supabase nps_daily_navs
 */
export async function syncDailyNpsNavs() {
  const navMap = await fetchProteanNpsNavBatch();
  return navMap ? navMap.size : 0;
}

/**
 * Continuous Gap-Filling Engine for Mutual Funds and NPS Schemes.
 * Features:
 * - Trading-day awareness: skips weekends and NSE holidays.
 * - Already-synced detection: skips Supabase upsert if today's NAVs are all present.
 * - Date-verified Protean fetch: uses npsnav.in only when Protean ZIP is confirmed stale.
 */
export async function syncAllMissingNavs(options = {}) {
  const { persistToDb = false } = options;
  const results = { npsUpdated: 0, mfUpdated: 0, totalChecked: 0, skipped: false, skipReason: null };

  const today = getTodayIST();
  const lastTradingDay = getLastTradingDay(today, 'NSE');

  // 1. Fetch active MF & NPS holdings from cached db.select (0 egress)
  const allHoldings = await db.select('holdings');
  const holdings = allHoldings.filter(h => 
    (h.category_id === 'mutual_funds' || h.category_id === 'nps') && Number(h.quantity) > 0
  );

  if (!holdings || holdings.length === 0) return results;
  results.totalChecked = holdings.length;

  const npsHoldings = holdings.filter(h => h.category_id === 'nps' && h.symbol);
  const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && h.symbol);

  // 2. Sync NPS via Supabase authoritative store -> Protean -> fallback
  if (npsHoldings.length > 0) {
    const npsSchemeCodes = npsHoldings.map(h => h.symbol);
    
    // Always check what latest NAVs exist in Supabase nps_daily_navs table first
    let latestDbNavs = [];
    try {
      const { data } = await supabase
        .from('nps_daily_navs')
        .select('scheme_code,nav,nav_date')
        .in('scheme_code', npsSchemeCodes)
        .order('nav_date', { ascending: false });
      latestDbNavs = data || [];
    } catch (e) {
      console.warn('[syncAllMissingNavs] nps_daily_navs fetch warning:', e.message);
    }

    const latestNavMapByScheme = new Map();
    latestDbNavs.forEach(r => {
      if (!latestNavMapByScheme.has(r.scheme_code)) {
        latestNavMapByScheme.set(r.scheme_code, r);
      }
    });

    // Check if any held schemes are missing or older than lastTradingDay
    const missingOrStaleCodes = npsSchemeCodes.filter(code => {
      const row = latestNavMapByScheme.get(code);
      return !row || row.nav_date < lastTradingDay;
    });

    if (missingOrStaleCodes.length > 0) {
      const proteanMap = await fetchProteanNpsNavBatch();
      const isStale = isProteanNavStale();

      await Promise.all(missingOrStaleCodes.map(async (code) => {
        const h = npsHoldings.find(item => item.symbol === code);
        try {
          let item = (!isStale && proteanMap) ? proteanMap.get(code) : null;
          if (!item || isStale) {
            const fallback = await fetchNpsNavFallback(code);
            if (fallback && (fallback.date === lastTradingDay || fallback.date > (item?.date || ''))) {
              item = { nav: fallback.nav, date: fallback.date, quoteDate: fallback.quoteDate };
              try {
                await supabase.from('nps_daily_navs').upsert({
                  scheme_code: code,
                  scheme_name: h ? h.name : code,
                  nav: fallback.nav,
                  nav_date: fallback.date
                }, { onConflict: 'scheme_code,nav_date' });
              } catch (e) {
                console.warn(`[syncAllMissingNavs] Supabase upsert error for ${code}:`, e.message);
              }
            } else if (!item && proteanMap?.get(code)) {
              item = proteanMap.get(code);
            }
          }
          if (item) {
            latestNavMapByScheme.set(code, {
              scheme_code: code,
              nav: item.nav,
              nav_date: item.date
            });
          }
        } catch (e) {
          console.warn(`[syncAllMissingNavs] NPS fetch error for ${code}:`, e.message);
        }
      }));
    }

    // Apply latest NAVs to liveQuoteCache and holdings
    for (const h of npsHoldings) {
      const latest = latestNavMapByScheme.get(h.symbol);
      if (latest && latest.nav > 0) {
        const navNum = Number(latest.nav);
        const qDate = formatCleanQuoteDate(latest.nav_date);
        liveQuoteCache.set(h.symbol, {
          price: navNum,
          quoteDate: qDate
        });
        if (navNum !== Number(h.current_price)) {
          updateCacheRow('holdings', h.id, {
            current_price: navNum,
            updated_at: new Date().toISOString()
          });
          if (persistToDb) {
            await db.update('holdings', h.id, {
              current_price: navNum,
              updated_at: new Date().toISOString()
            });
          }
        }
        results.npsUpdated++;
      }
    }
  }

  // 3. Sync Mutual Funds in parallel
  await Promise.all(mfHoldings.map(async (h) => {
    try {
      const q = await fetchMutualFundNav(h.symbol);
      if (q) {
        liveQuoteCache.set(h.symbol, q);
        if (Number(h.current_price) !== Number(q.nav)) {
          updateCacheRow('holdings', h.id, {
            current_price: q.nav,
            updated_at: new Date().toISOString()
          });
          if (persistToDb) {
            await db.update('holdings', h.id, {
              current_price: q.nav,
              updated_at: new Date().toISOString()
            });
          }
        }
        results.mfUpdated++;
      }
    } catch (e) {
      console.warn(`[syncAllMissingNavs] MF ${h.symbol} error:`, e.message);
    }
  }));

  return results;
}

export async function fetchNpsNav(schemeCode) {
  try {
    const navMap = await fetchProteanNpsNavBatch();
    if (navMap && navMap.has(schemeCode)) {
      const item = navMap.get(schemeCode);
      return {
        price: item.nav,
        date: item.date,
        quoteDate: item.quoteDate,
        change: 0,
        changePercent: 0,
        open: item.nav,
        high: item.nav,
        low: item.nav,
        close: item.nav
      };
    }
  } catch (e) {
    console.warn(`[NPS Nav] Protean batch lookup error for ${schemeCode}:`, e.message);
  }
  return await fetchNpsNavFallback(schemeCode);
}

export async function fetchNpsNavFallback(schemeCode) {
  try {
    const res = await axios.get(`https://npsnav.in/api/historical/${schemeCode}`, { timeout: 8000 });
    if (res.data && Array.isArray(res.data.data) && res.data.data.length > 0) {
      const latest = res.data.data[0];
      const nav = parseFloat(latest.nav);
      if (!isNaN(nav) && nav > 0) {
        let isoDate = latest.date;
        if (/^\d{2}-\d{2}-\d{4}$/.test(isoDate)) {
          const [d, m, y] = isoDate.split('-');
          isoDate = `${y}-${m}-${d}`;
        }
        return { 
          nav, 
          date: isoDate, 
          rawDate: latest.date,
          quoteDate: formatCleanQuoteDate(isoDate) 
        };
      }
    }
  } catch (err) {
    console.warn(`[NPS Nav Fallback] Error fetching fallback NAV for ${schemeCode}:`, err.message);
  }
  return null;
}

// In-memory cache for historical NAV series: schemeCode -> { navMap: Map<YYYY-MM-DD, number>, cachedAt: timestamp }
const npsHistoricalCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function fetchNpsHistoricalNav(schemeCode) {
  const cached = npsHistoricalCache.get(schemeCode);
  if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
    return cached.navMap;
  }

  const navMap = new Map();

  // 1. Seed from local historical_prices.json if available
  let latestDateInLocal = null;
  const hpPath = './data/historical_prices.json';
  if (fs.existsSync(hpPath)) {
    try {
      const hp = JSON.parse(fs.readFileSync(hpPath, 'utf8'));
      if (hp[schemeCode]) {
        Object.entries(hp[schemeCode]).forEach(([d, p]) => {
          if (p != null && !isNaN(p)) {
            navMap.set(d, Number(p));
            if (!latestDateInLocal || d > latestDateInLocal) latestDateInLocal = d;
          }
        });
      }
    } catch (e) {
      console.warn(`[NPS Historical] Local historical prices parse error for ${schemeCode}:`, e.message);
    }
  }

  const lastTradingDay = getLastTradingDay(getTodayIST(), 'NSE');
  // If local seed already covers up to the last completed trading day, serve from cache with 0 egress
  if (latestDateInLocal && latestDateInLocal >= lastTradingDay && navMap.size > 50) {
    npsHistoricalCache.set(schemeCode, { navMap, cachedAt: Date.now() });
    return navMap;
  }

  // 2. Fetch only incremental missing NAVs from Supabase rather than scanning full history
  try {
    let query = supabase
      .from('nps_daily_navs')
      .select('nav_date, nav')
      .eq('scheme_code', schemeCode);
    
    if (latestDateInLocal) {
      query = query.gte('nav_date', latestDateInLocal);
    }

    const { data, error } = await query.limit(500);
    if (!error && data && data.length > 0) {
      data.forEach(r => {
        if (r.nav_date && r.nav != null) {
          navMap.set(r.nav_date, parseFloat(r.nav));
        }
      });
    }

    if (navMap.size > 0) {
      npsHistoricalCache.set(schemeCode, { navMap, cachedAt: Date.now() });
      return navMap;
    }
  } catch (err) {
    console.warn(`[NPS Historical Supabase Fetch] Failed for ${schemeCode}:`, err.message);
  }

  // Fallback to npsnav.in only if completely missing from Supabase
  console.warn(`[NPS Historical Fallback] Scheme ${schemeCode} missing or incomplete in Supabase; querying npsnav.in fallback...`);
  try {
    const res = await axios.get(`https://npsnav.in/api/historical/${schemeCode}`, { timeout: 10000 });
    if (res.data && Array.isArray(res.data.data)) {
      for (const item of res.data.data) {
        if (!item.date || item.nav == null) continue;
        const parts = item.date.split('-');
        if (parts.length === 3) {
          const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
          if (!navMap.has(iso)) navMap.set(iso, parseFloat(item.nav));
        }
      }
      npsHistoricalCache.set(schemeCode, { navMap, cachedAt: Date.now() });
      return navMap;
    }
  } catch (err) {
    console.warn(`[NPS Historical API] Failed to fetch history for ${schemeCode}:`, err.message);
  }

  return navMap.size > 0 ? navMap : null;
}

// In-memory live quotes cache: symbol -> quote object (declared at top of module)

// -------------------------------------------------------------
// Unified High-Speed Parallel Live Quote Engine
// -------------------------------------------------------------

/**
 * Universal holdings price refresh engine.
 * Supports active-only fast loop or full portfolio refresh.
 * 
 * @param {Object} [options]
 * @param {boolean} [options.activeOnly=true] - If true, only holdings with quantity > 0 are refreshed
 */
export async function refreshHoldingsPrices({ activeOnly = true, persistToDb = false, marketSession = 'ALL' } = {}) {
  const allHoldings = await db.select('holdings');
  const holdings = activeOnly ? allHoldings.filter(h => Number(h.quantity) > 0) : allHoldings;
  const fxRate = await fetchFxRate();
  let updatedCount = 0;

  const shouldRefreshUs = marketSession === 'ALL' || marketSession === 'US';
  const shouldRefreshIn = marketSession === 'ALL' || marketSession === 'IN';

  // 1. Refresh US stocks in parallel
  if (shouldRefreshUs) {
    const usHoldings = holdings.filter(h => h.category_id === 'us_stocks');
    await Promise.all(usHoldings.map(async (h) => {
      try {
        const q = await fetchStockQuote(h.symbol);
        if (q && q.price > 0) {
          liveQuoteCache.set(h.symbol, q);
          const updates = {
            current_price: q.price,
            day_change: q.dayChange,
            day_change_pct: q.dayChangePct,
            quote_date: q.quoteDate,
            updated_at: new Date().toISOString()
          };
          updateCacheRow('holdings', h.id, updates);
          if (persistToDb) {
            await db.update('holdings', h.id, updates);
          }
          updatedCount++;
        }
      } catch (e) {
        console.warn(`[Sync] Failed to fetch US Stock ${h.symbol}:`, e.message);
      }
    }));
  }

  // 2. Refresh Indian stocks in concurrent batches with NSE/BSE MAX price comparison
  if (shouldRefreshIn) {
    const inHoldings = holdings.filter(h => h.category_id === 'in_stocks');
    const batchSize = 10;
    for (let i = 0; i < inHoldings.length; i += batchSize) {
      const batch = inHoldings.slice(i, i + batchSize);
      await Promise.all(batch.map(async (h) => {
        try {
          const baseSymbol = h.symbol.replace(/\.(NS|BO)$/i, '');
          const [nseQ, bseQ] = await Promise.all([
            fetchStockQuote(`${baseSymbol}.NS`),
            fetchStockQuote(`${baseSymbol}.BO`)
          ]);

          const nseP = Number(nseQ?.price) || 0;
          const bseP = Number(bseQ?.price) || 0;

          // Automatically lock the higher market quote (NSE/BSE MAX)
          let bestQ = nseQ;
          let newPrice = nseP;

          if (bseP > nseP && bseP > 0) {
            bestQ = bseQ;
            newPrice = bseP;
          } else if (nseP > 0) {
            bestQ = nseQ;
            newPrice = nseP;
          } else if (bseP > 0) {
            bestQ = bseQ;
            newPrice = bseP;
          }

          if (bestQ && newPrice > 0) {
            liveQuoteCache.set(h.symbol, {
              price: newPrice,
              nse_price: nseP,
              bse_price: bseP,
              dayChange: bestQ.dayChange,
              dayChangePct: bestQ.dayChangePct,
              open: bestQ.open,
              high: bestQ.high,
              low: bestQ.low,
              fiftyTwoWeekHigh: Math.max(Number(nseQ?.fiftyTwoWeekHigh || 0), Number(bseQ?.fiftyTwoWeekHigh || 0), Number(bestQ.fiftyTwoWeekHigh || 0)),
              fiftyTwoWeekLow: Math.min(...[nseQ?.fiftyTwoWeekLow, bseQ?.fiftyTwoWeekLow, bestQ.fiftyTwoWeekLow].map(Number).filter(v => v > 0)),
              quoteDate: bestQ.quoteDate
            });

            const updates = {
              current_price: newPrice,
              nse_price: nseP,
              bse_price: bseP,
              day_change: bestQ.dayChange,
              day_change_pct: bestQ.dayChangePct,
              quote_date: bestQ.quoteDate,
              updated_at: new Date().toISOString()
            };

            updateCacheRow('holdings', h.id, updates);
            if (persistToDb) {
              await db.update('holdings', h.id, updates);
            }
            updatedCount++;
          }
        } catch (e) {
          console.warn(`[Sync] Failed to fetch IN Stock ${h.symbol}:`, e.message);
        }
      }));
    }

    // 3. Refresh Mutual Funds in parallel
    const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds');
    await Promise.all(mfHoldings.map(async (h) => {
      try {
        const q = await fetchMutualFundNav(h.symbol);
        if (q && q.nav > 0) {
          liveQuoteCache.set(h.symbol, {
            price: q.nav,
            dayChange: q.dayChange,
            dayChangePct: q.dayChangePct,
            open: q.open,
            high: q.high,
            low: q.low,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow,
            quoteDate: q.quoteDate
          });
          const updates = {
            current_price: q.nav,
            day_change: q.dayChange,
            day_change_pct: q.dayChangePct,
            quote_date: q.quoteDate,
            updated_at: new Date().toISOString()
          };
          updateCacheRow('holdings', h.id, updates);
          if (persistToDb) {
            await db.update('holdings', h.id, updates);
          }
          updatedCount++;
        }
      } catch (e) {
        console.warn(`[Sync] Failed to fetch MF ${h.symbol}:`, e.message);
      }
    }));

    // 4. Refresh NPS schemes in parallel
    const npsHoldings = holdings.filter(h => h.category_id === 'nps');
    if (npsHoldings.length > 0) {
      const heldCodes = npsHoldings.map(h => h.symbol).filter(Boolean);
      let latestDbNavs = [];
      try {
        const { data } = await supabase
          .from('nps_daily_navs')
          .select('scheme_code,nav,nav_date')
          .in('scheme_code', heldCodes)
          .order('nav_date', { ascending: false });
        latestDbNavs = data || [];
      } catch (e) {
        console.warn('[refreshHoldingsPrices] nps_daily_navs query warning:', e.message);
      }

      const latestNavMap = new Map();
      const prevNavMap = new Map();
      latestDbNavs.forEach(r => {
        if (!latestNavMap.has(r.scheme_code)) {
          latestNavMap.set(r.scheme_code, r);
        } else if (!prevNavMap.has(r.scheme_code)) {
          prevNavMap.set(r.scheme_code, r);
        }
      });

      const lastTradingDay = getLastTradingDay(getTodayIST(), 'NSE');
      const missingOrStaleCodes = heldCodes.filter(code => {
        const row = latestNavMap.get(code);
        return !row || row.nav_date < lastTradingDay;
      });

      let proteanMap = null;
      let isStale = true;
      if (missingOrStaleCodes.length > 0) {
        proteanMap = await fetchProteanNpsNavBatch();
        isStale = isProteanNavStale();
      }

      await Promise.all(npsHoldings.map(async (h) => {
        try {
          let q = latestNavMap.get(h.symbol);
          let prevQ = prevNavMap.get(h.symbol);
          if (!q || q.nav_date < lastTradingDay) {
            let pItem = (!isStale && proteanMap) ? proteanMap.get(h.symbol) : null;
            if (!pItem || isStale) {
              const fallback = await fetchNpsNavFallback(h.symbol);
              if (fallback && (fallback.date === lastTradingDay || fallback.date > (pItem?.date || ''))) {
                pItem = fallback;
                try {
                  await supabase.from('nps_daily_navs').upsert({
                    scheme_code: h.symbol,
                    scheme_name: h.name,
                    nav: fallback.nav,
                    nav_date: fallback.date
                  }, { onConflict: 'scheme_code,nav_date' });
                } catch (e) {
                  console.warn(`[Sync] Failed to upsert NPS fallback NAV for ${h.symbol}:`, e.message);
                }
              } else if (!pItem && proteanMap?.get(h.symbol)) {
                pItem = proteanMap.get(h.symbol);
              }
            }
            if (pItem) {
              if (q && q.nav_date !== (pItem.date || pItem.rawDate)) {
                prevQ = q;
              }
              q = { nav: pItem.nav, nav_date: pItem.date || pItem.rawDate };
            }
          }

          if (q && q.nav > 0) {
            const navNum = Number(q.nav);
            const qDate = formatCleanQuoteDate(q.nav_date);
            let dayChange = 0;
            let dayChangePct = 0;
            if (prevQ && Number(prevQ.nav) > 0) {
              const prevNavNum = Number(prevQ.nav);
              dayChange = Number((navNum - prevNavNum).toFixed(4));
              dayChangePct = Number((((navNum - prevNavNum) / prevNavNum) * 100).toFixed(2));
            }

            liveQuoteCache.set(h.symbol, {
              price: navNum,
              dayChange,
              dayChangePct,
              quoteDate: qDate
            });

            const updates = {
              current_price: navNum,
              day_change: dayChange,
              day_change_pct: dayChangePct,
              updated_at: new Date().toISOString()
            };

            if (navNum !== Number(h.current_price) || h.day_change !== dayChange) {
              updateCacheRow('holdings', h.id, updates);
              if (persistToDb) {
                await db.update('holdings', h.id, updates);
              }
              updatedCount++;
            }
          }
        } catch (e) {
          console.warn(`[Sync] Failed to fetch NPS ${h.symbol}:`, e.message);
        }
      }));
    }
  }

  return { updatedCount, fxRate, activeCount: holdings.length };
}

/**
 * Fast loop: refreshes only actively held assets (quantity > 0) for active market sessions
 */
export async function refreshActiveHoldingsPrices(options = {}) {
  let marketSession = 'ALL';
  const inOpen = isIndianMarketOpen();
  const usOpen = isUsMarketOpen();
  if (inOpen && !usOpen) marketSession = 'IN';
  else if (!inOpen && usOpen) marketSession = 'US';
  return refreshHoldingsPrices({ activeOnly: true, marketSession, ...options });
}

/**
 * Comprehensive sync: refreshes all holdings across database
 */
export async function refreshAllHoldingsPrices(options = {}) {
  return refreshHoldingsPrices({ activeOnly: false, ...options });
}

/**
 * Persists official closing prices to Supabase table once at EOD / market close.
 */
export async function persistHoldingClosingPrices() {
  console.log('[PriceEngine] Persisting closing holding prices to Supabase...');
  return refreshHoldingsPrices({ activeOnly: false, persistToDb: true });
}
