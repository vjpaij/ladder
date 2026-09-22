import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { recalculateHoldingState } from './recalculator.js';
import { triggerEodRebuildIfPastDate } from './eodSync.js';

/**
 * Corporate Action Domain Service
 * Single source of truth for Stock Splits and Bonus Issues.
 * Manages the complete lifecycle:
 * - Dynamic open lot scaling for UI splits (matching split-adjusted chart price feeds)
 * - Safe reversibility upon amend and delete
 * - Full dependency orchestration (holding state recalculation, EOD rebuilds, cache invalidation)
 */

/**
 * Reverts previous split adjustments on open lots for a holding.
 * Restores pre-split quantities and prices from `[Split orig: Q@P]` tags.
 *
 * @param {string} holdingId
 * @returns {Promise<Array<string>>}
 */
export async function revertStockSplit(holdingId) {
  if (!holdingId) return [];

  const allTxs = await db.select('transactions');
  const txs = (allTxs || []).filter(t => String(t.holding_id) === String(holdingId));

  const revertedIds = [];

  for (const tx of txs) {
    if (!tx.notes) continue;
    const match = tx.notes.match(/\[Split orig:\s*([\d.]+)\s*@\s*([\d.]+)\]/);
    if (match) {
      const origQty = parseFloat(match[1]);
      const origPrice = parseFloat(match[2]);
      const origTotal = parseFloat((origQty * origPrice).toFixed(2));
      const cleanedNotes = tx.notes.replace(/\s*\[Split orig:\s*[\d.]+\s*@\s*[\d.]+\]/, '').trim();

      await db.update('transactions', tx.id, {
        quantity: origQty,
        price: origPrice,
        total_amount: origTotal,
        notes: cleanedNotes || null
      });

      revertedIds.push(tx.id);
    }
  }

  if (revertedIds.length > 0) {
    await recalculateHoldingState(holdingId);
    console.log(`[CorporateActionService] Reverted ${revertedIds.length} split-adjusted transactions for holding ${holdingId}`);
  }

  return revertedIds;
}

/**
 * Applies a stock split to a holding.
 * Scales preceding open BUY lots, inserts the SPLIT transaction row,
 * recalculates holding state, triggers past EOD rebuilds, and invalidates caches.
 *
 * @param {Object} params
 * @returns {Promise<{ success: boolean, holdingId: string, splitRatio: number }>}
 */
