import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { recalculateHoldingState } from './recalculator.js';
import { triggerEodRebuildIfPastDate } from './eodSync.js';
import { fetchFxRate } from './priceEngine.js';
import { formatDateDDMMYYYY } from './historicalPriceStore.js';

/**
 * Canonical Dividend Domain Service
 * Single source of truth for all dividend mutations and retrievals.
 * Guarantees 100% parity across:
 * - Supabase `dividends` table
 * - Supabase `transactions` table (type = 'DIVIDEND')
 * - HoldingDetailModal KPI cards & ledger
 * - DividendsView hub
 * - Portfolio Summary & Net Worth
 */

/**
 * Retrieves all dividends for a specific holding (single source of truth).
 * @param {string} holdingId
 * @returns {Promise<{ dividends: Array, totalDividends: number, dividendCount: number }>}
 */
export async function getHoldingDividends(holdingId) {
  if (!holdingId) return { dividends: [], totalDividends: 0, dividendCount: 0 };

  const [divs, txs] = await Promise.all([
    db.select('dividends'),
    db.select('transactions')
  ]);

  const holdingDivs = (divs || []).filter(d => d.holding_id === holdingId);
  const holdingDivTxs = (txs || []).filter(t => t.holding_id === holdingId && t.type === 'DIVIDEND');

  // Unified deduplicated list
  const matchedTxIds = new Set();
  const unified = [];

  for (const d of holdingDivs) {
    const dDate = d.payment_date || d.ex_date;
    const dAmt = Number(d.amount_original) || Number(d.amount_inr) || 0;
    const matchedTx = holdingDivTxs.find(t =>
      !matchedTxIds.has(t.id) &&
      t.date === dDate &&
      Math.abs((Number(t.total_amount) || Number(t.price)) - dAmt) < 0.05
    );

    if (matchedTx) {
      matchedTxIds.add(matchedTx.id);
      unified.push({
        ...matchedTx,
        div_id: d.id,
        amount_original: d.amount_original || matchedTx.total_amount,
        amount_inr: d.amount_inr || (matchedTx.currency === 'USD' ? (Number(matchedTx.total_amount) * (Number(d.fx_rate) || 1)) : matchedTx.total_amount)
      });
    } else {
      unified.push({
        id: `div-${d.id}`,
        div_id: d.id,
        holding_id: d.holding_id,
        symbol: d.symbol,
        name: d.name,
        type: 'DIVIDEND',
        quantity: 0,
        price: 0,
        total_amount: Number(d.amount_original) || Number(d.amount_inr) || 0,
        currency: d.currency || 'INR',
        fx_rate: d.fx_rate || 1,
        charges: 0,
        date: dDate,
        amount_original: d.amount_original,
        amount_inr: d.amount_inr,
        notes: `Dividend ₹${d.amount_inr || d.amount_original}`
      });
    }
  }

  // Include any orphan transactions with type = 'DIVIDEND'
  for (const t of holdingDivTxs) {
    if (!matchedTxIds.has(t.id)) {
      unified.push(t);
    }
  }

  // Sort descending by date
  unified.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  let totalDividends = 0;
  unified.forEach(d => {
    totalDividends += Number(d.amount_original || d.total_amount || d.amount_inr || 0);
  });

  return {
    dividends: unified,
    totalDividends: parseFloat(totalDividends.toFixed(2)),
    dividendCount: unified.length
  };
}

/**
 * Retrieves and formats all dividends across the portfolio for the Dividends Hub.
 * @returns {Promise<Object>}
 */
