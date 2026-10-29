import fs from 'fs';
import path from 'path';
import axios from 'axios';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { getHistoricalFxRate, getHistoricalFxRatesMap, recordDailyFxRate, getPersistedRate } from './fxRateStore.js';
import { recalculateHoldingState } from './recalculator.js';
import { 
  fetchStockQuote, 
  fetchMutualFundNav, 
  fetchNpsNavFallback, 
  syncAllMissingNavs,
  isTradingDay,
  getTodayIST
} from './priceEngine.js';

/**
 * Background Self-Healing Service
 * 
 * Automatically checks for data gaps and corrects them once fresh data is available:
 * 1. Historical FX Rate Backfill: Resolves any missing dates in historical_fx_rates.json.
 * 2. Transaction FX Rate Healing: Resolves missing or 0 FX rates for past USD transactions
 *    using verified historical FX rates, re-simulating the affected holding state.
 * 3. Missing Holding Price Healing: Resolves missing/zero current_price on active holdings
 *    by attempting live price fetches from official exchanges/APIs.
 * 4. NAV Gap Synchronization: Backfills any missing daily NAVs across NPS and Mutual Funds.
 */

export async function healMissingHistoricalFxRates() {
  const healedCount = { updated: 0 };
  try {
    const fxMap = getHistoricalFxRatesMap();
    const existingDates = new Set(Object.keys(fxMap));
    const today = new Date().toISOString().split('T')[0];

    // Check if recent 14 trading days have any gaps
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1d&range=1mo`;
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const result = res.data?.chart?.result?.[0];
    if (result && result.timestamp && result.indicators?.quote?.[0]) {
      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];

      timestamps.forEach((t, i) => {
        const tDate = new Date(t * 1000);
        const offsetDate = new Date(tDate.getTime() - (tDate.getTimezoneOffset() * 60000));
        const dStr = offsetDate.toISOString().split('T')[0];
        const val = quote.close[i] !== null && quote.close[i] !== undefined ? quote.close[i] : adjclose[i];

        if (val !== null && val !== undefined && !isNaN(val) && val > 0) {
          if (!existingDates.has(dStr)) {
            recordDailyFxRate(dStr, Number(Number(val).toFixed(2)));
            healedCount.updated++;
            existingDates.add(dStr);
          }
        }
      });
    }
    if (healedCount.updated > 0) {
      console.log(`[Self-Healing] Backfilled ${healedCount.updated} missing historical FX dates.`);
    }
  } catch (err) {
    console.warn('[Self-Healing] Historical FX sync warning:', err.message);
  }
  return healedCount;
}

export async function healTransactionFxRates() {
  const healedCount = { updated: 0, holdingsRecalculated: 0 };
  try {
    const allTxs = await db.select('transactions');
    const usTxs = allTxs.filter(t => t.currency === 'USD' && t.date);

    const affectedHoldingIds = new Set();

    for (const tx of usTxs) {
      const currentRate = Number(tx.fx_rate) || 0;
      // If fx_rate is missing, 0, corrupted default (46.61), or anomalously low for post-2020 (< 70)
      const isCorrupted = currentRate <= 0 || Math.abs(currentRate - 46.61) < 0.1 || (tx.date >= '2020-01-01' && currentRate < 70);
      if (isCorrupted) {
        // Try note extraction first if available
        const noteMatch = (tx.notes || '').match(/FX:\s*₹?([0-9.]+)/);
        const noteFx = noteMatch ? parseFloat(noteMatch[1]) : null;
        const accurateRate = (noteFx && noteFx > 70) ? noteFx : (getHistoricalFxRate(tx.date) || getPersistedRate('USD_INR'));
        if (accurateRate && accurateRate > 0) {
          console.log(`[Self-Healing] Healing corrupted/missing FX rate for TX ${tx.id} (${tx.symbol} on ${tx.date}): ${currentRate} -> ${accurateRate}`);
          let newNotes = tx.notes;
          if (tx.type === 'DIVIDEND' && (!tx.notes || !tx.notes.includes('FX:'))) {
            newNotes = (tx.notes ? tx.notes + ' | ' : '') + `FX: ₹${Number(accurateRate).toFixed(2)}/$`;
          }
          await db.update('transactions', tx.id, { fx_rate: Number(Number(accurateRate).toFixed(4)), notes: newNotes });
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
 * Detects and fills missing NPS NAV entries for held schemes across the last
 * 7 trading days. Uses npsnav.in as the data source and persists gaps to
 * Supabase nps_daily_navs for permanent resolution.
 *
 * This addresses the Protean CRA T+1 publication lag where NAVs for trading
 * day T are only published on T+1 (sometimes late morning), causing stale
 * carry-forward values in EOD logs that were never corrected.
 */
export async function healNpsNavGaps() {
  const healedCount = { updated: 0 };
  try {
    const holdings = await db.select('holdings');
    const npsHoldings = holdings.filter(h => h.category_id === 'nps' && Number(h.quantity) > 0 && h.symbol);
    if (npsHoldings.length === 0) return healedCount;

    const heldCodes = npsHoldings.map(h => h.symbol);
    const today = getTodayIST();

    // Collect the last 7 trading days
    const tradingDays = [];
    const checkDate = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 14 && tradingDays.length < 7; i++) {
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
      const ds = checkDate.toISOString().slice(0, 10);
      if (isTradingDay(ds, 'NSE')) {
        tradingDays.push(ds);
      }
    }
    if (tradingDays.length === 0) return healedCount;

    // Query existing NAVs for held schemes across these trading days
    const { data: existingNavs } = await supabase
      .from('nps_daily_navs')
      .select('scheme_code,nav_date')
      .in('scheme_code', heldCodes)
      .in('nav_date', tradingDays);

    const existingSet = new Set((existingNavs || []).map(r => `${r.scheme_code}_${r.nav_date}`));

    for (const code of heldCodes) {
      const missingDates = tradingDays.filter(d => !existingSet.has(`${code}_${d}`));
      if (missingDates.length === 0) continue;

      // Fetch full history from npsnav.in once for this scheme
      try {
        const res = await axios.get(`https://npsnav.in/api/historical/${code}`, { timeout: 10000 });
        if (res.data && Array.isArray(res.data.data)) {
          const navByDate = {};
          for (const item of res.data.data) {
            let isoDate = item.date;
            if (/^\d{2}-\d{2}-\d{4}$/.test(isoDate)) {
              const [d, m, y] = isoDate.split('-');
              isoDate = `${y}-${m}-${d}`;
            }
            const nav = parseFloat(item.nav);
            if (!isNaN(nav) && nav > 0) {
              navByDate[isoDate] = nav;
            }
          }

          const rowsToUpsert = [];
          for (const date of missingDates) {
            if (navByDate[date]) {
              rowsToUpsert.push({
                scheme_code: code,
                scheme_name: npsHoldings.find(h => h.symbol === code)?.name || code,
                nav: navByDate[date],
                nav_date: date
              });
            }
          }

          if (rowsToUpsert.length > 0) {
            const { error } = await supabase
              .from('nps_daily_navs')
              .upsert(rowsToUpsert, { onConflict: 'scheme_code,nav_date' });
            if (!error) {
              healedCount.updated += rowsToUpsert.length;
              console.log(`[Self-Healing] Backfilled ${rowsToUpsert.length} NPS NAV gaps for ${code}: ${rowsToUpsert.map(r => r.nav_date).join(', ')}`);
            }
          }
        }
      } catch (e) {
        console.warn(`[Self-Healing] NPS NAV gap fetch error for ${code}:`, e.message);
      }
    }

    if (healedCount.updated > 0) {
      console.log(`[Self-Healing] Total NPS NAV gaps filled: ${healedCount.updated}`);
    }
    // Automatically synchronize any past-date EOD valuations that had stale carry-forward NAVs
    await syncRecentNpsEodValuations();
  } catch (err) {
    console.warn('[Self-Healing] NPS NAV gap healing warning:', err.message);
  }
  return healedCount;
}

