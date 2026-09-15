import express from 'express';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { processDueSips, getSipExecutionHistory } from '../services/sipEngine.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// List all SIPs
router.get('/sips', authenticateToken, async (req, res) => {
  try {
    const { data: sips, error } = await supabase
      .from('sips')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(sips || []);
  } catch (err) {
    console.error('[Get SIPs Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create new SIP
router.post('/sips', authenticateToken, async (req, res) => {
  try {
    const { holding_id, symbol, name, amount, day_of_month, frequency, start_date, end_date } = req.body;
    if (!symbol || !name || !amount) {
      return res.status(400).json({ error: 'Symbol, name and amount are required' });
    }

    const freq = (frequency || 'MONTHLY').toUpperCase();
    const dom = Math.min(28, Math.max(1, parseInt(day_of_month) || 1));
    const todayStr = new Date().toISOString().split('T')[0];
    
    let nextRunStr = start_date || todayStr;
    if (!start_date) {
      const today = new Date();
      let nextDate = new Date(today.getFullYear(), today.getMonth(), dom);
      if (nextDate < today) {
        nextDate = new Date(today.getFullYear(), today.getMonth() + 1, dom);
      }
      nextRunStr = nextDate.toISOString().split('T')[0];
    }

    const { data: inserted, error } = await supabase
      .from('sips')
      .insert({
        holding_id: holding_id || null,
        symbol,
        name,
        amount: Number(amount),
        frequency: freq,
        day_of_month: dom,
        start_date: start_date || nextRunStr,
        end_date: end_date || null,
        next_run_date: nextRunStr,
        status: 'ACTIVE'
      })
      .select();

    if (error) throw error;
    db.invalidateCache('sips');
    const processing = await processDueSips();
    res.json({ success: true, sip: inserted[0], processing });
  } catch (err) {
    console.error('[Create SIP Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update SIP parameters
router.put('/sips/:id', authenticateToken, async (req, res) => {
  try {
    const { amount, day_of_month, frequency, next_run_date, end_date, start_date } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (amount !== undefined) updates.amount = Number(amount);
    if (day_of_month !== undefined) updates.day_of_month = parseInt(day_of_month);
    if (frequency !== undefined) updates.frequency = frequency.toUpperCase();
    if (next_run_date !== undefined) updates.next_run_date = next_run_date;
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date || null;

    const { data: updated, error } = await supabase
      .from('sips')
      .update(updates)
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    db.invalidateCache('sips');
    res.json({ success: true, sip: updated[0] });
  } catch (err) {
    console.error('[Update SIP Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Change SIP status: ACTIVE, PAUSED, CLOSED
router.patch('/sips/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'PAUSED', 'CLOSED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be ACTIVE, PAUSED, or CLOSED' });
    }

    const { data: updated, error } = await supabase
      .from('sips')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    db.invalidateCache('sips');
    res.json({ success: true, sip: updated[0] });
  } catch (err) {
    console.error('[Patch SIP Status Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete SIP
router.delete('/sips/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase.from('sips').delete().eq('id', req.params.id);
    if (error) throw error;
    db.invalidateCache('sips');
    res.json({ success: true });
  } catch (err) {
    console.error('[Delete SIP Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger to process due SIPs immediately
router.post('/sips/process-due', authenticateToken, async (req, res) => {
  try {
    const result = await processDueSips();
    res.json({ success: true, result });
  } catch (err) {
    console.error('[Process Due SIPs Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get SIP execution and skip history
router.get('/sips/history', authenticateToken, async (req, res) => {
  try {
    const history = await getSipExecutionHistory();
    res.json({ success: true, history: history || [] });
  } catch (err) {
    console.error('[Get SIP History Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
