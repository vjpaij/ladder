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

const router = express.Router();

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

export default router;
