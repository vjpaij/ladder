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

    if (id.startsWith('div-')) {
      const divId = id.slice(4);
      const { data: divs } = await supabase.from('dividends').select('*').eq('id', divId);
      if (!divs || divs.length === 0) {
        return res.status(404).json({ error: 'Dividend record not found' });
      }
      const parentId = divs[0].holding_id;
      const date = divs[0].payment_date || divs[0].ex_date;

      await supabase.from('dividends').delete().eq('id', divId);

      // Clean up matching legacy transaction if present
      if (parentId && date) {
        await supabase.from('transactions').delete()
          .eq('holding_id', parentId)
          .eq('type', 'DIVIDEND')
          .eq('date', date);
      }

      db.invalidateCache('dividends');
      db.invalidateCache('transactions');
      db.invalidateCache('holdings');

      if (parentId) {
        await recalculateHoldingState(parentId);
      }
      if (date) {
        triggerEodRebuildIfPastDate(date);
      }

      return res.json({ success: true, message: 'Dividend deleted and holding position synchronized.' });
    }

    const { data: txs } = await supabase.from('transactions').select('*').eq('id', id);
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;
    await supabase.from('transactions').delete().eq('id', id);

    // If deleting a DIVIDEND transaction, also delete any corresponding dividend in 'dividends'
    if (txs[0].type === 'DIVIDEND' && parentId && txs[0].date) {
      await supabase.from('dividends').delete()
        .eq('holding_id', parentId)
        .or(`payment_date.eq.${txs[0].date},ex_date.eq.${txs[0].date}`);
      db.invalidateCache('dividends');
    }

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

    if (id.startsWith('div-')) {
      const divId = id.slice(4);
      const { data: divs } = await supabase.from('dividends').select('*').eq('id', divId);
      if (!divs || divs.length === 0) {
        return res.status(404).json({ error: 'Dividend record not found' });
      }
      const parentId = divs[0].holding_id;
      const originalDate = divs[0].payment_date || divs[0].ex_date;

      const amt = Number(updates.total_amount) || Number(updates.price) || 0;
      const date = updates.date || originalDate;
      const fxRate = Number(updates.fx_rate) || 1.0;
      const isUs = updates.currency === 'USD' || divs[0].currency === 'USD';
      const amountInr = isUs ? Number((amt * fxRate).toFixed(2)) : amt;

      await supabase.from('dividends').update({
        amount_original: amt,
        amount_inr: amountInr,
        payment_date: date,
        fx_rate: isUs ? fxRate : 1.0
      }).eq('id', divId);

      // Also update matching legacy transaction if present
      if (parentId && originalDate) {
        await supabase.from('transactions').update({
          total_amount: amt,
          net_amount: amt,
          date: date,
          notes: updates.notes || `Dividend ${isUs ? '$' : '₹'}${amt}`
        })
        .eq('holding_id', parentId)
        .eq('type', 'DIVIDEND')
        .eq('date', originalDate);
      }

      db.invalidateCache('dividends');
      db.invalidateCache('transactions');
      db.invalidateCache('holdings');

      if (parentId) {
        await recalculateHoldingState(parentId);
      }
      triggerEodRebuildIfPastDate(updates.date || originalDate);

      return res.json({ success: true, message: 'Dividend updated and holding position synchronized.' });
    }

    const { data: txs } = await supabase.from('transactions').select('*').eq('id', id);
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const parentId = txs[0].holding_id || txs[0].liability_id;
    await supabase.from('transactions').update(updates).eq('id', id);

    // If updating a DIVIDEND transaction, also sync with 'dividends' table
    if (txs[0].type === 'DIVIDEND' && parentId && txs[0].date) {
      const amt = Number(updates.total_amount) || Number(updates.price) || Number(txs[0].total_amount);
      const newDate = updates.date || txs[0].date;
      await supabase.from('dividends').update({
        amount_original: amt,
        amount_inr: txs[0].currency === 'USD' ? Number((amt * (Number(updates.fx_rate) || 1)).toFixed(2)) : amt,
        payment_date: newDate
      })
      .eq('holding_id', parentId)
      .or(`payment_date.eq.${txs[0].date},ex_date.eq.${txs[0].date}`);
      db.invalidateCache('dividends');
    }

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
