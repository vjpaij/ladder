import express from 'express';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate } from '../services/priceEngine.js';
import { getPersistedRate } from '../services/fxRateStore.js';
import { formatDateDDMMYYYY } from '../services/historicalPriceStore.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// -------------------------------------------------------------
// Dividends Hub API
// -------------------------------------------------------------
router.get('/dividends', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const divs = await db.select('dividends');
    const holdings = await db.select('holdings');
    const hMap = {};
    holdings.forEach(h => hMap[h.id] = h);

    let totalIndiaINR = 0;
    let totalUSUSD = 0;
    let totalUSConvertedINR = 0;

    const history = divs.map(d => {
      const asset = hMap[d.holding_id] || holdings.find(h => h.symbol === d.symbol) || {};
      const categoryId = asset.category_id || (d.currency === 'USD' ? 'us_stocks' : 'in_stocks');
      let assetName = asset.name || d.name || 'Stock';
      if (typeof assetName === 'string') {
        assetName = assetName.replace(/\b(Common Stock|Capital Stock|Registry Share|Registry Shares|Class A|Class B|Class C|Ordinary Shares|Ordinary Share)\b/ig, '')
                             .replace(/,\s*Inc\.?$/i, ' Inc.')
                             .replace(/,\s*Corp\.?$/i, ' Corp.')
                             .replace(/[,\.\-\s]+$/, '')
                             .trim();
      }
      const amountOriginal = Number(d.amount_original) || 0;
      const amountInr = Number(d.amount_inr) || 0;

      if (d.currency === 'USD') {
        totalUSUSD += amountOriginal;
        totalUSConvertedINR += amountInr;
      } else {
        totalIndiaINR += amountInr;
      }

      return {
        ...d,
        holding_id: d.holding_id || asset.id,
        category_id: categoryId,
        symbol: asset.symbol || d.symbol || 'ASSET',
        asset_name: assetName,
        raw_date: d.payment_date,
        payment_date: formatDateDDMMYYYY(d.payment_date)
      };
    }).sort((a, b) => (b.raw_date || '').localeCompare(a.raw_date || ''));

    res.json({
      totalDividendsINR: Number((totalIndiaINR + totalUSConvertedINR).toFixed(2)),
      totalIndiaINR: Number(totalIndiaINR.toFixed(2)),
      totalUSUSD: Number(totalUSUSD.toFixed(2)),
      totalUSConvertedINR: Number(totalUSConvertedINR.toFixed(2)),
      fxRate,
      history
    });
  } catch (err) {
    console.error('[Get Dividends Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/dividends/scheme/:idOrSymbol', authenticateToken, async (req, res) => {
  try {
    const { idOrSymbol } = req.params;
    const { currency } = req.query;

    let query = supabase.from('dividends').delete().or(`holding_id.eq.${idOrSymbol},symbol.eq.${idOrSymbol}`);
    if (currency) {
      query = query.eq('currency', currency);
    }
    const { error } = await query;
    if (error) throw new Error(error.message);
    db.invalidateCache();

    res.json({ success: true, message: 'Scheme dividend records deleted successfully.' });
  } catch (err) {
    console.error('[API Error - delete scheme dividends]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/dividends/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('dividends').delete().eq('id', id);
    if (error) throw new Error(error.message);
    db.invalidateCache();
    res.json({ success: true, message: 'Dividend entry deleted successfully.' });
  } catch (err) {
    console.error('[API Error - delete dividend]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/dividends/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_original, payment_date, currency, fx_rate } = req.body;
    const originalAmt = Number(amount_original);
    if (isNaN(originalAmt) || originalAmt <= 0) {
      return res.status(400).json({ error: 'Dividend amount must be a positive number.' });
    }

    const liveFx = await fetchFxRate();
    const effFx = Number(fx_rate) || liveFx || getPersistedRate('USD_INR') || 1.0;
    const isUs = currency === 'USD';
    const amountInr = isUs ? Number((originalAmt * effFx).toFixed(2)) : originalAmt;

    const updates = {
      amount_original: originalAmt,
      payment_date: payment_date,
      currency: currency || (isUs ? 'USD' : 'INR'),
      fx_rate: isUs ? effFx : 1.0,
      amount_inr: amountInr
    };

    const { data, error } = await supabase.from('dividends').update(updates).eq('id', id).select();
    if (error) throw new Error(error.message);
    db.invalidateCache();

    res.json({ success: true, message: 'Dividend entry updated successfully.', data: data?.[0] });
  } catch (err) {
    console.error('[API Error - update dividend]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
