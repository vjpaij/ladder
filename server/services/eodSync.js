import fs from 'fs';
import path from 'path';
import { fork } from 'child_process';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { getLastTradingDay, getYesterdayIST } from './marketCalendar.js';

/**
 * Fast in-process synchronous cascade of portfolio_eod_logs.json when any bank,
 * EPF, loan, or credit card transaction is added, updated, or removed for a past date.
 * Replays all transaction deltas day-by-day in < 15ms so /api/daily-pnl and all charts
 * update dynamically and instantly without waiting for a multi-second background script.
 */
export async function fastCascadeEodLogs(txDate) {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!txDate || String(txDate).slice(0, 10) >= todayStr) return;

    const eodPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
    if (!fs.existsSync(eodPath)) return;

    const logs = JSON.parse(fs.readFileSync(eodPath, 'utf-8'));
    if (!Array.isArray(logs) || logs.length === 0) return;

    const allTxs = await db.select('transactions');
    const allHoldings = await db.select('holdings');
    const allLiabilities = await db.select('liabilities');

    const hMap = new Map((allHoldings || []).map(h => [h.id, h]));
    const lMap = new Map((allLiabilities || []).map(l => [l.id, l]));

    // Group transactions by date
    const txsByDate = new Map();
    (allTxs || []).forEach(t => {
      const d = (t.date || '').slice(0, 10);
      if (d) {
        const arr = txsByDate.get(d) || [];
        arr.push(t);
        txsByDate.set(d, arr);
      }
    });

    const baseCutoff = '2026-08-07';
    const lastExcelLog = logs.find(l => l.date === baseCutoff);
    if (!lastExcelLog) return;

    let curHdfc = Number(lastExcelLog.hdfc || 0);
    let curIndusind = Number(lastExcelLog.indusind || 0);
    let curIdfc = Number(lastExcelLog.idfc || 0);
    let curRbl = Number(lastExcelLog.rbl || 0);
    let curSbi = Number(lastExcelLog.sbi || 0);
    let curFederal = Number(lastExcelLog.federal || 0);
    let curEpf = Number(lastExcelLog.epf || 0);
    let curLoan = Number(lastExcelLog.loan || 0);
    let curCredits = Number(lastExcelLog.credits || 0);

    const baselineCardTxs = (allTxs || []).filter(t => t.date <= baseCutoff && (
      t.liability_id === '00000000-0000-0000-0000-000000000011' ||
      t.symbol === 'ICICI-AMAZON-CC' ||
      (t.name || '').includes('Amazon Card')
    ));
    if (baselineCardTxs.length > 0) {
      let cardSum = 0;
      baselineCardTxs.forEach(t => {
        const amt = Number(t.total_amount) || Number(t.price) || 0;
        const type = (t.type || '').toUpperCase();
        if (['OPENING_BALANCE', 'BORROW', 'DISBURSEMENT', 'CHARGE', 'EXPENSE', 'BUY'].includes(type)) {
          cardSum += amt;
        } else if (['EMI_PAYMENT', 'PREPAYMENT', 'PAYMENT', 'REPAYMENT', 'PAY', 'SELL'].includes(type)) {
          cardSum -= amt;
        }
      });
      if (cardSum > 0) curCredits = Number(cardSum.toFixed(2));
    }

    // Map logs by date for in-place update
    const logIndexMap = new Map();
    logs.forEach((l, idx) => logIndexMap.set(l.date, idx));

    let curDate = new Date(`${baseCutoff}T00:00:00Z`);
    const yesterdayStr = logs[logs.length - 1].date < todayStr ? logs[logs.length - 1].date : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const endDate = new Date(`${yesterdayStr}T00:00:00Z`);

    const updatedLogs = [];

    while (true) {
      curDate.setUTCDate(curDate.getUTCDate() + 1);
      if (curDate > endDate) break;
      const dStr = curDate.toISOString().slice(0, 10);

      const todayTxs = txsByDate.get(dStr) || [];
      todayTxs.forEach(t => {
        const amt = Number(t.total_amount) || Number(t.price) || 0;
        const type = (t.type || '').toUpperCase();
        const isPositive = ['OPENING_BALANCE', 'DEPOSIT', 'CREDIT', 'CONTRIBUTION', 'INTEREST', 'BUY'].includes(type);
        const isNegative = ['WITHDRAWAL', 'DEBIT', 'SELL'].includes(type);
        const isDebtIncr = ['OPENING_BALANCE', 'BORROW', 'DISBURSEMENT', 'CHARGE', 'EXPENSE', 'TAKE', 'BUY', 'DEBIT'].includes(type);
        const isDebtDecr = ['EMI_PAYMENT', 'PREPAYMENT', 'PAYMENT', 'REPAYMENT', 'PAY', 'SELL', 'CREDIT'].includes(type);

        if (t.holding_id) {
          const h = hMap.get(t.holding_id);
          if (h) {
            if (h.category_id === 'epf') {
              if (isPositive) curEpf += amt; else if (isNegative) curEpf -= amt;
            } else if (h.category_id === 'bank') {
              const sym = (h.symbol || h.name || '').toUpperCase();
              if (sym.includes('HDFC')) { if (isPositive) curHdfc += amt; else if (isNegative) curHdfc -= amt; }
              else if (sym.includes('INDUSIND')) { if (isPositive) curIndusind += amt; else if (isNegative) curIndusind -= amt; }
              else if (sym.includes('IDFC')) { if (isPositive) curIdfc += amt; else if (isNegative) curIdfc -= amt; }
              else if (sym.includes('RBL')) { if (isPositive) curRbl += amt; else if (isNegative) curRbl -= amt; }
              else if (sym.includes('SBI')) { if (isPositive) curSbi += amt; else if (isNegative) curSbi -= amt; }
              else if (sym.includes('FEDERAL')) { if (isPositive) curFederal += amt; else if (isNegative) curFederal -= amt; }
            }
          }
        }
        if (t.liability_id) {
          const l = lMap.get(t.liability_id);
          const isLoan = l?.category_id === 'loans' || (l?.name || '').toLowerCase().includes('loan');
          if (isLoan) {
            if (isDebtIncr) curLoan += amt; else if (isDebtDecr) curLoan -= amt;
          } else {
            if (isDebtIncr) curCredits += amt; else if (isDebtDecr) curCredits -= amt;
          }
        }
      });

      const idx = logIndexMap.get(dStr);
      if (idx !== undefined) {
        const log = logs[idx];
        const curSavings = Number((curHdfc + curIndusind + curIdfc + curRbl + curSbi + curFederal).toFixed(2));
        const curDebt = Number((curLoan + curCredits).toFixed(2));
        log.hdfc = Number(curHdfc.toFixed(2));
        log.indusind = Number(curIndusind.toFixed(2));
        log.idfc = Number(curIdfc.toFixed(2));
        log.rbl = Number(curRbl.toFixed(2));
        log.sbi = Number(curSbi.toFixed(2));
        log.federal = Number(curFederal.toFixed(2));
        log.savings = curSavings;
        log.epf = Number(curEpf.toFixed(2));
        log.loan = Number(curLoan.toFixed(2));
        log.credits = Number(curCredits.toFixed(2));
        log.debt = curDebt;

        const mfVal = Number(log.mutual_funds || 0);
        const inStocksVal = Number(log.indian_stocks || 0);
        const usStocksVal = Number(log.us_stocks || 0);
        const npsVal = Number(log.nps || 0);
        const totAssets = Number((curSavings + Number(curEpf.toFixed(2)) + mfVal + inStocksVal + usStocksVal + npsVal).toFixed(2));
        const wealth = Number((totAssets - curDebt).toFixed(2));

        log.total_assets = totAssets;
        log.wealth = wealth;
        log.total_wealth = wealth;

        const prevIdx = idx > 0 ? idx - 1 : 0;
        const prevWealth = logs[prevIdx].wealth || logs[prevIdx].total_wealth || wealth;
        const dailyPnl = Number((wealth - prevWealth).toFixed(2));
        const pnlPct = prevWealth > 0 ? Number(((dailyPnl / prevWealth) * 100).toFixed(2)) : 0;

        log.daily_pnl = dailyPnl;
        log.pnl_pct = pnlPct;

        if (dStr >= txDate) {
          updatedLogs.push(log);
        }
      }
    }

    // Save updated portfolio_eod_logs.json to disk synchronously
    fs.writeFileSync(eodPath, JSON.stringify(logs, null, 2), 'utf-8');
    console.log(`[EOD Fast-Sync] Synchronously updated portfolio_eod_logs.json from ${txDate} to ${yesterdayStr}.`);

    // Async batch upsert modified rows to Supabase pnl_history without blocking response
    if (updatedLogs.length > 0) {
      const rowsToUpsert = updatedLogs.map(l => ({
        log_date: l.date,
        total_assets_inr: l.total_assets,
        total_liabilities_inr: l.debt,
        net_worth_inr: l.wealth,
        daily_pnl_inr: l.daily_pnl,
        pnl_percentage: l.pnl_pct,
        breakdown: {
          savings: l.savings,
          mutual_funds: l.mutual_funds,
          indian_stocks: l.indian_stocks,
          us_stocks: l.us_stocks,
          nps: l.nps,
          epf: l.epf,
          loan: l.loan,
          credits: l.credits
        },
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
        updated_at: new Date().toISOString()
      }));

      supabase.from('pnl_history').upsert(rowsToUpsert, { onConflict: 'log_date' })
        .then(() => console.log(`[EOD Fast-Sync] Upserted ${rowsToUpsert.length} rows to pnl_history.`))
        .catch(err => console.warn('[EOD Fast-Sync Supabase Warning]:', err.message));
    }
  } catch (err) {
    console.warn('[EOD Fast-Sync Error]:', err.message);
  }
}

