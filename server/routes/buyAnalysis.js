/**
 * buyAnalysis.js — Express Router for Buy Analysis API endpoints
 *
 * Endpoints:
 *   GET  /api/buy-analysis          — Full buy signal evaluation
 *   GET  /api/buy-universe          — Current filtered stock universe
 *   GET  /api/earnings-calendar     — Earnings dates for all tracked stocks
 *   GET  /api/news-intel/:symbol    — News signals for a specific stock
 *   GET  /api/sip-plan/:symbol      — SIP accumulation plan for a symbol
 *   POST /api/buy-watchlist         — Add a symbol to the buy watchlist
 *   DELETE /api/buy-watchlist/:sym  — Remove from watchlist
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getTodayIST } from '../services/marketCalendar.js';
import { loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { liveQuoteCache, resolveHoldingPrice } from '../services/priceEngine.js';
import { buildBuyAnalyses, buildBuyPortfolioSummary } from '../services/stockIntelligence/buyAnalysisService.js';
import { buildCandidateUniverse, addToWatchlist, removeFromWatchlist, loadWatchlist, loadUniverseCache, saveUniverseCache } from '../services/stockIntelligence/buyUniverseProvider.js';
import { batchComputeEarningsCatalysts, getFullEarningsCalendar } from '../services/stockIntelligence/earningsCatalystService.js';
import { fetchNewsSignals, loadNewsCache } from '../services/stockIntelligence/newsIntelService.js';
import { loadSipPlan, buildSipPlan, shouldGenerateSipPlan } from '../services/stockIntelligence/sipPositionBuilder.js';
import { fetchCompanyFundamentals } from '../services/stockIntelligence/screenerFundamentalsProvider.js';
import { logSyncEvent } from '../services/syncLogService.js';

const router = express.Router();

// In-memory buy analysis cache (60-second TTL)
let _buyAnalysisCache = null;
let _buyAnalysisCacheTimestamp = 0;
const BUY_CACHE_TTL_MS = 60 * 1000;

function invalidateBuyCache() {
  _buyAnalysisCache = null;
  _buyAnalysisCacheTimestamp = 0;
}

/**
 * Loads fundamentals from disk cache for a list of symbols.
 */
