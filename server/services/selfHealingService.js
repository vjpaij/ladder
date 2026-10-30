import fs from 'fs';
import path from 'path';
import { fork } from 'child_process';
import axios from 'axios';
import db, { updateCacheRow } from '../db.js';
import { supabase } from '../supabaseClient.js';
import { getHistoricalFxRate, getHistoricalFxRatesMap, recordDailyFxRate, getPersistedRate } from './fxRateStore.js';
import { recalculateHoldingState } from './recalculator.js';
import { triggerEodRebuildIfPastDate } from './eodSync.js';
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
 * Universal Multi-Asset Historical Price & NAV Self-Healing Engine
 *
 * Audits recent trading sessions (last 10 trading days) for all held & recently-traded assets:
 * - Indian Stocks: Reconciles against official Yahoo Finance NSE / BSE candle closes (quote.close)
 * - US Stocks: Reconciles against official Yahoo Finance closes (quote.close)
 * - Mutual Funds: Reconciles against authoritative AMFI historical NAVs
 *
 * Replaces both:
 * 1. Multi-month fallback spikes (e.g., meta.chartPreviousClose from 3 months ago)
 * 2. Stale single-day carry-forward freezes (where day T was temporarily carried forward from T-1
 *    and daily deltas were <= 10%)
 */
