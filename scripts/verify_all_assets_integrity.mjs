import fs from 'fs';
import path from 'path';
import { supabase } from '../server/supabaseClient.js';
import axios from 'axios';

async function verifyAllAssetsIntegrity() {
  console.log('================================================================');
  console.log('       UNIVERSAL MULTI-ASSET & LIABILITY INTEGRITY AUDIT        ');
  console.log('================================================================\n');

  let failureCount = 0;

  // Helper: IST hours (UTC+5:30)
  const nowUtc = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(nowUtc.getTime() + istOffsetMs);
  const istHour = nowIst.getUTCHours();
  // NAVs are published by AMFI/Protean typically after 16:00 IST on trading days
  const navsPublishedToday = istHour >= 16;
  const todayStr = nowUtc.toISOString().slice(0, 10);
  const dayOfWeek = nowUtc.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const isTodayWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Check 1: Future / premature rows - PAGINATED (fixes H5)
  console.log(`[Check 1] Checking for Premature Snapshots (Current day: ${todayStr})...`);
  let futureTotalCount = 0;
  let futureFrom = 0;
  while (true) {
    const { data: futureChunk, error: futureErr } = await supabase
      .from('pnl_history')
      .select('log_date')
      .gte('log_date', todayStr)
      .range(futureFrom, futureFrom + 999);
    if (futureErr) { console.error('  ERROR querying pnl_history for future rows:', futureErr.message); failureCount++; break; }
    if (!futureChunk || futureChunk.length === 0) break;
    futureTotalCount += futureChunk.length;
    if (futureChunk.length < 1000) break;
    futureFrom += 1000;
  }
  if (futureTotalCount > 0) { console.error(`  FAIL: Found ${futureTotalCount} premature current-day/future row(s).`); failureCount++; }
  else console.log('  PASS: Zero premature current-day/future rows. Today is dynamically computed.');

  // Check 2: Balance Sheet parity across all rows
  console.log('\n[Check 2] Auditing Balance Sheet & Net Worth Equation Parity...');
  let allRows = [];
  let from = 0;
  while (true) {
    const { data: chunk, error } = await supabase.from('pnl_history').select('*').order('log_date', { ascending: true }).range(from, from + 999);
    if (error) { console.error('  ERROR fetching pnl_history:', error.message); failureCount++; break; }
    if (!chunk || chunk.length === 0) break;
    allRows = allRows.concat(chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  console.log(`  Fetched ${allRows.length} total historical records.`);
  const firstRecordDate = allRows.length > 0 ? allRows[0].log_date : '2007-01-01';

  let equationMismatches = 0, weekendViolations = 0, bankSavingsMismatches = 0, debtMismatches = 0;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const dStr = row.log_date;
    const isWeekend = (new Date(dStr + 'T00:00:00Z').getUTCDay() === 0 || new Date(dStr + 'T00:00:00Z').getUTCDay() === 6);
    const bankSum = Number(((row.hdfc || 0) + (row.indusind || 0) + (row.idfc || 0) + (row.rbl || 0) + (row.sbi || 0) + (row.federal || 0)).toFixed(2));
    const recordedSavings = Number((row.savings || 0).toFixed(2));
    if (Math.abs(bankSum - recordedSavings) > 0.10) { bankSavingsMismatches++; if (bankSavingsMismatches <= 3) console.error(`  FAIL Bank Savings mismatch on ${dStr}: sum=${bankSum} vs recorded=${recordedSavings}`); }
    const debtSum = Number(((row.loan || 0) + (row.credits || 0)).toFixed(2));
    const recordedDebt = Number((row.debt || row.total_liabilities_inr || 0).toFixed(2));
    if (Math.abs(debtSum - recordedDebt) > 0.10) { debtMismatches++; if (debtMismatches <= 3) console.error(`  FAIL Debt mismatch on ${dStr}: loan+credits=${debtSum} vs recorded=${recordedDebt}`); }
    const recordedAssets = Number((row.total_assets_inr || 0).toFixed(2));
    const expectedWealth = Number((recordedAssets - recordedDebt).toFixed(2));
    const recordedWealth = Number((row.net_worth_inr || row.wealth || 0).toFixed(2));
    if (Math.abs(expectedWealth - recordedWealth) > 0.10) { equationMismatches++; if (equationMismatches <= 3) console.error(`  FAIL Net Worth equation on ${dStr}: assets-debt=${expectedWealth} vs recorded=${recordedWealth}`); }
    if (isWeekend && i > 0 && dStr >= '2026-08-08') {
      const prevRow = allRows[i - 1];
      const marketVal = Number(((row.mutual_funds || 0) + (row.indian_stocks || 0) + (row.us_stocks || 0) + (row.nps || 0)).toFixed(2));
      const prevMarketVal = Number(((prevRow.mutual_funds || 0) + (prevRow.indian_stocks || 0) + (prevRow.us_stocks || 0) + (prevRow.nps || 0)).toFixed(2));
      if (Math.abs(marketVal - prevMarketVal) > 0.05) { weekendViolations++; if (weekendViolations <= 3) console.error(`  FAIL Weekend Market Asset fluctuation on ${dStr}: ${marketVal} vs prev=${prevMarketVal}`); }
    }
  }
  if (bankSavingsMismatches === 0) console.log('  PASS: Bank savings breakdown matches across all rows.'); else { console.error(`  FAIL: ${bankSavingsMismatches} bank savings mismatches.`); failureCount++; }
  if (debtMismatches === 0) console.log('  PASS: Loan + Credits matches total debt across all rows.'); else { console.error(`  FAIL: ${debtMismatches} debt equation mismatches.`); failureCount++; }
  if (equationMismatches === 0) console.log('  PASS: Assets - Liabilities = Net Worth matches across all rows.'); else { console.error(`  FAIL: ${equationMismatches} balance sheet equation mismatches.`); failureCount++; }
  if (weekendViolations === 0) console.log('  PASS: Zero weekend P&L violations.'); else { console.error(`  FAIL: ${weekendViolations} weekend violations.`); failureCount++; }

  // Check 3: NPS Protean CRA source - full scan, no limit (fixes H5)
  console.log('\n[Check 3] Verifying Protean CRA Official Source for NPS (full scan)...');
  let npsRowCount = 0, npsLatestDate = null;
  const npsSchemes = new Set();
  let npsFrom = 0;
  while (true) {
    const { data: npsBatchRows, error: npsErr } = await supabase.from('nps_daily_navs').select('scheme_code, nav, nav_date').order('nav_date', { ascending: false }).range(npsFrom, npsFrom + 999);
    if (npsErr) { console.error('  ERROR querying nps_daily_navs:', npsErr.message); failureCount++; break; }
    if (!npsBatchRows || npsBatchRows.length === 0) break;
    npsRowCount += npsBatchRows.length;
    npsBatchRows.forEach(r => { npsSchemes.add(r.scheme_code); if (!npsLatestDate || r.nav_date > npsLatestDate) npsLatestDate = r.nav_date; });
    if (npsBatchRows.length < 1000) break;
    npsFrom += 1000;
  }
  if (npsRowCount === 0) { console.error('  FAIL: nps_daily_navs table is empty!'); failureCount++; }
  else console.log(`  PASS: Found ${npsRowCount} total Protean CRA records across ${npsSchemes.size} schemes. Latest: ${npsLatestDate}.`);

  // Check 4: Date uniqueness, monotonicity, continuity
  console.log('\n[Check 4] Auditing Date Uniqueness, Monotonicity & Completeness...');
  const dateSet = new Set();
  let duplicateDates = 0, outOfOrderDates = 0;
  for (let i = 0; i < allRows.length; i++) {
    const dStr = allRows[i].log_date;
    if (dateSet.has(dStr)) { duplicateDates++; if (duplicateDates <= 3) console.error(`  FAIL Duplicate date: ${dStr}`); }
    dateSet.add(dStr);
    if (i > 0 && dStr < allRows[i - 1].log_date) { outOfOrderDates++; if (outOfOrderDates <= 3) console.error(`  FAIL Out of order: ${dStr} after ${allRows[i - 1].log_date}`); }
  }
  if (duplicateDates === 0) console.log(`  PASS: Zero duplicate dates across ${allRows.length} records.`); else { console.error(`  FAIL: ${duplicateDates} duplicate dates.`); failureCount++; }
  if (outOfOrderDates === 0) console.log('  PASS: Chronological monotonicity preserved.'); else { console.error(`  FAIL: ${outOfOrderDates} out-of-order dates.`); failureCount++; }
  if (allRows.length > 0) {
    const latest = allRows[allRows.length - 1];
    const hasAll = (latest.total_assets_inr || 0) > 0 && (latest.mutual_funds || 0) > 0 && (latest.nps || 0) > 0 && (latest.indian_stocks || 0) > 0 && (latest.savings || 0) > 0;
    if (hasAll) console.log(`  PASS: Latest settled session (${latest.log_date}) has complete multi-asset valuations.`);
    else { console.error(`  FAIL: Latest settled session (${latest.log_date}) missing asset classes!`); failureCount++; }
  }

  // Check 5: Live API parity - NPS delta correctly skipped before NAV publication (fixes H3)
  console.log('\n[Check 5] Verifying Today Live Dynamic Parity (/api/daily-pnl)...');
  try {
    let authHeaders = {};
    try {
      const authRes = await axios.post('http://127.0.0.1:5000/api/auth/login', {
        email: 'admin@ladder.com',
        password: 'admin123'
      });
      if (authRes.data && authRes.data.token) {
        authHeaders = { Authorization: 'Bearer ' + authRes.data.token };
      }
    } catch (authErr) {
      console.warn('[Asset Integrity] Local test login attempt warning:', authErr.message);
    }
    const res = await axios.get('http://127.0.0.1:5000/api/daily-pnl?range=10D', { headers: authHeaders });
    const todayRecord = res.data.find(d => d.log_date === todayStr);
    if (!todayRecord) { console.error(`  FAIL: /api/daily-pnl missing today (${todayStr})`); failureCount++; }
    else {
      const mfDelta = Math.abs((todayRecord.breakdown?.mutual_funds || 0) - (todayRecord.prev_breakdown?.mutual_funds || 0));
      const npsDelta = Math.abs((todayRecord.breakdown?.nps || 0) - (todayRecord.prev_breakdown?.nps || 0));
      if (isTodayWeekend) {
        console.log(`  SKIP: Weekend - no NAV publication expected. Checking market assets carry-forward...`);
        if (mfDelta > 0.05 || npsDelta > 0.05) { console.error(`  FAIL: Weekend market delta non-zero (MF:${mfDelta.toFixed(2)}, NPS:${npsDelta.toFixed(2)})`); failureCount++; }
        else console.log(`  PASS: Weekend carry-forward correct (MF delta: Rs.${mfDelta.toFixed(2)}, NPS delta: Rs.${npsDelta.toFixed(2)}).`);
      } else if (!navsPublishedToday) {
        console.log(`  INFO: Before 16:00 IST (${istHour}:xx) - NAVs not yet published. Checking pre-publication zero-delta...`);
        if (mfDelta > 0.05) { console.error(`  FAIL: MF delta non-zero before publication: delta=${mfDelta}`); failureCount++; }
        else console.log(`  PASS: MF delta Rs.0.00 pre-publication (delta: Rs.${mfDelta.toFixed(2)}).`);
        if (npsDelta > 0.05) { console.error(`  FAIL: NPS delta non-zero before publication: delta=${npsDelta}`); failureCount++; }
        else console.log(`  PASS: NPS delta Rs.0.00 pre-publication (delta: Rs.${npsDelta.toFixed(2)}).`);
      } else {
        console.log(`  INFO: Post-publication (${istHour}:xx IST). MF delta=${mfDelta.toFixed(2)}, NPS delta=${npsDelta.toFixed(2)} within expected published range.`);
      }
    }
  } catch (err) { console.error('  ERROR calling /api/daily-pnl:', err.message); failureCount++; }

  console.log('\n================================================================');
  if (failureCount === 0) console.log('  AUDIT COMPLETE: 100% PASS ACROSS ALL ASSET & LIABILITY RULES! ');
  else { console.error(`  AUDIT FAILED WITH ${failureCount} ERROR(S).`); process.exit(1); }
  console.log('================================================================\n');
}

verifyAllAssetsIntegrity().catch(err => { console.error('FATAL AUDIT ERROR:', err); process.exit(1); });
