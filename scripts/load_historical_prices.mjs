import fs from 'fs';
import path from 'path';
import axios from 'axios';
import YahooFinance from 'yahoo-finance2';
import { db, initDatabase } from '../server/db.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const DATA_FILE = path.join(process.cwd(), 'data', 'historical_prices.json');

// Delay helper for rate limiting
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchYahooFinanceHistorical(symbol, startDate) {
  try {
    const results = await yahooFinance.chart(symbol, { period1: startDate, interval: '1d' });
    const prices = {};
    if (results && results.quotes) {
      results.quotes.forEach(q => {
        if (q.date && q.adjclose !== undefined && q.adjclose !== null) {
          const dStr = q.date.toISOString().split('T')[0];
          prices[dStr] = q.adjclose;
        }
      });
    }
    return prices;
  } catch (error) {
    console.error(`[Yahoo] Failed to fetch historical for ${symbol}:`, error.message);
    return {};
  }
}

async function fetchMutualFundHistorical(schemeCode) {
  try {
    const res = await axios.get(`https://api.mfapi.in/mf/${schemeCode}`, { timeout: 10000 });
    const prices = {};
    if (res.data && res.data.data) {
      res.data.data.forEach(item => {
        // mfapi returns date in DD-MM-YYYY
        const parts = item.date.split('-');
        if (parts.length === 3) {
          const dStr = `${parts[2]}-${parts[1]}-${parts[0]}`; // Convert to YYYY-MM-DD
          prices[dStr] = parseFloat(item.nav);
        }
      });
    }
    return prices;
  } catch (error) {
    console.error(`[MFAPI] Failed to fetch historical for ${schemeCode}:`, error.message);
    return {};
  }
}

async function getLatestPriceAndDate(prices) {
  const dates = Object.keys(prices).sort();
  if (dates.length === 0) return { price: null, date: null };
  const latestDate = dates[dates.length - 1];
  return { price: prices[latestDate], date: latestDate };
}

async function checkStalenessAndPatch(symbol, prices, startDate, isIndianStock) {
  // Get latest historical price
  const { price: latestHistPrice, date: latestHistDate } = await getLatestPriceAndDate(prices);
  if (latestHistPrice === null) {
    return prices; // No historical data to compare
  }

  // Fetch live quote
  let livePrice = null;
  try {
    const quote = await yahooFinance.quote(symbol);
    livePrice = quote.regularMarketPrice;
  } catch (error) {
    console.error(`  [Yahoo] Failed to fetch live quote for ${symbol}:`, error.message);
    return prices; // Can't check staleness without live price
  }

  if (livePrice === null || livePrice === undefined) {
    return prices;
  }

  // Compare: if difference > 1%, consider stale
  const diffPct = Math.abs(latestHistPrice - livePrice) / livePrice;
  const isStale = diffPct > 0.01;

  if (!isStale) {
    // console.log(`  [Staleness Check] ${symbol}: Historical (${latestHistDate}: ${latestHistPrice.toFixed(2)}) matches live (${livePrice.toFixed(2)}) within 1%.`);
    return prices;
  }

  console.log(`  [Staleness Check] ${symbol}: STALE detected. Historical (${latestHistDate}: ${latestHistPrice.toFixed(2)}) vs Live (${livePrice.toFixed(2)}) diff: ${(diffPct * 100).toFixed(2)}%`);

  // If Indian stock (.NS), try .BO fallback
  if (isIndianStock && symbol.endsWith('.NS')) {
    const boSymbol = symbol.replace('.NS', '.BO');
    console.log(`  [Fallback] Trying ${boSymbol}...`);
    await delay(1000);
    const boPrices = await fetchYahooFinanceHistorical(boSymbol, startDate);
    
    // Check staleness on .BO data
    const { price: boLatestPrice } = await getLatestPriceAndDate(boPrices);
    if (boLatestPrice !== null) {
      const boDiffPct = Math.abs(boLatestPrice - livePrice) / livePrice;
      if (boDiffPct <= 0.01) {
        console.log(`  [Fallback] ${boSymbol} is fresh. Using .BO data.`);
        return boPrices;
      }
      console.log(`  [Fallback] ${boSymbol} also stale (diff: ${(boDiffPct * 100).toFixed(2)}%).`);
    } else {
      console.log(`  [Fallback] ${boSymbol} returned no data.`);
    }
  }

  // If still stale (or US stock), patch today's price
  const today = new Date().toISOString().split('T')[0];
  if (!prices[today]) {
    prices[today] = livePrice;
    console.log(`  [Patch] Injected today's price (${today}: ${livePrice.toFixed(2)}) for ${symbol}.`);
  } else {
    // Update existing today's price if it differs
    prices[today] = livePrice;
    console.log(`  [Patch] Updated today's price (${today}: ${livePrice.toFixed(2)}) for ${symbol}.`);
  }

  return prices;
}

