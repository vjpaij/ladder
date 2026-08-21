import fs from 'fs';
import path from 'path';
import { db, initDatabase } from '../server/db.js';
import { fetchFxRate } from '../server/services/priceEngine.js';

const EOD_FILE = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
const HISTORICAL_FILE = path.join(process.cwd(), 'data', 'historical_prices.json');

let historicalFxRatesCache = {};
const FX_FILE = path.join(process.cwd(), 'data', 'historical_fx_rates.json');
if (fs.existsSync(FX_FILE)) {
  historicalFxRatesCache = JSON.parse(fs.readFileSync(FX_FILE, 'utf-8'));
}

// Helper to get USD/INR rate historically (exact daily if available)
function getHistoricalFxRate(dateStr) {
  if (!dateStr) return 80.5;
  if (historicalFxRatesCache[dateStr]) return historicalFxRatesCache[dateStr];
  
  // If exact date not found, attempt to find nearest previous date
  const prevDates = Object.keys(historicalFxRatesCache).filter(d => d < dateStr).sort().reverse();
  if (prevDates.length > 0) {
    return historicalFxRatesCache[prevDates[0]];
  }

  const year = parseInt(String(dateStr).slice(0, 4), 10);
  if (isNaN(year)) return 80.5;
  if (year <= 2019) return 70.4;
  if (year === 2020) return 74.1;
  if (year === 2021) return 73.9;
  if (year === 2022) return 79.8;
  if (year === 2023) return 82.6;
  if (year === 2024) return 83.5;
  if (year === 2025) return 85.2;
  return 87.25;
}

async function rebuildEod() {
  initDatabase();
  console.log('Rebuilding portfolio EOD logs...');

  let eodLogs = [];
  if (fs.existsSync(EOD_FILE)) {
    eodLogs = JSON.parse(fs.readFileSync(EOD_FILE, 'utf-8'));
  }

  let historicalPrices = {};
  if (fs.existsSync(HISTORICAL_FILE)) {
    historicalPrices = JSON.parse(fs.readFileSync(HISTORICAL_FILE, 'utf-8'));
  }

  const txs = await db.select('transactions');
  txs.sort((a, b) => a.date.localeCompare(b.date));

  const holdings = await db.select('holdings');
  
  // Create a map of eodLog dates
  const eodMap = {};
  eodLogs.forEach(log => {
    eodMap[log.date] = log;
  });

  // Collect all relevant dates
  const allDatesSet = new Set(Object.keys(eodMap));
  
  // Inject dates from historical prices
  for (const [symbol, prices] of Object.entries(historicalPrices)) {
    for (const d of Object.keys(prices)) {
      allDatesSet.add(d);
    }
  }

  const allDates = Array.from(allDatesSet).sort();
  
  // Tracking active quantities for all holdings
  const activeQuantities = {};
  
  let txIdx = 0;
  
  for (const date of allDates) {
    if (!eodMap[date]) {
      eodMap[date] = { date };
    }
    const log = eodMap[date];

    // Process transactions up to this date
    while (txIdx < txs.length && txs[txIdx].date <= date) {
      const tx = txs[txIdx];
      const hId = tx.holding_id;
      if (!activeQuantities[hId]) activeQuantities[hId] = 0;
      
      const qty = Number(tx.quantity) || 0;
      if (tx.type === 'BUY' || tx.type === 'BONUS') {
        activeQuantities[hId] += qty;
      } else if (tx.type === 'SELL') {
        activeQuantities[hId] = Math.max(0, activeQuantities[hId] - qty);
      }
      txIdx++;
    }

    // Now calculate daily value for stocks/MFs
    let stocksValueINR = 0;
    
    for (const [hId, qty] of Object.entries(activeQuantities)) {
      if (qty > 0) {
        const holding = holdings.find(h => h.id === hId || h.id == hId);
        if (holding) {
          const isUS = holding.currency === 'USD';
          const symbol = holding.symbol;
          const prices = historicalPrices[symbol];
          if (prices) {
            let price = prices[date];
            // If price missing for weekend/holiday, try to find the last available
            if (price === undefined) {
              const prevDates = Object.keys(prices).filter(d => d < date).sort().reverse();
              if (prevDates.length > 0) {
                price = prices[prevDates[0]];
              }
            }
            
            if (price !== undefined) {
              const fxRate = isUS ? getHistoricalFxRate(date) : 1.0;
              stocksValueINR += (qty * price * fxRate);
            }
          }
        }
      }
    }
    
    log.stocks_mfs = stocksValueINR;
    
    // We should compute a total daily wealth
    // EOD accounts (Bank, EPF, Loan)
    const bankVal = (log.hdfc || 0) + (log.indusind || 0) + (log.idfc || 0) + (log.rbl || 0) + (log.sbi || 0) + (log.federal || 0);
    const epfVal = log.epf || 0;
    const npsVal = log.nps || 0; // We can integrate NPS later or leave it if it's already in log.nps
    const liabVal = (log.loan || 0) + (log.credits || 0);
    
    log.total_wealth = bankVal + epfVal + npsVal + stocksValueINR - liabVal;
  }

  const finalLogs = Object.values(eodMap).sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(EOD_FILE, JSON.stringify(finalLogs, null, 2));
  console.log(`Rebuilt portfolio EOD logs with stock/MF data for ${finalLogs.length} days!`);
}

rebuildEod().catch(console.error);
