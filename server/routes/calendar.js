import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate, liveQuoteCache, resolveHoldingPrice } from '../services/priceEngine.js';
import { computePortfolioValuation } from '../services/portfolioCalculator.js';
import { getHolidaysForYear, isTradingDay, getLastTradingDay, getNextTradingDay, getTodayIST, isAnyMarketOpen, getAssetSessionStatus, isAssetTradingDay, getSpecialTradingSession } from '../services/marketCalendar.js';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get('/daily-pnl', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, range } = req.query;

    let eodLogs = [];
    const eodPath = path.join(__dirname, '../../data/portfolio_eod_logs.json');
    if (fs.existsSync(eodPath)) {
      const raw = fs.readFileSync(eodPath, 'utf8');
      eodLogs = JSON.parse(raw);
    }

    const latestLocalDate = eodLogs.reduce((latest, log) => (
      log.date > latest ? log.date : latest
    ), '0000-00-00');
    let dbLogs = [];
    try {
      const pnlHistory = await db.select('pnl_history');
      if (pnlHistory && pnlHistory.length > 0) {
        dbLogs = pnlHistory.filter(l => l.log_date >= latestLocalDate).sort((a, b) => a.log_date.localeCompare(b.log_date));
      }
    } catch (e) {
      console.warn('[EOD db.select pnl_history Warning]:', e.message);
    }
    if (!dbLogs || dbLogs.length === 0) {
      const { data, error: dbLogsError } = await supabase
        .from('pnl_history')
        .select('*')
        .gte('log_date', latestLocalDate)
        .order('log_date', { ascending: true });
      if (dbLogsError) {
        console.warn('[EOD Supabase Fetch Warning]:', dbLogsError.message);
      }
      dbLogs = data || [];
    }
    const dbLogsByDate = new Map((dbLogs || []).map(l => [l.log_date, {
      date: l.log_date,
      total_assets: l.total_assets_inr,
      debt: l.total_liabilities_inr,
      wealth: l.net_worth_inr,
      total_wealth: l.net_worth_inr,
      daily_pnl: l.daily_pnl_inr,
      pnl_pct: l.pnl_percentage,
      ...(l.breakdown || {}),
      hdfc: l.hdfc,
      indusind: l.indusind,
      idfc: l.idfc,
      rbl: l.rbl,
      sbi: l.sbi,
      federal: l.federal,
      savings: l.savings,
      mutual_funds: l.mutual_funds,
      indian_stocks: l.indian_stocks,
      us_stocks: l.us_stocks,
      nps: l.nps,
      epf: l.epf,
      loan: l.loan,
      credits: l.credits
    }]));
    // The local portfolio_eod_logs.json is the live canonical source.
    // pnl_history (Supabase) only backfills dates where the local file has no entry.
    // This guarantees /api/summary and /api/daily-pnl use the exact same wealth baseline.
    const localDates = new Set(eodLogs.map(l => l.date));
    eodLogs = [
      ...eodLogs,
      ...dbLogsByDate.values().filter ? [...dbLogsByDate.values()].filter(l => !localDates.has(l.date)) : [...dbLogsByDate.values()].filter(l => !localDates.has(l.date))
    ];

    // Universal Live Snapshot for Today (Single Source of Truth)
    const fxRate = await fetchFxRate();
    const holdings = await db.select('holdings');
    const liabilities = await db.select('liabilities');
    const livePriceMap = {};
    holdings.forEach(h => {
      const liveQuote = liveQuoteCache.get(h.symbol);
      livePriceMap[h.symbol] = resolveHoldingPrice(h, liveQuote);
    });

    const liveTodayValuation = computePortfolioValuation(holdings, liabilities, livePriceMap, fxRate);
    const todayStr = getTodayIST();

    // Load transactions strictly by trade/transaction date (Rule 5 & Rule 9)
    const allTxs = await db.select('transactions');
    const txDatesWithActivity = new Set((allTxs || []).map(t => t.date));
    const todayTxs = (allTxs || []).filter(t => t.date === todayStr);

    // Identify which asset categories had user transactions today
    const categoriesWithTodayTxs = new Set();
    const holdingMapById = new Map((holdings || []).map(h => [h.id, h]));
    const liabilityMapById = new Map((liabilities || []).map(l => [l.id, l]));
    todayTxs.forEach(t => {
      if (t.holding_id) {
        const h = holdingMapById.get(t.holding_id);
        if (h && h.category_id) categoriesWithTodayTxs.add(h.category_id);
      }
      if (t.liability_id) {
        const l = liabilityMapById.get(t.liability_id);
        if (l && l.category_id) categoriesWithTodayTxs.add(l.category_id);
        else categoriesWithTodayTxs.add('loans');
      }
    });

    // Identify last trading day log before today (e.g. previous finalized session)
    const priorLogs = eodLogs.filter(l => l.date < todayStr).sort((a, b) => b.date.localeCompare(a.date));
    const lastTradingLog = priorLogs[0];

    // Multi-Asset Dynamic Valuation Engine:
    // Decoupled from rigid weekend or fixed holiday assumptions.
    // Each asset class is evaluated independently based on its actual market schedule:
    // - Indian Stocks (NSE/BSE): Active on regular weekdays, special Saturday sessions (DR/Budget), and Diwali Muhurat trading.
    // - US Stocks (NYSE/NASDAQ): Active on US trading days (trades independently on Indian holidays like Gandhi Jayanti, Diwali, Holi).
    // - Mutual Funds (AMFI) & NPS (CRA): NAV publication schedules.
    // - Bank, EPF, Liabilities: Continuous ledgers updated on user transactions.

    const inStocksStatus = getAssetSessionStatus('in_stocks', todayStr);
    const usStocksStatus = getAssetSessionStatus('us_stocks', todayStr);
    const mfStatus = getAssetSessionStatus('mutual_funds', todayStr);
    const npsStatus = getAssetSessionStatus('nps', todayStr);

    const prevInStocks = Number((lastTradingLog?.indian_stocks ?? lastTradingLog?.stocks_val_inr ?? 0).toFixed(2));
    const prevUsStocks = Number((lastTradingLog?.us_stocks ?? lastTradingLog?.us_stocks_val_inr ?? 0).toFixed(2));
    const prevMf = Number((lastTradingLog?.mutual_funds ?? lastTradingLog?.mutual_funds_val_inr ?? 0).toFixed(2));
    const prevNps = Number((lastTradingLog?.nps ?? lastTradingLog?.nps_val_inr ?? 0).toFixed(2));
    const prevSavings = Number((lastTradingLog?.savings ?? lastTradingLog?.savings_val_inr ?? 0).toFixed(2));
    const prevEpf = Number((lastTradingLog?.epf ?? lastTradingLog?.epf_val_inr ?? 0).toFixed(2));
    const prevDebt = Number((lastTradingLog?.debt ?? lastTradingLog?.liabilities_inr ?? 0).toFixed(2));

    // Resolve Indian Stocks
    const hasInTx = categoriesWithTodayTxs.has('in_stocks');
    let resolvedInStocks;
    if (!hasInTx && (inStocksStatus.status === 'NON_TRADING_DAY' || inStocksStatus.status === 'PRE_MARKET')) {
      resolvedInStocks = prevInStocks;
    } else {
      resolvedInStocks = Number((liveTodayValuation.indian_stocks ?? 0).toFixed(2));
    }

    // Resolve US Stocks (active on US market days even when Indian markets are closed!)
    const hasUsTx = categoriesWithTodayTxs.has('us_stocks');
    let resolvedUsStocks;
    if (!hasUsTx && (usStocksStatus.status === 'NON_TRADING_DAY' || usStocksStatus.status === 'PRE_MARKET')) {
      resolvedUsStocks = prevUsStocks;
    } else {
      resolvedUsStocks = Number((liveTodayValuation.us_stocks ?? 0).toFixed(2));
    }

    // Resolve Mutual Funds
    const hasMfTx = categoriesWithTodayTxs.has('mutual_funds');
    let resolvedMf;
    if (!hasMfTx && (mfStatus.status === 'NON_TRADING_DAY' || mfStatus.status === 'PRE_MARKET')) {
      resolvedMf = prevMf;
    } else {
      resolvedMf = Number((liveTodayValuation.mutual_funds ?? 0).toFixed(2));
    }

    // Resolve NPS
    const hasNpsTx = categoriesWithTodayTxs.has('nps');
    let resolvedNps;
    if (!hasNpsTx && (npsStatus.status === 'NON_TRADING_DAY' || npsStatus.status === 'PRE_MARKET')) {
      resolvedNps = prevNps;
    } else {
      resolvedNps = Number((liveTodayValuation.nps ?? 0).toFixed(2));
    }

    // Resolve Bank (Savings) & EPF
    const hasBankTx = categoriesWithTodayTxs.has('bank');
    const resolvedSavings = hasBankTx ? Number((liveTodayValuation.savings ?? 0).toFixed(2)) : (lastTradingLog ? prevSavings : Number((liveTodayValuation.savings ?? 0).toFixed(2)));

    const hasEpfTx = categoriesWithTodayTxs.has('epf');
    const resolvedEpf = hasEpfTx ? Number((liveTodayValuation.epf ?? 0).toFixed(2)) : (lastTradingLog ? prevEpf : Number((liveTodayValuation.epf ?? 0).toFixed(2)));

    // Resolve Debt
    const hasDebtTx = categoriesWithTodayTxs.has('loans') || categoriesWithTodayTxs.has('credit_cards');
    const liveDebtVal = Number((liveTodayValuation.debt ?? ((liveTodayValuation.loan || 0) + (liveTodayValuation.credits || 0))).toFixed(2));
    const resolvedDebt = hasDebtTx ? liveDebtVal : (lastTradingLog ? prevDebt : liveDebtVal);

    // Dynamic Balance Sheet Totals
    const totalAssets = Number((resolvedInStocks + resolvedUsStocks + resolvedMf + resolvedNps + resolvedSavings + resolvedEpf).toFixed(2));
    const totalWealth = Number((totalAssets - resolvedDebt).toFixed(2));

    const prevTotalWealth = Number((lastTradingLog?.total_wealth ?? lastTradingLog?.wealth ?? lastTradingLog?.net_worth_inr ?? totalWealth).toFixed(2));
    const prevTotalAssets = Number((lastTradingLog?.total_assets ?? lastTradingLog?.total_assets_inr ?? totalAssets).toFixed(2));
    const prevLiabilities = Number((lastTradingLog?.debt ?? lastTradingLog?.liabilities_inr ?? resolvedDebt).toFixed(2));

    // If all held market assets are non-trading or pre-market, and no transactions occurred today, P&L is strictly 0.00
    const anyMarketTrading = (inStocksStatus.status === 'MARKET_OPEN' || inStocksStatus.status === 'POST_MARKET') ||
                             (usStocksStatus.status === 'MARKET_OPEN' || usStocksStatus.status === 'POST_MARKET');
    const hasAnyTxToday = todayTxs.length > 0;

    let dailyPnl = Number((totalWealth - prevTotalWealth).toFixed(2));
    let pnlPct = prevTotalWealth > 0 ? Number(((dailyPnl / prevTotalWealth) * 100).toFixed(2)) : 0;
    let assetDelta = Number((totalAssets - prevTotalAssets).toFixed(2));
    let liabilityDelta = Number((resolvedDebt - prevLiabilities).toFixed(2));

    if (!anyMarketTrading && !hasAnyTxToday) {
      dailyPnl = 0;
      pnlPct = 0;
      assetDelta = 0;
      liabilityDelta = 0;
    }

    const todayEntry = {
      ...(lastTradingLog || {}),
      date: todayStr,
      indian_stocks: resolvedInStocks,
      us_stocks: resolvedUsStocks,
      mutual_funds: resolvedMf,
      nps: resolvedNps,
      savings: resolvedSavings,
      epf: resolvedEpf,
      stocks_val_inr: resolvedInStocks,
      us_stocks_val_inr: resolvedUsStocks,
      mutual_funds_val_inr: resolvedMf,
      nps_val_inr: resolvedNps,
      savings_val_inr: resolvedSavings,
      epf_val_inr: resolvedEpf,
      total_assets: totalAssets,
      total_assets_inr: totalAssets,
      debt: resolvedDebt,
      liabilities_inr: resolvedDebt,
      wealth: totalWealth,
      total_wealth: totalWealth,
      net_worth_inr: totalWealth,
      daily_pnl: dailyPnl,
      daily_pnl_inr: dailyPnl,
      pnl_pct: pnlPct,
      pnl_percentage: pnlPct,
      asset_delta: assetDelta,
      asset_delta_inr: assetDelta,
      liability_delta_inr: liabilityDelta
    };

    // Merge or append today's valuation
    const existingTodayIdx = eodLogs.findIndex(l => l.date === todayStr);
    if (existingTodayIdx >= 0) {
      eodLogs[existingTodayIdx] = todayEntry;
    } else {
      eodLogs.push(todayEntry);
    }

    // Sort chronologically
    eodLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Recompute daily_pnl and pnl_pct across all historical logs
    for (let i = 0; i < eodLogs.length; i++) {
      const cur = eodLogs[i];
      if (cur.date === todayStr) continue; // todayEntry is already precisely computed
      const prev = i > 0 ? eodLogs[i - 1] : cur;
      const curWealth = cur.total_wealth !== undefined ? cur.total_wealth : (cur.wealth || 0);
      const prevWealth = prev.total_wealth !== undefined ? prev.total_wealth : (prev.wealth || 0);
      const rawDelta = Number((curWealth - prevWealth).toFixed(2));
      cur.daily_pnl = rawDelta;
      cur.pnl_pct = prevWealth !== 0 ? Number(((rawDelta / prevWealth) * 100).toFixed(2)) : 0;
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

      const rangeMatch = String(range).match(/^(\d+)([DWMYdwmy])$/);
      if (range === 'ALL') {
        startD.setUTCFullYear(2000);
      } else if (rangeMatch) {
        const count = parseInt(rangeMatch[1], 10) || 1;
        const u = rangeMatch[2].toUpperCase();
        if (u === 'D') startD.setUTCDate(startD.getUTCDate() - count);
        else if (u === 'W') startD.setUTCDate(startD.getUTCDate() - count * 7);
        else if (u === 'M') startD.setUTCMonth(startD.getUTCMonth() - count);
        else if (u === 'Y') startD.setUTCFullYear(startD.getUTCFullYear() - count);
      } else if (range === '1M') startD.setUTCMonth(startD.getUTCMonth() - 1);
      else if (range === '3M') startD.setUTCMonth(startD.getUTCMonth() - 3);
      else if (range === '6M') startD.setUTCMonth(startD.getUTCMonth() - 6);
      else if (range === '1Y') startD.setUTCFullYear(startD.getUTCFullYear() - 1);
      else if (range === '2Y') startD.setUTCFullYear(startD.getUTCFullYear() - 2);
      else if (range === '3Y') startD.setUTCFullYear(startD.getUTCFullYear() - 3);
      else if (range === '5Y') startD.setUTCFullYear(startD.getUTCFullYear() - 5);
      else if (range === '10Y') startD.setUTCFullYear(startD.getUTCFullYear() - 10);

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
      const hasTx = txDatesWithActivity.has(item.date);

      let dailyPnl, pct, wealth, debt, assets, assetDelta, liabilityDelta;

      if (item.date === todayStr) {
        // Use todayEntry's rigorously calculated multi-asset figures
        wealth = item.wealth !== undefined ? item.wealth : (item.total_wealth ?? wCurr);
        debt = item.debt !== undefined ? item.debt : ((item.loan || 0) + (item.credits || 0));
        assets = item.total_assets !== undefined ? item.total_assets : (wealth + debt);
        dailyPnl = item.daily_pnl !== undefined ? item.daily_pnl : Number((wealth - prevWealth).toFixed(2));
        pct = item.pnl_pct !== undefined ? item.pnl_pct : (prevWealth !== 0 ? Number(((dailyPnl / prevWealth) * 100).toFixed(2)) : 0);
        const prevDebt = prevItem.debt !== undefined ? prevItem.debt : ((prevItem.loan || 0) + (prevItem.credits || 0));
        const prevAssets = prevItem.total_assets !== undefined ? prevItem.total_assets : (prevWealth + prevDebt);
        assetDelta = item.asset_delta !== undefined ? item.asset_delta : Number((assets - prevAssets).toFixed(2));
        liabilityDelta = item.liability_delta_inr !== undefined ? item.liability_delta_inr : Number((debt - prevDebt).toFixed(2));
      } else {
        const isItemTradingDay = isTradingDay(item.date, 'NSE') || isTradingDay(item.date, 'NYSE');
        const isZeroPnlDay = !isItemTradingDay && !hasTx;
        dailyPnl = isZeroPnlDay ? 0 : (item.daily_pnl !== undefined ? item.daily_pnl : (wCurr - prevWealth));
        pct = isZeroPnlDay ? 0 : (prevWealth !== 0 ? Number(((dailyPnl / prevWealth) * 100).toFixed(2)) : 0);
        wealth = isZeroPnlDay ? prevWealth : (wCurr || 0);
        debt = item.debt !== undefined ? item.debt : ((item.loan || 0) + (item.credits || 0));
        assets = isZeroPnlDay ? (prevWealth + debt) : (item.total_assets !== undefined ? item.total_assets : (wealth + debt));

        const prevDebt = prevItem.debt !== undefined ? prevItem.debt : ((prevItem.loan || 0) + (prevItem.credits || 0));
        const prevAssets = prevItem.total_assets !== undefined ? prevItem.total_assets : (prevWealth + prevDebt);
        assetDelta = isZeroPnlDay ? 0 : Number((assets - prevAssets).toFixed(2));
        liabilityDelta = isZeroPnlDay ? 0 : Number((debt - prevDebt).toFixed(2));
      }

      resultLogs.push({
        log_date: item.date,
        net_worth_inr: Number(wealth.toFixed(2)),
        total_assets_inr: Number(assets.toFixed(2)),
        liabilities_inr: Number(debt.toFixed(2)),
        daily_pnl_inr: Number(dailyPnl.toFixed(2)),
        pnl_percentage: Number(pct),
        asset_delta_inr: Number(assetDelta.toFixed(2)),
        liability_delta_inr: Number(liabilityDelta.toFixed(2)),

        // Exact breakdown fields
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
    console.error('[API Error - /api/daily-pnl]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/market-holidays', (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const market = (req.query.market || 'ALL').toUpperCase();
    const holidays = getHolidaysForYear(year, market);
    const todayISO = new Date().toISOString().split('T')[0];

    res.json({
      success: true,
      year,
      market,
      count: holidays.length,
      isTodayTradingDayNSE: isTradingDay(todayISO, 'NSE'),
      isTodayTradingDayNYSE: isTradingDay(todayISO, 'NYSE'),
      lastTradingDayNSE: getLastTradingDay(todayISO, 'NSE'),
      lastTradingDayNYSE: getLastTradingDay(todayISO, 'NYSE'),
      nextTradingDayNSE: getNextTradingDay(todayISO, 'NSE'),
      nextTradingDayNYSE: getNextTradingDay(todayISO, 'NYSE'),
      holidays
    });
  } catch (err) {
    console.error('[API Error - /api/market-holidays]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
