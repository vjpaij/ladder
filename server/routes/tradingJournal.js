/**
 * server/routes/tradingJournal.js
 * 
 * Express API routes for Ladder Trading Journal:
 * - Trade CRUD
 * - Comprehensive stats & analytics
 * - Live statutory charges preview
 * - 1-click Ladder portfolio transaction sync
 */

import express from 'express';
import {
  getAllTrades,
  getTradeById,
  createTrade,
  updateTrade,
  deleteTrade,
  computeJournalStats,
  syncFromPortfolioTransactions,
  getSymbolAggregatedTrades,
  updateTradeNotesAndTags,
  syncJournalToSupabase
} from '../services/tradingJournalService.js';
import { calculateTradingCharges } from '../services/tradingChargesCalculator.js';
import { authenticateToken } from '../middleware/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { getHistoricalPricesMap, ensureHistoricalPricesForSymbol, loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { fetchCompanyFundamentals } from '../services/stockIntelligence/screenerFundamentalsProvider.js';
import { loadAllCachedUsFundamentals } from '../services/stockIntelligence/usFundamentalsProvider.js';
import YF from 'yahoo-finance2';

const yahooFinance = new YF();

const router = express.Router();

/**
 * Technical Indicator Helpers for GoCharting 1D View
 */
function computeSeriesEMA(prices, period) {
  const k = 2 / (period + 1);
  const ema = [];
  let prevEma = null;
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
      prevEma = sum / period;
      ema.push(Number(prevEma.toFixed(2)));
    } else {
      prevEma = price * k + prevEma * (1 - k);
      ema.push(Number(prevEma.toFixed(2)));
    }
  }
  return ema;
}

function computeSeriesRSI(prices, period = 10) {
  const rsi = [];
  if (prices.length <= period) return prices.map(() => null);
  
  const gains = [];
  const losses = [];
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  
  rsi.push(null); // for index 0
  
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < period - 1; i++) {
    rsi.push(null);
  }
  
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(Number((100 - (100 / (1 + rs))).toFixed(2)));
  
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(Number((100 - (100 / (1 + rs))).toFixed(2)));
  }
  return rsi;
}

/**
 * GET /api/trading-journal/symbols
 * Return symbol-wise aggregated trades with Buy/Sell analysis badges
 */
router.get('/trading-journal/symbols', async (req, res) => {
  try {
    const { market, segment, status, outcome, query, sortField, sortOrder } = req.query;
    const symbols = await getSymbolAggregatedTrades({
      market,
      segment,
      status,
      outcome,
      query,
      sortField,
      sortOrder
    });
    res.json({ success: true, symbols });
  } catch (err) {
    console.error('[TradingJournal] Error fetching symbol aggregated trades:', err);
    res.status(500).json({ error: 'Failed to fetch symbol aggregated trades.' });
  }
});

/**
 * GET /api/trading-journal
 * List trades with optional filtering
 */
router.get('/trading-journal', (req, res) => {
  try {
    const { market, segment, status, outcome, query } = req.query;
    const trades = getAllTrades({ market, segment, status, outcome, query });
    res.json({ success: true, trades });
  } catch (err) {
    console.error('[TradingJournal] Error fetching trades:', err);
    res.status(500).json({ error: 'Failed to fetch journal trades.' });
  }
});

/**
 * GET /api/trading-journal/stats
 * Return computed performance analytics and psychology metrics
 */
router.get('/trading-journal/stats', (req, res) => {
  try {
    const { market, segment } = req.query;
    const stats = computeJournalStats({ market, segment });
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[TradingJournal] Error computing stats:', err);
    res.status(500).json({ error: 'Failed to compute journal statistics.' });
  }
});

/**
 * POST /api/trading-journal/calculate-preview
 * Instant live preview of charges & Net P&L for frontend modals
 */
