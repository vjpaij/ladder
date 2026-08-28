import axios from 'axios';
import AdmZip from 'adm-zip';
import db from '../db.js';

export const liveQuoteCache = new Map();

export async function fetchFxRate() {
  try {
    const quote = await fetchStockQuote('INR=X');
    if (quote && quote.price > 0) {
      liveQuoteCache.set('USDINR', quote);
      return quote.price;
    }
  } catch (err) {
    // Yahoo Finance FX fallback
  }

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

export function formatCleanQuoteDate(dateStr, timeZone) {
  if (!dateStr) return null;
  if (typeof dateStr === 'number') {
    const opts = { day: '2-digit', month: 'short', year: 'numeric' };
    if (timeZone) opts.timeZone = timeZone;
    return new Date(dateStr * 1000).toLocaleDateString('en-GB', opts);
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
        const d = new Date(Date.UTC(parseInt(year, 10), mNum - 1, parseInt(day, 10)));
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      }
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const opts = { day: '2-digit', month: 'short', year: 'numeric' };
      if (timeZone) opts.timeZone = timeZone;
      return parsed.toLocaleDateString('en-GB', opts);
    }
  }
  return dateStr;
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

      // Derive exchange timezone so US stocks reflect US trading date (e.g. 27 Aug 2026) and Indian stocks reflect Indian date (28 Aug 2026)
      const exchangeTz = result.meta.exchangeTimezoneName || (symbol.endsWith('.NS') || symbol.endsWith('.BO') ? 'Asia/Kolkata' : 'America/New_York');
      const quoteTime = result.meta.regularMarketTime || Math.floor(Date.now() / 1000);
      const d = new Date(quoteTime * 1000);
      const quoteDate = d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: exchangeTz
      });

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
        quoteDate,
        exchangeTimezone: exchangeTz,
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
    // AMFI NAV fallback
  }
  return null;
}

// ---------------------------------------------------------------------------
// NPS NAV: Primary source = Protean CRA official ZIP, Fallback = npsnav.in
// ---------------------------------------------------------------------------

