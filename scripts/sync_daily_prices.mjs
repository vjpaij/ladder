import fs from 'fs';
import path from 'path';
import axios from 'axios';
import YahooFinance from 'yahoo-finance2';
import { db, initDatabase } from '../server/db.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const DATA_FILE = path.join(process.cwd(), 'data', 'historical_prices.json');
const FX_FILE = path.join(process.cwd(), 'data', 'historical_fx_rates.json');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchYahooFinanceHistorical(symbol, startDate = '2015-01-01') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const result = res.data?.chart?.result?.[0];
    const prices = {};
    if (result && result.timestamp && result.indicators?.quote?.[0]) {
      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      const adjclose = result.indicators?.adjclose?.[0]?.adjclose || quote.close;
      timestamps.forEach((t, i) => {
        const dStr = new Date(t * 1000).toISOString().split('T')[0];
        const val = adjclose[i] !== null && adjclose[i] !== undefined ? adjclose[i] : quote.close[i];
        if (val !== null && val !== undefined && !isNaN(val) && val > 0) {
          prices[dStr] = Number(Number(val).toFixed(2));
        }
      });
    }
    return prices;
  } catch (error) {
    try {
      const results = await yahooFinance.chart(symbol, { period1: startDate, interval: '1d' });
      const prices = {};
      if (results && results.quotes) {
        results.quotes.forEach(q => {
          if (q.date && (q.adjclose !== undefined || q.close !== undefined)) {
            const dStr = q.date.toISOString().split('T')[0];
            const val = q.adjclose !== undefined && q.adjclose !== null ? q.adjclose : q.close;
            if (val > 0) prices[dStr] = Number(Number(val).toFixed(2));
          }
        });
      }
      return prices;
    } catch (err2) {
      console.error(`[Yahoo] Failed for ${symbol}:`, err2.message);
      return {};
    }
  }
}

async function fetchMutualFundHistorical(schemeCode) {
  try {
    const res = await axios.get(`https://api.mfapi.in/mf/${schemeCode}`, { timeout: 10000 });
    const prices = {};
    if (res.data && res.data.data) {
      res.data.data.forEach(item => {
        const parts = item.date.split('-');
        if (parts.length === 3) {
          const dStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
          prices[dStr] = parseFloat(item.nav);
        }
      });
    }
    return prices;
  } catch (error) {
    console.error(`[MFAPI] Failed for ${schemeCode}:`, error.message);
    return {};
  }
}

async function fetchNpsHistorical(schemeCode) {
  try {
    const res = await axios.get(`https://npsnav.in/api/historical/${schemeCode}`, { timeout: 10000 });
    const prices = {};
    if (res.data && Array.isArray(res.data.data)) {
      res.data.data.forEach(item => {
        if (!item.date || item.nav == null) return;
        const parts = item.date.split('-');
        if (parts.length === 3) {
          const dStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
          prices[dStr] = parseFloat(item.nav);
        }
      });
    }
    return prices;
  } catch (error) {
    console.error(`[NPSNAV] Failed for ${schemeCode}:`, error.message);
    return {};
  }
}