router.post('/trading-journal/calculate-preview', (req, res) => {
  try {
    const calculation = calculateTradingCharges(req.body);
    res.json({ success: true, calculation });
  } catch (err) {
    console.error('[TradingJournal] Error previewing charges:', err);
    res.status(400).json({ error: 'Failed to compute charges preview.' });
  }
});

/**
 * POST /api/trading-journal
 * Log a new trade
 */
router.post('/trading-journal', (req, res) => {
  try {
    const tradeData = req.body;
    if (!tradeData.symbol) {
      return res.status(400).json({ error: 'Stock/Contract symbol is required.' });
    }
    if (!tradeData.entryPrice || Number(tradeData.entryPrice) <= 0) {
      return res.status(400).json({ error: 'Valid entry price is required.' });
    }
    const trade = createTrade(tradeData);
    res.status(201).json({ success: true, trade });
  } catch (err) {
    console.error('[TradingJournal] Error creating trade:', err);
    res.status(500).json({ error: 'Failed to create journal trade.' });
  }
});

/**
 * PUT /api/trading-journal/:id
 * Update an existing trade
 */
router.put('/trading-journal/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updated = updateTrade(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Trade not found.' });
    }
    res.json({ success: true, trade: updated });
  } catch (err) {
    console.error('[TradingJournal] Error updating trade:', err);
    res.status(500).json({ error: 'Failed to update journal trade.' });
  }
});

/**
 * PATCH /api/trading-journal/:id/notes-tags
 * Fast dedicated endpoint to update notes and multi-tags on any trade
 */
router.patch('/trading-journal/:id/notes-tags', (req, res) => {
  try {
    const { id } = req.params;
    const { notes, tags } = req.body;
    const updated = updateTradeNotesAndTags(id, { notes, tags });
    if (!updated) {
      return res.status(404).json({ error: 'Trade not found.' });
    }
    res.json({ success: true, trade: updated });
  } catch (err) {
    console.error('[TradingJournal] Error updating trade notes/tags:', err);
    res.status(500).json({ error: 'Failed to update trade notes and tags.' });
  }
});

/**
 * POST /api/trading-journal/sync-cloud
 * Force instant cloud backup to Supabase
 */
router.post('/trading-journal/sync-cloud', async (req, res) => {
  try {
    await syncJournalToSupabase();
    res.json({ success: true, message: 'Trading journal persisted to Supabase.' });
  } catch (err) {
    console.error('[TradingJournal] Error syncing to Supabase:', err);
    res.status(500).json({ error: 'Failed to sync to Supabase.' });
  }
});

/**
 * DELETE /api/trading-journal/:id
 * Remove a trade entry
 */
router.delete('/trading-journal/:id', (req, res) => {
  try {
    const { id } = req.params;
    const success = deleteTrade(id);
    if (!success) {
      return res.status(404).json({ error: 'Trade not found.' });
    }
    res.json({ success: true, message: 'Trade entry deleted.' });
  } catch (err) {
    console.error('[TradingJournal] Error deleting trade:', err);
    res.status(500).json({ error: 'Failed to delete journal trade.' });
  }
});

/**
 * POST /api/trading-journal/sync-portfolio
 * 1-click sync from Ladder transactions table
 */
router.post('/trading-journal/sync-portfolio', async (req, res) => {
  try {
    const result = await syncFromPortfolioTransactions();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[TradingJournal] Error syncing from portfolio:', err);
    res.status(500).json({ error: 'Failed to sync trades from portfolio transactions.' });
  }
});

function deriveQuarterHeaders(latestQuarterStr, count = 12) {
  if (!latestQuarterStr) return [];
  const months = ['Mar', 'Jun', 'Sep', 'Dec'];
  const parts = String(latestQuarterStr).trim().split(' ');
  let curMonth = parts[0];
  let curYear = parseInt(parts[1]) || new Date().getFullYear();
  let mIdx = months.indexOf(curMonth);
  if (mIdx === -1) mIdx = 2;

  const headers = [];
  for (let i = 0; i < count; i++) {
    headers.unshift(months[mIdx] + ' ' + curYear);
    mIdx--;
    if (mIdx < 0) {
      mIdx = 3;
      curYear--;
    }
  }
  return headers;
}