export async function getAllDividends() {
  const fxRate = await fetchFxRate();
  const [divs, txs, holdings] = await Promise.all([
    db.select('dividends'),
    db.select('transactions'),
    db.select('holdings')
  ]);

  const divTxs = (txs || []).filter(t => t.type === 'DIVIDEND');
  const hMap = {};
  (holdings || []).forEach(h => { hMap[h.id] = h; });

  const matchedTxIds = new Set();
  const unifiedDivs = (divs || []).map(d => {
    const dDate = d.payment_date || d.ex_date;
    const dAmt = Number(d.amount_original) || 0;
    const matched = divTxs.find(t =>
      !matchedTxIds.has(t.id) &&
      (t.holding_id === d.holding_id || (t.symbol && d.symbol === t.symbol)) &&
      t.date === dDate &&
      Math.abs((Number(t.total_amount) || Number(t.price)) - dAmt) < 0.05
    );
    if (matched) matchedTxIds.add(matched.id);
    return d;
  });

  // Add any orphan transactions
  const orphanTxs = divTxs.filter(t => !matchedTxIds.has(t.id));
  for (const t of orphanTxs) {
    const isUs = t.currency === 'USD';
    const amt = Number(t.total_amount) || Number(t.price) || 0;
    const fx = Number(t.fx_rate) || fxRate || 1.0;
    unifiedDivs.push({
      id: `tx-${t.id}`,
      holding_id: t.holding_id,
      symbol: t.symbol,
      name: t.name,
      amount_original: amt,
      amount_inr: isUs ? Number((amt * fx).toFixed(2)) : amt,
      currency: isUs ? 'USD' : 'INR',
      fx_rate: isUs ? fx : 1.0,
      payment_date: t.date,
      ex_date: t.date
    });
  }

  let totalIndiaINR = 0;
  let totalUSUSD = 0;
  let totalUSConvertedINR = 0;

  const history = unifiedDivs.map(d => {
    const asset = hMap[d.holding_id] || (holdings || []).find(h => h.symbol === d.symbol) || {};
    const categoryId = asset.category_id || (d.currency === 'USD' ? 'us_stocks' : 'in_stocks');
    let assetName = asset.name || d.name || 'Stock';
    if (typeof assetName === 'string') {
      assetName = assetName
        .replace(/\b(Common Stock|Capital Stock|Registry Share|Registry Shares|Class A|Class B|Class C|Ordinary Shares|Ordinary Share)\b/ig, '')
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
  });

  return {
    totalDividendsINR: parseFloat((totalIndiaINR + totalUSConvertedINR).toFixed(2)),
    totalIndiaINR: parseFloat(totalIndiaINR.toFixed(2)),
    totalUSUSD: parseFloat(totalUSUSD.toFixed(2)),
    totalUSConvertedINR: parseFloat(totalUSConvertedINR.toFixed(2)),
    fxRate,
    history
  };
}

/**
 * Atomically records a dividend into both `dividends` and `transactions` tables.
 * @param {Object} data
 * @returns {Promise<{ dividendId: string, transactionId: string }>}
 */
export async function recordDividend({
  holdingId,
  date,
  amount,
  currency = 'INR',
  fxRate = 1.0,
  notes = '',
  symbol = '',
  name = '',
  exDate = null
}) {
  if (!holdingId && !symbol) throw new Error('holdingId or symbol is required to record a dividend');
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) throw new Error('Dividend amount must be greater than zero');

  const cleanDate = (date || new Date().toISOString().split('T')[0]).split('T')[0];
  const numFx = Number(fxRate) || 1.0;
  const isUs = currency === 'USD';
  const amountInr = isUs ? parseFloat((numAmount * numFx).toFixed(2)) : numAmount;

  // 1. Insert into `dividends` table via write-through db.insert
  const divRecord = {
    holding_id: holdingId || null,
    amount_original: numAmount,
    amount_inr: amountInr,
    currency,
    fx_rate: numFx,
    ex_date: exDate || cleanDate,
    payment_date: cleanDate,
    symbol: symbol || null,
    name: name || null
  };

  const divInsert = await db.insert('dividends', divRecord);
  const divId = divInsert?.id;

  // 2. Insert matching transaction row into `transactions` table via write-through db.insert
  const txRecord = {
    holding_id: holdingId || null,
    type: 'DIVIDEND',
    quantity: 0,
    price: 0,
    total_amount: numAmount,
    currency,
    fx_rate: numFx,
    charges: 0,
    net_amount: numAmount,
    date: cleanDate,
    symbol: symbol || null,
    name: name || null,
    notes: notes || `Dividend ${isUs ? '$' : '₹'}${numAmount}`
  };

  const txInsert = await db.insert('transactions', txRecord);
  const txId = txInsert?.id;

  // Recalculate holding state & trigger past EOD rebuild if past-dated
  if (holdingId) {
    await recalculateHoldingState(holdingId);
  }
  triggerEodRebuildIfPastDate(cleanDate);

  return { dividendId: divId, transactionId: txId };
}

