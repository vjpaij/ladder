import express from 'express';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { formatDateDDMMYYYY } from '../services/historicalPriceStore.js';
import { recalculateHoldingState } from '../services/recalculator.js';
import { authenticateToken } from '../middleware/auth.js';

import { loadCategoryRegistry } from '../services/categoryRegistry.js';

const router = express.Router();

const DB_TABLE_COLUMNS = {
  categories: new Set(['name', 'color', 'valuation_model', 'default_currency', 'default_exchange', 'price_fetcher', 'has_dividends']),
  holdings: new Set(['category_id', 'symbol', 'name', 'exchange', 'quantity', 'avg_buy_price', 'current_price', 'currency', 'sector', 'market_cap', 'status']),
  transactions: new Set(['holding_id', 'liability_id', 'type', 'quantity', 'price', 'total_amount', 'charges', 'currency', 'fx_rate', 'date', 'notes']),
  liabilities: new Set(['category_id', 'name', 'lender', 'total_principal', 'outstanding_balance', 'interest_rate', 'monthly_emi', 'due_day']),
  dividends: new Set(['holding_id', 'amount_original', 'currency', 'fx_rate', 'amount_inr', 'ex_date', 'payment_date']),
  pnl_history: new Set(['log_date', 'daily_pnl_inr', 'pnl_percentage', 'total_assets_inr', 'total_liabilities_inr', 'net_worth_inr', 'breakdown']),
  fx_rates: new Set(['rate_date', 'rate'])
};

function assertDatabaseTable(tableName) {
  if (!Object.prototype.hasOwnProperty.call(DB_TABLE_COLUMNS, tableName)) {
    const error = new Error(`Table '${tableName}' is not available through the database editor.`);
    error.statusCode = 400;
    throw error;
  }
}

// -------------------------------------------------------------
// Category Dynamic Registry API
// -------------------------------------------------------------
router.get('/categories/registry', async (req, res) => {
  try {
    const categories = await loadCategoryRegistry();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load category registry: ' + err.message });
  }
});

// -------------------------------------------------------------
// DB Visual Manager API (Relational Editor with Name & Symbol Enriched)
// -------------------------------------------------------------
router.get('/db-tables', authenticateToken, (req, res) => {
  res.json(['categories', 'holdings', 'transactions', 'liabilities', 'dividends', 'pnl_history', 'fx_rates']);
});

router.get('/db-table-data/:tableName', authenticateToken, async (req, res) => {
  const { tableName } = req.params;
  try {
    assertDatabaseTable(tableName);
    const rawRows = await db.select(tableName);

    if (tableName === 'transactions' || tableName === 'dividends') {
      const holdings = await db.select('holdings');
      const hMap = {};
      holdings.forEach(h => hMap[h.id] = h);

      const enrichedRows = rawRows.map(r => {
        const h = hMap[r.holding_id] || {};
        const formattedDate = formatDateDDMMYYYY(r.date || r.payment_date || r.created_at);

        if (tableName === 'transactions') {
          return {
            id: r.id,
            symbol: h.symbol || 'N/A',
            name: h.name || 'N/A',
            holding_id: r.holding_id,
            type: r.type,
            quantity: r.quantity,
            price: r.price,
            total_amount: r.total_amount,
            charges: r.charges,
            currency: r.currency,
            date: formattedDate,
            notes: r.notes || ''
          };
        } else {
          return {
            id: r.id,
            symbol: h.symbol || 'N/A',
            name: h.name || 'N/A',
            holding_id: r.holding_id,
            amount_original: r.amount_original,
            currency: r.currency,
            fx_rate: r.fx_rate,
            amount_inr: r.amount_inr,
            payment_date: formattedDate
          };
        }
      });

      const firstRow = enrichedRows[0] || {};
      const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
      return res.json({ columns, rows: enrichedRows });
    }

    // Default formatting for dates in other tables
    const formattedRows = rawRows.map(r => {
      const newObj = { ...r };
      ['date', 'payment_date', 'log_date', 'created_at', 'updated_at'].forEach(key => {
        if (newObj[key]) newObj[key] = formatDateDDMMYYYY(newObj[key]);
      });
      return newObj;
    });

    const firstRow = formattedRows[0] || {};
    const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
    res.json({ columns, rows: formattedRows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/db-table-update', authenticateToken, async (req, res) => {
  const { tableName, id, column, value } = req.body;
  try {
    assertDatabaseTable(tableName);
    if (!id || !DB_TABLE_COLUMNS[tableName].has(column)) {
      return res.status(400).json({ error: 'Invalid table, row id, or column.' });
    }
    const updateObj = {};
    updateObj[column] = isNaN(value) ? value : Number(value);
    await db.update(tableName, id, updateObj);

    // If a transaction is amended, automatically recalculate its parent holding or liability
    if (tableName === 'transactions') {
      const { data: txs } = await supabase.from('transactions').select('holding_id, liability_id').eq('id', id);
      const parentId = txs?.[0]?.holding_id || txs?.[0]?.liability_id;
      if (parentId) {
        await recalculateHoldingState(parentId);
      }
    }

    db.invalidateCache(tableName);
    if (tableName === 'transactions') {
      db.invalidateCache('holdings');
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
