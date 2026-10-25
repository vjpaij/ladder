import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getTodayIST } from '../services/marketCalendar.js';
import { loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { runWalkForwardBacktest } from '../services/stockIntelligence/backtestEngine.js';
import { buildPortfolioSummary, buildStockAnalyses } from '../services/stockIntelligence/analysisService.js';
import { getIntelligenceConfig, getStateHistory, recordStateTransitions, saveIntelligenceConfig } from '../services/stockIntelligence/repository.js';
import { fetchCompanyFundamentals, preloadAllHeldFundamentals } from '../services/stockIntelligence/screenerFundamentalsProvider.js';
import { loadAllCachedUsFundamentals } from '../services/stockIntelligence/usFundamentalsProvider.js';
import { logSyncEvent } from '../services/syncLogService.js';
import { liveQuoteCache, resolveHoldingPrice } from '../services/priceEngine.js';
import { validateAndHealStockData } from '../services/stockIntelligence/dataIntegrityValidator.js';
import { generateActionPlan } from '../services/stockIntelligence/actionPlanService.js';

const router = express.Router();
const backtestCache = new Map();
let cachedOverview = null;
let cachedOverviewKey = '';
let cachedOverviewTimestamp = 0;
const OVERVIEW_TTL_MS = 60 * 1000; // 60 seconds fast in-memory cache

function getUserKey(user) {
  return String(user?.id || user?.email || '1');
}

export function invalidateStockIntelligenceCache() {
  cachedOverview = null;
  cachedOverviewKey = '';
  cachedOverviewTimestamp = 0;
}

function getBacktest(priceMap, symbols) {
  if (!symbols || !symbols.length) {
    return { version: '30w-confirmed-breakdown-v1', activeEquities: 0, training: null, validation: null, holdout: null };
  }
  const key = symbols.map(symbol => {
    const clean = String(symbol).replace(/\.(NS|BO)$/i, '');
    const series = priceMap[symbol] || priceMap[clean] || priceMap[`${clean}.NS`] || priceMap[`${clean}.BO`] || {};
    const dates = Object.keys(series).sort();
    const latest = dates.at(-1);
    return `${symbol}:${dates.length}:${latest || ''}:${latest ? series[latest] : ''}`;
  }).join('|');
  if (!backtestCache.has(key)) {
    const res = runWalkForwardBacktest(priceMap, symbols);
    backtestCache.set(key, res);
  }
  return backtestCache.get(key);
}

/**
 * Loads all cached fundamentals from data/screener_cache/ into an in-memory map
 */
function loadAllCachedFundamentals(symbols = []) {
  const cacheDir = path.join(process.cwd(), 'data', 'screener_cache');
  const result = {};
  if (!fs.existsSync(cacheDir)) return result;

  for (const sym of symbols) {
    const clean = String(sym).replace(/\.(NS|BO)$/i, '').toUpperCase();
    const filePath = path.join(cacheDir, `${clean}.json`);
    if (fs.existsSync(filePath)) {
      try {
        result[clean] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        // ignore parse error
      }
    }
  }
  return result;
}

/**
 * Loads cached daily candles from data/daily_candles_cache.json
 */
function loadDailyCandlesCache() {
  const cacheFile = path.join(process.cwd(), 'data', 'daily_candles_cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (_) {}
  }
  return {};
}

/**
 * Runs the daily Stock Analysis audit, records state transitions, and logs sync event
 */
export async function runDailyStockAnalysisAudit({ userId = '1', trigger = 'SCHEDULED' } = {}) {
  const startTime = Date.now();
  try {
    const [holdings, transactions, dividends, metadata, history] = await Promise.all([
      db.select('holdings'),
      db.select('transactions'),
      db.select('dividends'),
      db.select('asset_metadata'),
      loadHistoricalPricesAsync()
    ]);

    const active = holdings.filter(item => item.category_id === 'in_stocks' && Number(item.quantity) > 0);
    const symbols = [...new Set(active.map(item => item.symbol).filter(Boolean))];

    // Enrich holdings with live quotes or verified recent closes
    const enrichedHoldings = holdings.map(h => {
      if (h.category_id !== 'in_stocks') return h;
      const quote = liveQuoteCache?.get(h.symbol);
      const resolved = resolveHoldingPrice(h, quote);
      const clean = String(h.symbol).replace(/\.(NS|BO)$/i, '');
      const series = history[h.symbol] || history[clean] || history[`${clean}.NS`] || {};
      const dates = Object.keys(series).sort();
      const latestClose = dates.length > 0 ? series[dates[dates.length - 1]] : 0;
      const currentPrice = resolved > 0 ? resolved : (latestClose > 0 ? latestClose : Number(h.current_price) || 0);
      const nsePrice = (quote && quote.nse_price > 0) ? Number(quote.nse_price) : (Number(h.nse_price) || 0);
      const bsePrice = (quote && quote.bse_price > 0) ? Number(quote.bse_price) : (Number(h.bse_price) || 0);
      return {
        ...h,
        current_price: currentPrice,
        nse_price: nsePrice,
        bse_price: bsePrice
      };
    });

    // Run automated data integrity & anti-hallucination validation suite
    const { healedPriceMap, auditReport } = validateAndHealStockData(enrichedHoldings, history, transactions);

    const backtest = getBacktest(healedPriceMap, symbols);
    const config = getIntelligenceConfig(userId);

    // Load available cached fundamentals
    let fundamentalsMap = loadAllCachedFundamentals(symbols);
    const candleCache = loadDailyCandlesCache();

    // Evaluate analyses on validated data
    const analyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
      today: getTodayIST(),
      backtest,
      config,
      transactions,
      dividends,
      metadata,
      fundamentalsMap,
      candleCache
    });

    // Record any state changes into persistent history
    const transitions = recordStateTransitions(userId, analyses);
    const summary = buildPortfolioSummary(analyses);

    logSyncEvent({
      jobType: 'STOCK_ANALYSIS_EOD',
      jobName: `Daily Stock Analysis Audit (${trigger})`,
      scheduledTime: '06:30 PM IST',
      runTime: new Date().toISOString(),
      status: 'SUCCESS',
      durationMs: Date.now() - startTime,
      details: `Evaluated ${analyses.length} active Indian equity holdings. ${summary.compoundingCount || 0} in Stage 2 Compounding, ${summary.states?.TECHNICAL_TRIM_CANDIDATE || 0} technical trim, ${summary.states?.WATCH || 0} on watch. Data integrity: ${auditReport.dataHealthScorePct}% (${auditReport.anomaliesDetected.length} anomalies). Recorded ${transitions.length} state transition(s).`,
      error: null
    });

    console.log(`[Stock Analysis] Daily audit completed (${analyses.length} stocks, ${transitions.length} state change(s)).`);
    return { summary, transitions, count: analyses.length, dataIntegrity: auditReport };
  } catch (error) {
    console.error('[Stock Analysis] Daily audit failed:', error.message);
    logSyncEvent({
      jobType: 'STOCK_ANALYSIS_EOD',
      jobName: `Daily Stock Analysis Audit (${trigger})`,
      scheduledTime: '06:30 PM IST',
      runTime: new Date().toISOString(),
      status: 'FAILED',
      durationMs: Date.now() - startTime,
      details: `Audit failed: ${error.message}`,
      error: error.message
    });
    return null;
  }
}

