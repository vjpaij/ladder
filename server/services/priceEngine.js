import axios from 'axios';
import AdmZip from 'adm-zip';
import db from '../db.js';

export async function fetchFxRate() {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 });
    if (res.data && res.data.rates && res.data.rates.INR) {
      const rate = res.data.rates.INR;
      return rate;
    }
  } catch (err) {
    // API fallback
  }
  return 87.25;
}

export async function fetchStockQuote(symbol) {
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

      return {
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
        updated: new Date().toISOString()
      };
    }
  } catch (err) {
    // Yahoo Finance quote fallback
  }
  return null;
}

export async function fetchMutualFundNav(schemeCode) {
  try {
    const res = await axios.get(`https://api.mfapi.in/mf/${schemeCode}`, { timeout: 5000 });
    if (res.data && res.data.data && res.data.data.length > 0) {
      const latest = res.data.data[0];
      const prev = res.data.data[1] || latest;
      const nav = parseFloat(latest.nav);
      const prevNav = parseFloat(prev.nav);
      const dayChange = nav - prevNav;
      const dayChangePct = prevNav > 0 ? Number(((dayChange / prevNav) * 100).toFixed(2)) : 0;

      const yearRecords = res.data.data.slice(0, 252).map(r => parseFloat(r.nav)).filter(n => !isNaN(n));
      const fiftyTwoWeekHigh = yearRecords.length > 0 ? Math.max(...yearRecords) : nav;
      const fiftyTwoWeekLow = yearRecords.length > 0 ? Math.min(...yearRecords) : nav;

      return {
        nav,
        date: latest.date,
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
    // AMFI NAV fallback
  }
  return null;
}

// ---------------------------------------------------------------------------
// NPS NAV: Primary source = Protean CRA official ZIP, Fallback = npsnav.in
// ---------------------------------------------------------------------------

/**
 * Fetch all NPS NAVs in a single batch from the official Protean CRA website.
 * The website publishes a daily ZIP file containing a .out CSV with all scheme NAVs.
 * Returns a Map of schemeCode -> { nav, date } or null if the scraper fails.
 */
export async function fetchProteanNpsNavBatch() {
  try {
    // Step 1: Fetch the NAV search page to discover the ZIP file URL
    const pageRes = await axios.get('https://www.npscra.proteantech.in/nav-search.php', {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = pageRes.data;

    // Step 2: Extract the ZIP URL from the page (pattern: NAV_File_DDMMYYYY.zip)
    const zipMatch = html.match(/href=["']([^"']*NAV_File_\d+\.zip)["']/i);
    if (!zipMatch) {
      console.warn('[NPS Protean] Could not find ZIP URL on page - layout may have changed');
      return null;
    }

    let zipUrl = zipMatch[1];
    if (!zipUrl.startsWith('http')) {
      zipUrl = `https://www.npscra.proteantech.in/${zipUrl.replace(/^\//, '')}`;
    }

    console.log(`[NPS Protean] Downloading ZIP: ${zipUrl}`);

    // Step 3: Download the ZIP as an ArrayBuffer
    const zipRes = await axios.get(zipUrl, {
      timeout: 15000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    // Step 4: Extract the .out file from the ZIP in memory
    const zip = new AdmZip(Buffer.from(zipRes.data));
    const entries = zip.getEntries();
    const outEntry = entries.find(e => e.entryName.endsWith('.out'));
    if (!outEntry) {
      console.warn('[NPS Protean] No .out file found inside ZIP');
      return null;
    }

    const csvContent = outEntry.getData().toString('utf8');
    const lines = csvContent.split(/\r?\n/).filter(l => l.trim());

    // Step 5: Parse CSV lines: Date,PFMCode,PFMName,SchemeCode,SchemeName,NAV
    const navMap = new Map();
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 6) {
        const navDate = parts[0].trim();
        const schemeCode = parts[3].trim();
        const nav = parseFloat(parts[5].trim());
        if (schemeCode && !isNaN(nav) && nav > 0) {
          navMap.set(schemeCode, { nav, date: navDate });
        }
      }
    }

    console.log(`[NPS Protean] Parsed ${navMap.size} scheme NAVs from official data`);
    return navMap;
  } catch (err) {
    console.warn(`[NPS Protean] Scraper failed: ${err.message} - will fall back to npsnav.in`);
    return null;
  }
}

/**
 * Fallback: Fetch a single NPS NAV from the community npsnav.in API.
 */
export async function fetchNpsNavFallback(schemeCode) {
  try {
    const res = await axios.get(`https://npsnav.in/api/${schemeCode}`, { timeout: 5000 });
    if (res.data) {
      const nav = parseFloat(String(res.data).trim());
      if (!isNaN(nav) && nav > 0) {
        return { nav, date: new Date().toISOString().split('T')[0] };
      }
    }
  } catch (err) {
    // npsnav.in fallback also failed
  }
  return null;
}

// In-memory cache for historical NAV series: schemeCode -> { navMap: Map<YYYY-MM-DD, number>, cachedAt: timestamp }
const npsHistoricalCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fetch historical daily NAV series for an NPS scheme code.
 * Returns a Map of 'YYYY-MM-DD' -> nav (number) or null if fetch fails.
 */
export async function fetchNpsHistoricalNav(schemeCode) {
  const cached = npsHistoricalCache.get(schemeCode);
  if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
    return cached.navMap;
  }

  try {
    const res = await axios.get(`https://npsnav.in/api/historical/${schemeCode}`, { timeout: 10000 });
    if (res.data && Array.isArray(res.data.data)) {
      const navMap = new Map();
      for (const item of res.data.data) {
        if (!item.date || item.nav == null) continue;
        const parts = item.date.split('-');
        if (parts.length === 3) {
          const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
          navMap.set(iso, parseFloat(item.nav));
        }
      }
      npsHistoricalCache.set(schemeCode, { navMap, cachedAt: Date.now() });
      return navMap;
    }
  } catch (err) {
    console.warn(`[NPS Historical API] Failed to fetch history for ${schemeCode}:`, err.message);
  }
  return null;
}

// In-memory live quotes cache: symbol -> quote object
export const liveQuoteCache = new Map();

/**
 * High-speed parallel live quote engine for active portfolio holdings.
 * Refreshes US stocks & active Indian stocks in < 1-2 seconds.
 */
export async function refreshActiveHoldingsPrices() {
  const holdings = await db.select('holdings');
  const activeHoldings = holdings.filter(h => Number(h.quantity) > 0);
  const fxRate = await fetchFxRate();
  let updatedCount = 0;

  // 1. Refresh active US stocks in parallel
  const usHoldings = activeHoldings.filter(h => h.category_id === 'us_stocks');
  await Promise.all(usHoldings.map(async (h) => {
    try {
      const q = await fetchStockQuote(h.symbol);
      if (q && q.price > 0) {
        liveQuoteCache.set(h.symbol, q);
        if (q.price !== Number(h.current_price)) {
          await db.update('holdings', h.id, {
            current_price: q.price,
            updated_at: new Date().toISOString()
          });
          updatedCount++;
        }
      }
    } catch (e) {}
  }));

  // 2. Refresh active Indian stocks in concurrent batches
  const inHoldings = activeHoldings.filter(h => h.category_id === 'in_stocks');
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
        let nseP = nseQ?.price || 0;
        let bseP = bseQ?.price || 0;
        let newPrice = Math.max(nseP, bseP);
        const bestQ = (nseP >= bseP ? nseQ : bseQ) || nseQ || bseQ;

        if (bestQ) {
          liveQuoteCache.set(h.symbol, {
            price: newPrice || bestQ.price,
            dayChange: bestQ.dayChange,
            dayChangePct: bestQ.dayChangePct,
            open: bestQ.open,
            high: bestQ.high,
            low: bestQ.low,
            fiftyTwoWeekHigh: bestQ.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: bestQ.fiftyTwoWeekLow
          });
        }

        if (newPrice > 0 && newPrice !== Number(h.current_price)) {
          await db.update('holdings', h.id, {
            current_price: newPrice,
            nse_price: nseP,
            bse_price: bseP,
            updated_at: new Date().toISOString()
          });
          updatedCount++;
        }
      } catch (e) {}
    }));
  }

  return { updatedCount, fxRate, activeCount: activeHoldings.length };
}