/**
 * Automatic background EOD rebuild trigger when any past-dated transaction is added, updated, or removed
 */
let _eodRebuildTimer = null;
let _earliestTxDate = null;

export function triggerEodRebuildIfPastDate(txDate) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const d = txDate ? String(txDate).slice(0, 10) : '';
  if (!d || d >= todayStr) return;

  if (!_earliestTxDate || d < _earliestTxDate) {
    _earliestTxDate = d;
  }

  if (_eodRebuildTimer) clearTimeout(_eodRebuildTimer);
  _eodRebuildTimer = setTimeout(async () => {
    const targetDate = _earliestTxDate;
    _earliestTxDate = null;
    _eodRebuildTimer = null;
    try {
      console.log(`[EOD Auto-Sync] Running debounced background cascade for ${targetDate}...`);
      await fastCascadeEodLogs(targetDate);

      const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild_portfolio_eod.mjs');
      const child = fork(scriptPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (e) {
      console.warn('[EOD Auto-Sync Warning]:', e.message);
    }
  }, 150);
}

/**
 * Check if the latest recorded EOD log is behind the last completed trading day and trigger a catch-up rebuild if needed.
 * Returns an object with status information.
 */
export async function checkAndTriggerMissedEodRebuild(options = {}) {
  const waitForCompletion = !!options.waitForCompletion;
  const yesterdayIST = getYesterdayIST();
  const lastCompletedTradingDay = getLastTradingDay(yesterdayIST, 'NSE');

  // Determine latest recorded EOD date from portfolio_eod_logs.json
  const eodPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
  let latestLogDate = null;

  if (fs.existsSync(eodPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(eodPath, 'utf-8'));
      if (Array.isArray(logs) && logs.length > 0) {
        latestLogDate = logs.reduce((latest, log) => {
          const date = String(log?.date || '');
          return date && (!latest || date > latest) ? date : latest;
        }, null);
      }
    } catch (err) {
      console.warn('[EOD Check] Failed to parse portfolio_eod_logs.json:', err.message);
    }
  }

  // Fallback to pnl_history table if file missing or empty
  if (!latestLogDate) {
    try {
      const rows = await db.select('pnl_history');
      if (Array.isArray(rows) && rows.length > 0) {
        const dates = rows.map(r => r.log_date).filter(Boolean);
        if (dates.length > 0) {
          dates.sort((a, b) => (a > b ? 1 : -1));
          latestLogDate = dates[dates.length - 1];
        }
      }
    } catch (err) {
      console.warn('[EOD Check] Failed to fetch pnl_history:', err.message);
    }
  }

  const needed = !!(latestLogDate && latestLogDate < lastCompletedTradingDay);
  const result = {
    needed,
    latestLogDate,
    lastCompletedTradingDay,
    rebuilt: false,
    triggeredAsync: false
  };

  if (!needed) {
    return result;
  }

  // Trigger rebuild via the background script
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild_portfolio_eod.mjs');
    if (waitForCompletion) {
      const child = fork(scriptPath, ['--incremental'], { stdio: 'inherit' });
      await new Promise((resolve, reject) => {
        child.on('exit', (code) => {
          if (code === 0) {
            result.rebuilt = true;
            resolve();
          } else {
            reject(new Error(`Rebuild script exited with code ${code}`));
          }
        });
        child.on('error', reject);
      });
    } else {
      const child = fork(scriptPath, ['--incremental'], { detached: true, stdio: 'ignore' });
      child.unref();
      result.triggeredAsync = true;
    }
  } catch (err) {
    console.warn('[EOD Check] Failed to trigger rebuild script:', err.message);
  }

  return result;
}
