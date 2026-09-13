import express from 'express';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { recalculateHoldingState } from '../services/recalculator.js';
import { triggerEodRebuildIfPastDate } from '../services/eodSync.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Dedicated Transaction Delete with Automatic Reversal/Recalculation
router.delete('/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: txs } = await supabase.from('transactions').select('*').eq('id', id);
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;
    await supabase.from('transactions').delete().eq('id', id);
    db.invalidateCache('transactions');
    db.invalidateCache('holdings');

    if (parentId) {
      await recalculateHoldingState(parentId);
    }
    triggerEodRebuildIfPastDate(txs[0].date);

    res.json({ success: true, message: 'Transaction deleted and holding position automatically recalculated.' });
  } catch (err) {
    console.error('[Delete Transaction Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dedicated Transaction Update with Automatic Reversal/Recalculation
router.put('/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { data: txs } = await supabase.from('transactions').select('*').eq('id', id);
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;
    await supabase.from('transactions').update(updates).eq('id', id);
    db.invalidateCache('transactions');
    db.invalidateCache('holdings');

    if (parentId) {
      await recalculateHoldingState(parentId);
    }
    triggerEodRebuildIfPastDate(updates.date || txs[0].date);

    res.json({ success: true, message: 'Transaction updated and holding position automatically recalculated.' });
  } catch (err) {
    console.error('[Update Transaction Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
