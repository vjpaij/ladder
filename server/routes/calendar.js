import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate, liveQuoteCache, resolveHoldingPrice, buildCanonicalLivePriceMap } from '../services/priceEngine.js';
import { computePortfolioValuation } from '../services/portfolioCalculator.js';
import { getHolidaysForYear, isTradingDay, getLastTradingDay, getNextTradingDay, getTodayIST, getYesterdayIST, isAnyMarketOpen, isUsMarketOpen, getAssetSessionStatus, isAssetTradingDay, getSpecialTradingSession } from '../services/marketCalendar.js';
import { checkAndTriggerMissedEodRebuild } from '../services/eodSync.js';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─── Server-Side EOD Log Cache ────────────────────────────────────────────────
// Caches portfolio_eod_logs.json in RAM. The 3.2 MB file is only re-parsed when
// its mtime changes (i.e. after an EOD rebuild), eliminating the synchronous
// disk-read on every calendar request.
let _eodLogsCache = null;
let _eodLogsMtimeMs = 0;

export function getEodLogs() {
  const eodPath = path.join(__dirname, '../../data/portfolio_eod_logs.json');
  try {
    if (!fs.existsSync(eodPath)) return [];
    const stat = fs.statSync(eodPath);
    if (_eodLogsCache && stat.mtimeMs === _eodLogsMtimeMs) return _eodLogsCache;
    const raw = fs.readFileSync(eodPath, 'utf8');
    _eodLogsCache = JSON.parse(raw).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    _eodLogsMtimeMs = stat.mtimeMs;
    console.log(`[EOD Cache] Reloaded portfolio_eod_logs.json (${_eodLogsCache.length} entries)`);
    return _eodLogsCache;
  } catch (e) {
    console.warn('[EOD Cache] Failed to read portfolio_eod_logs.json:', e.message);
    return _eodLogsCache || [];
  }
}

/** Flush the EOD log cache — call after any EOD rebuild writes the file. */
export function invalidateEodLogsCache() {
  _eodLogsCache = null;
  _eodLogsMtimeMs = 0;
}

// ─── Today Portfolio Valuation Cache (60-second TTL) ─────────────────────────
// computePortfolioValuation over 400+ holdings with liveQuoteCache resolution is
// the single most expensive operation in this route. Cache it for 60 seconds so
// rapid calendar clicks / polling don't re-run the full engine each time.
let _todayValCache = null;
let _todayValCacheExpiry = 0;
const TODAY_VAL_TTL_MS = 60_000;

// ─── Transaction Dates Cache (5-minute TTL) ────────────────────────────────────
// Building txDatesWithActivity requires iterating 11 000+ transactions.
// This derived Set changes only when transactions are mutated — cache for 5 min.
let _txDatesCache = null;
let _txDatesCacheExpiry = 0;
const TX_DATES_TTL_MS = 5 * 60_000;

export function invalidateTxDatesCache() {
  _txDatesCache = null;
  _txDatesCacheExpiry = 0;
  _todayValCache = null;
  _todayValCacheExpiry = 0;
}

export function invalidateCalendarValuationCache() {
  _todayValCache = null;
  _todayValCacheExpiry = 0;
}