export async function computeStockOverview(userId, { forceRefresh = false, includeBacktest = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedOverview && cachedOverviewKey === userId && (now - cachedOverviewTimestamp < OVERVIEW_TTL_MS)) {
    return cachedOverview;
  }

  const [holdings, transactions, dividends, metadata, history] = await Promise.all([
    db.select('holdings'),
    db.select('transactions'),
    db.select('dividends'),
    db.select('asset_metadata'),
    loadHistoricalPricesAsync()
  ]);
  const active = holdings.filter(item => item.category_id === 'in_stocks' && Number(item.quantity) > 0);
  const symbols = [...new Set(active.map(item => item.symbol).filter(Boolean))];
  const activeUs = holdings.filter(item => item.category_id === 'us_stocks' && Number(item.quantity) > 0);
  const usSymbols = [...new Set(activeUs.map(item => item.symbol).filter(Boolean))];
  const config = getIntelligenceConfig(userId);

  // Fast read from disk cache
  const fundamentalsMap = loadAllCachedFundamentals(symbols);
  const usFundamentalsMap = loadAllCachedUsFundamentals(usSymbols);

  // Enrich holdings with live quotes or verified recent closes
  const enrichedHoldings = holdings.map(h => {
    const isUs = h.category_id === 'us_stocks';
    const isIndian = h.category_id === 'in_stocks';
    if (!isIndian && !isUs) return h;

    const quote = liveQuoteCache?.get(h.symbol);
    const resolved = resolveHoldingPrice(h, quote);
    const clean = String(h.symbol).replace(/\.(NS|BO)$/i, '');
    const series = history[h.symbol] || history[clean] || history[`${clean}.NS`] || {};
    const dates = Object.keys(series).sort();
    const latestClose = dates.length > 0 ? series[dates[dates.length - 1]] : 0;
    const currentPrice = resolved > 0 ? resolved : (latestClose > 0 ? latestClose : Number(h.current_price) || 0);
    const nsePrice = (quote && quote.nse_price > 0) ? Number(quote.nse_price) : (Number(h.nse_price) || 0);
    const bsePrice = (quote && quote.bse_price > 0) ? Number(quote.bse_price) : (Number(h.bse_price) || 0);
    return {
      ...h,
      current_price: currentPrice,
      nse_price: nsePrice,
      bse_price: bsePrice
    };
  });

  // Run automated data integrity & anti-hallucination validation suite
  const { healedPriceMap, auditReport } = validateAndHealStockData(enrichedHoldings, history, transactions);

  // Backtest calculation is compute-heavy (simulates 14 years across all 82 stocks).
  // If client does not explicitly ask for includeBacktest, provide rule metadata to avoid blocking UI render.
  const backtest = includeBacktest
    ? getBacktest(healedPriceMap, symbols)
    : { version: '30w-confirmed-breakdown-v1', activeEquities: symbols.length };
  const usBacktest = includeBacktest
    ? getBacktest(healedPriceMap, usSymbols)
    : { version: '30w-confirmed-breakdown-v1', activeEquities: usSymbols.length };

  const candleCache = loadDailyCandlesCache();

  const analyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
    today: getTodayIST(),
    backtest,
    config,
    transactions,
    dividends,
    metadata,
    fundamentalsMap,
    categoryId: 'in_stocks',
    candleCache
  });

  const usAnalyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
    today: getTodayIST(),
    backtest: usBacktest,
    config,
    transactions,
    dividends,
    metadata,
    fundamentalsMap: usFundamentalsMap,
    categoryId: 'us_stocks',
    candleCache
  });

  recordStateTransitions(userId, [...analyses, ...usAnalyses]);

  const result = {
    generatedAt: new Date().toISOString(),
    ruleVersion: backtest.version,
    summary: buildPortfolioSummary(analyses),
    usSummary: buildPortfolioSummary(usAnalyses),
    config,
    backtest,
    analyses,
    usAnalyses,
    dataIntegrity: auditReport,
    executionSchedule: {
      scheduledDailyTime: '06:30 PM IST (Post-Market Close)',
      runEverySession: true,
      lastEvaluatedAt: new Date().toISOString()
    }
  };

  // Cache the completed overview payload
  cachedOverview = result;
  cachedOverviewKey = userId;
  cachedOverviewTimestamp = Date.now();

  return result;
}