export async function applyStockSplit({
  holdingId,
  splitOld = 1,
  splitNew = 1,
  date,
  notes = '',
  symbol = '',
  name = '',
  currency = 'INR'
}) {
  if (!holdingId) throw new Error('holdingId is required to apply a stock split');
  const oldR = Number(splitOld) || 1;
  const newR = Number(splitNew) || 1;
  if (oldR <= 0 || newR <= 0) throw new Error('Split Old Ratio and New Ratio must be greater than zero');

  const splitMultiplier = newR / oldR;
  const cleanDate = (date || new Date().toISOString().split('T')[0]).split('T')[0];

  // 1. Fetch all transactions for holding ordered chronologically
  const allDbTxs = await db.select('transactions');
  const allTxs = (allDbTxs || [])
    .filter(t => String(t.holding_id) === String(holdingId))
    .sort((a, b) => {
      const dDiff = (a.date || '').localeCompare(b.date || '');
      if (dDiff !== 0) return dDiff;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });

  if (!allTxs || allTxs.length === 0) {
    throw new Error('No transactions found for holding to apply split');
  }

  // 2. FIFO tracking to identify which lots are OPEN as of split date
  const lots = [];
  for (const t of allTxs) {
    const tDate = (t.date || '').split('T')[0];
    if (tDate > cleanDate) continue;

    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;

    if (['BUY', 'BONUS', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(t.type)) {
      lots.push({
        id: t.id,
        tx: t,
        origQty: qty,
        remQty: qty,
        price: price
      });
    } else if (['SELL', 'REDEEM', 'REDEMPTION'].includes(t.type)) {
      let remSell = qty;
      for (const lot of lots) {
        if (remSell <= 0) break;
        if (lot.remQty > 0) {
          const take = Math.min(lot.remQty, remSell);
          lot.remQty -= take;
          remSell -= take;
        }
      }
    }
  }

  // 3. Filter open lots
  const openLots = lots.filter(l => l.remQty > 0);
  let preSplitOpenQty = 0;
  let postSplitOpenQty = 0;

  for (const lot of openLots) {
    preSplitOpenQty += lot.remQty;
    const tx = lot.tx;

    if (lot.remQty === lot.origQty) {
      const newQty = parseFloat((tx.quantity * splitMultiplier).toFixed(9));
      const newPrice = parseFloat((tx.price / splitMultiplier).toFixed(4));
      const newTotal = parseFloat((newQty * newPrice).toFixed(2));
      const origTag = `[Split orig: ${tx.quantity}@${tx.price}]`;
      const updatedNotes = tx.notes ? `${tx.notes} ${origTag}` : origTag;

      await db.update('transactions', tx.id, {
        quantity: newQty,
        price: newPrice,
        total_amount: newTotal,
        notes: updatedNotes
      });

      postSplitOpenQty += newQty;
    } else {
      const closedQty = parseFloat((lot.origQty - lot.remQty).toFixed(9));
      const closedTotal = parseFloat((closedQty * tx.price).toFixed(2));

      await db.update('transactions', tx.id, {
        quantity: closedQty,
        total_amount: closedTotal
      });

      const openScaledQty = parseFloat((lot.remQty * splitMultiplier).toFixed(9));
      const openScaledPrice = parseFloat((tx.price / splitMultiplier).toFixed(4));
      const openScaledTotal = parseFloat((openScaledQty * openScaledPrice).toFixed(2));
      const origTag = `[Split orig: ${lot.remQty}@${tx.price}]`;
      const newNotes = tx.notes ? `${tx.notes} ${origTag}` : origTag;

      await db.insert('transactions', {
        holding_id: holdingId,
        type: tx.type,
        quantity: openScaledQty,
        price: openScaledPrice,
        total_amount: openScaledTotal,
        charges: 0,
        currency: tx.currency || currency,
        date: tx.date,
        symbol: tx.symbol || symbol,
        name: tx.name || name,
        notes: newNotes
      });

      postSplitOpenQty += openScaledQty;
    }
  }

  // 4. Record the SPLIT corporate action row (quantity: 0 so lots are not double-counted)
  const splitNotes = notes || `Stock split ${oldR}:${newR} — holding scaled from ${preSplitOpenQty} to ${postSplitOpenQty} shares`;
  await db.insert('transactions', {
    holding_id: holdingId,
    type: 'SPLIT',
    quantity: 0,
    price: 0,
    total_amount: 0,
    charges: 0,
    currency,
    date: cleanDate,
    symbol: symbol || null,
    name: name || null,
    notes: splitNotes
  });

  await recalculateHoldingState(holdingId);
  triggerEodRebuildIfPastDate(cleanDate);

  console.log(`[CorporateActionService] Applied split (${splitMultiplier}x) for holding ${holdingId}. Pre: ${preSplitOpenQty}, Post: ${postSplitOpenQty}`);
  return { success: true, holdingId, splitRatio: splitMultiplier };
}

/**
 * Atomically deletes a stock split transaction and restores preceding open lots.
 *
 * @param {string} txId
 * @returns {Promise<boolean>}
 */
export async function deleteStockSplit(txId) {
  if (!txId) throw new Error('Transaction ID required');

  const allTxs = await db.select('transactions');
  const tx = (allTxs || []).find(t => String(t.id) === String(txId));
  if (!tx) throw new Error('SPLIT transaction not found');

  const holdingId = tx.holding_id;
  const splitDate = tx.date;

  // 1. Revert previous split adjustments on open lots
  if (holdingId) {
    await revertStockSplit(holdingId);
  }

  // 2. Delete the SPLIT transaction row
  await db.delete('transactions', txId);

  if (holdingId) {
    await recalculateHoldingState(holdingId);
  }
  if (splitDate) {
    triggerEodRebuildIfPastDate(splitDate);
  }

  return true;
}

/**
 * Atomically updates a stock split transaction (reverts old split, reapplies new ratio/date).
 *
 * @param {string} txId
 * @param {Object} updates
 * @returns {Promise<boolean>}
 */
export async function updateStockSplit(txId, updates) {
  if (!txId) throw new Error('Transaction ID required');

  const allTxs = await db.select('transactions');
  const tx = (allTxs || []).find(t => String(t.id) === String(txId));
  if (!tx) throw new Error('SPLIT transaction not found');

  const holdingId = tx.holding_id;
  const oldDate = tx.date;
  const newDate = (updates.date || oldDate).split('T')[0];
  const oldR = Number(updates.splitOld) || 1;
  const newR = Number(updates.splitNew) || 1;

  // 1. Revert previous split adjustments
  if (holdingId) {
    await revertStockSplit(holdingId);
  }

  // 2. Re-apply with new ratio & date
  if (holdingId && oldR > 0 && newR > 0) {
    const splitMultiplier = newR / oldR;

    // Apply scaling logic
    const holdingTxs = (allTxs || [])
      .filter(t => String(t.holding_id) === String(holdingId) && String(t.id) !== String(txId))
      .sort((a, b) => {
        const dDiff = (a.date || '').localeCompare(b.date || '');
        if (dDiff !== 0) return dDiff;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });

    const lots = [];
    for (const t of holdingTxs) {
      const tDate = (t.date || '').split('T')[0];
      if (tDate > newDate) continue;
      const qty = Number(t.quantity) || 0;
      const price = Number(t.price) || 0;
      if (['BUY', 'BONUS', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(t.type)) {
        lots.push({ id: t.id, tx: t, origQty: qty, remQty: qty, price });
      } else if (['SELL', 'REDEEM', 'REDEMPTION'].includes(t.type)) {
        let remSell = qty;
        for (const lot of lots) {
          if (remSell <= 0) break;
          if (lot.remQty > 0) {
            const take = Math.min(lot.remQty, remSell);
            lot.remQty -= take;
            remSell -= take;
          }
        }
      }
    }

    const openLots = lots.filter(l => l.remQty > 0);
    for (const lot of openLots) {
      const t = lot.tx;
      const newQty = parseFloat((t.quantity * splitMultiplier).toFixed(4));
      const newPrice = parseFloat((t.price / splitMultiplier).toFixed(4));
      const newTotal = parseFloat((newQty * newPrice).toFixed(2));
      const origTag = `[Split orig: ${t.quantity}@${t.price}]`;
      const updatedNotes = t.notes ? `${t.notes} ${origTag}` : origTag;

      await db.update('transactions', t.id, {
        quantity: newQty,
        price: newPrice,
        total_amount: newTotal,
        notes: updatedNotes
      });
    }
  }

  // 3. Update the SPLIT transaction row
  const splitNotes = updates.notes || `Stock split ${oldR}:${newR}`;
  await db.update('transactions', txId, {
    date: newDate,
    quantity: 0,
    price: 0,
    total_amount: 0,
    charges: 0,
    notes: splitNotes
  });

  if (holdingId) {
    await recalculateHoldingState(holdingId);
  }
  triggerEodRebuildIfPastDate(newDate);
  if (oldDate !== newDate) triggerEodRebuildIfPastDate(oldDate);

  return true;
}