async function syncAllPrices() {
  initDatabase();
  console.log('=== 1. Loading existing historical data ===');
  let historicalData = {};
  if (fs.existsSync(DATA_FILE)) {
    historicalData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }

  let fxData = {};
  if (fs.existsSync(FX_FILE)) {
    fxData = JSON.parse(fs.readFileSync(FX_FILE, 'utf-8'));
  }

  console.log('=== 2. Syncing USD/INR FX Rates ===');
  const freshFx = await fetchYahooFinanceHistorical('INR=X', '2024-01-01');
  if (Object.keys(freshFx).length > 0) {
    fxData = { ...fxData, ...freshFx };
    fs.writeFileSync(FX_FILE, JSON.stringify(fxData, null, 2));
    console.log(`Updated FX rates. Latest FX: ${Object.keys(fxData).sort().pop()} = ${fxData[Object.keys(fxData).sort().pop()]}`);
  }

  console.log('=== 3. Loading active holdings from Supabase ===');
  const holdings = await db.select('holdings');
  const activeHoldings = holdings.filter(h => (Number(h.quantity) || 0) > 0);

  const mfHoldings = activeHoldings.filter(h => h.category_id === 'mutual_funds');
  const npsHoldings = activeHoldings.filter(h => h.category_id === 'nps');
  const usHoldings = activeHoldings.filter(h => h.category_id === 'us_stocks');
  const inHoldings = activeHoldings.filter(h => h.category_id === 'in_stocks');

  console.log(`Active: ${inHoldings.length} Indian Stocks, ${usHoldings.length} US Stocks, ${mfHoldings.length} MFs, ${npsHoldings.length} NPS`);

  // 3a. Sync Mutual Funds
  console.log('--- Syncing Mutual Funds ---');
  for (const h of mfHoldings) {
    const fresh = await fetchMutualFundHistorical(h.symbol);
    if (Object.keys(fresh).length > 0) {
      historicalData[h.symbol] = { ...(historicalData[h.symbol] || {}), ...fresh };
      const latestDate = Object.keys(historicalData[h.symbol]).sort().pop();
      console.log(`[MF] ${h.symbol} (${h.name?.slice(0, 20)}...): Latest ${latestDate} = ${historicalData[h.symbol][latestDate]}`);
    }
  }

  // 3b. Sync NPS
  console.log('--- Syncing NPS Schemes ---');
  for (const h of npsHoldings) {
    const fresh = await fetchNpsHistorical(h.symbol);
    if (Object.keys(fresh).length > 0) {
      historicalData[h.symbol] = { ...(historicalData[h.symbol] || {}), ...fresh };
      const latestDate = Object.keys(historicalData[h.symbol]).sort().pop();
      console.log(`[NPS] ${h.symbol}: Latest ${latestDate} = ${historicalData[h.symbol][latestDate]}`);
    }
  }

  // 3c. Sync US Stocks
  console.log('--- Syncing US Stocks ---');
  for (const h of usHoldings) {
    const fresh = await fetchYahooFinanceHistorical(h.symbol);
    if (Object.keys(fresh).length > 0) {
      historicalData[h.symbol] = { ...(historicalData[h.symbol] || {}), ...fresh };
      const latestDate = Object.keys(historicalData[h.symbol]).sort().pop();
      console.log(`[US] ${h.symbol}: Latest ${latestDate} = $${historicalData[h.symbol][latestDate]}`);
    }
    await delay(300);
  }

  // 3d. Sync Indian Stocks
  console.log('--- Syncing Indian Stocks ---');
  const symbolMap = {
    'TATAMOTORS': 'TMPV.NS',
    'TATAMTRDVR': 'TMPV.NS',
    'SWANENERGY': '503310.BO'
  };

  for (let i = 0; i < inHoldings.length; i++) {
    const h = inHoldings[i];
    let fetchSym = symbolMap[h.symbol] || h.symbol;
    if (!fetchSym.endsWith('.NS') && !fetchSym.endsWith('.BO')) {
      fetchSym = `${fetchSym}.NS`;
    }
    const fresh = await fetchYahooFinanceHistorical(fetchSym);
    if (Object.keys(fresh).length > 0) {
      historicalData[h.symbol] = { ...(historicalData[h.symbol] || {}), ...fresh };
      const latestDate = Object.keys(historicalData[h.symbol]).sort().pop();
      console.log(`[IN ${i+1}/${inHoldings.length}] ${h.symbol}: Latest ${latestDate} = ₹${historicalData[h.symbol][latestDate]}`);
    } else {
      // Try .BO fallback
      if (fetchSym.endsWith('.NS')) {
        const boSym = fetchSym.replace('.NS', '.BO');
        const boFresh = await fetchYahooFinanceHistorical(boSym);
        if (Object.keys(boFresh).length > 0) {
          historicalData[h.symbol] = { ...(historicalData[h.symbol] || {}), ...boFresh };
          const latestDate = Object.keys(historicalData[h.symbol]).sort().pop();
          console.log(`[IN ${i+1}/${inHoldings.length} - BO fallback] ${h.symbol}: Latest ${latestDate} = ₹${historicalData[h.symbol][latestDate]}`);
        }
      }
    }
    await delay(250);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(historicalData, null, 2));
  console.log(`Saved updated historical prices for ${Object.keys(historicalData).length} symbols to ${DATA_FILE}`);
}

syncAllPrices().catch(console.error);