router.get('/stock-intelligence/overview', authenticateToken, async (req, res) => {
  try {
    const userId = getUserKey(req.user);
    const forceRefresh = req.query.refresh === 'true' || req.query.forceRefresh === 'true';
    const includeBacktest = req.query.includeBacktest === 'true';
    const result = await computeStockOverview(userId, { forceRefresh, includeBacktest });
    res.json(result);
  } catch (error) {
    console.error('[Stock Intelligence] Overview failed:', error.message);
    res.status(500).json({ error: 'Stock analysis could not be loaded.' });
  }
});

router.get('/stock-intelligence/breach-alerts', authenticateToken, async (req, res) => {
  try {
    const userId = getUserKey(req.user);
    const forceRefresh = req.query.refresh === 'true' || req.query.forceRefresh === 'true';
    const overview = await computeStockOverview(userId, { forceRefresh });
    const inBreached = (overview.analyses || []).filter(item => item.stopFloorBreached);
    const usBreached = (overview.usAnalyses || []).filter(item => item.stopFloorBreached);
    const allBreached = [...inBreached, ...usBreached];

    const count = allBreached.length;
    const symbols = allBreached.map(b => b.symbol);
    const totalSuggestedShares = allBreached.reduce((sum, b) => sum + (b.suggestedSellQuantity || b.totalActionShares || 0), 0);
    const totalProceedsINR = allBreached.reduce((sum, b) => {
      const shares = b.suggestedSellQuantity || b.totalActionShares || 0;
      const price = b.currentPrice || 0;
      return sum + (shares * price);
    }, 0);

    res.json({
      count,
      symbols,
      totalSuggestedShares,
      totalProceedsINR: Number(totalProceedsINR.toFixed(2)),
      items: allBreached.map(b => ({
        id: b.holdingId,
        symbol: b.symbol,
        name: b.name,
        currentPrice: b.currentPrice,
        stopFloorPrice: b.trailingFloorPrice || b.chandelierStopPrice,
        bufferPct: b.liveBufferToTrailingFloorPct,
        suggestedSellQuantity: b.suggestedSellQuantity || b.totalActionShares || 0,
        action: b.action,
        state: b.state,
        tranche1Shares: b.tranche1Shares,
        tranche2Shares: b.tranche2Shares
      }))
    });
  } catch (error) {
    console.error('[Stock Intelligence] Breach alerts failed:', error.message);
    res.status(500).json({ error: 'Failed to evaluate breach alerts.' });
  }
});