export async function fetchProteanNpsNavBatch() {
  try {
    const pageRes = await axios.get('https://www.npscra.proteantech.in/nav-search.php', {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = pageRes.data;

    const zipMatch = html.match(/href=["']([^"']*NAV_File_\d+\.zip)["']/i);
    if (!zipMatch) {
      return null;
    }

    let zipUrl = zipMatch[1];
    if (!zipUrl.startsWith('http')) {
      zipUrl = `https://www.npscra.proteantech.in/${zipUrl.replace(/^\//, '')}`;
    }

    const zipRes = await axios.get(zipUrl, {
      timeout: 15000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const zip = new AdmZip(Buffer.from(zipRes.data));
    const entries = zip.getEntries();
    const outEntry = entries.find(e => e.entryName.endsWith('.out'));
    if (!outEntry) {
      return null;
    }

    const csvContent = outEntry.getData().toString('utf8');
    const lines = csvContent.split(/\r?\n/).filter(l => l.trim());

    const navMap = new Map();
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 6) {
        const navDate = parts[0].trim();
        const schemeCode = parts[3].trim();
        const nav = parseFloat(parts[5].trim());
        if (schemeCode && !isNaN(nav) && nav > 0) {
          navMap.set(schemeCode, { nav, date: navDate, quoteDate: formatCleanQuoteDate(navDate) });
        }
      }
    }

    return navMap;
  } catch (err) {
    return null;
  }
}

export async function fetchNpsNavFallback(schemeCode) {
  try {
    const res = await axios.get(`https://npsnav.in/api/historical/${schemeCode}`, { timeout: 8000 });
    if (res.data && Array.isArray(res.data.data) && res.data.data.length > 0) {
      const latest = res.data.data[0];
      const nav = parseFloat(latest.nav);
      if (!isNaN(nav) && nav > 0) {
        return { nav, date: latest.date, quoteDate: formatCleanQuoteDate(latest.date) };
      }
    }
  } catch (err) {
    // fallback
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

// In-memory live quotes cache: symbol -> quote object (declared at top of module)

/**
 * High-speed parallel live quote engine for active portfolio holdings.
 * Refreshes US stocks, active Indian stocks, MFs & NPS schemes in parallel.
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
  const batchSize = 15;
  for (let i = 0; i < inHoldings.length; i += batchSize) {
    const batch = inHoldings.slice(i, i + batchSize);
    await Promise.all(batch.map(async (h) => {
      try {
        const baseSymbol = h.symbol.replace(/\.(NS|BO)$/i, '');
        let bestQ = await fetchStockQuote(`${baseSymbol}.NS`);
        let nseP = bestQ?.price || 0;
        let bseP = 0;

        // Fallback to BSE only if NSE is unavailable
        if (!bestQ || nseP <= 0) {
          const bseQ = await fetchStockQuote(`${baseSymbol}.BO`);
          if (bseQ && bseQ.price > 0) {
            bestQ = bseQ;
            bseP = bseQ.price;
          }
        }

        const newPrice = nseP || bseP || bestQ?.price || 0;

        if (bestQ) {
          liveQuoteCache.set(h.symbol, {
            price: newPrice || bestQ.price,
            dayChange: bestQ.dayChange,
            dayChangePct: bestQ.dayChangePct,
            open: bestQ.open,
            high: bestQ.high,
            low: bestQ.low,
            fiftyTwoWeekHigh: bestQ.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: bestQ.fiftyTwoWeekLow,
            quoteDate: bestQ.quoteDate
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

  // 3. Refresh active Mutual Funds in parallel
  const mfHoldings = activeHoldings.filter(h => h.category_id === 'mutual_funds');
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
        if (q.nav !== Number(h.current_price)) {
          await db.update('holdings', h.id, {
            current_price: q.nav,
            updated_at: new Date().toISOString()
          });
          updatedCount++;
        }
      }
    } catch (e) {}
  }));

  // 4. Refresh active NPS schemes in parallel
  const npsHoldings = activeHoldings.filter(h => h.category_id === 'nps');
  if (npsHoldings.length > 0) {
    const proteanMap = await fetchProteanNpsNavBatch();
    await Promise.all(npsHoldings.map(async (h) => {
      try {
        let q = proteanMap?.get(h.symbol);
        if (!q) q = await fetchNpsNavFallback(h.symbol);
        if (q && q.nav > 0) {
          const qDate = q.quoteDate || formatCleanQuoteDate(q.date);
          liveQuoteCache.set(h.symbol, {
            price: q.nav,
            quoteDate: qDate
          });
          if (q.nav !== Number(h.current_price)) {
            await db.update('holdings', h.id, {
              current_price: q.nav,
              updated_at: new Date().toISOString()
            });
            updatedCount++;
          }
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

  const npsHoldings = holdings.filter(h => h.category_id === 'nps');
  let proteanNavMap = null;
  if (npsHoldings.length > 0) {
    proteanNavMap = await fetchProteanNpsNavBatch();
  }

  for (const h of holdings) {
    let newPrice = Number(h.current_price) || 0;
    let nseP = Number(h.nse_price) || 0;
    let bseP = Number(h.bse_price) || 0;
    let qDate = null;

    if (h.category_id === 'in_stocks') {
      const baseSymbol = h.symbol.replace(/\.(NS|BO)$/i, '');
      const nseQuote = await fetchStockQuote(`${baseSymbol}.NS`);
      const bseQuote = await fetchStockQuote(`${baseSymbol}.BO`);

      if (nseQuote && nseQuote.price > 0) {
        nseP = nseQuote.price;
        qDate = nseQuote.quoteDate;
        liveQuoteCache.set(h.symbol, nseQuote);
      }
      if (bseQuote && bseQuote.price > 0) {
        bseP = bseQuote.price;
        if (!nseQuote) {
          qDate = bseQuote.quoteDate;
          liveQuoteCache.set(h.symbol, bseQuote);
        }
      }

      if (nseP > 0 || bseP > 0) {
        newPrice = Math.max(nseP, bseP);
      }
    } else if (h.category_id === 'us_stocks') {
      const usQuote = await fetchStockQuote(h.symbol);
      if (usQuote && usQuote.price > 0) {
        newPrice = usQuote.price;
        qDate = usQuote.quoteDate;
        liveQuoteCache.set(h.symbol, usQuote);
      }
    } else if (h.category_id === 'mutual_funds') {
      const mfNav = await fetchMutualFundNav(h.symbol);
      if (mfNav && mfNav.nav > 0) {
        newPrice = mfNav.nav;
        qDate = mfNav.quoteDate;
        liveQuoteCache.set(h.symbol, { price: mfNav.nav, quoteDate: qDate });
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
        qDate = npsNav.quoteDate || formatCleanQuoteDate(npsNav.date);
        liveQuoteCache.set(h.symbol, { price: npsNav.nav, quoteDate: qDate });
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