async function run() {
  initDatabase();
  console.log('Loading existing historical prices...');
  
  let historicalData = {};
  if (fs.existsSync(DATA_FILE)) {
    historicalData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }

  const FX_FILE = path.join(process.cwd(), 'data', 'historical_fx_rates.json');
  console.log('Fetching historical daily USD/INR FX rates...');
  const fxPrices = await fetchYahooFinanceHistorical('INR=X', '2010-01-01');
  if (Object.keys(fxPrices).length > 0) {
    fs.writeFileSync(FX_FILE, JSON.stringify(fxPrices, null, 2));
    console.log(`Saved ${Object.keys(fxPrices).length} daily FX records.`);
  } else {
    console.log('Warning: Failed to fetch FX rates.');
  }

  // Find earliest transaction date for each holding
  const txs = await db.select('transactions');
  const earliestDates = {};
  txs.forEach(t => {
    const key = t.holding_id;
    if (!earliestDates[key] || t.date < earliestDates[key]) {
      earliestDates[key] = t.date;
    }
  });

  const holdings = await db.select('holdings');
  const targetCategories = ['in_stocks', 'us_stocks', 'mutual_funds'];
  const targets = holdings.filter(h => targetCategories.includes(h.category_id));

  console.log(`Found ${targets.length} target holdings for historical data ingestion.`);

  for (let i = 0; i < targets.length; i++) {
    const holding = targets[i];
    let symbol = holding.symbol;
    
    console.log(`[${i+1}/${targets.length}] Fetching data for ${symbol}...`);

    let prices = {};
    // Determine start date (fallback to 2010-01-01 if no transactions)
    let startDate = earliestDates[holding.id] || '2010-01-01';
    
    if (holding.category_id === 'mutual_funds') {
      // mfapi returns max history, start date is ignored by the API
      prices = await fetchMutualFundHistorical(symbol);
    } else {
      // Fallbacks for known renamed/delisted Indian stocks on Yahoo
      const symbolMap = {
        'TATAMOTORS': 'TMPV.NS',
        'TATAMTRDVR': 'TMPV.NS',
        'SWANENERGY': '503310.BO'
      };
      
      let fetchSymbol = symbolMap[symbol] || symbol;

      // Yahoo Finance requires proper suffix for Indian stocks
      const isIndianStock = holding.category_id === 'in_stocks';
      if (isIndianStock && !fetchSymbol.endsWith('.NS') && !fetchSymbol.endsWith('.BO')) {
        fetchSymbol = `${fetchSymbol}.NS`;
      }
      
      prices = await fetchYahooFinanceHistorical(fetchSymbol, startDate);
      await delay(1000); // 1s delay to avoid Yahoo rate limits

      // Staleness Detection & Fallback logic
      if (Object.keys(prices).length > 0) {
        prices = await checkStalenessAndPatch(fetchSymbol, prices, startDate, isIndianStock);
      }
    }

    if (Object.keys(prices).length > 0) {
      historicalData[holding.symbol] = prices; // Store by original symbol
      console.log(` -> Fetched ${Object.keys(prices).length} daily records.`);
    } else {
      console.log(` -> No data found.`);
    }

    // Periodically save to avoid losing data on crash
    if (i % 10 === 0) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(historicalData, null, 2));
    }
  }

  // Final save
  fs.writeFileSync(DATA_FILE, JSON.stringify(historicalData, null, 2));
  console.log('Historical data ingestion complete!');
  process.exit(0);
}

run().catch(console.error);