router.get('/daily-pnl', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, range, forceRefresh: forceRefreshParam } = req.query;
    const forceRefresh = forceRefreshParam === 'true';

    // ── 1. Load EOD logs from RAM cache (mtime-validated) ────────────────────
    let eodLogs = getEodLogs().slice();

    // ── 2. Merge any pnl_history rows beyond the local file's latest date ─────
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

    // Merge Supabase rows that are not in local file (avoid duplicating local data)
    const localDates = new Set(eodLogs.map(l => l.date));
    // Create a working copy to avoid mutating the cached array
    eodLogs = [
      ...eodLogs,
      ...[...dbLogsByDate.values()].filter(l => !localDates.has(l.date))
    ];

    // ── 3. Today Valuation (from 60-second TTL cache) ─────────────────────────
    const todayStr = getTodayIST();
    const now = Date.now();

    let liveTodayValuation;
    let fxRate;
    let todayTxs = [];
    let holdings = [];

    if (!forceRefresh && _todayValCache && now < _todayValCacheExpiry) {
      // Serve today's metrics from cache
      ({ liveTodayValuation, fxRate, todayTxs, holdings } = _todayValCache);
    } else {
      fxRate = await fetchFxRate();
      holdings = await db.select('holdings');
      const liabilities = await db.select('liabilities');
      const allTxs = await db.select('transactions');
      todayTxs = (allTxs || []).filter(t => t.date === todayStr);

      const { livePriceMap, effectiveUsFx } = buildCanonicalLivePriceMap({
        holdings,
        transactions: allTxs,
        liabilities,
        todayStr,
        fxRate,
        pastEodLogs: eodLogs
      });
      liveTodayValuation = computePortfolioValuation(holdings, liabilities, livePriceMap, effectiveUsFx);

      _todayValCache = { liveTodayValuation, fxRate: effectiveUsFx, todayTxs, holdings };
      _todayValCacheExpiry = now + TODAY_VAL_TTL_MS;
    }

    // ── 4. tx-date activity Set (5-minute TTL cache) ───────────────────────────
    let txDatesWithActivity;
    if (_txDatesCache && now < _txDatesCacheExpiry) {
      txDatesWithActivity = _txDatesCache;
    } else {
      const allTxs = await db.select('transactions');
      _txDatesCache = new Set((allTxs || []).map(t => t.date));
      _txDatesCacheExpiry = now + TX_DATES_TTL_MS;
      txDatesWithActivity = _txDatesCache;
    }

    // ── 5. US market intraday correction (carry-forward for open US session) ───
    const nyDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (isUsMarketOpen() && nyDate < todayStr) {
      const nyLogIdx = eodLogs.findIndex(l => l.date === nyDate);
      if (nyLogIdx >= 0) {
        const nyLog = eodLogs[nyLogIdx];
        const updatedUsVal = Number((liveTodayValuation.us_stocks ?? 0).toFixed(2));
        nyLog.us_stocks = updatedUsVal;
        nyLog.us_stocks_val_inr = updatedUsVal;
        nyLog.total_assets = Number((
          (nyLog.savings || 0) +
          (nyLog.epf || 0) +
          (nyLog.mutual_funds || 0) +
          (nyLog.indian_stocks || 0) +
          updatedUsVal +
          (nyLog.nps || 0)
        ).toFixed(2));
        nyLog.total_assets_inr = nyLog.total_assets;
        const debtVal = Number((nyLog.debt !== undefined ? nyLog.debt : ((nyLog.loan || 0) + (nyLog.credits || 0))).toFixed(2));
        nyLog.wealth = Number((nyLog.total_assets - debtVal).toFixed(2));
        nyLog.total_wealth = nyLog.wealth;
        nyLog.net_worth_inr = nyLog.wealth;
      }
    }

    // ── 6. Gap-healing: bridge missing past sessions with carry-forward ────────
    const yesterdayStr = getYesterdayIST();
    if (eodLogs.length > 0) {
      let latestPastLog = null;
      for (const log of eodLogs) {
        if (log.date < todayStr && (!latestPastLog || log.date > latestPastLog.date)) latestPastLog = log;
      }
      if (latestPastLog && latestPastLog.date < yesterdayStr) {
        checkAndTriggerMissedEodRebuild({ waitForCompletion: false }).catch(() => {});
        const latestRecorded = latestPastLog;
        let bridgeD = new Date(`${latestRecorded.date}T00:00:00Z`);
        const targetEndD = new Date(`${yesterdayStr}T00:00:00Z`);
        const knownDates = new Set(eodLogs.map(l => l.date));
        while (true) {
          bridgeD.setUTCDate(bridgeD.getUTCDate() + 1);
          if (bridgeD > targetEndD) break;
          const ds = bridgeD.toISOString().slice(0, 10);
          if (!knownDates.has(ds)) {
            eodLogs.push({
              ...latestRecorded,
              date: ds,
              daily_pnl: 0,
              daily_pnl_inr: 0,
              pnl_pct: 0,
              pnl_percentage: 0,
              asset_delta: 0,
              asset_delta_inr: 0,
              liability_delta_inr: 0
            });
            knownDates.add(ds);
          }
        }
      }
    }

    // ── 7. Resolve prior trading session baseline ──────────────────────────────
    let lastTradingLog = null;
    for (let i = eodLogs.length - 1; i >= 0; i--) {
      if (eodLogs[i].date < todayStr) {
        lastTradingLog = eodLogs[i];
        break;
      }
    }

    // ── 8. Multi-Asset Dynamic Valuation Engine (today's entry) ───────────────
    const inStocksStatus = getAssetSessionStatus('in_stocks', todayStr);
    const usStocksStatus = getAssetSessionStatus('us_stocks', todayStr);
    // Today's synthetic row must reflect the same current holdings and ledger
    // balances as the Dashboard and asset pages. Historical EOD values belong
    // only to finalized dates; carrying them into today made the calendar
    // disagree whenever there was no transaction in a category.
    let resolvedInStocks = Number((liveTodayValuation.indian_stocks ?? 0).toFixed(2));
    let resolvedUsStocks = Number((liveTodayValuation.us_stocks ?? 0).toFixed(2));
    let resolvedMf = Number((liveTodayValuation.mutual_funds ?? 0).toFixed(2));
    let resolvedNps = Number((liveTodayValuation.nps ?? 0).toFixed(2));
    let resolvedSavings = Number((liveTodayValuation.savings ?? 0).toFixed(2));
    let resolvedEpf = Number((liveTodayValuation.epf ?? 0).toFixed(2));
    let resolvedDebt = Number((liveTodayValuation.debt ?? ((liveTodayValuation.loan || 0) + (liveTodayValuation.credits || 0))).toFixed(2));

    const hasUsTxToday = todayTxs.some(t => {
      const h = holdings.find(x => x.id === t.holding_id);
      return h && h.category_id === 'us_stocks';
    });
    const isUsTrading = (usStocksStatus.status === 'MARKET_OPEN' || usStocksStatus.status === 'POST_MARKET');
    if (!isUsTrading && !hasUsTxToday && lastTradingLog && lastTradingLog.us_stocks !== undefined) {
      resolvedUsStocks = lastTradingLog.us_stocks;
    }

    let totalAssets = Number((resolvedInStocks + resolvedUsStocks + resolvedMf + resolvedNps + resolvedSavings + resolvedEpf).toFixed(2));
    let totalWealth = Number((totalAssets - resolvedDebt).toFixed(2));

    const prevTotalWealth = Number((lastTradingLog?.total_wealth ?? lastTradingLog?.wealth ?? lastTradingLog?.net_worth_inr ?? totalWealth).toFixed(2));
    const prevTotalAssets = Number((lastTradingLog?.total_assets ?? lastTradingLog?.total_assets_inr ?? totalAssets).toFixed(2));
    const prevLiabilities = Number((lastTradingLog?.debt ?? lastTradingLog?.liabilities_inr ?? resolvedDebt).toFixed(2));

    const anyMarketTrading = (inStocksStatus.status === 'MARKET_OPEN' || inStocksStatus.status === 'POST_MARKET') ||
                             (usStocksStatus.status === 'MARKET_OPEN' || usStocksStatus.status === 'POST_MARKET');
    const hasAnyTxToday = todayTxs.length > 0;

    let dailyPnl = Number((totalWealth - prevTotalWealth).toFixed(2));
    let pnlPct = prevTotalWealth > 0 ? Number(((dailyPnl / prevTotalWealth) * 100).toFixed(2)) : 0;
    let assetDelta = Number((totalAssets - prevTotalAssets).toFixed(2));
    let liabilityDelta = Number((resolvedDebt - prevLiabilities).toFixed(2));

    if (!anyMarketTrading && !hasAnyTxToday) {
      if (prevTotalWealth > 0 && prevTotalAssets > 0) {
        totalWealth = prevTotalWealth;
        totalAssets = prevTotalAssets;
        resolvedDebt = prevLiabilities;
        if (lastTradingLog) {
          if (lastTradingLog.indian_stocks !== undefined) resolvedInStocks = lastTradingLog.indian_stocks;
          if (lastTradingLog.us_stocks !== undefined) resolvedUsStocks = lastTradingLog.us_stocks;
          if (lastTradingLog.mutual_funds !== undefined) resolvedMf = lastTradingLog.mutual_funds;
          if (lastTradingLog.nps !== undefined) resolvedNps = lastTradingLog.nps;
          if (lastTradingLog.savings !== undefined) resolvedSavings = lastTradingLog.savings;
          if (lastTradingLog.epf !== undefined) resolvedEpf = lastTradingLog.epf;
        }
      }
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

    // Keep the sorted base ordering; gap bridges are appended chronologically.
    // Sort only if a newly merged DB row was out of order.
    if (eodLogs.some((log, i) => i > 0 && eodLogs[i - 1].date > log.date)) {
      eodLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }

    // Recompute daily_pnl across all historical logs
    for (let i = 0; i < eodLogs.length; i++) {
      const cur = eodLogs[i];
      if (cur.date === todayStr) continue;
      const prev = i > 0 ? eodLogs[i - 1] : cur;
      const curWealth = cur.total_wealth !== undefined ? cur.total_wealth : (cur.wealth || 0);
      const prevWealth = prev.total_wealth !== undefined ? prev.total_wealth : (prev.wealth || 0);
      const rawDelta = Number((curWealth - prevWealth).toFixed(2));
      cur.daily_pnl = rawDelta;
      cur.pnl_pct = prevWealth !== 0 ? Number(((rawDelta / prevWealth) * 100).toFixed(2)) : 0;
      cur.total_wealth = curWealth;
      cur.wealth = curWealth;
    }

    // ── 9. Date-range filtering ────────────────────────────────────────────────
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

    let filtered = eodLogs;
    if (targetStartDate) filtered = filtered.filter(l => l.date >= targetStartDate);
    if (targetEndDate) filtered = filtered.filter(l => l.date <= targetEndDate);

    // Build an index map into the full sorted eodLogs for true prev-day lookups
    const eodIndexMap = new Map();
    eodLogs.forEach((l, idx) => eodIndexMap.set(l.date, idx));

    // ── 10. Format output ──────────────────────────────────────────────────────
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
