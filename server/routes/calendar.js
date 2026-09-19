import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate, liveQuoteCache } from '../services/priceEngine.js';
import { computePortfolioValuation } from '../services/portfolioCalculator.js';
import { getHolidaysForYear, isTradingDay, getLastTradingDay, getNextTradingDay, getTodayIST } from '../services/marketCalendar.js';
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
    eodLogs = [
      ...eodLogs.filter(l => !dbLogsByDate.has(l.date)),
      ...dbLogsByDate.values()
    ];

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
    const todayStr = getTodayIST();

    const isWeekendDay = (dStr) => {
      if (!dStr) return false;
      const d = new Date(`${dStr}T00:00:00Z`);
      const day = d.getUTCDay();
      return day === 0 || day === 6;
    };

    // Load transactions strictly by trade/transaction date (Rule 5 & Rule 9)
    const allTxs = await db.select('transactions');
    const txDatesWithActivity = new Set((allTxs || []).map(t => t.date));
    const todayTxs = (allTxs || []).filter(t => t.date === todayStr);

    // Identify last trading day log before today (e.g. Friday)
    const priorLogs = eodLogs.filter(l => l.date < todayStr).sort((a, b) => b.date.localeCompare(a.date));
    const lastTradingLog = priorLogs[0];

    let todayEntry;
    if (isWeekendDay(todayStr) && lastTradingLog) {
      if (todayTxs.length === 0) {
        // Rule 5: Non-trading session invariance. Zero market movement against Friday.
        todayEntry = {
          ...lastTradingLog,
          date: todayStr,
          daily_pnl: 0,
          pnl_pct: 0
        };
      } else {
        // User performed cash/debt transactions on weekend. Equity/MF/NPS strictly carry forward Friday.
        const debt = Number((liveTodayValuation.debt ?? (liveTodayValuation.loan + liveTodayValuation.credits)).toFixed(2));
        const totalAssets = Number((
          (liveTodayValuation.savings || 0) +
          (liveTodayValuation.epf || 0) +
          Number(lastTradingLog.mutual_funds || 0) +
          Number(lastTradingLog.indian_stocks || 0) +
          Number(lastTradingLog.us_stocks || 0) +
          Number(lastTradingLog.nps || 0)
        ).toFixed(2));
        const wealth = Number((totalAssets - debt).toFixed(2));
        const prevWealth = Number(lastTradingLog.total_wealth ?? lastTradingLog.wealth ?? 0);
        const pnl = Number((wealth - prevWealth).toFixed(2));
        const pct = prevWealth !== 0 ? Number(((pnl / prevWealth) * 100).toFixed(2)) : 0;
        todayEntry = {
          ...lastTradingLog,
          ...liveTodayValuation,
          date: todayStr,
          indian_stocks: lastTradingLog.indian_stocks,
          us_stocks: lastTradingLog.us_stocks,
          mutual_funds: lastTradingLog.mutual_funds,
          nps: lastTradingLog.nps,
          total_assets: totalAssets,
          debt,
          wealth,
          total_wealth: wealth,
          daily_pnl: pnl,
          pnl_pct: pct
        };
      }
    } else {
      todayEntry = {
        date: todayStr,
        ...liveTodayValuation
      };
    }

    // Merge or append today's valuation
    const existingTodayIdx = eodLogs.findIndex(l => l.date === todayStr);
    if (existingTodayIdx >= 0) {
      eodLogs[existingTodayIdx] = todayEntry;
    } else {
      eodLogs.push(todayEntry);
    }

    // Sort chronologically
    eodLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Recompute daily_pnl and pnl_pct across all logs so today is accurate against yesterday
    for (let i = 0; i < eodLogs.length; i++) {
      const cur = eodLogs[i];
      const prev = i > 0 ? eodLogs[i - 1] : cur;
      const curWealth = cur.total_wealth !== undefined ? cur.total_wealth : (cur.wealth || 0);
      const prevWealth = prev.total_wealth !== undefined ? prev.total_wealth : (prev.wealth || 0);
      const rawDelta = curWealth - prevWealth;
      const isWk = isWeekendDay(cur.date);
      const hasTx = txDatesWithActivity.has(cur.date);
      const pnl = isWk ? (hasTx ? rawDelta : 0) : rawDelta;
      const pct = isWk
        ? (hasTx && prevWealth !== 0 ? ((pnl / prevWealth) * 100) : 0)
        : (prevWealth !== 0 ? ((pnl / prevWealth) * 100) : 0);
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
      const isWk = isWeekendDay(item.date);
      const hasTx = txDatesWithActivity.has(item.date);
      const dailyPnl = isWk ? (hasTx ? (item.daily_pnl !== undefined ? item.daily_pnl : (wCurr - prevWealth)) : 0) : (item.daily_pnl !== undefined ? item.daily_pnl : (wCurr - prevWealth));
      const pct = isWk ? (hasTx && prevWealth !== 0 ? Number(((dailyPnl / prevWealth) * 100).toFixed(2)) : 0) : (prevWealth !== 0 ? Number(((dailyPnl / prevWealth) * 100).toFixed(2)) : 0);

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
