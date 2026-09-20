import { db } from '../db.js';
import { supabase } from '../supabaseClient.js';

/**
 * Universal Chronological Position Recalculation Engine
 * 
 * Re-simulates the entire history of a holding/liability from its raw transactions.
 * When any transaction (BUY, SELL, BONUS, SPLIT, DEPOSIT, WITHDRAWAL, EMI, CHARGE)
 * is deleted, amended, or inserted, this function brings the holding into exact mathematical parity.
 */
async function fetchPagedTransactions(filterField, filterValue) {
  try {
    const allTxs = await db.select('transactions');
    if (allTxs && allTxs.length > 0) {
      return allTxs
        .filter(tx => String(tx[filterField]) === String(filterValue))
        .sort((a, b) => {
          const dDiff = (a.date || '').localeCompare(b.date || '');
          if (dDiff !== 0) return dDiff;
          return (a.created_at || '').localeCompare(b.created_at || '');
        });
    }
  } catch (e) {
    console.warn('[Recalculator] In-memory transactions read fallback:', e.message);
  }

  let allTxs = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq(filterField, filterValue)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allTxs = allTxs.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allTxs;
}

export async function recalculateHoldingState(holdingId) {
  if (!holdingId) return null;

  try {
    // 1. Check if holding exists in 'holdings' (using cached db.select)
    let holding = null;
    const allHoldings = await db.select('holdings');
    if (allHoldings && allHoldings.length > 0) {
      holding = allHoldings.find(h => String(h.id) === String(holdingId));
    }
    if (!holding) {
      const { data } = await supabase.from('holdings').select('*').eq('id', holdingId);
      if (data && data.length > 0) holding = data[0];
    }

    if (holding) {
      const categoryId = holding.category_id;

      // Handle Balance-based categories (Bank, EPF)
      if (categoryId === 'bank' || categoryId === 'epf') {
        const txs = await fetchPagedTransactions('holding_id', holdingId);

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

        const status = netBalance > 0.01 ? 'ACTIVE' : 'REDEEMED';

        await db.update('holdings', holdingId, {
          current_price: parseFloat(netBalance.toFixed(2)),
          avg_buy_price: parseFloat(netBalance.toFixed(2)),
          quantity: 1,
          status: status,
          updated_at: new Date().toISOString()
        });

        return { holdingId, type: 'balance', currentBalance: netBalance, status };
      }

      // Handle Market-based categories (Indian Equity, US Equity, Mutual Funds, NPS)
      const txs = await fetchPagedTransactions('holding_id', holdingId);

      let runningQty = 0;
      let totalBuyQty = 0;
      let totalBuyAmount = 0;
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

        if (type === 'BUY' || type === 'INVESTMENT' || type === 'INVESTMENT (SIP)') {
          runningQty += qty;
          totalBuyQty += qty;
          const buyCost = Number(tx.total_amount) > 0 ? Number(tx.total_amount) : ((qty * price) + charges);
          totalBuyAmount += buyCost;
          const isFundOrNps = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
          const lotPrice = qty > 0 ? (isFundOrNps ? (buyCost / qty) : Math.max(0, (buyCost - charges) / qty)) : price;
          openLots.push({ qty, price: lotPrice, charges, rem: qty });
        } else if (type === 'BONUS') {
          // If bonus has a positive quantity, add to runningQty at 0 cost
          if (qty > 0) {
            runningQty += qty;
            totalBuyQty += qty;
            openLots.push({ qty, price: 0, charges: 0, rem: qty });
          }
        } else if (type === 'SPLIT') {
          // If split has explicit added quantity (user-added or reconstructed split), adjust runningQty and lots
          if (qty > 0 && runningQty > 0) {
            const preQty = runningQty;
            runningQty += qty;
            totalBuyQty += qty;
            const ratio = runningQty / preQty;
            for (const lot of openLots) {
              lot.rem *= ratio;
              lot.qty *= ratio;
              lot.price /= ratio;
            }
          }
        } else if (type === 'SELL' || type === 'REDEEM' || type === 'REDEMPTION') {
          totalSellQty += qty;
          let remToSell = qty;
          let costOfSoldLots = 0;
          let buyChargesOfSoldLots = 0;

          // FIFO lot matching
          for (const lot of openLots) {
            if (remToSell <= 0) break;
            if (lot.rem > 0) {
              const take = Math.min(lot.rem, remToSell);
              lot.rem -= take;
              costOfSoldLots += take * lot.price;
              if (lot.qty > 0 && (lot.charges || 0) > 0) {
                buyChargesOfSoldLots += (take / lot.qty) * lot.charges;
              }
              remToSell -= take;
            }
          }

          const proceeds = (qty * price) - charges;
          const pnl = proceeds - costOfSoldLots - buyChargesOfSoldLots;
          totalRealizedPnl += pnl;
          runningQty = Math.max(0, runningQty - qty);
        }
      }

      // Epsilon clamp for fractional liquidation rounding (e.g. mutual funds)
      if (Math.abs(runningQty) < 0.005) {
        runningQty = 0;
      }

      // Compute weighted average cost basis of remaining open lots
      const activeLots = openLots.filter(l => l.rem > 0);
      let totalCostBasis = 0;
      let totalOpenShares = 0;

      for (const lot of activeLots) {
        totalCostBasis += lot.rem * lot.price;
        if (lot.qty > 0 && (lot.charges || 0) > 0) {
          totalCostBasis += (lot.rem / lot.qty) * lot.charges;
        }
        totalOpenShares += lot.rem;
      }

      const avgBuyPrice = totalOpenShares > 0 
        ? (totalCostBasis / totalOpenShares) 
        : (totalBuyQty > 0 ? (totalBuyAmount / totalBuyQty) : 0);
      const status = runningQty > 0.0001 ? 'ACTIVE' : 'REDEEMED';

      // Fetch and add credited dividends for this holding to strictly enforce:
      // Realized P&L = Sell - Buy - Charges + Dividends
      let totalDividends = 0;
      let divRows = [];
      try {
        const allDivs = await db.select('dividends');
        divRows = (allDivs || []).filter(d => 
          String(d.holding_id) === String(holdingId) || (d.symbol && d.symbol === holding.symbol)
        );
      } catch (e) {
        const { data } = await supabase
          .from('dividends')
          .select('payment_date, ex_date, amount_inr, amount_original, fx_rate')
          .or(`holding_id.eq.${holdingId},symbol.eq.${holding.symbol}`);
        divRows = data || [];
      }

      const divTxs = (txs || []).filter(t => t.type === 'DIVIDEND');
      const matchedTxIds = new Set();

      if (divRows && divRows.length > 0) {
        for (const d of divRows) {
          const dDate = d.payment_date || d.ex_date;
          const dAmt = Number(d.amount_original || d.amount_inr || 0);
          const matched = divTxs.find(t =>
            !matchedTxIds.has(t.id) &&
            t.date === dDate &&
            Math.abs((Number(t.total_amount) || Number(t.price)) - dAmt) < 0.05
          );
          if (matched) matchedTxIds.add(matched.id);

          if (holding.currency === 'USD') {
            totalDividends += Number(d.amount_original || (Number(d.amount_inr) / (Number(d.fx_rate) || 1)) || 0);
          } else {
            totalDividends += Number(d.amount_inr || d.amount_original || 0);
          }
        }
      }

      // Add any orphan dividend transactions from transactions table
      for (const t of divTxs) {
        if (!matchedTxIds.has(t.id)) {
          const amt = Number(t.total_amount) || Number(t.price) || 0;
          totalDividends += amt;
        }
      }

      totalRealizedPnl += totalDividends;

      await db.update('holdings', holdingId, {
        quantity: parseFloat(runningQty.toFixed(9)),
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
    let liability = null;
    const allLiabilities = await db.select('liabilities');
    if (allLiabilities && allLiabilities.length > 0) {
      liability = allLiabilities.find(l => String(l.id) === String(holdingId));
    }
    if (!liability) {
      const { data } = await supabase.from('liabilities').select('*').eq('id', holdingId);
      if (data && data.length > 0) liability = data[0];
    }

    if (liability) {
      const txs = await fetchPagedTransactions('liability_id', holdingId);

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
