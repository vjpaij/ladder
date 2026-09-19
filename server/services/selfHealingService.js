import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { getHistoricalFxRate, getPersistedRate } from './fxRateStore.js';
import { recalculateHoldingState } from './recalculator.js';
import { 
  fetchStockQuote, 
  fetchMutualFundNav, 
  fetchNpsNavFallback, 
  syncAllMissingNavs 
} from './priceEngine.js';

/**
 * Background Self-Healing Service
 * 
 * Automatically checks for data gaps and corrects them once fresh data is available:
 * 1. Transaction FX Rate Healing: Resolves missing or 0 FX rates for past USD transactions
 *    using verified historical FX rates, re-simulating the affected holding state.
 * 2. Missing Holding Price Healing: Resolves missing/zero current_price on active holdings
 *    by attempting live price fetches from official exchanges/APIs.
 * 3. NAV Gap Synchronization: Backfills any missing daily NAVs across NPS and Mutual Funds.
 */

export async function healTransactionFxRates() {
  const healedCount = { updated: 0, holdingsRecalculated: 0 };
  try {
    const allTxs = await db.select('transactions');
    const usTxs = allTxs.filter(t => t.currency === 'USD' && t.date);

    const affectedHoldingIds = new Set();

    for (const tx of usTxs) {
      const currentRate = Number(tx.fx_rate) || 0;
      // If fx_rate is missing or 0
      if (currentRate <= 0) {
        const accurateRate = getHistoricalFxRate(tx.date) || getPersistedRate('USD_INR');
        if (accurateRate && accurateRate > 0) {
          console.log(`[Self-Healing] Healing missing FX rate for TX ${tx.id} (${tx.symbol} on ${tx.date}): -> ${accurateRate}`);
          await db.update('transactions', tx.id, { fx_rate: accurateRate });
          healedCount.updated++;
          if (tx.holding_id) affectedHoldingIds.add(tx.holding_id);
        }
      }
    }

    if (affectedHoldingIds.size > 0) {
      for (const hid of affectedHoldingIds) {
        try {
          await recalculateHoldingState(hid);
          healedCount.holdingsRecalculated++;
        } catch (e) {
          console.warn(`[Self-Healing] Recalculate holding ${hid} warning:`, e.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Self-Healing] Transaction FX healing warning:', err.message);
  }

  return healedCount;
}

export async function healMissingHoldingPrices() {
  const healedCount = { updated: 0 };
  try {
    const holdings = await db.select('holdings');
    const unpriced = holdings.filter(h => h.status === 'ACTIVE' && (!h.current_price || Number(h.current_price) <= 0));

    for (const h of unpriced) {
      let freshPrice = null;
      try {
        if (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') {
          const quote = await fetchStockQuote(h.symbol, h.category_id === 'in_stocks' ? (h.exchange || 'NSE') : 'NASDAQ');
          if (quote && quote.price && quote.price > 0) {
            freshPrice = quote.price;
          }
        } else if (h.category_id === 'mutual_funds') {
          const mf = await fetchMutualFundNav(h.symbol);
          if (mf && mf.nav && mf.nav > 0) {
            freshPrice = mf.nav;
          }
        } else if (h.category_id === 'nps') {
          const nps = await fetchNpsNavFallback(h.symbol);
          if (nps && nps.nav && nps.nav > 0) {
            freshPrice = nps.nav;
          }
        }

        if (freshPrice && freshPrice > 0) {
          console.log(`[Self-Healing] Healed missing price for ${h.symbol}: -> ${freshPrice}`);
          await db.update('holdings', h.id, { current_price: freshPrice, updated_at: new Date().toISOString() });
          healedCount.updated++;
        }
      } catch (err) {
        console.warn(`[Self-Healing] Price fetch warning for ${h.symbol}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[Self-Healing] Holding price healing warning:', err.message);
  }

  return healedCount;
}

/**
 * Runs all self-healing routines in sequence
 */
export async function runComprehensiveSelfHealing() {
  console.log('[Self-Healing Service] Starting comprehensive self-healing scan...');
  const txHeal = await healTransactionFxRates();
  const priceHeal = await healMissingHoldingPrices();
  let navHeal = null;
  try {
    navHeal = await syncAllMissingNavs();
  } catch (err) {
    console.warn('[Self-Healing Service] NAV sync warning:', err.message);
  }

  console.log(`[Self-Healing Service] Completed scan. Healed FX TXs: ${txHeal.updated}, Recalculated Holdings: ${txHeal.holdingsRecalculated}, Healed Prices: ${priceHeal.updated}`);
  return {
    transactionsHealed: txHeal,
    pricesHealed: priceHeal,
    navSync: navHeal
  };
}
