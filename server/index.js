import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db, { initDatabase } from './db.js';
import { supabase } from './supabaseClient.js';
import { refreshAllHoldingsPrices, refreshActiveHoldingsPrices, liveQuoteCache, fetchFxRate, fetchNpsHistoricalNav, fetchMutualFundNav, formatCleanQuoteDate, syncAllMissingNavs, syncDailyNpsNavs } from './services/priceEngine.js';
import { calculateXirr, calculateAbsoluteReturn } from './services/xirrCalculator.js';
import { computeHoldingValueINR, computePortfolioValuation } from './services/portfolioCalculator.js';
import { recalculateHoldingState } from './services/recalculator.js';
import { processDueSips } from './services/sipEngine.js';
import { computeGrowthBenchmarks, invalidateBenchmarkCache } from './services/benchmarkEngine.js';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'ladder-super-secret-key-2026';

app.use(cors());
app.use(express.json());

// Process-level resilience against network drops & unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Server Warning] Unhandled Promise Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.warn('[Server Warning] Uncaught Exception:', err?.message || err);
});

process.on('uncaughtException', (err) => {
  console.error('[Server Error] Uncaught Exception:', err?.message || err);
});

// Initialize DB engine connection
initDatabase();

let historicalPricesCache = {};
let historicalFxRatesCache = {};

function loadHistoricalPrices() {
  const p = './data/historical_prices.json';
  if (fs.existsSync(p)) {
    try {
      historicalPricesCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
      console.log(`[Historical Pricing] Loaded cache for ${Object.keys(historicalPricesCache).length} assets.`);
    } catch (e) {
      console.error('[Historical Pricing] Failed to parse cache:', e.message);
    }
  }

  const fxP = './data/historical_fx_rates.json';
  if (fs.existsSync(fxP)) {
    try {
      historicalFxRatesCache = JSON.parse(fs.readFileSync(fxP, 'utf-8'));
      console.log(`[Historical Pricing] Loaded FX rates cache with ${Object.keys(historicalFxRatesCache).length} daily records.`);
    } catch (e) {
      console.error('[Historical Pricing] Failed to parse FX cache:', e.message);
    }
  }
}
loadHistoricalPrices();

// Helper to format date string to DD-MM-YYYY
function formatDateDDMMYYYY(dateStr) {
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
  } catch (e) { }

  const parts = str.split(/[-T /]/);
  if (parts.length >= 3) {
    if (parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    }
  }
  return str;
}

// Historical USD/INR exchange rate lookup for US stocks transaction dates
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

// Middleware: Authenticate Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    req.user = { userId: 1, email: 'admin@ladder.com' };
    return next();
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) req.user = { userId: 1, email: 'admin@ladder.com' };
    else req.user = user;
    next();
  });
}