router.post('/stock-intelligence/refresh-fundamentals', authenticateToken, async (req, res) => {
  try {
    invalidateStockIntelligenceCache();
    const holdings = await db.select('holdings');
    const symbol = req.body?.symbol;
    if (symbol) {
      const fund = await fetchCompanyFundamentals(symbol, { forceRefresh: true });
      return res.json({ symbol, fundamentals: fund });
    }

    // Refresh all held in background
    preloadAllHeldFundamentals(holdings).catch(e => console.error('[Fundamentals Preload Error]:', e.message));
    res.json({ message: 'Fundamentals refresh initiated for active holdings.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stock-intelligence/history', authenticateToken, (req, res) => {
  res.json({ events: getStateHistory(getUserKey(req.user), req.query.holdingId || null) });
});

router.post('/stock-intelligence/config', authenticateToken, (req, res) => {
  try {
    const config = saveIntelligenceConfig(getUserKey(req.user), req.body || {});
    invalidateStockIntelligenceCache();
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


router.get('/stock-intelligence/action-plan', authenticateToken, async (req, res) => {
  try {
    const userConfig = getIntelligenceConfig(getUserKey(req.user));
    const externalCash = req.query.externalCash !== undefined ? Number(req.query.externalCash) : userConfig.externalCashBudget;
    const recyclingMode = req.query.recyclingMode || userConfig.recyclingMode;

    const plan = await generateActionPlan({
      userId: getUserKey(req.user),
      externalCashBudget: externalCash,
      recyclingMode,
      userConfig
    });
    res.json(plan);
  } catch (error) {
    console.error('[Stock Intelligence] Action plan fetch failed:', error.message);
    res.status(500).json({ error: 'Failed to generate action plan.' });
  }
});

router.get('/stock-intelligence/action-plan-csv', authenticateToken, async (req, res) => {
  try {
    const userConfig = getIntelligenceConfig(getUserKey(req.user));
    const externalCash = req.query.externalCash !== undefined ? Number(req.query.externalCash) : userConfig.externalCashBudget;
    const recyclingMode = req.query.recyclingMode || userConfig.recyclingMode;

    const plan = await generateActionPlan({
      userId: getUserKey(req.user),
      externalCashBudget: externalCash,
      recyclingMode,
      userConfig
    });

    if (req.query.format === 'json') {
      return res.json(plan);
    }

    const filename = `ladder_action_plan_${plan.today}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(plan.csv);
  } catch (error) {
    console.error('[Stock Intelligence] Action plan generation failed:', error.message);
    res.status(500).json({ error: 'Failed to generate action plan.' });
  }
});

export default router;