/**
 * Automatically synchronizes EOD logs and Supabase pnl_history for recent trading
 * days when T+1 published NPS NAVs become available.
 * Resolves the issue where day T was initially logged with stale carry-forward NAVs
 * and never updated, shifting day T's change onto day T+1 and leaving day T with 0 change.
 */
export async function syncRecentNpsEodValuations() {
  const result = { updatedDates: [] };
  try {
    const eodPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
    if (!fs.existsSync(eodPath)) return result;

    const raw = fs.readFileSync(eodPath, 'utf8');
    const logs = JSON.parse(raw);
    if (!Array.isArray(logs) || logs.length === 0) return result;

    const holdings = await db.select('holdings');
    const npsHoldings = holdings.filter(h => h.category_id === 'nps' && Number(h.quantity) > 0 && h.symbol);
    if (npsHoldings.length === 0) return result;

    const heldCodes = npsHoldings.map(h => h.symbol);
    const today = getTodayIST();

    // Inspect the last 7 trading days
    const tradingDays = [];
    const checkDate = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 14 && tradingDays.length < 7; i++) {
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
      const ds = checkDate.toISOString().slice(0, 10);
      if (isTradingDay(ds, 'NSE')) {
        tradingDays.push(ds);
      }
    }
    if (tradingDays.length === 0) return result;

    // Query nps_daily_navs for held schemes across these trading days
    const { data: navRows } = await supabase
      .from('nps_daily_navs')
      .select('scheme_code, nav, nav_date')
      .in('scheme_code', heldCodes)
      .in('nav_date', tradingDays);

    const navMap = {};
    (navRows || []).forEach(r => {
      if (!navMap[r.nav_date]) navMap[r.nav_date] = {};
      navMap[r.nav_date][r.scheme_code] = Number(r.nav);
    });

    let dirty = false;
    const sortedDays = tradingDays.slice().sort();

    for (const date of sortedDays) {
      const dayNavs = navMap[date];
      if (!dayNavs) continue;
      const allHaveNav = heldCodes.every(c => dayNavs[c] && dayNavs[c] > 0);
      if (!allHaveNav) continue;

      const expectedNps = Number(npsHoldings.reduce((sum, h) => sum + Number((Number(h.quantity) * dayNavs[h.symbol]).toFixed(2)), 0).toFixed(2));
      const logIdx = logs.findIndex(l => l.date === date);
      if (logIdx < 0) continue;

      const log = logs[logIdx];
      const currentNps = Number((log.nps || 0).toFixed(2));

      if (Math.abs(currentNps - expectedNps) > 0.005) {
        console.log(`[Self-Healing] Correcting stale NPS valuation on ${date}: ₹${currentNps} -> ₹${expectedNps} (delta: ₹${(expectedNps - currentNps).toFixed(2)})`);
        log.nps = expectedNps;
        const savings = Number(log.savings || 0);
        const epf = Number(log.epf || 0);
        const mf = Number(log.mutual_funds || 0);
        const inStocks = Number(log.indian_stocks || 0);
        const usStocks = Number(log.us_stocks || 0);
        const debt = Number((log.debt !== undefined ? log.debt : ((log.loan || 0) + (log.credits || 0))).toFixed(2));

        log.total_assets = Number((savings + epf + mf + inStocks + usStocks + expectedNps).toFixed(2));
        log.total_assets_inr = log.total_assets;
        log.wealth = Number((log.total_assets - debt).toFixed(2));
        log.total_wealth = log.wealth;
        log.net_worth_inr = log.wealth;

        // Recalculate daily_pnl
        const prevLog = logIdx > 0 ? logs[logIdx - 1] : log;
        const prevWealth = Number((prevLog.total_wealth !== undefined ? prevLog.total_wealth : (prevLog.wealth || 0)).toFixed(2));
        log.daily_pnl = Number((log.wealth - prevWealth).toFixed(2));
        log.pnl_pct = prevWealth > 0 ? Number(((log.daily_pnl / prevWealth) * 100).toFixed(2)) : 0;

        // Recalculate next day's daily_pnl if exists
        if (logIdx < logs.length - 1) {
          const nextLog = logs[logIdx + 1];
          const nextWealth = Number((nextLog.total_wealth !== undefined ? nextLog.total_wealth : (nextLog.wealth || 0)).toFixed(2));
          nextLog.daily_pnl = Number((nextWealth - log.wealth).toFixed(2));
          nextLog.pnl_pct = log.wealth > 0 ? Number(((nextLog.daily_pnl / log.wealth) * 100).toFixed(2)) : 0;
        }

        result.updatedDates.push(date);
        dirty = true;
      }
    }

    if (dirty) {
      fs.writeFileSync(eodPath, JSON.stringify(logs, null, 2), 'utf8');

      try {
        const histPath = path.join(process.cwd(), 'data', 'historical_prices.json');
        if (fs.existsSync(histPath)) {
          const hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
          (navRows || []).forEach(r => {
            if (!hist[r.scheme_code]) hist[r.scheme_code] = {};
            hist[r.scheme_code][r.nav_date] = Number(r.nav);
          });
          fs.writeFileSync(histPath, JSON.stringify(hist, null, 2), 'utf8');
        }
      } catch (_) {}

      const rowsToUpsert = logs
        .filter(l => result.updatedDates.includes(l.date) || (result.updatedDates.length > 0 && l.date > result.updatedDates[0]))
        .map(l => ({
          log_date: l.date,
          daily_pnl_inr: l.daily_pnl,
          pnl_percentage: l.pnl_pct,
          total_assets_inr: l.total_assets,
          total_liabilities_inr: l.debt,
          net_worth_inr: l.wealth,
          breakdown: {
            hdfc: l.hdfc,
            indusind: l.indusind,
            idfc: l.idfc,
            rbl: l.rbl,
            sbi: l.sbi,
            federal: l.federal,
            savings: l.savings,
            mutual_funds: l.mutual_funds,
            indian_stocks: l.indian_stocks,
            us_stocks: l.us_stocks,
            nps: l.nps,
            epf: l.epf,
            loan: l.loan,
            credits: l.credits,
            debt: l.debt
          }
        }));

      if (rowsToUpsert.length > 0) {
        const { error: upsertErr } = await supabase
          .from('pnl_history')
          .upsert(rowsToUpsert, { onConflict: 'log_date' });
        if (upsertErr) {
          console.warn('[Self-Healing] Supabase pnl_history upsert warning:', upsertErr.message);
        } else {
          console.log(`[Self-Healing] Upserted ${rowsToUpsert.length} corrected rows to Supabase pnl_history.`);
        }
      }

      db.invalidateCache('pnl_history');
    }
  } catch (err) {
    console.warn('[Self-Healing] NPS EOD valuation sync warning:', err.message);
  }
  return result;
}


/**
 * Runs all self-healing routines in sequence
 */
export async function runComprehensiveSelfHealing() {
  console.log('[Self-Healing Service] Starting comprehensive self-healing scan...');
  const fxHeal = await healMissingHistoricalFxRates();
  const txHeal = await healTransactionFxRates();
  const priceHeal = await healMissingHoldingPrices();
  const npsGapHeal = await healNpsNavGaps();
  const npsEodSync = await syncRecentNpsEodValuations();
  let navHeal = null;
  try {
    navHeal = await syncAllMissingNavs();
  } catch (err) {
    console.warn('[Self-Healing Service] NAV sync warning:', err.message);
  }

  console.log(`[Self-Healing Service] Completed scan. Healed FX dates: ${fxHeal.updated}, FX TXs: ${txHeal.updated}, Recalculated Holdings: ${txHeal.holdingsRecalculated}, Healed Prices: ${priceHeal.updated}, NPS NAV Gaps: ${npsGapHeal.updated}`);
  return {
    fxHealed: fxHeal,
    transactionsHealed: txHeal,
    pricesHealed: priceHeal,
    npsGapHeal,
    npsEodSync,
    navSync: navHeal
  };
}
