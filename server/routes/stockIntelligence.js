import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getTodayIST } from '../services/marketCalendar.js';
import { loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { runWalkForwardBacktest } from '../services/stockIntelligence/backtestEngine.js';
import { buildPortfolioSummary, buildStockAnalyses } from '../services/stockIntelligence/analysisService.js';
import { getIntelligenceConfig, getStateHistory, recordStateTransitions, saveIntelligenceConfig } from '../services/stockIntelligence/repository.js';

const router = express.Router();
let cachedBacktest = null;
let cachedBacktestKey = '';

function getUserKey(user) {
  return String(user?.id || user?.email || 'local-user');
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

router.get('/stock-intelligence/overview', authenticateToken, async (req, res) => {
  try {
    const [holdings, transactions, metadata, history] = await Promise.all([
      db.select('holdings'), db.select('transactions'), db.select('asset_metadata'), loadHistoricalPricesAsync()
    ]);
    const active = holdings.filter(item => item.category_id === 'in_stocks' && Number(item.quantity) > 0);
    const symbols = [...new Set(active.map(item => item.symbol).filter(Boolean))];
    const backtest = getBacktest(history, symbols);
    const userId = getUserKey(req.user);
    const config = getIntelligenceConfig(userId);
    const analyses = buildStockAnalyses(holdings, history, { today: getTodayIST(), backtest, config, transactions, metadata });
    recordStateTransitions(userId, analyses);
    res.json({
      generatedAt: new Date().toISOString(),
      ruleVersion: backtest.version,
      summary: buildPortfolioSummary(analyses),
      config,
      backtest,
      analyses
    });
  } catch (error) {
    console.error('[Stock Intelligence] Overview failed:', error.message);
    res.status(500).json({ error: 'Stock analysis could not be loaded.' });
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