function deriveAnnualHeaders(count = 12) {
  const currentYear = new Date().getFullYear();
  const headers = ['TTM'];
  let y = currentYear;
  for (let i = 1; i < count; i++) {
    headers.unshift(`Mar ${y}`);
    y--;
  }
  return headers;
}

/**
 * GET /api/trading-journal/technical-chart/:symbol
 * Fetches 1D Daily candles with overlaid EMA(21), EMA(50), EMA(200), and RSI(10) matching GoCharting
 * Consumes 0 KB Supabase Storage
 */
router.get('/trading-journal/technical-chart/:symbol', async (req, res) => {
  try {
    const rawSym = req.params.symbol;
    const cleanSym = String(rawSym || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
    const isUs = req.query.market === 'US' || ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'].includes(cleanSym);
    const market = isUs ? 'US' : 'IN';

    // 1. Read daily close history from historicalPriceStore.js using loadHistoricalPricesAsync()
    const histMap = await loadHistoricalPricesAsync();
    let symbolPrices = histMap[rawSym.toUpperCase()] ||
                       histMap[cleanSym] || 
                       histMap[`${cleanSym}.NS`] || 
                       histMap[`${cleanSym}.BO`] || {};

    // Auto-fetch from free provider if missing or too few quotes
    if (Object.keys(symbolPrices).length < 20) {
      try {
        await ensureHistoricalPricesForSymbol(cleanSym, isUs ? 'us_stocks' : 'in_stocks');
        const reloaded = await loadHistoricalPricesAsync(true);
        symbolPrices = reloaded[rawSym.toUpperCase()] ||
                       reloaded[cleanSym] || 
                       reloaded[`${cleanSym}.NS`] || 
                       reloaded[`${cleanSym}.BO`] || symbolPrices;
      } catch (ensureErr) {
        console.warn(`[TechnicalChart] ensureHistoricalPricesForSymbol fallback failed for ${cleanSym}:`, ensureErr.message);
      }
    }

    const sortedEntries = Object.entries(symbolPrices)
      .map(([dStr, val]) => ({
        date: dStr,
        close: typeof val === 'number' ? Number(val.toFixed(2)) : Number(Number(val?.close || val).toFixed(2))
      }))
      .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.close) && item.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    // 2. Compute exact indicators matching GoCharting: 21 EMA, 50 EMA, 200 EMA, 10 RSI
    const closes = sortedEntries.map(e => e.close);
    const ema21 = computeSeriesEMA(closes, 21);
    const ema50 = computeSeriesEMA(closes, 50);
    const ema200 = computeSeriesEMA(closes, 200);
    const rsi10 = computeSeriesRSI(closes, 10);

    const fullData = sortedEntries.map((item, idx) => ({
      date: item.date,
      close: item.close,
      ema21: ema21[idx],
      ema50: ema50[idx],
      ema200: ema200[idx],
      rsi10: rsi10[idx],
      volume: null
    }));

    // 3. Extract recent 120-250 trading sessions (default 200)
    const windowSize = Math.min(Math.max(parseInt(req.query.limit) || 200, 120), 250);
    const data = fullData.length > windowSize ? fullData.slice(-windowSize) : fullData;

    const latest = data.at(-1) || {};
    const indicators = {
      currentPrice: latest.close ?? null,
      ema21: latest.ema21 ?? null,
      ema50: latest.ema50 ?? null,
      ema200: latest.ema200 ?? null,
      rsi10: latest.rsi10 ?? null
    };

    res.json({
      success: true,
      symbol: cleanSym,
      market,
      timeframe: '1D',
      data,
      series: data,
      indicators
    });
  } catch (err) {
    console.error('[TradingJournal] Error computing technical chart for', req.params.symbol, err);
    res.status(500).json({ error: 'Failed to generate technical chart data.' });
  }
});