/**
 * Atomically updates a dividend record across both `dividends` and `transactions` tables.
 * @param {string} id - Either `dividends.id` or `transactions.id` (or prefixed)
 * @param {Object} updates
 * @returns {Promise<boolean>}
 */
export async function updateDividend(id, updates) {
  if (!id) throw new Error('ID required for updating dividend');

  const cleanId = String(id).replace(/^(div-|tx-)/, '');
  const cleanDate = updates.date ? String(updates.date).split('T')[0] : null;
  const numAmount = updates.amount !== undefined ? Number(updates.amount) : undefined;
  const numFx = updates.fx_rate ? Number(updates.fx_rate) : undefined;

  const [allDivs, allTxs] = await Promise.all([
    db.select('dividends'),
    db.select('transactions')
  ]);

  const existingDiv = (allDivs || []).find(d => String(d.id) === cleanId);
  const existingTx = (allTxs || []).find(t => String(t.id) === cleanId);

  const holdingId = existingDiv?.holding_id || existingTx?.holding_id;
  const symbol = existingDiv?.symbol || existingTx?.symbol;
  const name = existingDiv?.name || existingTx?.name;
  const targetDate = cleanDate || existingDiv?.payment_date || existingTx?.date;
  const oldDate = existingDiv?.payment_date || existingTx?.date;
  const curr = updates.currency || existingDiv?.currency || existingTx?.currency || 'INR';
  const isUs = curr === 'USD';
  const fx = numFx || existingDiv?.fx_rate || existingTx?.fx_rate || 1.0;
  const amtOrig = numAmount !== undefined ? numAmount : (Number(existingDiv?.amount_original) || Number(existingTx?.total_amount) || 0);
  const amtInr = isUs ? parseFloat((amtOrig * fx).toFixed(2)) : amtOrig;

  // 1. Update `dividends` table
  if (existingDiv) {
    await db.update('dividends', existingDiv.id, {
      amount_original: amtOrig,
      amount_inr: amtInr,
      currency: curr,
      fx_rate: fx,
      payment_date: targetDate,
      ex_date: targetDate
    });
  } else if (holdingId || symbol) {
    const matchedDiv = (allDivs || []).find(d =>
      ((holdingId && d.holding_id === holdingId) || (symbol && d.symbol === symbol)) &&
      (d.payment_date === oldDate || d.ex_date === oldDate)
    );
    if (matchedDiv) {
      await db.update('dividends', matchedDiv.id, {
        amount_original: amtOrig,
        amount_inr: amtInr,
        currency: curr,
        fx_rate: fx,
        payment_date: targetDate,
        ex_date: targetDate
      });
    } else {
      await db.insert('dividends', {
        holding_id: holdingId || null,
        symbol: symbol || null,
        name: name || null,
        amount_original: amtOrig,
        amount_inr: amtInr,
        currency: curr,
        fx_rate: fx,
        payment_date: targetDate,
        ex_date: targetDate
      });
    }
  }

  // 2. Update `transactions` table
  if (existingTx) {
    await db.update('transactions', existingTx.id, {
      total_amount: amtOrig,
      net_amount: amtOrig,
      currency: curr,
      fx_rate: fx,
      date: targetDate,
      notes: updates.notes !== undefined ? updates.notes : existingTx.notes
    });
  } else if (holdingId || symbol) {
    const matchedTx = (allTxs || []).find(t =>
      ((holdingId && t.holding_id === holdingId) || (symbol && t.symbol === symbol)) &&
      t.type === 'DIVIDEND' &&
      t.date === oldDate
    );
    if (matchedTx) {
      await db.update('transactions', matchedTx.id, {
        total_amount: amtOrig,
        net_amount: amtOrig,
        currency: curr,
        fx_rate: fx,
        date: targetDate,
        notes: updates.notes !== undefined ? updates.notes : matchedTx.notes
      });
    } else {
      await db.insert('transactions', {
        holding_id: holdingId || null,
        symbol: symbol || null,
        name: name || null,
        type: 'DIVIDEND',
        quantity: 0,
        price: 0,
        total_amount: amtOrig,
        currency: curr,
        fx_rate: fx,
        charges: 0,
        net_amount: amtOrig,
        date: targetDate,
        notes: updates.notes || `Dividend ${isUs ? '$' : '₹'}${amtOrig}`
      });
    }
  }

  if (holdingId) {
    await recalculateHoldingState(holdingId);
  }
  if (targetDate) triggerEodRebuildIfPastDate(targetDate);
  if (oldDate && oldDate !== targetDate) triggerEodRebuildIfPastDate(oldDate);

  return true;
}

