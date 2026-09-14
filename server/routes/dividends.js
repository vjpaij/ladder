import express from 'express';
import {
  getAllDividends,
  deleteDividend,
  deleteSchemeDividends,
  updateDividend
} from '../services/dividendService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// -------------------------------------------------------------
// Dividends Hub API (Single Source of Truth)
// -------------------------------------------------------------
router.get('/dividends', authenticateToken, async (req, res) => {
  try {
    const result = await getAllDividends();
    res.json(result);
  } catch (err) {
    console.error('[Get Dividends Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/dividends/scheme/:idOrSymbol', authenticateToken, async (req, res) => {
  try {
    const { idOrSymbol } = req.params;
    await deleteSchemeDividends(idOrSymbol);
    res.json({ success: true, message: 'Scheme dividend records deleted successfully.' });
  } catch (err) {
    console.error('[API Error - delete scheme dividends]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/dividends/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteDividend(id);
    res.json({ success: true, message: 'Dividend entry deleted successfully.' });
  } catch (err) {
    console.error('[API Error - delete dividend]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/dividends/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_original, payment_date, currency, fx_rate, notes } = req.body;
    const originalAmt = Number(amount_original);
    if (isNaN(originalAmt) || originalAmt <= 0) {
      return res.status(400).json({ error: 'Dividend amount must be a positive number.' });
    }

    await updateDividend(id, {
      amount: originalAmt,
      date: payment_date,
      currency,
      fx_rate,
      notes
    });

    res.json({ success: true, message: 'Dividend entry updated successfully.' });
  } catch (err) {
    console.error('[API Error - update dividend]:', err);
    res.status(500).json({ error: err.message });
  }
});
export default router;
