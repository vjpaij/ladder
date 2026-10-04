import express from 'express';
import db from '../db.js';
import { recalculateHoldingState } from '../services/recalculator.js';
import { triggerEodRebuildIfPastDate } from '../services/eodSync.js';
import { authenticateToken } from '../middleware/auth.js';
import { deleteDividend, updateDividend } from '../services/dividendService.js';
import { deleteStockSplit, updateStockSplit } from '../services/corporateActionService.js';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// Dedicated Transaction Delete with Automatic Reversal/Recalculation
router.delete('/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (id.startsWith('div-')) {
      await deleteDividend(id);
      return res.json({ success: true, message: 'Dividend deleted and holding position synchronized.' });
    }

    const txs = await db.selectWhere('transactions', { id });
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;

    // If deleting a SPLIT transaction, delegate to corporate action service
    if (txs[0].type === 'SPLIT') {
      await deleteStockSplit(id);
      return res.json({ success: true, message: 'Stock split deleted and open shares restored.' });
    }

    // If deleting a DIVIDEND transaction, delegate to dividend service
    if (txs[0].type === 'DIVIDEND') {
      await deleteDividend(id);
      return res.json({ success: true, message: 'Dividend deleted and holding position synchronized.' });
    }

    await db.delete('transactions', id);

    if (parentId) {
      await recalculateHoldingState(parentId);
    }

    // If deleting an EMI_PAYMENT for a loan, un-settle the matching amortization row
    const deletedTx = txs[0];
    if (
      (deletedTx.type === 'EMI_PAYMENT' || deletedTx.type === 'PREPAYMENT') &&
      deletedTx.liability_id
    ) {
      try {
        const monthPrefix = (deletedTx.date || '').slice(0, 7); // YYYY-MM
        if (monthPrefix) {
          const { data: amortRows } = await supabase
            .from('loan_amortization')
            .select('id, is_settled')
            .eq('liability_id', deletedTx.liability_id)
            .like('date', `${monthPrefix}%`)
            .order('date', { ascending: true });

          if (amortRows && amortRows.length > 0 && amortRows[0].is_settled === true) {
            await supabase
              .from('loan_amortization')
              .update({ is_settled: false, updated_at: new Date().toISOString() })
              .eq('id', amortRows[0].id);
            console.log(`[Delete EMI] Un-settled amortization row ${amortRows[0].id} for ${monthPrefix} after transaction deletion.`);
          }
        }
      } catch (amortErr) {
        console.warn('[Delete EMI] Amortization un-settle failed (non-fatal):', amortErr.message);
      }
      db.invalidateCache('liabilities');
      db.invalidateCache('loan_amortization');
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

    if (id.startsWith('div-') || updates.type === 'DIVIDEND') {
      await updateDividend(id, {
        amount: Number(updates.total_amount) || Number(updates.price) || 0,
        date: updates.date,
        currency: updates.currency,
        fx_rate: updates.fx_rate,
        notes: updates.notes
      });
      return res.json({ success: true, message: 'Dividend updated and holding position synchronized.' });
    }

    const txs = await db.selectWhere('transactions', { id });
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;

    // Handle SPLIT transaction updates via corporate action service
    if (txs[0].type === 'SPLIT' || updates.type === 'SPLIT') {
      await updateStockSplit(id, updates);
      return res.json({ success: true, message: 'Stock split updated and holding position synchronized.' });
    }

    // Handle DIVIDEND transaction updates if txs[0].type is DIVIDEND
    if (txs[0].type === 'DIVIDEND') {
      await updateDividend(id, {
        amount: Number(updates.total_amount) || Number(updates.price) || 0,
        date: updates.date,
        currency: updates.currency,
        fx_rate: updates.fx_rate,
        notes: updates.notes
      });
      return res.json({ success: true, message: 'Dividend updated and holding position synchronized.' });
    }

    if (txs[0].type === 'BONUS' || updates.type === 'BONUS') {
      updates.price = 0;
      updates.total_amount = 0;
      if (!updates.notes || updates.notes.startsWith('Bonus issue')) {
        updates.notes = `Bonus issue: +${updates.quantity} shares credited`;
      }
    }

    await db.update('transactions', id, updates);

    if (parentId) {
      await recalculateHoldingState(parentId);
    }
    if (txs[0].liability_id || updates.liability_id) {
      db.invalidateCache('liabilities');
      db.invalidateCache('loan_amortization');
    }
    triggerEodRebuildIfPastDate(updates.date || txs[0].date);

    res.json({ success: true, message: 'Transaction updated and holding position automatically recalculated.' });
  } catch (err) {
    console.error('[Update Transaction Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