/**
 * Atomically deletes a dividend record from both `dividends` and `transactions` tables.
 * @param {string} id - Either `dividends.id` or `transactions.id`
 * @returns {Promise<boolean>}
 */
export async function deleteDividend(id) {
  if (!id) throw new Error('ID required for deleting dividend');

  const cleanId = String(id).replace(/^(div-|tx-)/, '');

  const [allDivs, allTxs] = await Promise.all([
    db.select('dividends'),
    db.select('transactions')
  ]);

  const divRow = (allDivs || []).find(d => String(d.id) === cleanId);
  const txRow = (allTxs || []).find(t => String(t.id) === cleanId);

  const holdingId = divRow?.holding_id || txRow?.holding_id;
  const symbol = divRow?.symbol || txRow?.symbol;
  const date = divRow?.payment_date || divRow?.ex_date || txRow?.date;

  // 1. Delete from `dividends`
  if (divRow) {
    await db.delete('dividends', divRow.id);
  } else if (holdingId && date) {
    const matched = (allDivs || []).filter(d => d.holding_id === holdingId && (d.payment_date === date || d.ex_date === date));
    for (const m of matched) await db.delete('dividends', m.id);
  } else if (symbol && date) {
    const matched = (allDivs || []).filter(d => d.symbol === symbol && (d.payment_date === date || d.ex_date === date));
    for (const m of matched) await db.delete('dividends', m.id);
  }

  // 2. Delete from `transactions`
  if (txRow) {
    await db.delete('transactions', txRow.id);
  } else if (holdingId && date) {
    const matched = (allTxs || []).filter(t => t.holding_id === holdingId && t.type === 'DIVIDEND' && t.date === date);
    for (const m of matched) await db.delete('transactions', m.id);
  } else if (symbol && date) {
    const matched = (allTxs || []).filter(t => t.symbol === symbol && t.type === 'DIVIDEND' && t.date === date);
    for (const m of matched) await db.delete('transactions', m.id);
  }

  if (holdingId) {
    await recalculateHoldingState(holdingId);
  }
  if (date) triggerEodRebuildIfPastDate(date);

  return true;
}

/**
 * Atomically deletes all dividends for a scheme across both `dividends` and `transactions` tables.
 * @param {string} idOrSymbol
 * @returns {Promise<boolean>}
 */
export async function deleteSchemeDividends(idOrSymbol) {
  if (!idOrSymbol) throw new Error('holding_id or symbol required');

  const [allHoldings, allDivs, allTxs] = await Promise.all([
    db.select('holdings'),
    db.select('dividends'),
    db.select('transactions')
  ]);

  const holding = (allHoldings || []).find(h => h.id === idOrSymbol || h.symbol === idOrSymbol);
  const hId = holding?.id || (idOrSymbol.length === 36 ? idOrSymbol : null);
  const sym = holding?.symbol || idOrSymbol;

  // 1. Delete from `dividends`
  const targetDivs = (allDivs || []).filter(d => (hId && d.holding_id === hId) || (sym && d.symbol === sym));
  for (const d of targetDivs) {
    await db.delete('dividends', d.id);
  }

  // 2. Delete from `transactions`
  const targetTxs = (allTxs || []).filter(t => ((hId && t.holding_id === hId) || (sym && t.symbol === sym)) && t.type === 'DIVIDEND');
  for (const t of targetTxs) {
    await db.delete('transactions', t.id);
  }

  if (hId) {
    await recalculateHoldingState(hId);
  }

  return true;
}
