import express from 'express';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { authenticateToken } from '../middleware/auth.js';
import { getLoanAmortizationData, addLoanAmortizationEntry, updateLoanAmortizationEntry, deleteLoanAmortizationEntry } from '../services/loanEngine.js';

const router = express.Router();

// -------------------------------------------------------------
// Liabilities API
// -------------------------------------------------------------
router.get('/liabilities', authenticateToken, async (req, res) => {
  try {
    const liabilities = await db.select('liabilities');
    res.json(liabilities);
  } catch (err) {
    console.error('[Get Liabilities Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/liabilities', authenticateToken, async (req, res) => {
  try {
    const { category_id, name, lender, total_principal, outstanding_balance, interest_rate, monthly_emi, due_day } = req.body;

    await db.insert('liabilities', {
      category_id: category_id || 'loans',
      name,
      lender,
      total_principal: Number(total_principal),
      outstanding_balance: Number(outstanding_balance),
      interest_rate: Number(interest_rate || 0),
      monthly_emi: Number(monthly_emi || 0),
      due_day: Number(due_day || 5)
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Post Liabilities Error]:', err);
    res.status(400).json({ error: err.message });
  }
});

router.put('/liabilities/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, lender, outstanding_balance, interest_rate, monthly_emi, due_day, category_id, total_principal } = req.body;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (lender !== undefined) updates.lender = lender;
    if (outstanding_balance !== undefined) updates.outstanding_balance = Number(outstanding_balance);
    if (interest_rate !== undefined) updates.interest_rate = Number(interest_rate);
    if (monthly_emi !== undefined) updates.monthly_emi = Number(monthly_emi);
    if (due_day !== undefined) updates.due_day = Number(due_day);
    if (category_id !== undefined) updates.category_id = category_id;
    if (total_principal !== undefined) updates.total_principal = Number(total_principal);

    await db.update('liabilities', id, updates);
    res.json({ success: true });
  } catch (err) {
    console.error('[Put Liabilities Error]:', err);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/liabilities/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('transactions').delete().eq('liability_id', id);
    await supabase.from('loan_amortization').delete().eq('liability_id', id);
    const { error: liabErr } = await supabase.from('liabilities').delete().eq('id', id);
    if (liabErr) throw new Error(liabErr.message);
    db.invalidateCache();
    res.json({ success: true, message: 'Liability and associated records deleted successfully.' });
  } catch (err) {
    console.error('[Delete Liability Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Loan Amortization API
// -------------------------------------------------------------
router.get('/loan/amortization', authenticateToken, async (req, res) => {
  try {
    let liabilityId = req.query.liabilityId;
    if (!liabilityId) {
      const loans = await db.selectWhere('liabilities', { category_id: 'loans' });
      liabilityId = loans[0]?.id || null;
    }
    const data = await getLoanAmortizationData(liabilityId);
    res.json(data);
  } catch (err) {
    console.error('[API Error - /api/loan/amortization]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/loan/amortization/entry', authenticateToken, async (req, res) => {
  try {
    const result = await addLoanAmortizationEntry(req.body);
    db.invalidateCache('liabilities');
    res.json({ success: true, entry: result });
  } catch (err) {
    console.error('[API Error - /api/loan/amortization/entry]:', err);
    res.status(400).json({ error: err.message });
  }
});

router.put('/loan/amortization/entry/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await updateLoanAmortizationEntry(id, req.body);
    db.invalidateCache('liabilities');
    res.json({ success: true, entry: result });
  } catch (err) {
    console.error('[API Error - update loan entry]:', err);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/loan/amortization/entry/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteLoanAmortizationEntry(id);
    db.invalidateCache('liabilities');
    res.json(result);
  } catch (err) {
    console.error('[API Error - delete loan entry]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
