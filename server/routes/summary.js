import express from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate, liveQuoteCache, resolveHoldingPrice } from '../services/priceEngine.js';
import { getHistoricalFxRate, getPersistedRate } from '../services/fxRateStore.js';
import { calculateXirr, calculateAbsoluteReturn } from '../services/xirrCalculator.js';
import { computeHoldingValueINR, computePortfolioValuation } from '../services/portfolioCalculator.js';
import { getTodayIST, isAnyMarketOpen, isTradingDay, getAssetSessionStatus } from '../services/marketCalendar.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

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

// -------------------------------------------------------------
// Portfolio Summary & Metrics API
// -------------------------------------------------------------
router.get('/summary', async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    const categories = await db.select('categories');
    const liabilities = await db.select('liabilities');

    const catMap = {};
    categories.forEach(c => catMap[c.id] = c);

    let totalInvestedINR = 0;
    let totalInvestedUSD = 0;   // raw USD invested (for correct USD display)
    let totalRealizedPnlINR = 0;
    let totalRealizedPnlUSD = 0;

    // Compute exact weighted transaction FX rates for US stocks for invested amount (using in-memory paginated cache)
    const txs = await db.select('transactions');
    const usFxMap = {};
    (txs || []).filter(t => t.currency === 'USD' && t.type === 'BUY').forEach(t => {
      const key = t.holding_id || t.symbol;
      if (!usFxMap[key]) usFxMap[key] = { totalUSD: 0, totalINR: 0 };
      const amt = Number(t.total_amount) || 0;
      const rate = Number(t.fx_rate) || getHistoricalFxRate(t.date) || getPersistedRate('USD_INR') || 1.0;
      usFxMap[key].totalUSD += amt;
      usFxMap[key].totalINR += amt * rate;
    });

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

    // Canonical valuation calculation using the single source of truth engine
    const livePriceMap = {};
    holdings.forEach(h => {
      const liveQuote = liveQuoteCache.get(h.symbol);
      livePriceMap[h.symbol] = resolveHoldingPrice(h, liveQuote);
    });

    const valuation = computePortfolioValuation(holdings, liabilities, livePriceMap, fxRate);
    const totalAssetsINR = valuation.totalAssets ?? valuation.total_assets;
    const totalLiabilitiesINR = valuation.totalLiabilities ?? valuation.debt ?? 0;
    const netWorthINR = valuation.netWorth ?? valuation.total_wealth;

    holdings.forEach(h => {
      // Realized P&L — sum across ALL holdings (including closed) which already strictly includes dividends
      const pnl = Number(h.realized_pnl) || 0;
      if (h.currency === 'USD') {
        totalRealizedPnlUSD += pnl;
        totalRealizedPnlINR += (pnl * fxRate);
      } else {
        totalRealizedPnlINR += pnl;
        totalRealizedPnlUSD += (pnl / fxRate);
      }

      // Active holdings only for invested computation
      if ((Number(h.quantity) || 0) <= 0) return;

      if (h.currency === 'USD') {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        const txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : fxRate;
        const investedUSD = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
        totalInvestedUSD += investedUSD;
        totalInvestedINR += investedUSD * txRate;
      } else {
        const investedVal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
        totalInvestedINR += investedVal;
      }
    });

    const totalGainINR = totalAssetsINR - totalInvestedINR;
    const absoluteReturnPct = calculateAbsoluteReturn(totalInvestedINR, totalAssetsINR);

    // -------------------------------------------------------------
    // Granular Asset Class Metrics & XIRR
    // -------------------------------------------------------------
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
      const pnl = (Number(h.realized_pnl) || 0) * (h.currency === 'USD' ? fxRate : 1.0);
      cat.realizedINR += pnl;

      // Active holdings
      if ((Number(h.quantity) || 0) > 0) {
        const liveRate = h.currency === 'USD' ? fxRate : 1.0;
        const liveQuote = liveQuoteCache.get(h.symbol);
        const currentPriceNum = resolveHoldingPrice(h, liveQuote);
        const currentVal = computeHoldingValueINR(h, currentPriceNum, liveRate);

        let txRate = 1.0;
        if (h.currency === 'USD') {
          const m = usFxMap[h.id] || usFxMap[h.symbol];
          txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : (getHistoricalFxRate(h.created_at) || fxRate);
        }
        const investedVal = Number(((Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0) * txRate).toFixed(2));

        cat.currentINR = Number((cat.currentINR + currentVal).toFixed(2));
        cat.investedINR = Number((cat.investedINR + investedVal).toFixed(2));
        cat.unrealizedINR = Number((cat.unrealizedINR + (currentVal - investedVal)).toFixed(2));

        if (validXirrCategories.has(h.category_id)) {
          xirrFinalAssetsINR += currentVal;
        }
      }
    });

    // 2. Build Category Cashflows from actual transactions
    txs.forEach(t => {
      if (t.type !== 'BUY' && t.type !== 'SELL') return;
      const h = holdings.find(item => item.id === t.holding_id);
      if (!h) return;
      const rate = (h.currency === 'USD') ? (getHistoricalFxRate(t.date) || fxRate) : 1.0;
      const amt = (Number(t.total_amount) || 0) * rate;
      const charges = (Number(t.charges) || 0) * rate;
      const amount = (t.type === 'BUY') ? -(amt + charges) : (amt - charges);
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

    const earliestTxDate = txs.length > 0 ? txs.reduce((min, t) => (!min || t.date < min) ? t.date : min, null) : null;

    holdings.forEach(h => {
      const cat = categoryMetricsMap[h.category_id];
      if (!cat || !validXirrCategories.has(h.category_id)) return;
      if (cat.holdingsCovered.has(h.id)) return; // already has real transactions

      const buyQty = Number(h.buy_qty) || 0;
      const avgPrice = Number(h.avg_buy_price) || 0;
      if (buyQty <= 0 || avgPrice <= 0) return;

      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      const txRate = h.currency === 'USD' ? (getHistoricalFxRate(h.created_at) || fxRate) : 1.0;
      const totalCostINR = buyQty * avgPrice * txRate;

      // Dynamic date resolution
      let holdingDate = holdingEarliestDivDate[h.id] || categoryEarliestDate[h.category_id] || h.created_at?.split('T')[0] || earliestTxDate || new Date().toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      if (holdingDate > todayStr) holdingDate = todayStr;

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
          const hTxs = txs.filter(t => t.holding_id === h.id && (t.type === 'BUY' || t.type === 'SELL'));
          const hDivs = dividends.filter(d => d.holding_id === h.id);
          const flows = [];
          if (hTxs.length > 0) {
            hTxs.forEach(t => {
              const r = (h.currency === 'USD') ? (getHistoricalFxRate(t.date) || fxRate) : 1.0;
              const amt = (Number(t.total_amount) || 0) * r;
              const charges = (Number(t.charges) || 0) * r;
              flows.push({
                date: t.date,
                amount: (t.type === 'BUY') ? -(amt + charges) : (amt - charges)
              });
            });
          } else {
            let earliestDivDate = null;
            hDivs.forEach(d => {
              const dt = d.ex_date || d.payment_date;
              if (dt && (!earliestDivDate || dt < earliestDivDate)) earliestDivDate = dt;
            });
            let buyDate = h.created_at?.split('T')[0] || earliestTxDate || new Date().toISOString().split('T')[0];
            if (earliestDivDate) {
              const dObj = new Date(earliestDivDate);
              dObj.setMonth(dObj.getMonth() - 1);
              buyDate = dObj.toISOString().split('T')[0];
            }
            const rate = h.currency === 'USD' ? (getHistoricalFxRate(buyDate) || fxRate) : 1.0;
            const cost = Number(h.quantity) * Number(h.avg_buy_price) * rate;
            flows.push({ date: buyDate, amount: -cost });
          }
          hDivs.forEach(d => flows.push({ date: d.ex_date || d.payment_date, amount: Number(d.amount_inr || 0) }));
          const rate = h.currency === 'USD' ? fxRate : 1.0;
          const liveQuote = liveQuoteCache.get(h.symbol);
          const curPrice = resolveHoldingPrice(h, liveQuote);
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
          const rate = h.currency === 'USD' ? (getHistoricalFxRate(h.created_at) || fxRate) : 1.0;
          const cost = soldQty > 0 ? (soldQty * avgBuy * rate) : ((Number(h.invested_amount) || 0) * rate);
          const pnl = (Number(h.realized_pnl) || 0) * (h.currency === 'USD' ? fxRate : 1.0);
          const proceeds = cost + pnl;

          const hTxs = txs.filter(t => t.holding_id === h.id && (t.type === 'BUY' || t.type === 'SELL'));
          const hDivs = dividends.filter(d => d.holding_id === h.id);
          const flows = [];
          const hasSellTx = hTxs.some(t => t.type === 'SELL');

          if (hTxs.length > 0) {
            hTxs.forEach(t => {
              const r = (h.currency === 'USD') ? (getHistoricalFxRate(t.date) || fxRate) : 1.0;
              const amt = (Number(t.total_amount) || 0) * r;
              const charges = (Number(t.charges) || 0) * r;
              flows.push({
                date: t.date,
                amount: (t.type === 'BUY') ? -(amt + charges) : (amt - charges)
              });
            });
          } else {
            const dynamicBuyDate = h.created_at?.split('T')[0] || earliestTxDate || new Date().toISOString().split('T')[0];
            flows.push({ date: dynamicBuyDate, amount: -cost });
          }
          hDivs.forEach(d => flows.push({ date: d.ex_date || d.payment_date, amount: Number(d.amount_inr || 0) }));
          if (!hasSellTx) {
            const dynamicSellDate = h.updated_at?.split('T')[0] || new Date().toISOString().split('T')[0];
            flows.push({ date: dynamicSellDate, amount: proceeds });
          }

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
    let yesterdayAssets = null;
    let yesterdayLog = null;
    const todayStr = getTodayIST();

    try {
      const eodPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
      if (fs.existsSync(eodPath)) {
        const raw = fs.readFileSync(eodPath, 'utf8');
        const eodLogs = JSON.parse(raw);
        const pastLogs = (eodLogs || []).filter(l => l.date < todayStr).sort((a, b) => b.date.localeCompare(a.date));
        if (pastLogs.length > 0) {
          yesterdayLog = pastLogs[0];
          yesterdayWealth = pastLogs[0].total_wealth !== undefined ? pastLogs[0].total_wealth : pastLogs[0].wealth;
          yesterdayAssets = pastLogs[0].total_assets !== undefined ? pastLogs[0].total_assets : (yesterdayWealth + (pastLogs[0].debt || 0));
        }
      }
    } catch (e) {
      console.warn('[EOD Local Logs Read Warning]:', e.message);
    }

    if (yesterdayWealth === null) {
      try {
        const pnlHistory = await db.select('pnl_history');
        if (pnlHistory && pnlHistory.length > 0) {
          const normalizedLogs = pnlHistory.map(l => {
            const parts = (l.log_date || '').split('-');
            const iso = (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4)
              ? `${parts[2]}-${parts[1]}-${parts[0]}`
              : l.log_date;
            return { ...l, isoDate: iso };
          });
          const pastLogs = normalizedLogs.filter(l => l.isoDate < todayStr).sort((a, b) => b.isoDate.localeCompare(a.isoDate));
          if (pastLogs.length > 0) {
            yesterdayLog = pastLogs[0];
            yesterdayWealth = pastLogs[0].net_worth_inr;
            yesterdayAssets = pastLogs[0].total_assets_inr;
          }
        }
      } catch (e) {
        console.warn('[EOD db.select pnl_history Warning]:', e.message);
      }
    }
    if (yesterdayWealth === null) {
      try {
        const { data: previousEod } = await supabase
          .from('pnl_history')
          .select('net_worth_inr, total_assets_inr')
          .lt('log_date', todayStr)
          .order('log_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        yesterdayWealth = previousEod?.net_worth_inr ?? null;
        yesterdayAssets = previousEod?.total_assets_inr ?? null;
      } catch (e) {
        console.warn('[EOD pnl_history Fetch Error]:', e.message);
      }
    }

    if (yesterdayWealth === null) {
      yesterdayWealth = netWorthINR;
    }

    // Multi-Asset Dynamic Valuation Engine (Parity with Calendar & Holding Details)
    const inStocksStatus = getAssetSessionStatus('in_stocks', todayStr);
    const usStocksStatus = getAssetSessionStatus('us_stocks', todayStr);
    const mfStatus = getAssetSessionStatus('mutual_funds', todayStr);
    const npsStatus = getAssetSessionStatus('nps', todayStr);

    const prevInStocks = Number((yesterdayLog?.indian_stocks ?? yesterdayLog?.stocks_val_inr ?? 0).toFixed(2));
    const prevUsStocks = Number((yesterdayLog?.us_stocks ?? yesterdayLog?.us_stocks_val_inr ?? 0).toFixed(2));
    const prevMf = Number((yesterdayLog?.mutual_funds ?? yesterdayLog?.mutual_funds_val_inr ?? 0).toFixed(2));
    const prevNps = Number((yesterdayLog?.nps ?? yesterdayLog?.nps_val_inr ?? 0).toFixed(2));
    const prevSavings = Number((yesterdayLog?.savings ?? yesterdayLog?.savings_val_inr ?? 0).toFixed(2));
    const prevEpf = Number((yesterdayLog?.epf ?? yesterdayLog?.epf_val_inr ?? 0).toFixed(2));
    const prevDebt = Number((yesterdayLog?.debt ?? yesterdayLog?.liabilities_inr ?? 0).toFixed(2));

    // Check if any user transactions occurred today strictly by trade date (Rule 5 & Rule 9)
    const todayTxs = (txs || []).filter(t => t.date === todayStr);
    const categoriesWithTodayTxs = new Set();
    const holdingMapById = new Map((holdings || []).map(h => [h.id, h]));
    todayTxs.forEach(t => {
      const h = holdingMapById.get(t.holding_id);
      if (h && h.category_id) {
        categoriesWithTodayTxs.add(h.category_id);
      }
    });

    const hasInTx = categoriesWithTodayTxs.has('in_stocks');
    const resolvedInStocks = (!hasInTx && (inStocksStatus.status === 'NON_TRADING_DAY' || inStocksStatus.status === 'PRE_MARKET')) ? (yesterdayLog ? prevInStocks : Number((valuation.indian_stocks || 0).toFixed(2))) : Number((valuation.indian_stocks || 0).toFixed(2));

    const hasUsTx = categoriesWithTodayTxs.has('us_stocks');
    const resolvedUsStocks = (!hasUsTx && (usStocksStatus.status === 'NON_TRADING_DAY' || usStocksStatus.status === 'PRE_MARKET')) ? (yesterdayLog ? prevUsStocks : Number((valuation.us_stocks || 0).toFixed(2))) : Number((valuation.us_stocks || 0).toFixed(2));

    const hasMfTx = categoriesWithTodayTxs.has('mutual_funds');
    const resolvedMf = (!hasMfTx && (mfStatus.status === 'NON_TRADING_DAY' || mfStatus.status === 'PRE_MARKET')) ? (yesterdayLog ? prevMf : Number((valuation.mutual_funds || 0).toFixed(2))) : Number((valuation.mutual_funds || 0).toFixed(2));

    const hasNpsTx = categoriesWithTodayTxs.has('nps');
    const resolvedNps = (!hasNpsTx && (npsStatus.status === 'NON_TRADING_DAY' || npsStatus.status === 'PRE_MARKET')) ? (yesterdayLog ? prevNps : Number((valuation.nps || 0).toFixed(2))) : Number((valuation.nps || 0).toFixed(2));

    const hasBankTx = categoriesWithTodayTxs.has('bank');
    const resolvedSavings = hasBankTx ? Number((valuation.savings || 0).toFixed(2)) : (yesterdayLog ? prevSavings : Number((valuation.savings || 0).toFixed(2)));

    const hasEpfTx = categoriesWithTodayTxs.has('epf');
    const resolvedEpf = hasEpfTx ? Number((valuation.epf || 0).toFixed(2)) : (yesterdayLog ? prevEpf : Number((valuation.epf || 0).toFixed(2)));

    const hasDebtTx = categoriesWithTodayTxs.has('loans') || categoriesWithTodayTxs.has('credit_cards');
    const resolvedDebt = hasDebtTx ? Number((valuation.debt || 0).toFixed(2)) : (yesterdayLog ? prevDebt : Number((valuation.debt || 0).toFixed(2)));

    const finalTotalAssetsINR = Number((resolvedInStocks + resolvedUsStocks + resolvedMf + resolvedNps + resolvedSavings + resolvedEpf).toFixed(2));
    const finalNetWorthINR = Number((finalTotalAssetsINR - resolvedDebt).toFixed(2));

    const anyMarketTrading = (inStocksStatus.status === 'MARKET_OPEN' || inStocksStatus.status === 'POST_MARKET') ||
                             (usStocksStatus.status === 'MARKET_OPEN' || usStocksStatus.status === 'POST_MARKET');
    const hasAnyTxToday = todayTxs.length > 0;

    let dayPnlINR = Number((finalNetWorthINR - yesterdayWealth).toFixed(2));
    let dayPnlPct = yesterdayWealth > 0 ? Number(((dayPnlINR / yesterdayWealth) * 100).toFixed(2)) : 0;

    if (!anyMarketTrading && !hasAnyTxToday) {
      dayPnlINR = 0;
      dayPnlPct = 0;
    }

    // Synchronize categoryMetrics currentINR so Category Breakdowns match finalTotalAssetsINR with 1-to-1 cent precision
    const categoryOverrides = {
      'in_stocks': resolvedInStocks,
      'us_stocks': resolvedUsStocks,
      'mutual_funds': resolvedMf,
      'nps': resolvedNps,
      'bank': resolvedSavings,
      'epf': resolvedEpf
    };
    categoryMetrics.forEach(c => {
      if (categoryOverrides[c.id] !== undefined) {
        c.currentINR = categoryOverrides[c.id];
      }
    });

    // Asset Breakdown by Category (clean names)
    const categoryValues = {};
    holdings.forEach(h => {
      if ((Number(h.quantity) || 0) <= 0) return;
      const displayName = DISPLAY_NAMES[h.category_id] || (catMap[h.category_id] ? catMap[h.category_id].name : h.category_id);
      const rate = h.currency === 'USD' ? fxRate : 1.0;
      const p = livePriceMap[h.symbol] || (Number(h.current_price) || 0);
      const val = (Number(h.quantity) || 0) * p * rate;
      if (!categoryValues[displayName]) categoryValues[displayName] = 0;
      categoryValues[displayName] += val;
    });

    const assetAllocation = Object.keys(categoryValues).map(cat => ({
      name: cat,
      value: Number(categoryValues[cat].toFixed(2)),
      percentage: Number(((categoryValues[cat] / (finalTotalAssetsINR || 1)) * 100).toFixed(1))
    }));

    res.json({
      totalAssetsINR: Number(finalTotalAssetsINR.toFixed(2)),
      totalLiabilitiesINR: Number(totalLiabilitiesINR.toFixed(2)),
      netWorthINR: Number(finalNetWorthINR.toFixed(2)),
      totalInvestedINR: Number(totalInvestedINR.toFixed(2)),
      totalInvestedUSD: Number(totalInvestedUSD.toFixed(2)),
      totalGainINR: Number((finalTotalAssetsINR - totalInvestedINR).toFixed(2)),
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

export default router;
