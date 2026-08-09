import axios from 'axios';
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

export async function refreshAllHoldingsPrices() {
  const holdings = await db.select('holdings');
  const fxRate = await fetchFxRate();
  let updatedCount = 0;

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