/**
 * GET /api/trading-journal/fundamentals/:symbol
 * Fetches Quarterly Results and Annual P&L statements (0 KB Supabase Storage)
 */
router.get('/trading-journal/fundamentals/:symbol', async (req, res) => {
  try {
    const rawSym = req.params.symbol;
    const cleanSym = String(rawSym || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!cleanSym) {
      return res.status(400).json({ error: 'Valid stock symbol is required.' });
    }

    const isUs = req.query.market === 'US' || ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'].includes(cleanSym);

    // 1. Check local disk cache in data/screener_cache/<SYMBOL>.json (0 KB Supabase Storage)
    const cacheDir = path.join(process.cwd(), 'data', 'screener_cache');
    const cachePath = path.join(cacheDir, `${cleanSym}.json`);
    let rawData = null;

    if (fs.existsSync(cachePath)) {
      try {
        rawData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch (readErr) {
        console.warn(`[Fundamentals API] Failed to parse ${cachePath}:`, readErr.message);
      }
    }

    // 2. If not cached, call fetchCompanyFundamentals(clean)
    if (!rawData || rawData.status === 'UNAVAILABLE' || !rawData.quarterRows) {
      if (isUs) {
        const usData = loadAllCachedUsFundamentals([cleanSym]);
        rawData = usData[cleanSym] || {
          status: 'AVAILABLE',
          symbol: cleanSym,
          source: 'Finviz Institutional',
          screenerUrl: `https://finviz.com/quote.ashx?t=${cleanSym}`
        };
      } else {
        try {
          rawData = await fetchCompanyFundamentals(cleanSym);
        } catch (fetchErr) {
          console.warn(`[Fundamentals API] fetchCompanyFundamentals failed for ${cleanSym}:`, fetchErr.message);
        }
      }
    }

    if (!rawData) {
      return res.status(404).json({ error: `Fundamentals not available for ${cleanSym}` });
    }

    // 3. Ensure quarterHeaders, quarterRows, annualHeaders, annualRows, opmHistory
    const quarterRows = rawData.quarterRows || {};
    const salesArr = rawData.quarterlySales || quarterRows['Sales'] || [];
    const countQ = Math.max(salesArr.length, (rawData.quarterLabels || []).length, 8);

    const quarterHeaders = (Array.isArray(rawData.quarterHeaders) && rawData.quarterHeaders.length > 0)
      ? rawData.quarterHeaders
      : (Array.isArray(rawData.quarterLabels) && rawData.quarterLabels.length > 0)
        ? rawData.quarterLabels
        : deriveQuarterHeaders(rawData.latestQuarter || rawData.opmHistory?.at(-1)?.quarter, countQ);

    const annualSalesArr = rawData.annualSales || (rawData.annualRows && rawData.annualRows['Sales']) || [];
    const countA = Math.max(annualSalesArr.length, (rawData.annualLabels || []).length, 8);

    const annualHeaders = (Array.isArray(rawData.annualHeaders) && rawData.annualHeaders.length > 0)
      ? rawData.annualHeaders
      : (Array.isArray(rawData.annualLabels) && rawData.annualLabels.length > 0)
        ? rawData.annualLabels
        : deriveAnnualHeaders(countA);

    const annualRows = rawData.annualRows || {
      'Sales': rawData.annualSales || [],
      'Net Profit': rawData.annualPat || [],
      'EPS in Rs': rawData.annualEps || []
    };

    const fundamentals = {
      ...rawData,
      quarterHeaders,
      quarterRows,
      annualHeaders,
      annualRows,
      opmHistory: rawData.opmHistory || []
    };

    res.json({
      success: true,
      symbol: cleanSym,
      market: isUs ? 'US' : 'IN',
      fundamentals,
      data: fundamentals
    });
  } catch (err) {
    console.error('[TradingJournal] Error fetching fundamentals for', req.params.symbol, err);
    res.status(500).json({ error: 'Failed to fetch company fundamentals.' });
  }
});

export default router;