// -------------------------------------------------------------
// Auth Routes
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const users = await db.selectWhere('users', { email: email || 'admin@ladder.com' });
  const user = users[0];

  if (!user && (email === 'admin@ladder.com' || !email)) {
    const token = jwt.sign({ userId: 1, email: 'admin@ladder.com' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: 1, email: 'admin@ladder.com', name: 'Vijay Pai' } });
  }

  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = bcrypt.compareSync(password || 'admin123', user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// -------------------------------------------------------------
// Portfolio Summary & Metrics API
// -------------------------------------------------------------
app.get('/api/summary', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    const categories = await db.select('categories');
    const liabilities = await db.select('liabilities');

    const catMap = {};
    categories.forEach(c => catMap[c.id] = c);

    // Clean display name mapping
    const DISPLAY_NAMES = {
      'in_stocks': 'Indian Equity',
      'us_stocks': 'US Equity',
      'mutual_funds': 'Mutual Funds',
      'nps': 'NPS',
      'bank': 'Bank Accounts',
      'epf': 'EPF',
      'loans': 'Loan',
      'credit_cards': 'Credit Card'
    };

    let totalAssetsINR = 0;
    let totalInvestedINR = 0;
    let totalInvestedUSD = 0;   // raw USD invested (for correct USD display)
    let totalRealizedPnlINR = 0;
    let totalRealizedPnlUSD = 0;

    // Compute exact weighted transaction FX rates for US stocks for invested amount
    const usTxsRes = await supabase.from('transactions').select('holding_id, symbol, total_amount, fx_rate').eq('currency', 'USD').eq('type', 'BUY');
    const usFxMap = {};
    if (usTxsRes.data) {
      usTxsRes.data.forEach(t => {
        const key = t.holding_id || t.symbol;
        if (!usFxMap[key]) usFxMap[key] = { totalUSD: 0, totalINR: 0 };
        const amt = Number(t.total_amount) || 0;
        const rate = Number(t.fx_rate) || 82.5;
        usFxMap[key].totalUSD += amt;
        usFxMap[key].totalINR += amt * rate;
      });
    }

    // Fetch dividends — use correct field: amount_inr (not total_amount)
    const dividends = await db.select('dividends');
    const divMap = {}; // holding_id -> total dividends INR
    const divCashflows = [];
    dividends.forEach(d => {
      const h = holdings.find(item => item.id === d.holding_id);
      const amtINR = Number(d.amount_inr) || 0;
      if (!divMap[d.holding_id]) divMap[d.holding_id] = 0;
      divMap[d.holding_id] += amtINR;
      divCashflows.push({ date: d.ex_date || d.payment_date, amount: amtINR, category_id: h ? h.category_id : null });
    });

    holdings.forEach(h => {
      // Realized P&L — sum across ALL holdings (including closed) + DIVIDENDS
      const capitalGain = Number(h.realized_pnl) || 0;
      const divIncome = divMap[h.id] || 0;
      if (h.currency === 'USD') {
        totalRealizedPnlUSD += capitalGain + (divIncome / fxRate);
        totalRealizedPnlINR += (capitalGain * fxRate) + divIncome;
      } else {
        totalRealizedPnlINR += capitalGain + divIncome;
        totalRealizedPnlUSD += (capitalGain + divIncome) / fxRate;
      }

      // Active holdings only for assets and invested
      if ((Number(h.quantity) || 0) <= 0) return;

      const liveQuote = liveQuoteCache.get(h.symbol);
      const currentPriceNum = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(h.current_price) || 0);
      const currentVal = computeHoldingValueINR(h, currentPriceNum, fxRate);
      totalAssetsINR = Number((totalAssetsINR + currentVal).toFixed(2));

      if (h.currency === 'USD') {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        const txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : getHistoricalFxRate(h.created_at || '2022-09-15');
        const investedUSD = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
        totalInvestedUSD += investedUSD;
        totalInvestedINR += investedUSD * txRate;
      } else {
        const investedVal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
        totalInvestedINR += investedVal;
      }
    });

    let totalLiabilitiesINR = 0;
    liabilities.forEach(l => {
      totalLiabilitiesINR += (Number(l.outstanding_balance) || 0);
    });

    const netWorthINR = totalAssetsINR - totalLiabilitiesINR;
    const totalGainINR = totalAssetsINR - totalInvestedINR;
    const absoluteReturnPct = calculateAbsoluteReturn(totalInvestedINR, totalAssetsINR);

    // -------------------------------------------------------------
    // Granular Asset Class Metrics & XIRR
    // -------------------------------------------------------------
    const txs = await db.select('transactions');
    const overallCashflows = [];
    const validXirrCategories = new Set(['in_stocks', 'us_stocks', 'mutual_funds', 'nps']);
    let xirrFinalAssetsINR = 0;

    const categoryMetricsMap = {};
    categories.forEach(c => {
      categoryMetricsMap[c.id] = {
        id: c.id,
        name: DISPLAY_NAMES[c.id] || c.name,
        color: c.color,
        investedINR: 0,
        currentINR: 0,
        realizedINR: 0,
        unrealizedINR: 0,
        cashflows: [],
        holdingsCovered: new Set() // track which holdings have transactions
      };
    });

    // 1. Group Holdings data by category
    holdings.forEach(h => {
      const cat = categoryMetricsMap[h.category_id];
      if (!cat) return;

      // Realized (capital gain + dividends) for this holding
      const capitalGain = (Number(h.realized_pnl) || 0) * (h.currency === 'USD' ? fxRate : 1.0);
      const divIncome = divMap[h.id] || 0;
      cat.realizedINR += capitalGain + divIncome;

      // Active holdings
      if ((Number(h.quantity) || 0) > 0) {
        const liveRate = h.currency === 'USD' ? fxRate : 1.0;
        const liveQuote = liveQuoteCache.get(h.symbol);
        const currentPriceNum = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(h.current_price) || 0);
        const currentVal = (Number(h.quantity) || 0) * currentPriceNum * liveRate;

        let txRate = 1.0;
        if (h.currency === 'USD') {
          const m = usFxMap[h.id] || usFxMap[h.symbol];
          txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : getHistoricalFxRate(h.created_at || '2022-09-15');
        }
        const investedVal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0) * txRate;

        cat.currentINR += currentVal;
        cat.investedINR += investedVal;
        cat.unrealizedINR += (currentVal - investedVal);

        if (validXirrCategories.has(h.category_id)) {
          xirrFinalAssetsINR += currentVal;
        }
      }
    });

    // 2. Build Category Cashflows from actual transactions
    txs.forEach(t => {
      const h = holdings.find(item => item.id === t.holding_id);
      if (!h) return;
      const rate = (h.currency === 'USD') ? getHistoricalFxRate(t.date) : 1.0;
      const amount = (t.type === 'BUY' ? -1 : 1) * (Number(t.total_amount) || 0) * rate;
      const flow = { date: t.date, amount };

      if (categoryMetricsMap[h.category_id]) {
        categoryMetricsMap[h.category_id].cashflows.push(flow);
        categoryMetricsMap[h.category_id].holdingsCovered.add(h.id);
      }
      if (validXirrCategories.has(h.category_id)) {
        overallCashflows.push(flow);
      }
    });

    // 3. Add dividends to cashflows
    divCashflows.forEach(flow => {
      if (flow.category_id && categoryMetricsMap[flow.category_id]) {
        categoryMetricsMap[flow.category_id].cashflows.push(flow);
      }
      if (flow.category_id && validXirrCategories.has(flow.category_id)) {
        overallCashflows.push(flow);
      }
    });

    // 4. Synthesize cashflows for holdings that have NO transactions in the ledger
    //    Use holdings data: buy_qty * avg_buy_price as total cost
    //    Date: earliest dividend date for that holding, or earliest date in its category
    const holdingEarliestDivDate = {};
    dividends.forEach(d => {
      const date = d.ex_date || d.payment_date;
      if (date && (!holdingEarliestDivDate[d.holding_id] || date < holdingEarliestDivDate[d.holding_id])) {
        holdingEarliestDivDate[d.holding_id] = date;
      }
    });

    // Find earliest real date per category from existing cashflows
    const categoryEarliestDate = {};
    Object.entries(categoryMetricsMap).forEach(([catId, cat]) => {
      let earliest = null;
      cat.cashflows.forEach(cf => {
        if (cf.date && (!earliest || cf.date < earliest)) earliest = cf.date;
      });
      categoryEarliestDate[catId] = earliest;
    });

    holdings.forEach(h => {
      const cat = categoryMetricsMap[h.category_id];
      if (!cat || !validXirrCategories.has(h.category_id)) return;
      if (cat.holdingsCovered.has(h.id)) return; // already has real transactions

      const buyQty = Number(h.buy_qty) || 0;
      const avgPrice = Number(h.avg_buy_price) || 0;
      if (buyQty <= 0 || avgPrice <= 0) return;

      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      const txRate = h.currency === 'USD' ? getHistoricalFxRate(h.created_at || '2022-09-15') : 1.0;
      const totalCostINR = buyQty * avgPrice * txRate;

      // Best date: holding's earliest dividend > category earliest > fallback (must be historical < 2024)
      let holdingDate = holdingEarliestDivDate[h.id] || categoryEarliestDate[h.category_id] || '2022-01-01';
      if (holdingDate > '2024-01-01') holdingDate = '2022-01-01';

      // Synthetic BUY cashflow
      const buyFlow = { date: holdingDate, amount: -totalCostINR };
      cat.cashflows.push(buyFlow);
      overallCashflows.push(buyFlow);

      // If holding is fully sold (quantity=0), add a SELL cashflow
      const sellQty = Number(h.sell_qty) || 0;
      if (sellQty > 0 && (Number(h.quantity) || 0) <= 0) {
        const sellAmount = totalCostINR + ((Number(h.realized_pnl) || 0) * liveRate);
        const sellFlow = { date: holdingDate, amount: sellAmount };
        cat.cashflows.push(sellFlow);
        overallCashflows.push(sellFlow);
      }
    });

    // 5. Finalize Category Metrics & Precise Holding-Level Weighted XIRR
    const categoryMetrics = Object.values(categoryMetricsMap)
      .filter(c => c.investedINR > 0 || c.currentINR > 0 || c.realizedINR > 0)
      .map(c => {
        const catHoldings = holdings.filter(h => h.category_id === c.id);
        const activeHoldings = catHoldings.filter(h => Number(h.quantity) > 0);
        const closedHoldings = catHoldings.filter(h => Number(h.quantity) === 0);

        // Calculate Active XIRR
        let activeCost = 0, activeWeightedXirr = 0;
        activeHoldings.forEach(h => {
          const hTxs = txs.filter(t => t.holding_id === h.id);
          const hDivs = dividends.filter(d => d.holding_id === h.id);
          const flows = [];
          if (hTxs.length > 0) {
            hTxs.forEach(t => flows.push({ date: t.date, amount: (t.type === 'BUY' ? -1 : 1) * Number(t.total_amount || 0) * (h.currency === 'USD' ? getHistoricalFxRate(t.date) : 1.0) }));
          } else {
            let earliestDivDate = null;
            hDivs.forEach(d => {
              const dt = d.ex_date || d.payment_date;
              if (dt && (!earliestDivDate || dt < earliestDivDate)) earliestDivDate = dt;
            });
            let buyDate = '2022-01-01';
            if (earliestDivDate) {
              const dObj = new Date(earliestDivDate);
              dObj.setMonth(dObj.getMonth() - 1);
              buyDate = dObj.toISOString().split('T')[0];
            }
            const rate = h.currency === 'USD' ? getHistoricalFxRate(buyDate) : 1.0;
            const cost = Number(h.quantity) * Number(h.avg_buy_price) * rate;
            flows.push({ date: buyDate, amount: -cost });
          }
          hDivs.forEach(d => flows.push({ date: d.ex_date || d.payment_date, amount: Number(d.amount_inr || 0) }));
          const rate = h.currency === 'USD' ? fxRate : 1.0;
          const liveQuote = liveQuoteCache.get(h.symbol);
          const curPrice = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(h.current_price) || 0);
          const curVal = Number(h.quantity) * curPrice * rate;
          flows.push({ date: new Date().toISOString().split('T')[0], amount: curVal });

          const xirr = calculateXirr(flows);
          const cost = Number(h.quantity) * Number(h.avg_buy_price) * rate;
          activeCost += cost;
          activeWeightedXirr += (xirr * cost);
        });
        const activeXirrPct = activeCost > 0 ? Number((activeWeightedXirr / activeCost).toFixed(2)) : 0;

        // Calculate Closed XIRR
        let closedCost = 0, closedWeightedXirr = 0;
        closedHoldings.forEach(h => {
          const soldQty = Number(h.sell_qty) || Number(h.buy_qty) || 0;
          const avgBuy = Number(h.avg_buy_price) || 0;
          const rate = h.currency === 'USD' ? getHistoricalFxRate(h.created_at || '2023-01-01') : 1.0;
          const cost = soldQty > 0 ? (soldQty * avgBuy * rate) : ((Number(h.invested_amount) || 0) * rate);
          const pnl = (Number(h.realized_pnl) || 0) * (h.currency === 'USD' ? fxRate : 1.0);
          const proceeds = cost + pnl;

          const hTxs = txs.filter(t => t.holding_id === h.id);
          const hDivs = dividends.filter(d => d.holding_id === h.id);
          const flows = [];
          if (hTxs.length > 0) {
            hTxs.forEach(t => flows.push({ date: t.date, amount: (t.type === 'BUY' ? -1 : 1) * Number(t.total_amount || 0) * (h.currency === 'USD' ? getHistoricalFxRate(t.date) : 1.0) }));
          } else {
            flows.push({ date: '2023-01-01', amount: -cost });
          }
          hDivs.forEach(d => flows.push({ date: d.ex_date || d.payment_date, amount: Number(d.amount_inr || 0) }));
          flows.push({ date: '2024-06-01', amount: proceeds });

          const xirr = calculateXirr(flows);
          closedCost += cost;
          closedWeightedXirr += (xirr * cost);
        });
        const closedXirrPct = closedCost > 0 ? Number((closedWeightedXirr / closedCost).toFixed(2)) : 0;

        const totalCategoryCost = activeCost + closedCost;
        const combinedXirrPct = totalCategoryCost > 0 ? Number(((activeWeightedXirr + closedWeightedXirr) / totalCategoryCost).toFixed(2)) : activeXirrPct;

        return {
          id: c.id,
          name: c.name,
          color: c.color,
          investedINR: Number(c.investedINR.toFixed(2)),
          currentINR: Number(c.currentINR.toFixed(2)),
          realizedINR: Number(c.realizedINR.toFixed(2)),
          unrealizedINR: Number(c.unrealizedINR.toFixed(2)),
          activeXirrPct,
          closedXirrPct,
          xirrPct: combinedXirrPct,
          absoluteReturnPct: calculateAbsoluteReturn(c.investedINR, c.currentINR)
        };
      })
      .sort((a, b) => b.currentINR - a.currentINR);

    // Overall Portfolio XIRR (weighted across active investments)
    let totalPortfolioCost = 0, totalPortfolioWeightedXirr = 0;
    categoryMetrics.forEach(c => {
      totalPortfolioCost += c.investedINR;
      totalPortfolioWeightedXirr += (c.activeXirrPct * c.investedINR);
    });
    const xirrPct = totalPortfolioCost > 0 ? Number((totalPortfolioWeightedXirr / totalPortfolioCost).toFixed(2)) : 0;

    // Dynamic Day P&L (Computed relative to yesterday's closing wealth for real-time parity)
    let yesterdayWealth = null;
    try {
      const eodPath = './data/portfolio_eod_logs.json';
      if (fs.existsSync(eodPath)) {
        const raw = fs.readFileSync(eodPath, 'utf8');
        const parsed = JSON.parse(raw);
        const todayStr = new Date().toISOString().slice(0, 10);
        const prevLogs = parsed.filter(l => l.date < todayStr);
        if (prevLogs.length > 0) {
          const l = prevLogs[prevLogs.length - 1];
          yesterdayWealth = l.total_wealth !== undefined ? l.total_wealth : l.wealth;
        } else if (parsed.length > 1) {
          const l = parsed[parsed.length - 2];
          yesterdayWealth = l.total_wealth !== undefined ? l.total_wealth : l.wealth;
        } else if (parsed.length === 1) {
          const l = parsed[0];
          yesterdayWealth = l.total_wealth !== undefined ? l.total_wealth : l.wealth;
        }
      }
    } catch (e) {
      console.warn('[EOD JSON Fetch Error]:', e.message);
    }

    const isWeekend = (new Date().getUTCDay() === 0 || new Date().getUTCDay() === 6);
    const dayPnlINR = isWeekend ? 0 : Number((netWorthINR - yesterdayWealth).toFixed(2));
    const dayPnlPct = isWeekend ? 0 : (yesterdayWealth > 0 ? Number(((dayPnlINR / yesterdayWealth) * 100).toFixed(2)) : 0);

    // Asset Breakdown by Category (clean names)
    const categoryValues = {};
    holdings.forEach(h => {
      if ((Number(h.quantity) || 0) <= 0) return;
      const displayName = DISPLAY_NAMES[h.category_id] || (catMap[h.category_id] ? catMap[h.category_id].name : h.category_id);
      const rate = h.currency === 'USD' ? fxRate : 1.0;
      const val = (Number(h.quantity) || 0) * (Number(h.current_price) || 0) * rate;
      if (!categoryValues[displayName]) categoryValues[displayName] = 0;
      categoryValues[displayName] += val;
    });

    const assetAllocation = Object.keys(categoryValues).map(cat => ({
      name: cat,
      value: Number(categoryValues[cat].toFixed(2)),
      percentage: Number(((categoryValues[cat] / (totalAssetsINR || 1)) * 100).toFixed(1))
    }));

    res.json({
      totalAssetsINR: Number(totalAssetsINR.toFixed(2)),
      totalLiabilitiesINR: Number(totalLiabilitiesINR.toFixed(2)),
      netWorthINR: Number(netWorthINR.toFixed(2)),
      totalInvestedINR: Number(totalInvestedINR.toFixed(2)),
      totalInvestedUSD: Number(totalInvestedUSD.toFixed(2)),
      totalGainINR: Number(totalGainINR.toFixed(2)),
      totalRealizedPnlINR: Number(totalRealizedPnlINR.toFixed(2)),
      totalRealizedPnlUSD: Number(totalRealizedPnlUSD.toFixed(2)),
      absoluteReturnPct,
      xirrPct,
      dayPnlINR: Number(dayPnlINR.toFixed(2)),
      dayPnlPct,
      fxRate,
      assetAllocation,
      categoryMetrics
    });
  } catch (err) {
    console.error('[API Error - /api/summary]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fx-rate', async (req, res) => {
  try {
    const liveRate = await fetchFxRate();
    res.json({ rate: liveRate, timestamp: Date.now() });
  } catch (err) {
    res.json({ rate: 87.25, timestamp: Date.now() });
  }
});

// -------------------------------------------------------------
// Holdings CRUD API
// -------------------------------------------------------------
app.get('/api/holdings', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    const categories = await db.select('categories');
    const catMap = {};
    categories.forEach(c => catMap[c.id] = c);

    // Compute exact weighted transaction FX rates for US stocks
    const usTxs = await supabase.from('transactions').select('holding_id, symbol, total_amount, fx_rate').eq('currency', 'USD').eq('type', 'BUY');
    const usFxMap = {};
    if (usTxs.data) {
      usTxs.data.forEach(t => {
        const key = t.holding_id || t.symbol;
        if (!usFxMap[key]) usFxMap[key] = { totalUSD: 0, totalINR: 0 };
        const amt = Number(t.total_amount) || 0;
        const rate = Number(t.fx_rate) || 82.5;
        usFxMap[key].totalUSD += amt;
        usFxMap[key].totalINR += amt * rate;
      });
    }

    // Fetch Asset Metadata to map sector and capitalisation
    let metaData = null;
    try {
      const { data } = await supabase.from('asset_metadata').select('*');
      metaData = data;
    } catch (e) { }

    // Fallback to local cache if DB was unreachable or empty
    if (!metaData || metaData.length === 0) {
      try {
        const localPath = path.join(__dirname, '../data/asset_metadata.json');
        if (fs.existsSync(localPath)) {
          metaData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        }
      } catch (e) { }
    }

    const metadataMap = {};
    if (metaData) {
      metaData.forEach(m => {
        if (m.symbol) {
          metadataMap[m.symbol] = m;
          metadataMap[m.symbol.toUpperCase()] = m;
          metadataMap[m.symbol.toLowerCase()] = m;
        }
      });
    }

    const formatted = holdings.map(h => {
      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      let txRate = 1.0;
      if (h.currency === 'USD') {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : (getHistoricalFxRate(h.created_at) || 82.5);
      }

      const liveQuote = liveQuoteCache.get(h.symbol);
      const currentPriceNum = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(h.current_price) || 0);
      const currentValueOriginal = (Number(h.quantity) || 0) * currentPriceNum;
      const currentValueINR = computeHoldingValueINR(h, currentPriceNum, fxRate);

      const investedValueOriginal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
      const investedValueINR = investedValueOriginal * txRate;

      const gainINR = currentValueINR - investedValueINR;
      const gainPct = investedValueINR > 0 ? ((gainINR / investedValueINR) * 100).toFixed(2) : 0;

      // Calculate Day Change & Day Change %
      let prevPrice = currentPriceNum;
      let dayChange = (liveQuote && liveQuote.dayChange !== undefined) ? liveQuote.dayChange : h.day_change;
      let dayChangePct = (liveQuote && liveQuote.dayChangePct !== undefined) ? liveQuote.dayChangePct : h.day_change_pct;

      if (dayChange === undefined || dayChangePct === undefined) {
        const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '');
        const hist = historicalPricesCache[h.symbol] || historicalPricesCache[cleanSym] || historicalPricesCache[`${cleanSym}.NS`] || {};
        const dates = Object.keys(hist).sort();
        if (dates.length >= 2) {
          prevPrice = Number(hist[dates[dates.length - 2]]) || currentPriceNum;
        } else if (dates.length === 1) {
          prevPrice = Number(hist[dates[0]]) || currentPriceNum;
        }
        dayChange = currentPriceNum - prevPrice;
        dayChangePct = prevPrice > 0 ? Number(((dayChange / prevPrice) * 100).toFixed(2)) : 0;
      } else {
        prevPrice = currentPriceNum - Number(dayChange);
      }

      const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim();
      const meta = metadataMap[h.symbol] || metadataMap[cleanSym] || metadataMap[cleanSym.toUpperCase()] || {};

      return {
        ...h,
        current_price: currentPriceNum,
        sector: meta.sector || h.sector || 'Unknown',
        market_cap: meta.mcap_category || meta.capitalisation || h.market_cap || 'Unknown',
        market_cap_cr: meta.market_cap || null,
        industry: meta.industry || null,
        category_name: catMap[h.category_id] ? catMap[h.category_id].name : h.category_id,
        category_color: catMap[h.category_id] ? catMap[h.category_id].color : '#3B82F6',
        fxRate: liveRate,
        txFxRate: Number(txRate.toFixed(2)),
        day_change: Number(Number(dayChange || 0).toFixed(2)),
        day_change_pct: Number(Number(dayChangePct || 0).toFixed(2)),
        prev_price: Number(prevPrice.toFixed(2)),
        quote_date: liveQuote?.quoteDate || (h.updated_at ? h.updated_at.split('T')[0] : null),
        currentValueOriginal: Number(currentValueOriginal.toFixed(2)),
        currentValueINR: Number(currentValueINR.toFixed(2)),
        investedValueINR: Number(investedValueINR.toFixed(2)),
        gainINR: Number(gainINR.toFixed(2)),
        gainPct: Number(gainPct)
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/holdings', authenticateToken, async (req, res) => {
  try {
    const { category_id, symbol, name, exchange, quantity, avg_buy_price, current_price, currency, sector, market_cap } = req.body;
    const newHolding = await db.insert('holdings', {
      category_id,
      symbol,
      name,
      exchange: exchange || 'NSE',
      quantity: Number(quantity),
      avg_buy_price: Number(avg_buy_price),
      current_price: Number(current_price || avg_buy_price),
      nse_price: exchange === 'NSE' ? Number(current_price || avg_buy_price) : 0,
      bse_price: exchange === 'BSE' ? Number(current_price || avg_buy_price) : 0,
      currency: currency || 'INR',
      sector: sector || 'General',
      market_cap: market_cap || 'Unknown',
      status: Number(quantity) > 0 ? 'active' : 'closed'
    });

    await db.insert('transactions', {
      holding_id: newHolding.id,
      type: 'BUY',
      quantity: Number(quantity),
      price: Number(avg_buy_price),
      total_amount: Number(quantity) * Number(avg_buy_price),
      currency: currency || 'INR',
      date: new Date().toISOString().split('T')[0],
      notes: `Initial purchase of ${name} (${symbol})`
    });

    res.json({ success: true, id: newHolding.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/holdings/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, avg_buy_price, current_price, name, symbol, sector, market_cap } = req.body;
    await db.update('holdings', id, {
      quantity: Number(quantity),
      avg_buy_price: Number(avg_buy_price),
      current_price: Number(current_price),
      name,
      symbol,
      sector,
      market_cap,
      status: Number(quantity) > 0 ? 'active' : 'closed'
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/holdings/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete('holdings', id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Holding Detail API (for HoldingDetailModal)
// -------------------------------------------------------------
app.get('/api/holding/:holdingId/detail', authenticateToken, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const fxRate = await fetchFxRate();

    // Fetch holding
    const holdings = await db.select('holdings');
    let holding = holdings.find(h => h.id === holdingId || h.id == holdingId || h.symbol === holdingId);

    // If not found in holdings, check liabilities
    if (!holding) {
      const liabilities = await db.select('liabilities');
      const liab = liabilities.find(l => l.id === holdingId || l.id == holdingId || l.category_id === holdingId);
      if (liab) {
        holding = {
          id: liab.id,
          name: liab.name,
          symbol: liab.category_id === 'loans' ? 'LOAN' : 'CREDITS',
          category_id: liab.category_id,
          quantity: 1,
          avg_buy_price: liab.outstanding_balance,
          current_price: liab.outstanding_balance,
          currency: 'INR'
        };
      }
    }

    if (!holding) return res.status(404).json({ error: 'Holding not found' });

    // --- Check if Bank, EPF, or Liability account with EOD daily tracking ---
    const eodKeyMap = {
      'HDFC-SAVINGS': 'hdfc',
      'INDUSIND-SAVINGS': 'indusind',
      'IDFC-SAVINGS': 'idfc',
      'RBL-SAVINGS': 'rbl',
      'SBI-SAVINGS': 'sbi',
      'FEDERAL-SAVINGS': 'federal',
      'EPF-RETIREMENT': 'epf',
      'LOAN': 'loan',
      'CREDITS': 'credits'
    };
    let eodKey = eodKeyMap[holding.symbol];
    if (!eodKey) {
      if (holding.category_id === 'bank') {
        if (holding.name.includes('HDFC')) eodKey = 'hdfc';
        else if (holding.name.includes('IndusInd')) eodKey = 'indusind';
        else if (holding.name.includes('IDFC')) eodKey = 'idfc';
        else if (holding.name.includes('RBL')) eodKey = 'rbl';
        else if (holding.name.includes('SBI')) eodKey = 'sbi';
        else if (holding.name.includes('Federal')) eodKey = 'federal';
        else eodKey = 'savings';
      } else if (holding.category_id === 'epf') {
        eodKey = 'epf';
      } else if (holding.category_id === 'loans') {
        eodKey = 'loan';
      } else if (holding.category_id === 'credit_cards') {
        eodKey = 'credits';
      }
    }

    if (eodKey) {
      const eodLogsPath = './data/portfolio_eod_logs.json';
      let eodLogs = [];
      try {
        if (fs.existsSync(eodLogsPath)) {
          eodLogs = JSON.parse(fs.readFileSync(eodLogsPath, 'utf-8'));
        }
      } catch (err) {
        console.error('[Detail API] Error reading eodLogs:', err.message);
      }

      if (eodLogs.length > 0) {
        const activeLogs = eodLogs.filter(l => l[eodKey] !== undefined && l[eodKey] !== null);
        const nonZeroLogs = activeLogs.filter(l => l[eodKey] > 0);
        const validLogs = nonZeroLogs.length > 0 ? nonZeroLogs : activeLogs;

        const livePrice = Number(holding.current_price);
        const currentVal = (livePrice !== undefined && livePrice !== null && !isNaN(livePrice) && livePrice > 0)
          ? livePrice
          : (validLogs[validLogs.length - 1]?.[eodKey] || 0);
        const peakVal = Math.max(...validLogs.map(l => l[eodKey]), currentVal);
        const minVal = Math.min(...validLogs.map(l => l[eodKey]), currentVal);
        const startVal = validLogs[0]?.[eodKey] || 0;
        const startDate = validLogs[0]?.date || '—';

        // Calculate 1 Year Delta
        const oneYearAgoDate = new Date();
        oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
        const oneYearAgoStr = oneYearAgoDate.toISOString().split('T')[0];
        const yearAgoLog = validLogs.find(l => l.date >= oneYearAgoStr) || validLogs[0];
        const yearAgoVal = yearAgoLog?.[eodKey] || startVal;
        const oneYearDelta = currentVal - yearAgoVal;
        const oneYearPct = yearAgoVal > 0 ? ((oneYearDelta / yearAgoVal) * 100).toFixed(2) : 0;

        // Build Daily Timeline without sampling
        const step = 1;
        const timelineINR = [];
        for (let i = 0; i < validLogs.length; i += step) {
          const item = validLogs[i];
          const val = Number(item[eodKey].toFixed(2));
          timelineINR.push({
            label: item.date,
            invested: val,
            value: val,
            balance: val
          });
        }
        // Ensure last record and today are included
        const lastLog = validLogs[validLogs.length - 1];
        if (timelineINR.length > 0 && timelineINR[timelineINR.length - 1].label !== lastLog.date) {
          const lastVal = Number(lastLog[eodKey].toFixed(2));
          timelineINR.push({
            label: lastLog.date,
            invested: lastVal,
            value: lastVal,
            balance: lastVal
          });
        }
        if (timelineINR.length > 0 && timelineINR[timelineINR.length - 1].label < today) {
          timelineINR.push({
            label: today,
            invested: currentVal,
            value: currentVal,
            balance: currentVal
          });
        } else if (timelineINR.length > 0 && timelineINR[timelineINR.length - 1].label === today) {
          timelineINR[timelineINR.length - 1] = {
            label: today,
            invested: currentVal,
            value: currentVal,
            balance: currentVal
          };
        }

        // Generate synthetic transaction history for table rendering
        const txs = [];
        let prevVal = 0;
        const txStep = Math.max(1, Math.floor(validLogs.length / 60)); // ~60 ledger entries
        for (let i = 0; i < validLogs.length; i += txStep) {
          const l = validLogs[i];
          const val = l[eodKey];
          const diff = val - prevVal;
          txs.push({
            id: `eod_${l.date}_${i}`,
            holding_id: holding.id,
            symbol: holding.symbol || 'EOD',
            name: holding.name,
            type: diff >= 0 ? 'BUY' : 'SELL',
            quantity: 1,
            price: val,
            total_amount: Math.abs(diff),
            date: l.date,
            notes: `EOD Balance: ₹${val.toLocaleString('en-IN')}`
          });
          prevVal = val;
        }

        return res.json({
          holding: {
            ...holding,
            current_price: currentVal,
            avg_buy_price: startVal
          },
          fxRate: 1.0,
          transactions: txs.reverse(),
          dividends: [],
          timelineUSD: timelineINR,
          timelineINR,
          metricsUSD: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          metricsINR: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          timeline: timelineINR,
          metrics: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          }
        });
      }
    }

    const isUSD = holding.currency === 'USD';
    const isUSStock = holding.currency === 'USD';
    const currentFx = await fetchFxRate();
    const liveRate = isUSStock ? currentFx : 1.0;

    // Fetch transactions specifically for this holding (prevents Supabase 1000 row limit truncation)
    const { data: txsData, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
      .order('date', { ascending: true });
    if (txErr) console.error('[Detail API] Tx Fetch Error:', txErr.message);
    const txs = txsData || [];

    // Fetch dividends specifically for this holding
    const { data: divsData, error: divErr } = await supabase
      .from('dividends')
      .select('*')
      .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
      .order('ex_date', { ascending: true });
    if (divErr) console.error('[Detail API] Div Fetch Error:', divErr.message);
    const divs = divsData || [];

    // --- Compute metrics in USD and INR ---
    let totalInvestedUSD = 0;
    let totalInvestedINR = 0;
    let totalRedeemedUSD = 0;
    let totalRedeemedINR = 0;
    let realizedPnlUSD = 0;
    let realizedPnlINR = 0;
    let totalBuyChargesUSD = 0;
    let totalBuyChargesINR = 0;
    let totalSellChargesUSD = 0;
    let totalSellChargesINR = 0;

    const buyLotsUSD = [];
    const buyLotsINR = [];

    for (const tx of txs) {
      const qty = Number(tx.quantity) || 0;
      const price = Number(tx.price) || 0;
      const amountUSD = Number(tx.total_amount) || (qty * price);
      const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
      const amountINR = amountUSD * txRate;
      const chargesUSD = Number(tx.charges) || 0;
      const chargesINR = chargesUSD * txRate;

      if (tx.type === 'BUY') {
        totalBuyChargesUSD += chargesUSD;
        totalBuyChargesINR += chargesINR;
        totalInvestedUSD += amountUSD + chargesUSD;
        totalInvestedINR += amountINR + chargesINR;
        buyLotsUSD.push({ qty, price, rem: qty });
        buyLotsINR.push({ qty, priceUSD: price, fxRate: txRate, rem: qty });
      } else if (tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST') {
        buyLotsUSD.push({ qty, price, rem: qty });
        buyLotsINR.push({ qty, priceUSD: price, fxRate: txRate, rem: qty });
      } else if (tx.type === 'SPLIT') {
        let ratio = 1;
        const match = (tx.notes || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
        if (match) {
          const o = parseFloat(match[1]);
          const n = parseFloat(match[2]);
          if (o > 0 && n > 0) ratio = n / o;
        } else if (tx.notes && tx.notes.includes('Multiplier')) {
          const m = tx.notes.match(/Multiplier\s+(\d+(?:\.\d+)?)x/i);
          if (m) ratio = parseFloat(m[1]);
        } else if (Number(tx.quantity) > 0) {
          const curLots = buyLotsINR.reduce((s, l) => s + l.rem, 0);
          if (curLots > 0) ratio = (curLots + Number(tx.quantity)) / curLots;
        }
        if (ratio > 0 && ratio !== 1) {
          for (const lot of buyLotsUSD) {
            lot.rem *= ratio;
            lot.qty *= ratio;
            lot.price /= ratio;
          }
          for (const lot of buyLotsINR) {
            lot.rem *= ratio;
            lot.qty *= ratio;
            lot.priceUSD /= ratio;
          }
        }
      } else if (tx.type === 'SELL') {
        totalSellChargesUSD += chargesUSD;
        totalSellChargesINR += chargesINR;
        totalRedeemedUSD += amountUSD - chargesUSD;
        totalRedeemedINR += amountINR - chargesINR;

        // USD FIFO Realized PnL
        let remUSD = qty;
        while (remUSD > 0 && buyLotsUSD.length > 0) {
          const lot = buyLotsUSD[0];
          const used = Math.min(lot.rem, remUSD);
          realizedPnlUSD += used * (price - lot.price);
          lot.rem -= used;
          remUSD -= used;
          if (lot.rem <= 0) buyLotsUSD.shift();
        }

        // INR FIFO Realized PnL (Sell FX - Buy FX)
        let remINR = qty;
        while (remINR > 0 && buyLotsINR.length > 0) {
          const lot = buyLotsINR[0];
          const used = Math.min(lot.rem, remINR);
          realizedPnlINR += (used * price * txRate) - (used * lot.priceUSD * lot.fxRate);
          lot.rem -= used;
          remINR -= used;
          if (lot.rem <= 0) buyLotsINR.shift();
        }
      }
    }

    const liveQuote = liveQuoteCache.get(holding.symbol);
    const currentQty = Number(holding.quantity) || 0;
    const currentPriceUSD = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(holding.current_price) || 0);
    const avgBuyPriceUSD = Number(holding.avg_buy_price) || 0;

    const currentValueUSD = currentQty * currentPriceUSD;
    const costBasisUSD = currentQty * avgBuyPriceUSD;
    const unrealizedPnlUSD = currentValueUSD - costBasisUSD;
    const unrealizedPctUSD = costBasisUSD > 0 ? Number(((unrealizedPnlUSD / costBasisUSD) * 100).toFixed(2)) : 0;

    const currentValueINR = currentValueUSD * liveRate;
    const activeLotsINR = buyLotsINR.filter(l => l.rem > 0);
    const costBasisINR = activeLotsINR.length > 0
      ? activeLotsINR.reduce((s, l) => s + (l.rem * l.priceUSD * l.fxRate), 0)
      : (costBasisUSD * (totalInvestedUSD > 0 ? (totalInvestedINR / totalInvestedUSD) : liveRate));

    const unrealizedPnlINR = currentValueINR - costBasisINR;
    const unrealizedPctINR = costBasisINR > 0 ? Number(((unrealizedPnlINR / costBasisINR) * 100).toFixed(2)) : 0;

    const totalDividendsUSD = isUSStock
      ? divs.reduce((s, d) => s + (Number(d.amount_original) || 0), 0)
      : 0;
    const totalDividendsINR = divs.reduce((s, d) => s + (Number(d.amount_inr) || 0), 0);

    realizedPnlUSD += totalDividendsUSD;
    realizedPnlINR += totalDividendsINR;

    // USD Cashflows & XIRR
    const cashflowsUSD = txs
      .filter(t => t.type === 'BUY' || t.type === 'SELL')
      .map(t => {
        const amt = Number(t.total_amount) || 0;
        const charges = Number(t.charges) || 0;
        return {
          date: t.date,
          amount: (t.type === 'BUY') ? -(amt + charges) : (amt - charges)
        };
      });

    if (isUSStock) {
      for (const d of divs) {
        cashflowsUSD.push({ date: d.ex_date || d.payment_date, amount: (Number(d.amount_original) || 0) });
      }
    }

    if (currentQty > 0) cashflowsUSD.push({ date: today, amount: currentValueUSD });
    const totalXirrUSD = calculateXirr(cashflowsUSD);

    // INR Cashflows & XIRR
    const cashflowsINR = txs
      .filter(t => t.type === 'BUY' || t.type === 'SELL')
      .map(t => {
        const r = isUSStock ? (Number(t.fx_rate) || getHistoricalFxRate(t.date)) : 1.0;
        const amt = (Number(t.total_amount) || 0) * r;
        const charges = (Number(t.charges) || 0) * r;
        return {
          date: t.date,
          amount: (t.type === 'BUY') ? -(amt + charges) : (amt - charges)
        };
      });

    for (const d of divs) {
      cashflowsINR.push({ date: d.ex_date || d.payment_date, amount: (Number(d.amount_inr) || 0) });
    }

    if (currentQty > 0) cashflowsINR.push({ date: today, amount: currentValueINR });
    const totalXirrINR = calculateXirr(cashflowsINR);

    // Timelines
    const timelineUSD = [];
    const timelineINR = [];

    // Group dividends by date
    const divsByDate = {};
    for (const d of divs) {
      const dDate = d.ex_date || d.payment_date || d.created_at || today;
      const dStr = dDate.split('T')[0];
      if (!divsByDate[dStr]) divsByDate[dStr] = [];
      divsByDate[dStr].push(d);
    }

    // High-fidelity historical daily NAV timeline for NPS holdings
    if (holding.category_id === 'nps' && txs.length > 0) {
      const npsNavMap = await fetchNpsHistoricalNav(holding.symbol);
      if (npsNavMap && npsNavMap.size > 0) {
        const sortedNavDates = Array.from(npsNavMap.keys()).sort();
        const firstTxDate = txs[0].date;
        const lastTxDate = txs[txs.length - 1].date;
        const isExited = (Number(holding.quantity) || 0) === 0;
        const relevantDates = sortedNavDates.filter(d => d >= firstTxDate && (!isExited || d <= lastTxDate));

        let runningQ = 0;
        let runningInv = 0;
        let txIdx = 0;

        for (const d of relevantDates) {
          let dayEvents = [];

          while (txIdx < txs.length && txs[txIdx].date <= d) {
            const tx = txs[txIdx];
            const qty = Number(tx.quantity) || 0;
            const amt = Number(tx.total_amount) || (qty * (Number(tx.price) || 0));

            if (tx.date === d && tx.type !== 'DIVIDEND') {
              dayEvents.push({
                type: tx.type,
                qty: qty,
                priceUSD: Number(tx.price) || 0,
                priceINR: Number(tx.price) || 0,
                amountUSD: amt,
                amountINR: amt,
                notes: tx.notes
              });
            }

            if (tx.type === 'BUY' || tx.type === 'BONUS') {
              runningQ += qty;
              runningInv += amt;
            } else if (tx.type === 'SELL') {
              runningQ = Math.max(0, runningQ - qty);
              runningInv = Math.max(0, runningInv - amt);
            }
            txIdx++;
          }

          if (divsByDate[d]) {
            for (const div of divsByDate[d]) {
              dayEvents.push({
                type: 'DIVIDEND',
                qty: 0,
                priceUSD: Number(div.amount_original) || 0,
                priceINR: Number(div.amount_inr) || 0,
                amountUSD: Number(div.amount_original) || 0,
                amountINR: Number(div.amount_inr) || 0,
                notes: 'Dividend payout'
              });
            }
          }

          const nav = npsNavMap.get(d) || 0;
          const val = Math.max(0, runningQ * nav);
          timelineINR.push({
            label: d,
            invested: Number(Math.max(0, runningInv).toFixed(2)),
            value: Number(val.toFixed(2)),
            price: Number(nav.toFixed(4)),
            events: dayEvents.length > 0 ? dayEvents : null
          });
        }

        if (!isExited && (timelineINR.length === 0 || timelineINR[timelineINR.length - 1].label !== today)) {
          const navToday = (Number(holding.current_price) || 0);
          timelineINR.push({
            label: today,
            invested: Number(Math.max(0, costBasisINR).toFixed(2)),
            value: Number(currentValueINR.toFixed(2)),
            price: Number(navToday.toFixed(4)),
            events: null
          });
        }
      }
    }

    // Dense Timeline Construction (for stocks, MFs, and fallback)
    if (timelineINR.length === 0 && txs.length > 0) {
      const histPrices = historicalPricesCache[holding.symbol] || {};
      const firstTxDate = txs[0].date;
      const lastTxDate = txs[txs.length - 1].date;
      const isExited = (Number(holding.quantity) || 0) <= 0;
      const endLimitStr = isExited ? lastTxDate : today;

      let runningQ = 0;
      let runningInvUSD = 0;
      let runningInvINR = 0;
      let txIdx = 0;
      let lastKnownPriceUSD = avgBuyPriceUSD || (Number(holding.current_price) || 0);
      let lastKnownPriceINR = lastKnownPriceUSD * liveRate;

      const startDate = new Date(firstTxDate);
      const endDate = new Date(endLimitStr);
      if (endDate > new Date(today)) endDate.setTime(new Date(today).getTime());

      let currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dStr = currentDate.toISOString().split('T')[0];
        let dayEvents = [];

        // Process any transactions on this day
        while (txIdx < txs.length && txs[txIdx].date <= dStr) {
          const tx = txs[txIdx];
          const qty = Number(tx.quantity) || 0;
          const price = Number(tx.price) || 0;
          const amtUSD = Number(tx.total_amount) || qty * price;
          const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
          const amtINR = amtUSD * txRate;

          if (tx.date === dStr && tx.type !== 'DIVIDEND') {
            dayEvents.push({
              type: tx.type,
              qty: qty,
              priceUSD: price,
              priceINR: price * txRate,
              amountUSD: amtUSD,
              amountINR: amtINR,
              notes: tx.notes
            });
          }

          if (tx.type === 'BUY') {
            runningQ += qty;
            const txChargesUSD = Number(tx.charges) || 0;
            const txChargesINR = txChargesUSD * txRate;
            runningInvUSD += amtUSD + txChargesUSD;
            runningInvINR += amtINR + txChargesINR;
            if (qty > 0) {
              lastKnownPriceUSD = price;
              lastKnownPriceINR = price * txRate;
            }
          } else if (tx.type === 'SELL') {
            const sellCostUSD = runningQ > 0 ? (qty * (runningInvUSD / runningQ)) : 0;
            const sellCostINR = runningQ > 0 ? (qty * (runningInvINR / runningQ)) : 0;
            runningQ = Math.max(0, runningQ - qty);
            runningInvUSD = Math.max(0, runningInvUSD - sellCostUSD);
            runningInvINR = Math.max(0, runningInvINR - sellCostINR);
          } else if (tx.type === 'SPLIT' || tx.type === 'BONUS') {
            // Corporate action event marker
          }
          if (runningQ <= 1e-6) {
            runningQ = 0;
            runningInvUSD = 0;
            runningInvINR = 0;
          }
          txIdx++;
        }

        if (divsByDate[dStr]) {
          for (const d of divsByDate[dStr]) {
            dayEvents.push({
              type: 'DIVIDEND',
              qty: 0,
              priceUSD: Number(d.amount_original) || 0,
              priceINR: Number(d.amount_inr) || 0,
              amountUSD: Number(d.amount_original) || 0,
              amountINR: Number(d.amount_inr) || 0,
              notes: 'Dividend payout'
            });
          }
        }

        // Determine price for this day
        if (dStr === today && currentPriceUSD > 0) {
          lastKnownPriceUSD = currentPriceUSD;
          lastKnownPriceINR = isUSStock ? currentPriceUSD * liveRate : currentPriceUSD;
        } else if (histPrices[dStr] !== undefined) {
          lastKnownPriceUSD = isUSStock ? histPrices[dStr] : histPrices[dStr] / getHistoricalFxRate(dStr);
          lastKnownPriceINR = isUSStock ? histPrices[dStr] * getHistoricalFxRate(dStr) : histPrices[dStr];
        }

        const valUSD = Math.max(0, runningQ * lastKnownPriceUSD);
        const valINR = Math.max(0, runningQ * lastKnownPriceINR);

        timelineUSD.push({
          label: dStr,
          invested: Number(Math.max(0, runningInvUSD).toFixed(2)),
          value: Number(valUSD.toFixed(2)),
          price: Number(lastKnownPriceUSD.toFixed(4)),
          events: dayEvents.length > 0 ? dayEvents : null
        });
        timelineINR.push({
          label: dStr,
          invested: Number(Math.max(0, runningInvINR).toFixed(2)),
          value: Number(valINR.toFixed(2)),
          price: Number(lastKnownPriceINR.toFixed(4)),
          events: dayEvents.length > 0 ? dayEvents : null
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // Extract market quote data for stocks, MFs, NPS
    const activeTimelineData = isUSStock ? timelineUSD : timelineINR;
    let quotePrice = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(holding.current_price) || 0);
    let prevClose = (liveQuote && liveQuote.previousClose) ? Number(liveQuote.previousClose) : quotePrice;
    let dayHigh = (liveQuote && liveQuote.high) ? Number(liveQuote.high) : quotePrice;
    let dayLow = (liveQuote && liveQuote.low) ? Number(liveQuote.low) : quotePrice;
    let openPrice = (liveQuote && liveQuote.open) ? Number(liveQuote.open) : quotePrice;
    let fiftyTwoWeekHigh = (liveQuote && liveQuote.fiftyTwoWeekHigh) ? Number(liveQuote.fiftyTwoWeekHigh) : (Number(holding.fifty_two_week_high) || quotePrice * 1.2);
    let fiftyTwoWeekLow = (liveQuote && liveQuote.fiftyTwoWeekLow) ? Number(liveQuote.fiftyTwoWeekLow) : (Number(holding.fifty_two_week_low) || quotePrice * 0.8);
    let quoteDateStr = liveQuote?.quoteDate || null;

    const cleanSym = (holding.symbol || '').replace(/\.(NS|BO)$/i, '');
    const hist = historicalPricesCache[holding.symbol] || historicalPricesCache[cleanSym] || historicalPricesCache[`${cleanSym}.NS`] || {};
    const histDates = Object.keys(hist).sort();
    if (!liveQuote || !liveQuote.previousClose) {
      if (histDates.length >= 2) {
        prevClose = Number(hist[histDates[histDates.length - 2]]) || quotePrice;
      } else if (histDates.length === 1) {
        prevClose = Number(hist[histDates[0]]) || quotePrice;
      }
    }

    if (activeTimelineData && activeTimelineData.length > 0) {
      const last365 = activeTimelineData.slice(-252);
      const yearPrices = last365.map(p => Number(p.price) || 0).filter(p => p > 0);
      if (yearPrices.length > 0) {
        fiftyTwoWeekHigh = Math.max(...yearPrices, fiftyTwoWeekHigh);
        fiftyTwoWeekLow = Math.min(...yearPrices, fiftyTwoWeekLow);
      }
    }

    if ((!liveQuote || !liveQuote.price) && (holding.category_id === 'in_stocks' || holding.category_id === 'us_stocks')) {
      const sym = holding.category_id === 'in_stocks' ? `${cleanSym}.NS` : holding.symbol;
      try {
        const liveQ = await fetchStockQuote(sym);
        if (liveQ) {
          if (liveQ.price) quotePrice = Number(liveQ.price);
          if (liveQ.previousClose) prevClose = Number(liveQ.previousClose);
          if (liveQ.open) openPrice = Number(liveQ.open);
          dayHigh = Number(liveQ.high) || Math.max(quotePrice, prevClose);
          dayLow = Number(liveQ.low) || Math.min(quotePrice, prevClose);
          if (liveQ.fiftyTwoWeekHigh) fiftyTwoWeekHigh = Number(liveQ.fiftyTwoWeekHigh);
          if (liveQ.fiftyTwoWeekLow) fiftyTwoWeekLow = Number(liveQ.fiftyTwoWeekLow);
          if (liveQ.quoteDate) quoteDateStr = liveQ.quoteDate;
        }
      } catch (e) { /* ignore */ }
    } else if (holding.category_id === 'mutual_funds') {
      try {
        const mfQ = await fetchMutualFundNav(holding.symbol);
        if (mfQ) {
          if (mfQ.nav) quotePrice = Number(mfQ.nav);
          if (mfQ.previousNav) prevClose = Number(mfQ.previousNav);
          openPrice = Number(mfQ.open) || prevClose;
          dayHigh = Number(mfQ.high) || quotePrice;
          dayLow = Number(mfQ.low) || quotePrice;
          if (mfQ.fiftyTwoWeekHigh) fiftyTwoWeekHigh = Number(mfQ.fiftyTwoWeekHigh);
          if (mfQ.fiftyTwoWeekLow) fiftyTwoWeekLow = Number(mfQ.fiftyTwoWeekLow);
          if (mfQ.quoteDate) quoteDateStr = mfQ.quoteDate;
        }
      } catch (e) { /* ignore */ }
    }

    if (!quoteDateStr && holding.category_id === 'nps') {
      try {
        const npsQ = await fetchNpsNavFallback(holding.symbol);
        if (npsQ?.quoteDate) quoteDateStr = npsQ.quoteDate;
      } catch (e) { }
    }

    if (!quoteDateStr) quoteDateStr = liveQuoteCache.get(holding.symbol)?.quoteDate;
    if (!quoteDateStr && (holding.category_id === 'mutual_funds' || holding.category_id === 'nps')) {
      const lastPoint = activeTimelineData && activeTimelineData.length > 0 ? activeTimelineData[activeTimelineData.length - 1] : null;
      if (lastPoint && lastPoint.label) {
        quoteDateStr = formatCleanQuoteDate(lastPoint.label);
      }
    }
    if (!quoteDateStr && holding.updated_at) {
      quoteDateStr = formatCleanQuoteDate(holding.updated_at);
    }

    const dayChange = quotePrice - prevClose;
    const dayChangePct = prevClose > 0 ? Number(((dayChange / prevClose) * 100).toFixed(2)) : 0;

    // Format dividends and merge with transactions for complete unified ledger
    const formattedDivs = (divs || []).map(d => {
      const dDate = d.payment_date || d.ex_date || '';
      const amtUSD = Number(d.amount_original) || (Number(d.amount_inr) / (Number(d.fx_rate) || 1));
      const amtINR = Number(d.amount_inr) || (amtUSD * (Number(d.fx_rate) || liveRate));
      const dRate = Number(d.fx_rate) || (isUSStock ? (getHistoricalFxRate(dDate) || liveRate) : 1.0);
      return {
        id: `div-${d.id}`,
        holding_id: d.holding_id || holding.id,
        user_id: d.user_id,
        symbol: d.symbol || holding.symbol,
        name: d.name || holding.name,
        type: 'DIVIDEND',
        quantity: 0,
        price: 0,
        total_amount: isUSStock ? Number(amtUSD.toFixed(2)) : Number(amtINR.toFixed(2)),
        currency: isUSStock ? 'USD' : 'INR',
        fx_rate: Number(dRate.toFixed(4)),
        charges: 0,
        date: dDate,
        notes: `Dividend: ${isUSStock ? '$' + amtUSD.toFixed(2) : '₹' + amtINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      };
    });

    const txTypePriority = { BUY: 1, BONUS: 1, DIVIDEND_REINVEST: 1, SPLIT: 2, SELL: 3, DIVIDEND: 4 };
    const mergedTransactions = [...txs, ...formattedDivs].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) return da.localeCompare(db);
      return (txTypePriority[a.type] || 9) - (txTypePriority[b.type] || 9);
    });

    res.json({
      holding,
      quote: {
        price: Number(quotePrice.toFixed(2)),
        previousClose: Number(prevClose.toFixed(2)),
        open: Number(openPrice.toFixed(2)),
        high: Number(dayHigh.toFixed(2)),
        low: Number(dayLow.toFixed(2)),
        close: Number(quotePrice.toFixed(2)),
        fiftyTwoWeekHigh: Number(fiftyTwoWeekHigh.toFixed(2)),
        fiftyTwoWeekLow: Number(fiftyTwoWeekLow.toFixed(2)),
        dayChange: Number(dayChange.toFixed(2)),
        dayChangePct,
        quoteDate: quoteDateStr || 'Latest Available',
        currency: isUSStock ? 'USD' : 'INR'
      },
      fxRate: liveRate,
      transactions: mergedTransactions,
      dividends: divs,
      timelineUSD,
      timelineINR,
      metricsUSD: {
        totalInvested: Number(totalInvestedUSD.toFixed(2)),
        totalRedeemed: Number(totalRedeemedUSD.toFixed(2)),
        currentInvested: Number(costBasisUSD.toFixed(2)),
        totalCharges: Number((totalBuyChargesUSD + totalSellChargesUSD).toFixed(2)),
        buyCharges: Number(totalBuyChargesUSD.toFixed(2)),
        sellCharges: Number(totalSellChargesUSD.toFixed(2)),
        currentValue: Number(currentValueUSD.toFixed(2)),
        unrealizedPnl: Number(unrealizedPnlUSD.toFixed(2)),
        unrealizedPct: unrealizedPctUSD,
        realizedPnl: Number(realizedPnlUSD.toFixed(2)),
        totalDividends: Number(totalDividendsUSD.toFixed(2)),
        dividendCount: divs.length,
        totalXirr: totalXirrUSD
      },
      metricsINR: {
        totalInvested: Number(totalInvestedINR.toFixed(2)),
        totalRedeemed: Number(totalRedeemedINR.toFixed(2)),
        currentInvested: Number(costBasisINR.toFixed(2)),
        totalCharges: Number((totalBuyChargesINR + totalSellChargesINR).toFixed(2)),
        buyCharges: Number(totalBuyChargesINR.toFixed(2)),
        sellCharges: Number(totalSellChargesINR.toFixed(2)),
        currentValue: Number(currentValueINR.toFixed(2)),
        unrealizedPnl: Number(unrealizedPnlINR.toFixed(2)),
        unrealizedPct: unrealizedPctINR,
        realizedPnl: Number(realizedPnlINR.toFixed(2)),
        totalDividends: Number(totalDividendsINR.toFixed(2)),
        dividendCount: divs.length,
        totalXirr: totalXirrINR
      },
      // Backward-compatible top-level properties
      timeline: isUSStock ? timelineUSD : timelineINR,
      metrics: {
        totalInvested: Number((isUSStock ? totalInvestedUSD : totalInvestedINR).toFixed(2)),
        totalRedeemed: Number((isUSStock ? totalRedeemedUSD : totalRedeemedINR).toFixed(2)),
        currentInvested: Number((isUSStock ? costBasisUSD : costBasisINR).toFixed(2)),
        totalCharges: Number(((isUSStock ? totalBuyChargesUSD : totalBuyChargesINR) + (isUSStock ? totalSellChargesUSD : totalSellChargesINR)).toFixed(2)),
        buyCharges: Number((isUSStock ? totalBuyChargesUSD : totalBuyChargesINR).toFixed(2)),
        sellCharges: Number((isUSStock ? totalSellChargesUSD : totalSellChargesINR).toFixed(2)),
        currentValue: Number((isUSStock ? currentValueUSD : currentValueINR).toFixed(2)),
        unrealizedPnl: Number((isUSStock ? unrealizedPnlUSD : unrealizedPnlINR).toFixed(2)),
        unrealizedPct: isUSStock ? unrealizedPctUSD : unrealizedPctINR,
        realizedPnl: Number((isUSStock ? realizedPnlUSD : realizedPnlINR).toFixed(2)),
        totalDividends: Number((isUSStock ? totalDividendsUSD : totalDividendsINR).toFixed(2)),
        dividendCount: divs.length,
        totalXirr: isUSStock ? totalXirrUSD : totalXirrINR
      }
    });
  } catch (err) {
    console.error('[API Error - /api/holding/detail]:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Liabilities API
// -------------------------------------------------------------
app.get('/api/liabilities', authenticateToken, async (req, res) => {
  try {
    const liabilities = await db.select('liabilities');
    res.json(liabilities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/liabilities', authenticateToken, async (req, res) => {
  try {
    const { category_id, name, lender, total_principal, outstanding_balance, interest_rate, monthly_emi, due_day } = req.body;

    await db.insert('liabilities', {
      category_id: category_id || 'loans',
      name,
      lender,
      total_principal: Number(total_principal),
      outstanding_balance: Number(outstanding_balance),
      interest_rate: Number(interest_rate || 0),
      monthly_emi: Number(monthly_emi || 0),
      due_day: Number(due_day || 5)
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Dividends Hub API
// -------------------------------------------------------------
app.get('/api/dividends', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const divs = await db.select('dividends');
    const holdings = await db.select('holdings');
    const hMap = {};
    holdings.forEach(h => hMap[h.id] = h);

    let totalIndiaINR = 0;
    let totalUSUSD = 0;
    let totalUSConvertedINR = 0;

    const history = divs.map(d => {
      const asset = hMap[d.holding_id] || {};
      const amountOriginal = Number(d.amount_original) || 0;
      const amountInr = Number(d.amount_inr) || 0;

      if (d.currency === 'USD') {
        totalUSUSD += amountOriginal;
        totalUSConvertedINR += amountInr;
      } else {
        totalIndiaINR += amountInr;
      }

      return {
        ...d,
        symbol: asset.symbol || 'ASSET',
        asset_name: asset.name || 'Stock',
        payment_date: formatDateDDMMYYYY(d.payment_date)
      };
    }).sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));

    res.json({
      totalDividendsINR: Number((totalIndiaINR + totalUSConvertedINR).toFixed(2)),
      totalIndiaINR: Number(totalIndiaINR.toFixed(2)),
      totalUSUSD: Number(totalUSUSD.toFixed(2)),
      totalUSConvertedINR: Number(totalUSConvertedINR.toFixed(2)),
      fxRate,
      history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Daily P&L Calendar Heatmap API
// -------------------------------------------------------------
app.get('/api/daily-pnl', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, range } = req.query;

    let eodLogs = [];
    const eodPath = './data/portfolio_eod_logs.json';
    if (fs.existsSync(eodPath)) {
      const raw = fs.readFileSync(eodPath, 'utf8');
      eodLogs = JSON.parse(raw);
    }

    if (eodLogs.length === 0) {
      const dbLogs = await db.select('pnl_history');
      eodLogs = dbLogs.map(l => ({
        date: l.log_date,
        wealth: l.net_worth_inr,
        daily_pnl: l.daily_pnl_inr,
        pnl_pct: l.pnl_percentage
      }));
    }

    // Universal Live Snapshot for Today (Single Source of Truth)
    const fxRate = await fetchFxRate();
    const holdings = await db.select('holdings');
    const liabilities = await db.select('liabilities');
    const livePriceMap = {};
    holdings.forEach(h => {
      const liveQuote = liveQuoteCache.get(h.symbol);
      livePriceMap[h.symbol] = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(h.current_price) || 0);
    });

    const liveTodayValuation = computePortfolioValuation(holdings, liabilities, livePriceMap, fxRate);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Merge or append today's live valuation
    const existingTodayIdx = eodLogs.findIndex(l => l.date === todayStr);
    const todayEntry = {
      date: todayStr,
      ...liveTodayValuation
    };

    if (existingTodayIdx >= 0) {
      eodLogs[existingTodayIdx] = todayEntry;
    } else {
      eodLogs.push(todayEntry);
    }

    // Sort chronologically
    eodLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const isWeekendDay = (dStr) => {
      if (!dStr) return false;
      const d = new Date(`${dStr}T00:00:00Z`);
      const day = d.getUTCDay();
      return day === 0 || day === 6;
    };

    // Recompute daily_pnl and pnl_pct across all logs so today is accurate against yesterday
    for (let i = 0; i < eodLogs.length; i++) {
      const cur = eodLogs[i];
      const prev = i > 0 ? eodLogs[i - 1] : cur;
      const curWealth = cur.total_wealth !== undefined ? cur.total_wealth : (cur.wealth || 0);
      const prevWealth = prev.total_wealth !== undefined ? prev.total_wealth : (prev.wealth || 0);
      const pnl = isWeekendDay(cur.date) ? 0 : (curWealth - prevWealth);
      const pct = isWeekendDay(cur.date) ? 0 : (prevWealth !== 0 ? ((pnl / prevWealth) * 100) : 0);
      cur.daily_pnl = Number(pnl.toFixed(2));
      cur.pnl_pct = Number(pct.toFixed(2));
      cur.total_wealth = curWealth;
      cur.wealth = curWealth;
    }

    // Determine start/end date bounds based on range parameter or custom dates
    let targetStartDate = startDate;
    let targetEndDate = endDate;

    if (range && !startDate && !endDate) {
      const lastDateStr = eodLogs.length > 0 ? eodLogs[eodLogs.length - 1].date : new Date().toISOString().split('T')[0];
      targetEndDate = lastDateStr;
      const endD = new Date(`${lastDateStr}T00:00:00Z`);
      const startD = new Date(endD);

      if (range === '1M') startD.setUTCMonth(startD.getUTCMonth() - 1);
      else if (range === '3M') startD.setUTCMonth(startD.getUTCMonth() - 3);
      else if (range === '6M') startD.setUTCMonth(startD.getUTCMonth() - 6);
      else if (range === '1Y') startD.setUTCFullYear(startD.getUTCFullYear() - 1);
      else if (range === '2Y') startD.setUTCFullYear(startD.getUTCFullYear() - 2);
      else if (range === '3Y') startD.setUTCFullYear(startD.getUTCFullYear() - 3);
      else if (range === '5Y') startD.setUTCFullYear(startD.getUTCFullYear() - 5);
      else if (range === '10Y') startD.setUTCFullYear(startD.getUTCFullYear() - 10);
      else if (range === 'ALL') startD.setUTCFullYear(2000);

      targetStartDate = startD.toISOString().slice(0, 10);
    }

    // Filter by bounds if present
    let filtered = eodLogs;
    if (targetStartDate) filtered = filtered.filter(l => l.date >= targetStartDate);
    if (targetEndDate) filtered = filtered.filter(l => l.date <= targetEndDate);

    // Map all eodLogs by date for true previous-day lookups
    const eodIndexMap = new Map();
    eodLogs.forEach((l, idx) => eodIndexMap.set(l.date, idx));

    // Format output array with daily PnL changes and asset/liability deltas
    const resultLogs = [];
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      const fullIdx = eodIndexMap.get(item.date);
      const prevItem = (fullIdx !== undefined && fullIdx > 0) ? eodLogs[fullIdx - 1] : (i > 0 ? filtered[i - 1] : item);

      const wCurr = item.total_wealth !== undefined ? item.total_wealth : item.wealth;
      const wPrev = prevItem.total_wealth !== undefined ? prevItem.total_wealth : prevItem.wealth;

      const prevWealth = wPrev !== undefined ? wPrev : wCurr;
      const dailyPnl = isWeekendDay(item.date) ? 0 : (item.daily_pnl !== undefined ? item.daily_pnl : (wCurr - prevWealth));
      const pct = isWeekendDay(item.date) ? 0 : (prevWealth !== 0 ? Number(((dailyPnl / prevWealth) * 100).toFixed(2)) : 0);

      const wealth = wCurr || 0;
      const debt = item.debt !== undefined ? item.debt : ((item.loan || 0) + (item.credits || 0));
      const assets = item.total_assets !== undefined ? item.total_assets : (wealth + debt);

      const prevDebt = prevItem.debt !== undefined ? prevItem.debt : ((prevItem.loan || 0) + (prevItem.credits || 0));
      const prevAssets = prevItem.total_assets !== undefined ? prevItem.total_assets : (prevWealth + prevDebt);

      const assetDelta = assets - prevAssets;
      const liabilityDelta = debt - prevDebt;

      resultLogs.push({
        log_date: item.date,
        net_worth_inr: Number(wealth.toFixed(2)),
        total_assets_inr: Number(assets.toFixed(2)),
        liabilities_inr: Number(debt.toFixed(2)),
        daily_pnl_inr: Number(dailyPnl.toFixed(2)),
        pnl_percentage: Number(pct),
        asset_delta_inr: Number(assetDelta.toFixed(2)),
        liability_delta_inr: Number(liabilityDelta.toFixed(2)),

        // Exact portfolio.xlsx sheet columns
        hdfc: Number((item.hdfc || 0).toFixed(2)),
        indusind: Number((item.indusind || 0).toFixed(2)),
        idfc: Number((item.idfc || 0).toFixed(2)),
        rbl: Number((item.rbl || 0).toFixed(2)),
        sbi: Number((item.sbi || 0).toFixed(2)),
        federal: Number((item.federal || 0).toFixed(2)),
        savings: Number((item.savings || 0).toFixed(2)),
        mutual_funds: Number((item.mutual_funds || 0).toFixed(2)),
        indian_stocks: Number((item.indian_stocks || 0).toFixed(2)),
        us_stocks: Number((item.us_stocks || 0).toFixed(2)),
        nps: Number((item.nps || 0).toFixed(2)),
        epf: Number((item.epf || 0).toFixed(2)),
        loan: Number((item.loan || 0).toFixed(2)),
        credits: Number((item.credits || 0).toFixed(2)),
        debt: Number((debt || 0).toFixed(2)),
        wealth: Number((wealth || 0).toFixed(2)),

        breakdown: {
          savings: item.savings || 0,
          epf: item.epf || 0,
          mutual_funds: item.mutual_funds || 0,
          indian_stocks: item.indian_stocks || 0,
          us_stocks: item.us_stocks || 0,
          nps: item.nps || 0,
          loan: item.loan || 0,
          credits: item.credits || 0
        },
        prev_breakdown: {
          savings: prevItem.savings || 0,
          epf: prevItem.epf || 0,
          mutual_funds: prevItem.mutual_funds || 0,
          indian_stocks: prevItem.indian_stocks || 0,
          us_stocks: prevItem.us_stocks || 0,
          nps: prevItem.nps || 0,
          loan: prevItem.loan || 0,
          credits: prevItem.credits || 0
        }
      });
    }

    res.json(resultLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Live Price Engine API
// -------------------------------------------------------------
app.post('/api/refresh-prices', authenticateToken, async (req, res) => {
  try {
    // Reload historical prices cache dynamically
    if (fs.existsSync('./data/historical_prices.json')) {
      historicalPricesCache = JSON.parse(fs.readFileSync('./data/historical_prices.json', 'utf-8'));
      console.log(`[API Refresh] Reloaded cache for ${Object.keys(historicalPricesCache).length} assets.`);
    }

    const result = await refreshAllHoldingsPrices();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DB Visual Manager API (Relational Editor with Name & Symbol Enriched)
// -------------------------------------------------------------
app.get('/api/db-tables', authenticateToken, (req, res) => {
  res.json(['categories', 'holdings', 'transactions', 'liabilities', 'dividends', 'pnl_history', 'fx_rates', 'audit_logs']);
});

app.get('/api/db-table-data/:tableName', authenticateToken, async (req, res) => {
  const { tableName } = req.params;
  try {
    const rawRows = await db.select(tableName);

    if (tableName === 'transactions' || tableName === 'dividends') {
      const holdings = await db.select('holdings');
      const hMap = {};
      holdings.forEach(h => hMap[h.id] = h);

      const enrichedRows = rawRows.map(r => {
        const h = hMap[r.holding_id] || {};
        const formattedDate = formatDateDDMMYYYY(r.date || r.payment_date || r.created_at);

        if (tableName === 'transactions') {
          return {
            id: r.id,
            symbol: h.symbol || 'N/A',
            name: h.name || 'N/A',
            holding_id: r.holding_id,
            type: r.type,
            quantity: r.quantity,
            price: r.price,
            total_amount: r.total_amount,
            charges: r.charges,
            currency: r.currency,
            date: formattedDate,
            notes: r.notes || ''
          };
        } else {
          return {
            id: r.id,
            symbol: h.symbol || 'N/A',
            name: h.name || 'N/A',
            holding_id: r.holding_id,
            amount_original: r.amount_original,
            currency: r.currency,
            fx_rate: r.fx_rate,
            amount_inr: r.amount_inr,
            payment_date: formattedDate
          };
        }
      });

      const firstRow = enrichedRows[0] || {};
      const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
      return res.json({ columns, rows: enrichedRows });
    }

    // Default formatting for dates in other tables
    const formattedRows = rawRows.map(r => {
      const newObj = { ...r };
      ['date', 'payment_date', 'log_date', 'created_at', 'updated_at'].forEach(key => {
        if (newObj[key]) newObj[key] = formatDateDDMMYYYY(newObj[key]);
      });
      return newObj;
    });

    const firstRow = formattedRows[0] || {};
    const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
    res.json({ columns, rows: formattedRows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/db-table-update', authenticateToken, async (req, res) => {
  const { tableName, id, column, value } = req.body;
  try {
    const updateObj = {};
    updateObj[column] = isNaN(value) ? value : Number(value);
    await db.update(tableName, id, updateObj);

    // If a transaction is amended, automatically recalculate its parent holding or liability
    if (tableName === 'transactions') {
      const { data: txs } = await supabase.from('transactions').select('holding_id, liability_id').eq('id', id);
      const parentId = txs?.[0]?.holding_id || txs?.[0]?.liability_id;
      if (parentId) {
        await recalculateHoldingState(parentId);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Dedicated Transaction Delete with Automatic Reversal/Recalculation
app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: txs } = await supabase.from('transactions').select('*').eq('id', id);
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;
    await supabase.from('transactions').delete().eq('id', id);

    if (parentId) {
      await recalculateHoldingState(parentId);
    }

    res.json({ success: true, message: 'Transaction deleted and holding position automatically recalculated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated Transaction Update with Automatic Reversal/Recalculation
app.put('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { data: txs } = await supabase.from('transactions').select('*').eq('id', id);
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;
    await supabase.from('transactions').update(updates).eq('id', id);

    if (parentId) {
      await recalculateHoldingState(parentId);
    }

    res.json({ success: true, message: 'Transaction updated and holding position automatically recalculated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Search / Autocomplete APIs for Add Investment
// -------------------------------------------------------------

// Yahoo Finance search proxy - returns matching tickers
app.get('/api/search/stocks', async (req, res) => {
  try {
    const { q, market } = req.query;
    if (!q || q.length < 1) return res.json([]);

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const quotes = response.data?.quotes || [];
    let filtered = quotes.filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'MUTUALFUND' || q.quoteType === 'ETF');

    if (market === 'india') {
      filtered = filtered.filter(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'NSE' ||
        (q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO'))));
    } else if (market === 'us') {
      filtered = filtered.filter(q => ['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'BTS'].includes(q.exchange) ||
        q.exchDisp === 'NASDAQ' || q.exchDisp === 'NYSE');
    }

    const results = filtered.map(q => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange,
      type: q.quoteType
    }));

    res.json(results);
  } catch (err) {
    console.error('[Search Stocks Error]:', err.message);
    res.json([]);
  }
});

// AMFI mutual fund search proxy
let amfiMasterCache = null;
let amfiCacheTime = 0;
const AMFI_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getAmfiMaster() {
  if (amfiMasterCache && Date.now() - amfiCacheTime < AMFI_CACHE_TTL) return amfiMasterCache;
  try {
    const res = await axios.get('https://api.mfapi.in/mf', { timeout: 10000 });
    if (res.data && Array.isArray(res.data)) {
      amfiMasterCache = res.data; // array of { schemeCode, schemeName }
      amfiCacheTime = Date.now();
      console.log(`[AMFI] Cached ${amfiMasterCache.length} mutual fund schemes`);
    }
  } catch (err) {
    console.error('[AMFI Master Fetch Error]:', err.message);
  }
  return amfiMasterCache || [];
}

app.get('/api/search/mutual-funds', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const master = await getAmfiMaster();
    const queryTerms = q.toLowerCase().split(/\s+/);

    const matches = master
      .filter(m => {
        const name = (m.schemeName || '').toLowerCase();
        return queryTerms.every(term => name.includes(term));
      })
      .slice(0, 15)
      .map(m => ({
        schemeCode: String(m.schemeCode),
        schemeName: m.schemeName
      }));

    res.json(matches);
  } catch (err) {
    console.error('[Search MF Error]:', err.message);
    res.json([]);
  }
});

app.get('/api/nav/mutual-funds/:schemeCode', async (req, res) => {
  try {
    const { date } = req.query;
    const mfRes = await axios.get(`https://api.mfapi.in/mf/${req.params.schemeCode}`, { timeout: 8000 });
    const dataArray = mfRes.data?.data;

    if (dataArray && dataArray.length > 0) {
      let match = dataArray[0];
      if (date) {
        const targetDateObj = new Date(date);
        match = dataArray.find(d => {
          const [dDD, dMM, dYYYY] = d.date.split('-');
          const dObj = new Date(`${dYYYY}-${dMM}-${dDD}`);
          return dObj <= targetDateObj;
        }) || dataArray[0];
      }
      res.json({ nav: parseFloat(match.nav), date: match.date });
    } else {
      res.status(404).json({ error: 'NAV not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NPS NAV Lookup by Scheme Code and Date (with Protean DB & Archive fallback)
app.get('/api/nav/nps/:schemeCode', async (req, res) => {
  try {
    const { schemeCode } = req.params;
    const { date } = req.query;
    const cleanDate = date || new Date().toISOString().split('T')[0];

    // 1. Try local database table nps_daily_navs first (Protean verified)
    const { data: dbRows } = await supabase
      .from('nps_daily_navs')
      .select('*')
      .eq('scheme_code', schemeCode)
      .lte('nav_date', cleanDate)
      .order('nav_date', { ascending: false })
      .limit(1);

    if (dbRows && dbRows.length > 0) {
      return res.json({ nav: Number(dbRows[0].nav), date: dbRows[0].nav_date, source: 'protean_db' });
    }

    // 2. Fallback to historical cache (covers back to 2013)
    const histMap = await fetchNpsHistoricalNav(schemeCode);
    if (histMap && histMap.size > 0) {
      if (histMap.has(cleanDate)) {
        return res.json({ nav: histMap.get(cleanDate), date: cleanDate, source: 'historical_archive' });
      }
      const dates = Array.from(histMap.keys()).filter(d => d <= cleanDate).sort().reverse();
      if (dates.length > 0) {
        return res.json({ nav: histMap.get(dates[0]), date: dates[0], source: 'historical_archive' });
      }
    }

    res.status(404).json({ error: 'NPS NAV not found for given date' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Universal On-Demand NAV Catch-Up Endpoint (Mutual Funds + NPS)
app.post('/api/refresh-navs', authenticateToken, async (req, res) => {
  try {
    const results = await syncAllMissingNavs();
    res.json({
      success: true,
      message: `Sync complete: ${results.npsUpdated} NPS schemes & ${results.mfUpdated} Mutual Funds updated.`,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Recurring SIP Management Endpoints
// ---------------------------------------------------------------------------

// List all SIPs
app.get('/api/sips', authenticateToken, async (req, res) => {
  try {
    const { data: sips, error } = await supabase
      .from('sips')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(sips || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new SIP
app.post('/api/sips', authenticateToken, async (req, res) => {
  try {
    const { holding_id, symbol, name, amount, day_of_month, frequency, start_date } = req.body;
    if (!symbol || !name || !amount) {
      return res.status(400).json({ error: 'Symbol, name and amount are required' });
    }

    const dom = Math.min(28, Math.max(1, parseInt(day_of_month) || 1));
    const today = new Date();
    let nextDate = start_date ? new Date(start_date) : new Date(today.getFullYear(), today.getMonth(), dom);
    if (nextDate < today) {
      nextDate = new Date(today.getFullYear(), today.getMonth() + 1, dom);
    }
    const nextRunStr = nextDate.toISOString().split('T')[0];

    const { data: inserted, error } = await supabase
      .from('sips')
      .insert({
        holding_id: holding_id || null,
        symbol,
        name,
        amount: Number(amount),
        frequency: frequency || 'MONTHLY',
        day_of_month: dom,
        next_run_date: nextRunStr,
        status: 'ACTIVE'
      })
      .select();

    if (error) throw error;
    res.json({ success: true, sip: inserted[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update SIP parameters (amount, day, next_run_date)
app.put('/api/sips/:id', authenticateToken, async (req, res) => {
  try {
    const { amount, day_of_month, next_run_date } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (amount !== undefined) updates.amount = Number(amount);
    if (day_of_month !== undefined) updates.day_of_month = parseInt(day_of_month);
    if (next_run_date !== undefined) updates.next_run_date = next_run_date;

    const { data: updated, error } = await supabase
      .from('sips')
      .update(updates)
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    res.json({ success: true, sip: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change SIP status: ACTIVE, PAUSED, CLOSED
app.patch('/api/sips/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'PAUSED', 'CLOSED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be ACTIVE, PAUSED, or CLOSED' });
    }

    const { data: updated, error } = await supabase
      .from('sips')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    res.json({ success: true, sip: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete SIP
app.delete('/api/sips/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase.from('sips').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger to process due SIPs immediately
app.post('/api/sips/process-due', authenticateToken, async (req, res) => {
  try {
    const result = await processDueSips();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NPS scheme master list
let npsSchemeMasterCache = null;
let npsCacheTime = 0;

app.get('/api/search/nps-schemes', async (req, res) => {
  try {
    // Build from existing DB holdings + known master list
    if (!npsSchemeMasterCache || Date.now() - npsCacheTime > AMFI_CACHE_TTL) {
      const npsHoldings = await db.selectWhere('holdings', { category_id: 'nps' });
      const schemeSet = new Map();

      // Add existing DB holdings
      npsHoldings.forEach(h => {
        schemeSet.set(h.symbol, { schemeCode: h.symbol, schemeName: h.name });
      });

      // Hardcoded master list of common NPS Tier-I Active Choice schemes
      const masterSchemes = [
        { schemeCode: 'SM008001', schemeName: 'SBI Pension - Scheme E Tier I' },
        { schemeCode: 'SM008002', schemeName: 'SBI Pension - Scheme C Tier I' },
        { schemeCode: 'SM008003', schemeName: 'SBI Pension - Scheme G Tier I' },
        { schemeCode: 'SM001001', schemeName: 'HDFC Pension - Scheme E Tier I' },
        { schemeCode: 'SM001002', schemeName: 'HDFC Pension - Scheme C Tier I' },
        { schemeCode: 'SM001003', schemeName: 'HDFC Pension - Scheme G Tier I' },
        { schemeCode: 'SM002001', schemeName: 'ICICI Pru Pension - Scheme E Tier I' },
        { schemeCode: 'SM002002', schemeName: 'ICICI Pru Pension - Scheme C Tier I' },
        { schemeCode: 'SM002003', schemeName: 'ICICI Pru Pension - Scheme G Tier I' },
        { schemeCode: 'SM003001', schemeName: 'Kotak Pension - Scheme E Tier I' },
        { schemeCode: 'SM003002', schemeName: 'Kotak Pension - Scheme C Tier I' },
        { schemeCode: 'SM003003', schemeName: 'Kotak Pension - Scheme G Tier I' },
        { schemeCode: 'SM004001', schemeName: 'Aditya Birla SL Pension - Scheme E Tier I' },
        { schemeCode: 'SM004002', schemeName: 'Aditya Birla SL Pension - Scheme C Tier I' },
        { schemeCode: 'SM004003', schemeName: 'Aditya Birla SL Pension - Scheme G Tier I' },
        { schemeCode: 'SM005001', schemeName: 'LIC Pension - Scheme E Tier I' },
        { schemeCode: 'SM005002', schemeName: 'LIC Pension - Scheme C Tier I' },
        { schemeCode: 'SM005003', schemeName: 'LIC Pension - Scheme G Tier I' },
        { schemeCode: 'SM006001', schemeName: 'UTI Pension - Scheme E Tier I' },
        { schemeCode: 'SM006002', schemeName: 'UTI Pension - Scheme C Tier I' },
        { schemeCode: 'SM006003', schemeName: 'UTI Pension - Scheme G Tier I' },
        { schemeCode: 'SM007001', schemeName: 'Tata Pension - Scheme E Tier I' },
        { schemeCode: 'SM007002', schemeName: 'Tata Pension - Scheme C Tier I' },
        { schemeCode: 'SM007003', schemeName: 'Tata Pension - Scheme G Tier I' },
        { schemeCode: 'SM010001', schemeName: 'Max Life Pension - Scheme E Tier I' },
        { schemeCode: 'SM010002', schemeName: 'Max Life Pension - Scheme C Tier I' },
        { schemeCode: 'SM010003', schemeName: 'Max Life Pension - Scheme G Tier I' },
        { schemeCode: 'SM001004', schemeName: 'HDFC Pension - Scheme A Tier I' },
        { schemeCode: 'SM002004', schemeName: 'ICICI Pru Pension - Scheme A Tier I' },
        { schemeCode: 'SM008004', schemeName: 'SBI Pension - Scheme A Tier I' },
      ];

      masterSchemes.forEach(s => {
        if (!schemeSet.has(s.schemeCode)) schemeSet.set(s.schemeCode, s);
      });

      npsSchemeMasterCache = Array.from(schemeSet.values());
      npsCacheTime = Date.now();
    }

    const { q } = req.query;
    if (q && q.length > 0) {
      const query = q.toLowerCase();
      const filtered = npsSchemeMasterCache.filter(s =>
        s.schemeName.toLowerCase().includes(query) || s.schemeCode.toLowerCase().includes(query)
      );
      return res.json(filtered);
    }

    res.json(npsSchemeMasterCache);
  } catch (err) {
    console.error('[NPS Schemes Error]:', err.message);
    res.json([]);
  }
});

// -------------------------------------------------------------
// Fetch Existing Accounts (for Bank, Loan, EPF, CC dropdowns)
// -------------------------------------------------------------
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const banks = await db.selectWhere('holdings', { category_id: 'bank' });
    const epf = await db.selectWhere('holdings', { category_id: 'epf' });
    const loans = await db.selectWhere('liabilities', { category_id: 'loans' });
    const creditCards = await db.selectWhere('liabilities', { category_id: 'credit_cards' });

    res.json({
      banks: banks.map(b => b.name),
      epf: epf.map(e => e.name),
      loans: loans.map(l => l.name),
      creditCards: creditCards.map(c => c.name)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Unified Add Investment Endpoint
// Uses PL/pgSQL trigger for automatic holdings sync
// -------------------------------------------------------------
app.post('/api/add-investment', authenticateToken, async (req, res) => {
  try {
    const { portfolio, data } = req.body;

    if (!portfolio || !data) {
      return res.status(400).json({ error: 'Missing portfolio type or data' });
    }

    const fxRate = await fetchFxRate();

    // Handle market-based portfolios (equities, mutual funds, NPS)
    if (['in_stocks', 'us_stocks', 'mutual_funds', 'nps'].includes(portfolio)) {
      const { symbol, name, quantity, price, amount, date, type, charges, fxRateOverride, schemeCode } = data;

      if (!symbol || !symbol.trim()) return res.status(400).json({ error: 'Symbol/Identifier Code is required and cannot be empty.' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Asset Name is required and cannot be empty.' });

      const txType = (type || 'BUY').toUpperCase();
      const txDate = date || new Date().toISOString().split('T')[0];

      // Date format validation
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
        return res.status(400).json({ error: `Invalid date format '${txDate}'. Must be YYYY-MM-DD.` });
      }

      // Numeric validations
      const rawQty = Number(quantity);
      const rawPrice = Number(price);
      const rawCharges = Number(charges) || 0;

      if (['BUY', 'SELL', 'REDEEM'].includes(txType)) {
        if ((isNaN(rawQty) || rawQty <= 0) && (isNaN(Number(amount)) || Number(amount) <= 0)) {
          return res.status(400).json({ error: `Invalid quantity '${quantity}'. Must be a positive number greater than zero.` });
        }
        if (isNaN(rawPrice) || rawPrice <= 0) {
          return res.status(400).json({ error: `Invalid price/NAV '${price}'. Must be a positive number greater than zero.` });
        }
      }

      let txQty = Math.abs(rawQty || 0);
      let txPrice = Math.abs(rawPrice || 0);
      let txCharges = Math.abs(rawCharges || 0);
      let txAmount = txQty * txPrice;

      if (txType === 'BUY') {
        txAmount += txCharges;
      } else if (txType === 'SELL') {
        txAmount -= txCharges;
      }

      // Handle MF SIP 0.015% automatic charges if amount was provided
      if (portfolio === 'mutual_funds' && txType === 'BUY' && data.amount) {
        const inputAmount = Math.abs(Number(data.amount));
        txCharges = Number((inputAmount * 0.00015).toFixed(4));
        txAmount = inputAmount - txCharges;
        txQty = Number((txAmount / txPrice).toFixed(4));
      }

      if (txType === 'BONUS') {
        txPrice = 0;
        txAmount = 0;
      }

      const isUS = portfolio === 'us_stocks';
      const currency = isUS ? 'USD' : 'INR';
      const txFxRate = isUS ? (Number(fxRateOverride) || fxRate) : null;

      const symbolKey = (portfolio === 'mutual_funds' && schemeCode) ? schemeCode : symbol.trim().toUpperCase();

      // Find or create holding
      let holdingId;
      const existingHoldings = await db.selectWhere('holdings', { category_id: portfolio, symbol: symbolKey });

      // OVER-SELL VALIDATION: For SELL / REDEEM, ensure user actually holds enough active shares
      if (txType === 'SELL' || txType === 'REDEEM') {
        if (existingHoldings.length === 0 || (Number(existingHoldings[0].quantity) || 0) <= 0) {
          return res.status(400).json({
            error: `Cannot sell ${symbolKey}: you do not have any active shares of this investment in your portfolio.`
          });
        }
        const currentOpenShares = Number(existingHoldings[0].quantity) || 0;
        if (txQty > currentOpenShares + 0.0001) {
          return res.status(400).json({
            error: `Cannot sell ${txQty} shares of ${symbolKey}: only ${currentOpenShares.toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares are currently held in your portfolio.`
          });
        }
      }

      if (existingHoldings.length > 0) {
        holdingId = existingHoldings[0].id;
      } else {
        const exchange = portfolio === 'in_stocks' ? 'NSE' :
          portfolio === 'us_stocks' ? 'NASDAQ' :
            portfolio === 'mutual_funds' ? 'AMFI' : 'NPS';

        const newHolding = await db.insert('holdings', {
          category_id: portfolio,
          symbol: symbolKey,
          name: name.trim(),
          exchange: exchange,
          quantity: 0,
          avg_buy_price: 0,
          current_price: txPrice,
          currency: currency,
          status: 'ACTIVE'
        });
        holdingId = newHolding.id;
      }

      // Handle DIVIDEND - insert into dividends table
      if (txType === 'DIVIDEND') {
        const divAmount = Number(data.dividendAmount) || txAmount;
        if (isNaN(divAmount) || divAmount <= 0) {
          return res.status(400).json({ error: 'Dividend amount must be a positive number.' });
        }

        await db.insert('dividends', {
          holding_id: holdingId,
          symbol: symbolKey,
          name: name.trim(),
          amount_original: isUS ? divAmount : divAmount,
          currency: currency,
          fx_rate: txFxRate || 1.0,
          amount_inr: isUS ? divAmount * (txFxRate || fxRate) : divAmount,
          payment_date: txDate
        });

        return res.json({ success: true, holdingId, action: 'dividend_recorded' });
      }

      // Handle SPLIT - update all open active positions
      if (txType === 'SPLIT') {
        const oldQty = Number(data.splitOldQty) || 1;
        const newQtyRatio = Number(data.splitNewQty) || 1;
        if (isNaN(oldQty) || oldQty <= 0 || isNaN(newQtyRatio) || newQtyRatio <= 0) {
          return res.status(400).json({ error: 'Split Old Ratio and New Ratio must be valid numbers greater than zero.' });
        }

        if (existingHoldings.length === 0 || (Number(existingHoldings[0].quantity) || 0) <= 0) {
          return res.status(400).json({ error: `Cannot perform stock split on ${symbolKey}: no active shares found in portfolio.` });
        }

        const splitRatio = newQtyRatio / oldQty;
        const holding = existingHoldings[0];
        const preSplitQty = Number(holding.quantity) || 0;
        const preSplitAvg = Number(holding.avg_buy_price) || 0;

        const newQty = preSplitQty * splitRatio;
        const newAvg = preSplitAvg / splitRatio;
        const newBuyQty = (Number(holding.buy_qty) || preSplitQty) * splitRatio;
        const addedShares = newQty - preSplitQty;

        await db.update('holdings', holdingId, {
          quantity: parseFloat(newQty.toFixed(4)),
          buy_qty: parseFloat(newBuyQty.toFixed(4)),
          avg_buy_price: parseFloat(newAvg.toFixed(4)),
          updated_at: new Date().toISOString()
        });

        // Record the split as a transaction for audit trail and charting
        await db.insert('transactions', {
          holding_id: holdingId,
          type: 'SPLIT',
          quantity: parseFloat(addedShares.toFixed(4)),
          price: 0,
          total_amount: 0,
          charges: 0,
          currency: currency,
          date: txDate,
          symbol: symbolKey,
          name: name.trim(),
          notes: `Stock split ${oldQty}:${newQtyRatio} — holding scaled from ${preSplitQty} to ${newQty} shares, avg cost adjusted from ₹${preSplitAvg.toFixed(2)} to ₹${newAvg.toFixed(2)}`
        });

        await recalculateHoldingState(holdingId);
        return res.json({ success: true, holdingId, action: 'split_applied' });
      }

      // Handle BONUS - add bonus shares at ₹0 cost and dilute avg price of open active holding
      if (txType === 'BONUS') {
        if (isNaN(txQty) || txQty <= 0) {
          return res.status(400).json({ error: 'Bonus quantity must be a positive number greater than zero.' });
        }

        if (existingHoldings.length === 0 || (Number(existingHoldings[0].quantity) || 0) <= 0) {
          return res.status(400).json({ error: `Cannot credit bonus shares for ${symbolKey}: no active shares found in portfolio.` });
        }

        const holding = existingHoldings[0];
        const preBonusQty = Number(holding.quantity) || 0;
        const preBonusAvg = Number(holding.avg_buy_price) || 0;

        const newQty = preBonusQty + txQty;
        const newAvg = (preBonusQty * preBonusAvg) / newQty;
        const newBuyQty = (Number(holding.buy_qty) || preBonusQty) + txQty;

        await db.update('holdings', holdingId, {
          quantity: parseFloat(newQty.toFixed(4)),
          buy_qty: parseFloat(newBuyQty.toFixed(4)),
          avg_buy_price: parseFloat(newAvg.toFixed(4)),
          updated_at: new Date().toISOString()
        });

        await db.insert('transactions', {
          holding_id: holdingId,
          type: 'BONUS',
          quantity: txQty,
          price: 0,
          total_amount: 0,
          charges: txCharges,
          currency: currency,
          date: txDate,
          symbol: symbolKey,
          name: name.trim(),
          notes: `Bonus issue (+${txQty} shares credited at ₹0 cost, avg cost diluted from ₹${preBonusAvg.toFixed(2)} to ₹${newAvg.toFixed(2)})`
        });

        await recalculateHoldingState(holdingId);
        return res.json({ success: true, holdingId, action: 'bonus_applied' });
      }

      // Insert transaction - PL/pgSQL trigger will auto-update holdings
      const txRecord = {
        holding_id: holdingId,
        type: txType,
        quantity: txQty,
        price: txPrice,
        total_amount: txAmount,
        charges: txCharges,
        currency: currency,
        date: txDate,
        symbol: symbolKey,
        name: name.trim(),
        notes: data.notes || `${txType} ${txQty} units of ${name} @ ${currency === 'USD' ? '$' : '₹'}${txPrice}`
      };

      if (txFxRate) txRecord.fx_rate = txFxRate;

      await db.insert('transactions', txRecord);
      await recalculateHoldingState(holdingId);
      invalidateBenchmarkCache();

      return res.json({ success: true, holdingId, action: 'transaction_recorded' });
    }

    // Handle Bank / EPF (delta-ledger based)
    if (portfolio === 'bank' || portfolio === 'epf') {
      const { name: accName, balance, amount, type: rawType, date: entryDate, notes } = data;
      if (!accName) return res.status(400).json({ error: 'Account name is required' });

      const symbolKey = portfolio === 'epf' ? 'EPF-RETIREMENT' :
        accName.toUpperCase().replace(/\s+/g, '-') + '-SAVINGS';

      const existing = await db.selectWhere('holdings', { category_id: portfolio, symbol: symbolKey });
      let holdingId;

      if (existing.length > 0) {
        holdingId = existing[0].id;
      } else {
        const newHolding = await db.insert('holdings', {
          category_id: portfolio,
          symbol: symbolKey,
          name: accName,
          exchange: portfolio === 'bank' ? 'BANK' : 'EPF',
          quantity: 1,
          avg_buy_price: 0,
          current_price: 0,
          currency: 'INR',
          status: 'ACTIVE'
        });
        holdingId = newHolding[0]?.id || newHolding.id;
      }

      const txDate = entryDate || new Date().toISOString().split('T')[0];

      // Determine transaction type and amount
      if (amount !== undefined && Number(amount) > 0) {
        const amt = Number(amount);
        let txType = (rawType || '').toUpperCase();
        if (!txType) {
          txType = portfolio === 'epf' ? 'CONTRIBUTION' : 'CREDIT';
        }

        await db.insert('transactions', {
          holding_id: holdingId,
          type: txType,
          quantity: 1,
          price: amt,
          total_amount: amt,
          charges: 0,
          currency: 'INR',
          date: txDate,
          symbol: symbolKey,
          name: accName,
          notes: notes || `${portfolio === 'epf' ? 'EPF' : 'Bank'} ${txType}: ₹${amt.toFixed(2)}`
        });
      } else if (balance !== undefined) {
        const currentBal = existing.length > 0 ? (Number(existing[0].current_price) || 0) : 0;
        const targetBal = Math.max(0, Number(balance));
        const diff = targetBal - currentBal;

        if (Math.abs(diff) > 0.001) {
          let txType;
          if (portfolio === 'epf') {
            txType = diff > 0 ? 'CONTRIBUTION' : 'WITHDRAWAL';
          } else {
            txType = diff > 0 ? 'CREDIT' : 'DEBIT';
          }

          await db.insert('transactions', {
            holding_id: holdingId,
            type: txType,
            quantity: 1,
            price: Math.abs(diff),
            total_amount: Math.abs(diff),
            charges: 0,
            currency: 'INR',
            date: txDate,
            symbol: symbolKey,
            name: accName,
            notes: notes || `Balance Adjustment (${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)})`
          });
        }
      }

      await recalculateHoldingState(holdingId);
      return res.json({ success: true, holdingId, action: 'ledger_updated' });
    }

    // Handle Loan (delta-ledger based)
    if (portfolio === 'loans') {
      const { name: loanName, balance, amount, type: rawType, date: entryDate, notes } = data;
      if (!loanName) return res.status(400).json({ error: 'Loan name is required' });

      const existing = await db.selectWhere('liabilities', { category_id: 'loans', name: loanName });
      let liabilityId;

      if (existing.length > 0) {
        liabilityId = existing[0].id;
      } else {
        const inserted = await db.insert('liabilities', {
          category_id: 'loans',
          name: loanName,
          total_principal: Number(balance || amount || 0),
          outstanding_balance: 0,
          updated_at: new Date().toISOString()
        });
        liabilityId = inserted[0]?.id || inserted.id;
      }

      const txDate = entryDate || new Date().toISOString().split('T')[0];

      if (amount !== undefined && Number(amount) > 0) {
        const amt = Number(amount);
        const txType = (rawType || 'EMI_PAYMENT').toUpperCase();

        await db.insert('transactions', {
          holding_id: null,
          liability_id: liabilityId,
          type: txType,
          quantity: 1,
          price: amt,
          total_amount: amt,
          charges: 0,
          currency: 'INR',
          date: txDate,
          symbol: 'LOAN',
          name: loanName,
          notes: notes || `Loan ${txType}: ₹${amt.toFixed(2)}`
        });
      } else if (balance !== undefined) {
        const currentBal = existing.length > 0 ? (Number(existing[0].outstanding_balance) || 0) : 0;
        const targetBal = Math.max(0, Number(balance));
        const diff = targetBal - currentBal;

        if (Math.abs(diff) > 0.001) {
          const txType = diff > 0 ? 'BORROW' : 'EMI_PAYMENT';
          await db.insert('transactions', {
            holding_id: null,
            liability_id: liabilityId,
            type: txType,
            quantity: 1,
            price: Math.abs(diff),
            total_amount: Math.abs(diff),
            charges: 0,
            currency: 'INR',
            date: txDate,
            symbol: 'LOAN',
            name: loanName,
            notes: notes || `Loan Adjustment (${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)})`
          });
        }
      }

      await recalculateHoldingState(liabilityId);
      return res.json({ success: true, liabilityId, action: 'loan_ledger_updated' });
    }

    // Handle Credit Card (delta-ledger based)
    if (portfolio === 'credit_cards') {
      const { name: cardName, balance, amount, type: rawType, date: entryDate, notes } = data;
      if (!cardName) return res.status(400).json({ error: 'Card name is required' });

      const existing = await db.selectWhere('liabilities', { category_id: 'credit_cards', name: cardName });
      let cardId;

      if (existing.length > 0) {
        cardId = existing[0].id;
      } else {
        const newCard = await db.insert('liabilities', {
          category_id: 'credit_cards',
          name: cardName,
          total_principal: 0,
          outstanding_balance: 0,
          updated_at: new Date().toISOString()
        });
        cardId = newCard[0]?.id || newCard.id;
      }

      const txDate = entryDate || new Date().toISOString().split('T')[0];

      if (amount !== undefined && Number(amount) > 0) {
        const amt = Number(amount);
        const txType = (rawType || 'CHARGE').toUpperCase();

        await db.insert('transactions', {
          holding_id: null,
          liability_id: cardId,
          type: txType,
          quantity: 1,
          price: amt,
          total_amount: amt,
          charges: 0,
          currency: 'INR',
          date: txDate,
          symbol: 'CARD',
          name: cardName,
          notes: notes || `Card ${txType}: ₹${amt.toFixed(2)}`
        });
      } else if (balance !== undefined) {
        const currentBal = existing.length > 0 ? (Number(existing[0].outstanding_balance) || 0) : 0;
        const targetBal = Math.max(0, Number(balance));
        const diff = targetBal - currentBal;

        if (Math.abs(diff) > 0.001) {
          const txType = diff > 0 ? 'CHARGE' : 'BILL_PAYMENT';
          await db.insert('transactions', {
            holding_id: null,
            liability_id: cardId,
            type: txType,
            quantity: 1,
            price: Math.abs(diff),
            total_amount: Math.abs(diff),
            charges: 0,
            currency: 'INR',
            date: txDate,
            symbol: 'CARD',
            name: cardName,
            notes: notes || `Card Adjustment (${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)})`
          });
        }
      }

      await recalculateHoldingState(cardId);
      return res.json({ success: true, cardId, action: 'card_ledger_updated' });
    }

    return res.status(400).json({ error: `Unknown portfolio type: ${portfolio}` });
  } catch (err) {
    console.error('[Add Investment Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// REPORTS & ANALYTICS ADVANCED ENGINES
// ============================================================================

app.get('/api/reports/mf-holdings', async (req, res) => {
  try {
    const fxRate = await fetchFxRate();
    const holdings = await db.select('holdings');
    const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && Number(h.quantity) > 0);

    const schemeValueMap = {};
    let totalMfValueINR = 0;
    mfHoldings.forEach(h => {
      const quote = liveQuoteCache.get(h.symbol);
      const price = (quote && quote.price > 0) ? quote.price : (Number(h.current_price) || 0);
      const valINR = computeHoldingValueINR(h, price, fxRate);
      schemeValueMap[h.symbol] = {
        name: h.name,
        symbol: h.symbol,
        units: Number(h.quantity),
        nav: price,
        currentValueINR: valINR
      };
      totalMfValueINR += valINR;
    });

    let mfPortfolios = null;
    try {
      const { data } = await supabase.from('mutual_fund_holdings').select('*');
      if (data && data.length > 0) {
        mfPortfolios = {};
        data.forEach(row => {
          if (!mfPortfolios[row.scheme_code]) {
            mfPortfolios[row.scheme_code] = {
              scheme_code: row.scheme_code,
              scheme_name: row.scheme_name,
              companies: []
            };
          }
          mfPortfolios[row.scheme_code].companies.push({
            company: row.company_name,
            symbol: row.symbol,
            allocation_pct: Number(row.allocation_pct),
            sector: row.sector,
            mcap_category: row.mcap_category
          });
        });
      }
    } catch (e) { }

    if (!mfPortfolios) {
      const mfFile = path.join(__dirname, '../data/mutual_fund_holdings.json');
      if (fs.existsSync(mfFile)) {
        mfPortfolios = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
      } else {
        mfPortfolios = {};
      }
    }

    const schemes = [];
    const aggregatedCompanies = {};
    const sectorDistribution = {};
    const mcapDistribution = { 'Mega Cap': 0, 'Large Cap': 0, 'Mid Cap': 0, 'Small Cap': 0, 'Micro Cap': 0, 'Cash': 0 };

    Object.keys(schemeValueMap).forEach(code => {
      const scheme = schemeValueMap[code];
      const portfolio = mfPortfolios[code] || { companies: [] };
      const companiesWithVal = (portfolio.companies || []).map(c => {
        const allocatedVal = Number(((c.allocation_pct / 100) * scheme.currentValueINR).toFixed(2));

        if (!aggregatedCompanies[c.company]) {
          aggregatedCompanies[c.company] = {
            company: c.company,
            symbol: c.symbol,
            sector: c.sector,
            mcap_category: c.mcap_category,
            totalAllocatedINR: 0,
            schemes: []
          };
        }
        aggregatedCompanies[c.company].totalAllocatedINR += allocatedVal;
        aggregatedCompanies[c.company].schemes.push({
          scheme_name: scheme.name,
          scheme_code: code,
          pct: c.allocation_pct,
          valueINR: allocatedVal
        });

        const s = c.sector || 'Diversified';
        sectorDistribution[s] = (sectorDistribution[s] || 0) + allocatedVal;

        const mc = c.mcap_category || 'Mid Cap';
        if (mcapDistribution[mc] !== undefined) {
          mcapDistribution[mc] += allocatedVal;
        } else {
          mcapDistribution['Mid Cap'] += allocatedVal;
        }

        return {
          ...c,
          allocatedINR: allocatedVal
        };
      }).sort((a, b) => b.allocatedINR - a.allocatedINR);

      schemes.push({
        scheme_code: code,
        scheme_name: scheme.name,
        currentValueINR: scheme.currentValueINR,
        companies: companiesWithVal
      });
    });

    const companyList = Object.values(aggregatedCompanies)
      .map(c => ({
        ...c,
        percentage: totalMfValueINR > 0 ? Number(((c.totalAllocatedINR / totalMfValueINR) * 100).toFixed(2)) : 0
      }))
      .sort((a, b) => b.totalAllocatedINR - a.totalAllocatedINR);

    res.json({
      totalMfValueINR,
      schemes: schemes.sort((a, b) => b.currentValueINR - a.currentValueINR),
      aggregatedCompanies: companyList,
      sectorDistribution,
      mcapDistribution
    });
  } catch (err) {
    console.error('[MF Holdings Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/growth-benchmarks', async (req, res) => {
  try {
    const result = await computeGrowthBenchmarks(req.query);
    res.json(result);
  } catch (err) {
    console.error('[Growth Benchmarks Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reports/sync-metadata', async (req, res) => {
  try {
    invalidateBenchmarkCache();
    const { syncAssetMetadata } = await import('../scripts/sync_asset_metadata.mjs');
    const { syncMutualFundHoldings } = await import('../scripts/sync_mf_holdings.mjs');
    const { syncIndexHistory } = await import('../scripts/sync_index_history.mjs');

    syncAssetMetadata(true).catch(e => console.error('[Background Sync Asset Error]:', e));
    syncIndexHistory().catch(e => console.error('[Background Sync Index Error]:', e));

    res.json({ success: true, message: 'Metadata and benchmark index sync initiated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Ladder Server] Running on http://localhost:${PORT}`);

  // Self-scheduling non-overlapping real-time active price & forex sync loop
  const runLiveTicker = async () => {
    try {
      await refreshActiveHoldingsPrices();
    } catch (err) {
      // background ticker resilience
    }
    setTimeout(runLiveTicker, 2000);
  };

  // Start ticker runner after initial boot delay
  setTimeout(runLiveTicker, 1500);

  // Full comprehensive portfolio sync (every 10 minutes)
  setInterval(async () => {
    try {
      await refreshAllHoldingsPrices();
    } catch (err) { }
  }, 10 * 60 * 1000);
});
