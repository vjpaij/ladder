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

const router = express.Router();
let cachedBacktest = null;
let cachedBacktestKey = '';

function getUserKey(user) {
  return String(user?.id || user?.email || '1');
}

function getBacktest(priceMap, symbols) {
  const key = symbols.map(symbol => {
    const clean = String(symbol).replace(/\.(NS|BO)$/i, '');
    const series = priceMap[symbol] || priceMap[clean] || priceMap[`${clean}.NS`] || priceMap[`${clean}.BO`] || {};
    const dates = Object.keys(series).sort();
    const latest = dates.at(-1);
    return `${symbol}:${dates.length}:${latest || ''}:${latest ? series[latest] : ''}`;
  }).join('|');
  if (!cachedBacktest || key !== cachedBacktestKey) {
    cachedBacktest = runWalkForwardBacktest(priceMap, symbols);
    cachedBacktestKey = key;
  }
  return cachedBacktest;
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

    // Evaluate analyses on validated data
    const analyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
      today: getTodayIST(),
      backtest,
      config,
      transactions,
      dividends,
      metadata,
      fundamentalsMap
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

router.get('/stock-intelligence/overview', authenticateToken, async (req, res) => {
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
    const activeUs = holdings.filter(item => item.category_id === 'us_stocks' && Number(item.quantity) > 0);
    const usSymbols = [...new Set(activeUs.map(item => item.symbol).filter(Boolean))];
    const userId = getUserKey(req.user);
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
    const backtest = getBacktest(healedPriceMap, symbols);
    const usBacktest = getBacktest(healedPriceMap, usSymbols);

    const analyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
      today: getTodayIST(),
      backtest,
      config,
      transactions,
      dividends,
      metadata,
      fundamentalsMap,
      categoryId: 'in_stocks'
    });

    const usAnalyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
      today: getTodayIST(),
      backtest: usBacktest,
      config,
      transactions,
      dividends,
      metadata,
      fundamentalsMap: usFundamentalsMap,
      categoryId: 'us_stocks'
    });

    recordStateTransitions(userId, [...analyses, ...usAnalyses]);

    res.json({
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
    });
  } catch (error) {
    console.error('[Stock Intelligence] Overview failed:', error.message);
    res.status(500).json({ error: 'Stock analysis could not be loaded.' });
  }
});

router.post('/stock-intelligence/refresh-fundamentals', authenticateToken, async (req, res) => {
  try {
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
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