export async function healRecentHistoricalPrices(options = {}) {
  const result = { updated: 0, updatedSymbols: [], updatedDates: [] };
  try {
    const hpPath = path.join(process.cwd(), 'data', 'historical_prices.json');
    if (!fs.existsSync(hpPath)) return result;

    const hp = JSON.parse(fs.readFileSync(hpPath, 'utf8'));
    const holdings = await db.select('holdings');
    const transactions = await db.select('transactions');
    const today = getTodayIST();

    // 1. Last 10 NSE Trading Days
    const nseTradingDays = [];
    const checkDate = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 25 && nseTradingDays.length < 10; i++) {
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
      const ds = checkDate.toISOString().slice(0, 10);
      if (isTradingDay(ds, 'NSE')) {
        nseTradingDays.push(ds);
      }
    }

    // 2. Last 10 NYSE Trading Days
    const nyseTradingDays = [];
    const checkNyse = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 25 && nyseTradingDays.length < 10; i++) {
      checkNyse.setUTCDate(checkNyse.getUTCDate() - 1);
      const ds = checkNyse.toISOString().slice(0, 10);
      if (isTradingDay(ds, 'NYSE')) {
        nyseTradingDays.push(ds);
      }
    }

    const cutoffDate = nseTradingDays[nseTradingDays.length - 1];
    const recentTxs = transactions.filter(t => t.date && t.date >= cutoffDate);

    const activeInHoldings = holdings.filter(h => h.category_id === 'in_stocks' && Number(h.quantity) > 0);
    const activeUsHoldings = holdings.filter(h => h.category_id === 'us_stocks' && Number(h.quantity) > 0);
    const activeMfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && Number(h.quantity) > 0);

    const allInSymbols = [...new Set([
      ...activeInHoldings.map(h => h.symbol),
      ...recentTxs.filter(t => t.symbol && !t.symbol.includes('-') && !t.symbol.includes('^')).map(t => t.symbol)
    ])].map(s => s.replace(/\.(NS|BO)$/i, ''));

    const allUsSymbols = [...new Set([
      ...activeUsHoldings.map(h => h.symbol),
      ...recentTxs.filter(t => t.currency === 'USD' && t.symbol).map(t => t.symbol)
    ])];

    const allMfCodes = [...new Set(activeMfHoldings.map(h => h.symbol))];

    let dirty = false;
    const affectedDates = new Set();
    const affectedSymbols = new Set();

    // 1. Audit Indian Equities against verified candle closes
    for (const sym of allInSymbols) {
      let officialMap = {};
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS?interval=1d&range=1mo`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
        const r = res.data?.chart?.result?.[0];
        if (r && r.timestamp) {
          const timestamps = r.timestamp;
          const quote = r.indicators?.quote?.[0];
          const adjclose = r.indicators?.adjclose?.[0]?.adjclose;
          timestamps.forEach((t, i) => {
            const d = new Date(t * 1000).toISOString().split('T')[0];
            const val = quote.close?.[i] !== null && quote.close?.[i] !== undefined ? quote.close[i] : adjclose?.[i];
            if (val > 0) officialMap[d] = Number(Number(val).toFixed(2));
          });
        }
      } catch (_) {}

      if (Object.keys(officialMap).length === 0) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.BO?interval=1d&range=1mo`;
          const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
          const r = res.data?.chart?.result?.[0];
          if (r && r.timestamp) {
            const timestamps = r.timestamp;
            const quote = r.indicators?.quote?.[0];
            const adjclose = r.indicators?.adjclose?.[0]?.adjclose;
            timestamps.forEach((t, i) => {
              const d = new Date(t * 1000).toISOString().split('T')[0];
              const val = quote.close?.[i] !== null && quote.close?.[i] !== undefined ? quote.close[i] : adjclose?.[i];
              if (val > 0) officialMap[d] = Number(Number(val).toFixed(2));
            });
          }
        } catch (_) {}
      }

      const storedSeries = hp[sym] || hp[`${sym}.NS`] || hp[`${sym}.BO`] || {};

      for (const date of nseTradingDays) {
        const official = officialMap[date];
        const stored = storedSeries[date];
        if (official && official > 0) {
          const diff = stored !== undefined ? Math.abs(stored - official) : Infinity;
          if (stored === undefined || diff > 0.05) {
            if (!hp[sym]) hp[sym] = {};
            hp[sym][date] = official;
            dirty = true;
            result.updated++;
            affectedDates.add(date);
            affectedSymbols.add(sym);
          }
        }
      }
    }

    // 2. Audit US Equities against verified candle closes
    for (const sym of allUsSymbols) {
      let officialMap = {};
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1mo`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
        const r = res.data?.chart?.result?.[0];
        if (r && r.timestamp) {
          const timestamps = r.timestamp;
          const quote = r.indicators?.quote?.[0];
          const adjclose = r.indicators?.adjclose?.[0]?.adjclose;
          timestamps.forEach((t, i) => {
            const d = new Date(t * 1000).toISOString().split('T')[0];
            const val = quote.close?.[i] !== null && quote.close?.[i] !== undefined ? quote.close[i] : adjclose?.[i];
            if (val > 0) officialMap[d] = Number(Number(val).toFixed(2));
          });
        }
      } catch (_) {}

      const storedSeries = hp[sym] || {};
      for (const date of nyseTradingDays) {
        const official = officialMap[date];
        const stored = storedSeries[date];
        if (official && official > 0) {
          const diff = stored !== undefined ? Math.abs(stored - official) : Infinity;
          if (stored === undefined || diff > 0.01) {
            if (!hp[sym]) hp[sym] = {};
            hp[sym][date] = official;
            dirty = true;
            result.updated++;
            affectedDates.add(date);
            affectedSymbols.add(sym);
          }
        }
      }
    }

    // 3. Audit Mutual Funds against official AMFI historical NAVs
    for (const code of allMfCodes) {
      let officialMap = {};
      try {
        const url = `https://api.mfapi.in/mf/${code}`;
        const res = await axios.get(url, { timeout: 6000 });
        if (res.data?.data && Array.isArray(res.data.data)) {
          for (const row of res.data.data.slice(0, 30)) {
            if (!row.date || !row.nav) continue;
            const [d, m, y] = row.date.split('-');
            if (d && m && y) {
              const iso = `${y}-${m}-${d}`;
              const n = parseFloat(row.nav);
              if (n > 0) officialMap[iso] = n;
            }
          }
        }
      } catch (_) {}

      const storedSeries = hp[code] || {};
      for (const date of nseTradingDays) {
        const official = officialMap[date];
        const stored = storedSeries[date];
        if (official && official > 0) {
          const diff = stored !== undefined ? Math.abs(stored - official) : Infinity;
          if (stored === undefined || diff > 0.001) {
            if (!hp[code]) hp[code] = {};
            hp[code][date] = official;
            dirty = true;
            result.updated++;
            affectedDates.add(date);
            affectedSymbols.add(code);
          }
        }
      }
    }

    if (dirty) {
      fs.writeFileSync(hpPath, JSON.stringify(hp, null, 2), 'utf8');
      result.updatedDates = [...affectedDates].sort();
      result.updatedSymbols = [...affectedSymbols];
      console.log(`[Self-Healing] Reconciled and saved ${result.updated} price points across ${result.updatedSymbols.length} assets and ${result.updatedDates.length} trading days.`);

      // Trigger automatic EOD cascade when prices change for past dates
      if (options.triggerEodSync !== false && result.updatedDates.length > 0) {
        try {
          const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild_portfolio_eod.mjs');
          const child = fork(scriptPath, ['--incremental'], { stdio: 'inherit' });
          await new Promise((resolve) => {
            child.on('exit', () => resolve());
          });
        } catch (e) {
          console.warn('[Self-Healing] EOD cascade trigger warning:', e.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Self-Healing] Multi-asset historical price reconciliation warning:', err.message);
  }
  return result;
}

/**
 * Automatically audits and self-heals Mutual Fund SIP transactions in the transactions table
 * over the last 14 days against official published NAVs for each transaction's trade date.
 * If an SIP was executed with an unfinalized or prior-day NAV, this automatically corrects
 * the transaction price, unit allocation (netInvested / officialNav), notes, and triggers
 * recalculateHoldingState to maintain 100% financial ledger integrity.
 */
export async function healRecentSipTransactions() {
  const result = { audited: 0, healed: 0, details: [] };
  try {
    const transactions = await db.select('transactions');
    if (!transactions || transactions.length === 0) return result;

    const today = getTodayIST();
    // Scan past 14 days of SIP transactions
    const cutoffDate = new Date(`${today}T00:00:00Z`);
    cutoffDate.setDate(cutoffDate.getDate() - 14);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const recentSipTxs = transactions.filter(t => 
      t.type === 'BUY' &&
      (t.notes || '').includes('SIP') &&
      t.date >= cutoffStr &&
      /^\d+$/.test(t.symbol)
    );

    result.audited = recentSipTxs.length;
    if (recentSipTxs.length === 0) return result;

    const affectedHoldingIds = new Set();
    let earliestHealedDate = null;

    for (const tx of recentSipTxs) {
      try {
        const quote = await fetchMutualFundNav(tx.symbol, tx.date);
        if (!quote || !quote.nav || quote.nav <= 0) continue;

        // Parse official quote date to verify exact trade date parity
        let quoteDateISO = null;
        if (quote.date) {
          const dStr = String(quote.date).trim();
          if (/^\d{2}-\d{2}-\d{4}$/.test(dStr)) {
            const [d, m, y] = dStr.split('-');
            quoteDateISO = `${y}-${m}-${d}`;
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
            quoteDateISO = dStr;
          }
        }

        // Only heal if the quote corresponds exactly to the transaction's trade date
        if (quoteDateISO !== tx.date) continue;

        const officialNav = Number(quote.nav);
        const currentPrice = Number(tx.price);

        if (Math.abs(officialNav - currentPrice) > 0.0001) {
          const totalAmount = Number(tx.total_amount); // net invested
          const newUnits = parseFloat((totalAmount / officialNav).toFixed(4));
          const newNotes = `SIP @ NAV Rs.${officialNav.toFixed(4)}`;

          console.log(`[Self-Healing] Healing SIP transaction ${tx.id} for ${tx.name} on ${tx.date}: NAV ${currentPrice} -> ${officialNav}, Units ${tx.quantity} -> ${newUnits}`);

          // Update in Supabase
          const { error } = await supabase.from('transactions').update({
            price: officialNav,
            quantity: newUnits,
            notes: newNotes
          }).eq('id', tx.id);

          if (!error) {
            // Update in-memory dbCache
            updateCacheRow('transactions', tx.id, {
              price: officialNav,
              quantity: newUnits,
              notes: newNotes
            });

            affectedHoldingIds.add(tx.holding_id);
            if (!earliestHealedDate || tx.date < earliestHealedDate) {
              earliestHealedDate = tx.date;
            }

            result.healed++;
            result.details.push({
              id: tx.id,
              symbol: tx.symbol,
              name: tx.name,
              date: tx.date,
              oldNav: currentPrice,
              newNav: officialNav,
              oldUnits: tx.quantity,
              newUnits
            });
          } else {
            console.warn(`[Self-Healing] Failed to update SIP tx ${tx.id}:`, error.message);
          }
        }
      } catch (itemErr) {
        console.warn(`[Self-Healing] Error checking SIP tx ${tx.id}:`, itemErr.message);
      }
    }

    // Recalculate holding state for all affected mutual funds
    for (const hId of affectedHoldingIds) {
      await recalculateHoldingState(hId);
    }

    // Trigger past-date EOD rebuild if past-dated transactions were healed
    if (earliestHealedDate && earliestHealedDate < today) {
      console.log(`[Self-Healing] Triggering EOD rebuild for Calendar sync from ${earliestHealedDate}...`);
      triggerEodRebuildIfPastDate(earliestHealedDate);
    }
  } catch (err) {
    console.warn('[Self-Healing] healRecentSipTransactions error:', err.message);
  }
  return result;
}

/**
 * Runs all self-healing routines in sequence
 */

/**
 * Scans all holdings for fractional rounding dust (0 < quantity < 0.005)
 * If found, reconciles the final exit transaction to eliminate remaining dust,
 * recalculates holding state to 0 and REDEEMED, and updates Supabase and dbCache.
 */
export async function healDustFractionalHoldings() {
  const result = { healed: 0, holdings: [] };
  try {
    const allHoldings = await db.select('holdings');
    const allTxs = await db.select('transactions');

    const dustHoldings = (allHoldings || []).filter(h => {
      const q = Number(h.quantity) || 0;
      return q > 0 && q < 0.005;
    });

    for (const h of dustHoldings) {
      const hTxs = (allTxs || [])
        .filter(t => t.holding_id === h.id || (h.symbol && t.symbol === h.symbol))
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      const sellTxs = hTxs.filter(t => ['SELL', 'REDEEM', 'REDEMPTION'].includes((t.type || '').toUpperCase()));
      if (sellTxs.length === 0) continue;

      const lastSell = sellTxs[sellTxs.length - 1];
      const remainingDust = Number(h.quantity) || 0;
      const oldQty = Number(lastSell.quantity) || 0;
      const newQty = parseFloat((oldQty + remainingDust).toFixed(4));
      const price = Number(lastSell.price) || 0;
      const newTotal = parseFloat((newQty * price).toFixed(2));

      console.log(`[Self-Healing] Healing fractional dust on ${h.symbol} (${h.name}): remaining ${remainingDust} units. Aligning final sell TX ${lastSell.id} from ${oldQty} to ${newQty}`);

      await db.update('transactions', lastSell.id, {
        quantity: newQty,
        total_amount: newTotal,
        notes: (lastSell.notes ? lastSell.notes + ' | ' : '') + `Full exit liquidated (${newQty} units)`
      });

      await recalculateHoldingState(h.id);
      result.healed++;
      result.holdings.push(h.symbol);
    }
  } catch (err) {
    console.warn('[Self-Healing] healDustFractionalHoldings error:', err.message);
  }
  return result;
}

export async function runComprehensiveSelfHealing() {
  console.log('[Self-Healing Service] Starting comprehensive self-healing scan...');
  const fxHeal = await healMissingHistoricalFxRates();
  const txHeal = await healTransactionFxRates();
  const priceHeal = await healMissingHoldingPrices();
  const npsGapHeal = await healNpsNavGaps();
  const npsEodSync = await syncRecentNpsEodValuations();
  const histPriceHeal = await healRecentHistoricalPrices({ triggerEodSync: false });
  const sipHeal = await healRecentSipTransactions();
  const dustHeal = await healDustFractionalHoldings();
  let navHeal = null;
  try {
    navHeal = await syncAllMissingNavs();
  } catch (err) {
    console.warn('[Self-Healing Service] NAV sync warning:', err.message);
  }

  console.log(`[Self-Healing Service] Completed scan. Healed FX dates: ${fxHeal.updated}, FX TXs: ${txHeal.updated}, Recalculated Holdings: ${txHeal.holdingsRecalculated}, Healed Current Prices: ${priceHeal.updated}, NPS NAV Gaps: ${npsGapHeal.updated}, Historical Asset Prices: ${histPriceHeal.updated}, Healed SIP TXs: ${sipHeal.healed}`);
  return {
    fxHealed: fxHeal,
    transactionsHealed: txHeal,
    pricesHealed: priceHeal,
    historicalPricesHealed: histPriceHeal,
    npsGapHeal,
    npsEodSync,
    sipHealed: sipHeal,
    navSync: navHeal
  };
}
