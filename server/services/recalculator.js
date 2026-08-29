import { db } from '../db.js';
import { supabase } from '../supabaseClient.js';

/**
 * Universal Chronological Position Recalculation Engine
 * 
 * Re-simulates the entire history of a holding/liability from its raw transactions.
 * When any transaction (BUY, SELL, BONUS, SPLIT, DEPOSIT, WITHDRAWAL, EMI, CHARGE)
 * is deleted, amended, or inserted, this function brings the holding into exact mathematical parity.
 */
export async function recalculateHoldingState(holdingId) {
  if (!holdingId) return null;

  try {
    // 1. Check if holding exists in 'holdings'
    const { data: holdingRows } = await supabase
      .from('holdings')
      .select('*')
      .eq('id', holdingId);

    if (holdingRows && holdingRows.length > 0) {
      const holding = holdingRows[0];
      const categoryId = holding.category_id;

      // Handle Balance-based categories (Bank, EPF)
      if (categoryId === 'bank' || categoryId === 'epf') {
        const { data: txs } = await supabase
          .from('transactions')
          .select('*')
          .eq('holding_id', holdingId)
          .order('date', { ascending: true })
          .order('created_at', { ascending: true });

        let netBalance = 0;
        let lastDate = holding.updated_at;

        if (txs && txs.length > 0) {
          for (const tx of txs) {
            const amt = Number(tx.total_amount) || Number(tx.price) || 0;
            const type = (tx.type || '').toUpperCase();

            if (['OPENING_BALANCE', 'DEPOSIT', 'CREDIT', 'CONTRIBUTION', 'INTEREST', 'BUY'].includes(type)) {
              netBalance += amt;
            } else if (['WITHDRAWAL', 'DEBIT', 'SELL'].includes(type)) {
              netBalance -= amt;
            }
            if (tx.date) lastDate = tx.date;
          }
        } else {
          netBalance = Number(holding.current_price) || 0;
        }

        netBalance = Math.max(0, netBalance);

        await db.update('holdings', holdingId, {
          current_price: parseFloat(netBalance.toFixed(2)),
          avg_buy_price: parseFloat(netBalance.toFixed(2)),
          quantity: 1,
          updated_at: new Date().toISOString()
        });

        return { holdingId, type: 'balance', currentBalance: netBalance };
      }

      // Handle Market-based categories (Indian Equity, US Equity, Mutual Funds, NPS)
      const { data: txs } = await supabase
        .from('transactions')
        .select('*')
        .eq('holding_id', holdingId)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      let runningQty = 0;
      let totalBuyQty = 0;
      let totalSellQty = 0;
      let totalCharges = 0;
      let totalRealizedPnl = 0;
      let openLots = []; // FIFO Queue of { qty, price, charges }

      for (const tx of (txs || [])) {
        const type = (tx.type || 'BUY').toUpperCase();
        const qty = Number(tx.quantity) || 0;
        const price = Number(tx.price) || 0;
        const charges = Number(tx.charges) || 0;
        totalCharges += charges;

        if (type === 'BUY') {
          runningQty += qty;
          totalBuyQty += qty;
          openLots.push({ qty, price, charges, rem: qty });
        } else if (type === 'BONUS') {
          // Bonus issues credit shares at ₹0 cost, diluting cost basis
          runningQty += qty;
          totalBuyQty += qty;
          openLots.push({ qty, price: 0, charges: 0, rem: qty });
        } else if (type === 'SPLIT') {
          // Extract split ratio from notes (e.g. "Stock split 1:10")
          let ratio = 1;
          const match = (tx.notes || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
          if (match) {
            const oldR = parseFloat(match[1]);
            const newR = parseFloat(match[2]);
            if (oldR > 0) ratio = newR / oldR;
          } else if (tx.quantity > 0 && runningQty > 0) {
            ratio = (runningQty + tx.quantity) / runningQty;
          }

          if (ratio > 0 && ratio !== 1) {
            runningQty = runningQty * ratio;
            totalBuyQty = totalBuyQty * ratio;
            for (const lot of openLots) {
              lot.rem = lot.rem * ratio;
              lot.qty = lot.qty * ratio;
              lot.price = lot.price / ratio;
            }
          }
        } else if (type === 'SELL' || type === 'REDEEM') {
          totalSellQty += qty;
          let remToSell = qty;
          let costOfSoldLots = 0;

          // FIFO lot matching
          for (const lot of openLots) {
            if (remToSell <= 0) break;
            if (lot.rem > 0) {
              const take = Math.min(lot.rem, remToSell);
              lot.rem -= take;
              costOfSoldLots += take * lot.price;
              remToSell -= take;
            }
          }

          const proceeds = (qty * price) - charges;
          const pnl = proceeds - costOfSoldLots;
          totalRealizedPnl += pnl;
          runningQty = Math.max(0, runningQty - qty);
        }
      }

      // Compute weighted average cost basis of remaining open lots
      const activeLots = openLots.filter(l => l.rem > 0);
      let totalCostBasis = 0;
      let totalOpenShares = 0;

      for (const lot of activeLots) {
        totalCostBasis += lot.rem * lot.price;
        totalOpenShares += lot.rem;
      }

      const avgBuyPrice = totalOpenShares > 0 ? (totalCostBasis / totalOpenShares) : 0;
      const status = runningQty > 0.0001 ? 'ACTIVE' : 'REDEEMED';

      await db.update('holdings', holdingId, {
        quantity: parseFloat(runningQty.toFixed(4)),
        buy_qty: parseFloat(totalBuyQty.toFixed(4)),
        sell_qty: parseFloat(totalSellQty.toFixed(4)),
        avg_buy_price: parseFloat(avgBuyPrice.toFixed(4)),
        realized_pnl: parseFloat(totalRealizedPnl.toFixed(2)),
        total_charges: parseFloat(totalCharges.toFixed(2)),
        status: status,
        updated_at: new Date().toISOString()
      });

      return {
        holdingId,
        type: 'market',
        quantity: runningQty,
        avgBuyPrice,
        realizedPnl: totalRealizedPnl,
        status
      };
    }

    // 2. Check if liability exists in 'liabilities' (Loans, Credit Cards)
    const { data: liabilityRows } = await supabase
      .from('liabilities')
      .select('*')
      .eq('id', holdingId);

    if (liabilityRows && liabilityRows.length > 0) {
      const liability = liabilityRows[0];
      const { data: txs } = await supabase
        .from('transactions')
        .select('*')
        .eq('liability_id', holdingId)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      let netDebt = 0;

      if (txs && txs.length > 0) {
        for (const tx of txs) {
          const amt = Number(tx.total_amount) || Number(tx.price) || 0;
          const type = (tx.type || '').toUpperCase();

          if (['OPENING_BALANCE', 'BORROW', 'DISBURSEMENT', 'CHARGE', 'EXPENSE', 'TAKE'].includes(type)) {
            netDebt += amt;
          } else if (['EMI_PAYMENT', 'PREPAYMENT', 'BILL_PAYMENT', 'REPAYMENT', 'PAY'].includes(type)) {
            netDebt -= amt;
          }
        }
      } else {
        // No transactions exist -- preserve existing principal as outstanding
        netDebt = Number(liability.total_principal) || Number(liability.outstanding_balance) || 0;
      }

      netDebt = Math.max(0, netDebt);

      await db.update('liabilities', holdingId, {
        outstanding_balance: parseFloat(netDebt.toFixed(2)),
        updated_at: new Date().toISOString()
      });

      return { holdingId, type: 'liability', outstandingBalance: netDebt };
    }

    return null;
  } catch (err) {
    console.error(`[Recalculator Error for holding ${holdingId}]:`, err.message);
    throw err;
  }
}