export async function refreshAllHoldingsPrices() {
  const holdings = await db.select('holdings');
  const fxRate = await fetchFxRate();
  let updatedCount = 0;

  // Pre-fetch all NPS NAVs in a single batch from Protean (or null if scraper fails)
  const npsHoldings = holdings.filter(h => h.category_id === 'nps');
  let proteanNavMap = null;
  if (npsHoldings.length > 0) {
    proteanNavMap = await fetchProteanNpsNavBatch();
  }

  for (const h of holdings) {
    let newPrice = Number(h.current_price) || 0;
    let nseP = Number(h.nse_price) || 0;
    let bseP = Number(h.bse_price) || 0;

    if (h.category_id === 'in_stocks') {
      const baseSymbol = h.symbol.replace(/\.(NS|BO)$/i, '');
      const nseQuote = await fetchStockQuote(`${baseSymbol}.NS`);
      const bseQuote = await fetchStockQuote(`${baseSymbol}.BO`);

      if (nseQuote && nseQuote.price > 0) {
        nseP = nseQuote.price;
        liveQuoteCache.set(h.symbol, nseQuote);
      }
      if (bseQuote && bseQuote.price > 0) {
        bseP = bseQuote.price;
        if (!nseQuote) liveQuoteCache.set(h.symbol, bseQuote);
      }

      if (nseP > 0 || bseP > 0) {
        newPrice = Math.max(nseP, bseP);
      }
    } else if (h.category_id === 'us_stocks') {
      const usQuote = await fetchStockQuote(h.symbol);
      if (usQuote && usQuote.price > 0) {
        newPrice = usQuote.price;
        liveQuoteCache.set(h.symbol, usQuote);
      }
    } else if (h.category_id === 'mutual_funds') {
      const mfNav = await fetchMutualFundNav(h.symbol);
      if (mfNav && mfNav.nav > 0) {
        newPrice = mfNav.nav;
      }
    } else if (h.category_id === 'nps') {
      let npsNav = null;
      if (proteanNavMap && proteanNavMap.has(h.symbol)) {
        npsNav = proteanNavMap.get(h.symbol);
      } else {
        npsNav = await fetchNpsNavFallback(h.symbol);
      }
      if (npsNav && npsNav.nav > 0) {
        newPrice = npsNav.nav;
      }
    }

    if (newPrice > 0 && newPrice !== Number(h.current_price)) {
      await db.update('holdings', h.id, {
        current_price: newPrice,
        nse_price: nseP,
        bse_price: bseP,
        updated_at: new Date().toISOString()
      });
      updatedCount++;
    }
  }

  return { updatedCount, fxRate };
}
