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
      return {
        price: result.meta.regularMarketPrice,
        adjustedClose: (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].adjclose && result.indicators.quote[0].adjclose[0]) || result.meta.regularMarketPrice,
        previousClose: result.meta.previousClose || result.meta.regularMarketPrice,
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
      return {
        nav: parseFloat(latest.nav),
        date: latest.date
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

      if (nseQuote) nseP = nseQuote.adjustedClose ?? nseQuote.price;
      if (bseQuote) bseP = bseQuote.adjustedClose ?? bseQuote.price;

      if (nseP > 0 || bseP > 0) {
        newPrice = Math.max(nseP, bseP);
      }
    } else if (h.category_id === 'us_stocks') {
      const usQuote = await fetchStockQuote(h.symbol);
      if (usQuote) {
        newPrice = usQuote.adjustedClose ?? usQuote.price;
      }
    } else if (h.category_id === 'mutual_funds') {
      const mfNav = await fetchMutualFundNav(h.symbol);
      if (mfNav) {
        newPrice = mfNav.nav;
      }
    } else if (h.category_id === 'nps') {
      // Primary: Protean batch data, Fallback: npsnav.in per-scheme
      let npsNav = null;
      if (proteanNavMap && proteanNavMap.has(h.symbol)) {
        npsNav = proteanNavMap.get(h.symbol);
        console.log(`[NPS] ${h.symbol} -> Protean NAV: ${npsNav.nav}`);
      } else {
        npsNav = await fetchNpsNavFallback(h.symbol);
        if (npsNav) {
          console.log(`[NPS] ${h.symbol} -> npsnav.in fallback NAV: ${npsNav.nav}`);
        }
      }
      if (npsNav) {
        newPrice = npsNav.nav;
      }
    }

    if (newPrice !== Number(h.current_price)) {
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