function loadCachedFundamentalsForSymbols(symbols = []) {
  const cacheDir = path.join(process.cwd(), 'data', 'screener_cache');
  const result = {};
  if (!fs.existsSync(cacheDir)) return result;
  for (const sym of symbols) {
    const clean = String(sym).toUpperCase().replace(/\.(NS|BO)$/i, '');
    const filePath = path.join(cacheDir, `${clean}.json`);
    if (fs.existsSync(filePath)) {
      try { result[clean] = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { /* ignore */ }
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/buy-analysis
// Returns the full buy signal evaluation across the stock universe.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/buy-analysis', authenticateToken, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const now = Date.now();
    const signalFilter = req.query.signal || null; // 'STRONG_BUY' | 'BUY' | 'WATCH' | 'MONITOR'
    const sourceFilter = req.query.source || null; // 'Portfolio' | 'NSE500' | 'Watchlist'

    // Serve from in-memory cache (60s TTL)
    if (!forceRefresh && _buyAnalysisCache && (now - _buyAnalysisCacheTimestamp < BUY_CACHE_TTL_MS)) {
      let cached = _buyAnalysisCache;
      // Apply filters on cached data
      if (signalFilter || sourceFilter) {
        const filtered = cached.analyses.filter(a => {
          const matchSignal = !signalFilter || a.buySignal === signalFilter;
          const matchSource = !sourceFilter || a.source.includes(sourceFilter);
          return matchSignal && matchSource;
        });
        return res.json({ ...cached, analyses: filtered, filteredCount: filtered.length });
      }
      return res.json(cached);
    }

    const startTime = Date.now();

    // Load holdings and price history
    const [holdings, history] = await Promise.all([
      db.select('holdings'),
      loadHistoricalPricesAsync()
    ]);

    // Enrich holdings with live prices
    const enrichedHoldings = holdings.map(h => {
      if (h.category_id !== 'in_stocks') return h;
      const quote = liveQuoteCache?.get(h.symbol);
      const resolved = resolveHoldingPrice(h, quote);
      const clean = String(h.symbol).replace(/\.(NS|BO)$/i, '');
      const series = history[h.symbol] || history[clean] || history[`${clean}.NS`] || {};
      const dates = Object.keys(series).sort();
      const latestClose = dates.length > 0 ? series[dates[dates.length - 1]] : 0;
      return {
        ...h,
        current_price: resolved > 0 ? resolved : (latestClose > 0 ? latestClose : Number(h.current_price) || 0)
      };
    });

    // Build candidate universe (portfolio + NSE500 + watchlist)
    const candidates = buildCandidateUniverse(enrichedHoldings);

    // For portfolio stocks, use live prices from enriched holdings
    const enrichedCandidates = candidates.map(c => {
      if (c.inPortfolio) {
        const holding = enrichedHoldings.find(h =>
          h.category_id === 'in_stocks' &&
          String(h.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '') === c.symbol
        );
        if (holding) {
          return { ...c, currentPrice: Number(holding.current_price) || 0 };
        }
      }
      return c;
    });

    // Load fundamentals from disk cache (no network fetch on main endpoint — background refresh only)
    const symbols = enrichedCandidates.map(c => c.symbol);
    const fundamentalsMap = loadCachedFundamentalsForSymbols(symbols);

    // Compute earnings catalysts for all symbols
    const today = getTodayIST();
    const earningsCatalystsMap = batchComputeEarningsCatalysts(symbols, fundamentalsMap, today);

    // Build buy analyses
    const analyses = buildBuyAnalyses(
      enrichedCandidates,
      history,
      fundamentalsMap,
      earningsCatalystsMap,
      loadNewsCache(), // news signals from cache
      { today, maxResults: 200, includeSipPlans: true }
    );

    const summary = buildBuyPortfolioSummary(analyses);

    const result = {
      generatedAt: new Date().toISOString(),
      today,
      ruleVersion: 'buy-analysis-v1.0',
      summary,
      candidateCount: enrichedCandidates.length,
      analyses,
      executionMs: Date.now() - startTime,
      dataNote: 'Local fundamentals are usable only when current and complete. No authorized historical buy-strategy dataset is configured.',
      backtestStatus: 'BLOCKED_DATA',
      backtestBlockers: ['Point-in-time fundamentals and filing dates', 'Licensed adjusted OHLCV and corporate-action history', 'Complete historical universe including delisted securities', 'Portfolio sizing and transaction-cost assumptions']
    };

    // Cache result
    _buyAnalysisCache = result;
    _buyAnalysisCacheTimestamp = Date.now();

    // Apply optional filters
    if (signalFilter || sourceFilter) {
      const filtered = analyses.filter(a => {
        const matchSignal = !signalFilter || a.buySignal === signalFilter;
        const matchSource = !sourceFilter || a.source.includes(sourceFilter);
        return matchSignal && matchSource;
      });
      return res.json({ ...result, analyses: filtered, filteredCount: filtered.length });
    }

    logSyncEvent({
      jobType: 'BUY_ANALYSIS',
      jobName: 'Buy Analysis Evaluation',
      scheduledTime: 'On Demand',
      runTime: new Date().toISOString(),
      status: 'SUCCESS',
      durationMs: Date.now() - startTime,
      details: `Evaluated ${analyses.length} stocks. STRONG_BUY: ${summary.strongBuyCount}, BUY: ${summary.buyCount}, WATCH: ${summary.watchCount}.`,
      error: null
    });

    res.json(result);
  } catch (error) {
    console.error('[Buy Analysis] Failed:', error.message);
    res.status(500).json({ error: 'Buy analysis could not be loaded.', details: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/buy-analysis/refresh-fundamentals
// Triggers background fundamentals refresh for universe symbols.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/buy-analysis/refresh-fundamentals', authenticateToken, async (req, res) => {
  try {
    invalidateBuyCache();
    if (process.env.SCREENER_AUTOMATION_ENABLED !== 'true') {
      return res.json({
        sourceStatus: 'NOT_CONFIGURED',
        message: 'No authorized automated fundamentals provider is configured. No external refresh was attempted; provide a permitted snapshot or configure an authorized provider.'
      });
    }
    const symbol = req.body?.symbol;
    if (symbol) {
      const fund = await fetchCompanyFundamentals(symbol, { forceRefresh: true });
      return res.json({ symbol, fundamentals: fund });
    }

    // Background refresh for top candidates (portfolio + watchlist)
    const [holdings] = await Promise.all([db.select('holdings')]);
    const watchlist = loadWatchlist();
    const portfolioSymbols = holdings
      .filter(h => h.category_id === 'in_stocks' && Number(h.quantity) > 0)
      .map(h => String(h.symbol).replace(/\.(NS|BO)$/i, '').toUpperCase());
    const allSymbols = [...new Set([...portfolioSymbols, ...watchlist])];

    // Async background refresh (don't block response)
    (async () => {
      for (const sym of allSymbols.slice(0, 50)) {
        try {
          await fetchCompanyFundamentals(sym, { forceRefresh: true });
          await new Promise(r => setTimeout(r, 600));
        } catch { /* ignore */ }
      }
      invalidateBuyCache();
    })().catch(err => console.warn('[Buy Analysis] Fundamentals refresh error:', err.message));

    res.json({ message: `Refreshing fundamentals for ${allSymbols.length} symbols in background.`, symbols: allSymbols.slice(0, 10) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/buy-universe
// Returns the raw candidate universe without full analysis.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/buy-universe', authenticateToken, async (req, res) => {
  try {
    const holdings = await db.select('holdings');
    const candidates = buildCandidateUniverse(holdings);
    const watchlist = loadWatchlist();
    res.json({
      totalCandidates: candidates.length,
      portfolioCount: candidates.filter(c => c.inPortfolio).length,
      watchlistCount: watchlist.length,
      candidates,
      watchlist
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/earnings-calendar
// Returns earnings dates for all tracked symbols.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/earnings-calendar', authenticateToken, (req, res) => {
  try {
    const calendar = getFullEarningsCalendar();
    const today = getTodayIST();
    // Enrich with daysToResult
    const enriched = {};
    for (const [sym, entry] of Object.entries(calendar)) {
      const daysToResult = entry.nextResultDate
        ? Math.round((new Date(`${entry.nextResultDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000)
        : null;
      enriched[sym] = { ...entry, daysToResult };
    }
    res.json({ today, calendar: enriched, count: Object.keys(enriched).length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/news-intel/:symbol
// Returns news signals for a specific stock.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/news-intel/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const name = req.query.name || symbol;
    const newsSignal = await fetchNewsSignals(symbol, name);
    res.json(newsSignal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sip-plan/:symbol
// Returns the SIP accumulation plan for a symbol.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sip-plan/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');

    // Try loading saved plan first
    const savedPlan = loadSipPlan(clean);
    if (savedPlan) {
      return res.json(savedPlan);
    }

    // If cached buy analysis has this stock's plan, return it
    if (_buyAnalysisCache) {
      const analysis = _buyAnalysisCache.analyses?.find(a => a.symbol === clean);
      if (analysis?.sipPlan) {
        return res.json(analysis.sipPlan);
      }
    }

    res.status(404).json({ error: `No SIP plan generated for ${clean}. Run buy analysis first.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/buy-watchlist
// Add a symbol to the buy watchlist.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/buy-watchlist', authenticateToken, (req, res) => {
  try {
    const { symbol } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    const updated = addToWatchlist(symbol);
    invalidateBuyCache();
    res.json({ message: `${symbol.toUpperCase()} added to watchlist`, watchlist: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/buy-watchlist/:symbol
// Remove a symbol from the buy watchlist.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/buy-watchlist/:symbol', authenticateToken, (req, res) => {
  try {
    const { symbol } = req.params;
    const updated = removeFromWatchlist(symbol);
    invalidateBuyCache();
    res.json({ message: `${symbol.toUpperCase()} removed from watchlist`, watchlist: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
