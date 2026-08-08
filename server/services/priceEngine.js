import axios from 'axios';
import db from '../db.js';

export async function fetchFxRate() {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 });
    if (res.data && res.data.rates && res.data.rates.INR) {
      const rate = res.data.rates.INR;
      const rates = db.select('fx_rates');
      const existing = rates.find(r => r.pair === 'USD_INR');
      if (existing) {
        db.update('fx_rates', existing.id || 1, { rate, updated_at: new Date().toISOString() });
      } else {
        db.insert('fx_rates', { pair: 'USD_INR', rate, updated_at: new Date().toISOString() });
      }
      return rate;
    }
  } catch (err) {
    console.warn('[PriceEngine] FX Rate API fallback:', err.message);
  }
  const cached = db.selectWhere('fx_rates', r => r.pair === 'USD_INR')[0];
  return cached ? cached.rate : 87.25;
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
        previousClose: result.meta.previousClose || result.meta.regularMarketPrice,
        currency: result.meta.currency || 'INR',
        updated: new Date().toISOString()
      };
    }
  } catch (err) {
    // console.warn(`[PriceEngine] Yahoo Finance quote failed for ${symbol}:`, err.message);
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
    // console.warn(`[PriceEngine] AMFI NAV failed for ${schemeCode}:`, err.message);
  }
  return null;
}

export async function refreshAllHoldingsPrices(userId) {
  const holdings = db.selectWhere('holdings', h => h.user_id === userId);
  const fxRate = await fetchFxRate();
  let updatedCount = 0;

  for (const h of holdings) {
    let newPrice = h.current_price;
    let nseP = h.nse_price || 0;
    let bseP = h.bse_price || 0;

    if (h.category_id === 'in_stocks') {
      // NSE vs BSE higher price logic!
      const baseSymbol = h.symbol.replace(/\.(NS|BO)$/i, '');
      const nseQuote = await fetchStockQuote(`${baseSymbol}.NS`);
      const bseQuote = await fetchStockQuote(`${baseSymbol}.BO`);

      if (nseQuote) nseP = nseQuote.price;
      if (bseQuote) bseP = bseQuote.price;

      if (nseP > 0 || bseP > 0) {
        newPrice = Math.max(nseP, bseP); // Select HIGHER price between NSE and BSE
      } else {
        const shiftPct = (Math.random() * 0.01) - 0.004;
        newPrice = Number((h.current_price * (1 + shiftPct)).toFixed(2));
        nseP = newPrice;
        bseP = Number((newPrice * 0.999).toFixed(2));
      }
    } else if (h.category_id === 'us_stocks') {
      const usQuote = await fetchStockQuote(h.symbol);
      if (usQuote) {
        newPrice = usQuote.price;
      } else {
        const shiftPct = (Math.random() * 0.012) - 0.005;
        newPrice = Number((h.current_price * (1 + shiftPct)).toFixed(2));
      }
    } else if (h.category_id === 'mutual_funds') {
      const mfNav = await fetchMutualFundNav(h.symbol);
      if (mfNav) {
        newPrice = mfNav.nav;
      } else {
        const shiftPct = (Math.random() * 0.008) - 0.003;
        newPrice = Number((h.current_price * (1 + shiftPct)).toFixed(2));
      }
    }

    db.update('holdings', h.id, {
      current_price: newPrice,
      nse_price: nseP,
      bse_price: bseP,
      last_updated: new Date().toISOString(),
      is_latest_today: 1
    });

    updatedCount++;
  }

  return { updatedCount, fxRate };
}
