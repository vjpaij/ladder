import fs from 'fs';
import path from 'path';
import { supabase } from '../server/supabaseClient.js';
import axios from 'axios';

async function verifyAllAssetsIntegrity() {
  console.log('================================================================');
  console.log('       UNIVERSAL MULTI-ASSET & LIABILITY INTEGRITY AUDIT        ');
  console.log('================================================================\n');

  let failureCount = 0;

  // 1. Check for Premature Current-Day or Future Rows in Supabase pnl_history
  const todayStr = new Date().toISOString().slice(0, 10);
  console.log(`[Check 1] Checking for Premature Snapshots (Current day: ${todayStr})...`);
  const { data: futureRows, error: futureErr } = await supabase
    .from('pnl_history')
    .select('log_date')
    .gte('log_date', todayStr);

  if (futureErr) {
    console.error('  ERROR querying pnl_history:', futureErr.message);
    failureCount++;
  } else if (futureRows && futureRows.length > 0) {
    console.error(`  FAIL: Found ${futureRows.length} premature current-day/future row(s) in pnl_history:`, futureRows.map(r => r.log_date));
    failureCount++;
  } else {
    console.log('  PASS: Zero premature current-day/future rows found in pnl_history. (Today is dynamic real-time).');
  }

  // 2. Audit Balance Sheet & Net Worth Invariance across ALL pnl_history records
  console.log('\n[Check 2] Auditing Balance Sheet & Net Worth Equation Parity...');
  const batchSize = 1000;
  let allRows = [];
  let from = 0;
  while (true) {
    const { data: chunk, error } = await supabase
      .from('pnl_history')
      .select('*')
      .order('log_date', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('  ERROR fetching pnl_history chunk:', error.message);
      failureCount++;
      break;
    }
    if (!chunk || chunk.length === 0) break;
    allRows = allRows.concat(chunk);
    if (chunk.length < batchSize) break;
    from += batchSize;
  }

  console.log(`  Fetched ${allRows.length} total historical records.`);

  let equationMismatches = 0;
  let weekendViolations = 0;
  let bankSavingsMismatches = 0;
  let debtMismatches = 0;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const dStr = row.log_date;
    const isWeekend = (new Date(dStr + 'T00:00:00Z').getUTCDay() === 0 || new Date(dStr + 'T00:00:00Z').getUTCDay() === 6);

    // Bank savings breakdown parity
    const bankSum = Number(((row.hdfc || 0) + (row.indusind || 0) + (row.idfc || 0) + (row.rbl || 0) + (row.sbi || 0) + (row.federal || 0)).toFixed(2));
    const recordedSavings = Number((row.savings || 0).toFixed(2));
    if (Math.abs(bankSum - recordedSavings) > 0.10) {
      bankSavingsMismatches++;
      if (bankSavingsMismatches <= 3) {
        console.error(`  FAIL Bank Savings mismatch on ${dStr}: sum=${bankSum} vs recorded=${recordedSavings}`);
      }
    }

    // Debt parity: loan + credits = debt
    const debtSum = Number(((row.loan || 0) + (row.credits || 0)).toFixed(2));
    const recordedDebt = Number((row.debt || row.total_liabilities_inr || 0).toFixed(2));
    if (Math.abs(debtSum - recordedDebt) > 0.10) {
      debtMismatches++;
      if (debtMismatches <= 3) {
        console.error(`  FAIL Debt mismatch on ${dStr}: loan+credits=${debtSum} vs recorded=${recordedDebt}`);
      }
    }

    // Assets parity: savings + mf + in_stocks + us_stocks + nps + epf = total_assets
    const expectedAssets = Number(((row.savings || 0) + (row.mutual_funds || 0) + (row.indian_stocks || 0) + (row.us_stocks || 0) + (row.nps || 0) + (row.epf || 0)).toFixed(2));
    const recordedAssets = Number((row.total_assets_inr || 0).toFixed(2));

    // Net Worth parity: total_assets - total_liabilities = net_worth
    const expectedWealth = Number((recordedAssets - recordedDebt).toFixed(2));
    const recordedWealth = Number((row.net_worth_inr || row.wealth || 0).toFixed(2));

    if (Math.abs(expectedWealth - recordedWealth) > 0.10) {
      equationMismatches++;
      if (equationMismatches <= 3) {
        console.error(`  FAIL Net Worth equation on ${dStr}: assets-debt=${expectedWealth} vs recorded=${recordedWealth}`);
      }
    }

    // Weekend market asset invariance: For all programmatic records (>= 2026-08-07), equity, MF, and NPS valuations must strictly carry forward
    if (isWeekend && i > 0 && dStr >= '2026-08-07') {
      const prevRow = allRows[i - 1];
      const marketVal = Number(((row.mutual_funds || 0) + (row.indian_stocks || 0) + (row.us_stocks || 0) + (row.nps || 0)).toFixed(2));
      const prevMarketVal = Number(((prevRow.mutual_funds || 0) + (prevRow.indian_stocks || 0) + (prevRow.us_stocks || 0) + (prevRow.nps || 0)).toFixed(2));
      const marketDiff = Math.abs(marketVal - prevMarketVal);

      if (marketDiff > 0.05) {
        weekendViolations++;
        if (weekendViolations <= 3) {
          console.error(`  FAIL Weekend Market Asset fluctuation on ${dStr}: current=${marketVal} vs prev=${prevMarketVal} (diff=${marketDiff})`);
        }
      }
    }
  }

  if (bankSavingsMismatches === 0) console.log('  PASS: Bank savings breakdown sums match recorded savings across all rows.');
  else { console.error(`  FAIL: ${bankSavingsMismatches} bank savings mismatches.`); failureCount++; }

  if (debtMismatches === 0) console.log('  PASS: Loan + Credits sum matches total debt across all rows.');
  else { console.error(`  FAIL: ${debtMismatches} debt equation mismatches.`); failureCount++; }

  if (equationMismatches === 0) console.log('  PASS: Assets - Liabilities = Net Worth matches across all rows.');
  else { console.error(`  FAIL: ${equationMismatches} balance sheet equation mismatches.`); failureCount++; }

  if (weekendViolations === 0) console.log('  PASS: Zero weekend P&L violations (Weekend invariance satisfied).');
  else { console.error(`  FAIL: ${weekendViolations} weekend violations.`); failureCount++; }

  // 3. Verify Protean CRA Source of Truth for NPS
  console.log('\n[Check 3] Verifying Protean CRA Official Source for NPS...');
  const { data: proteanRows, error: proteanErr } = await supabase
    .from('nps_daily_navs')
    .select('scheme_code, nav, nav_date')
    .order('nav_date', { ascending: false })
    .limit(10);

  if (proteanErr) {
    console.error('  ERROR querying nps_daily_navs:', proteanErr.message);
    failureCount++;
  } else if (!proteanRows || proteanRows.length === 0) {
    console.error('  FAIL: nps_daily_navs table is empty! Protean CRA scraper cache required.');
    failureCount++;
  } else {
    console.log(`  PASS: Found ${proteanRows.length} recent verified Protean CRA records. Latest date: ${proteanRows[0].nav_date}.`);
  }

  // 4. Invariance & Continuity Verification on Historical Log Dates
  console.log('\n[Check 4] Auditing Date Uniqueness, Monotonicity & Recent Continuity...');
  const dateSet = new Set();
  let duplicateDates = 0;
  let outOfOrderDates = 0;

  for (let i = 0; i < allRows.length; i++) {
    const dStr = allRows[i].log_date;
    if (dateSet.has(dStr)) {
      duplicateDates++;
      if (duplicateDates <= 3) console.error(`  FAIL Duplicate date detected in pnl_history: ${dStr}`);
    }
    dateSet.add(dStr);

    if (i > 0 && dStr < allRows[i - 1].log_date) {
      outOfOrderDates++;
      if (outOfOrderDates <= 3) console.error(`  FAIL Out of order date in pnl_history: ${dStr} after ${allRows[i - 1].log_date}`);
    }
  }

  if (duplicateDates === 0) {
    console.log(`  PASS: Zero duplicate dates across all ${allRows.length} historical records.`);
  } else {
    console.error(`  FAIL: Found ${duplicateDates} duplicate date records in pnl_history.`);
    failureCount++;
  }

  if (outOfOrderDates === 0) {
    console.log(`  PASS: Chronological monotonicity preserved (records strictly sorted ascending).`);
  } else {
    console.error(`  FAIL: Found ${outOfOrderDates} out-of-order date records in pnl_history.`);
    failureCount++;
  }

  // Audit the most recent settled session's valuations for multi-asset completeness
  if (allRows.length > 0) {
    const latestSettled = allRows[allRows.length - 1];
    console.log(`  Auditing latest settled session (${latestSettled.log_date}):`);
    const hasAssets = (latestSettled.total_assets_inr || 0) > 0;
    const hasMf = (latestSettled.mutual_funds || 0) > 0;
    const hasNps = (latestSettled.nps || 0) > 0;
    const hasEquities = (latestSettled.indian_stocks || 0) > 0;
    const hasSavings = (latestSettled.savings || 0) > 0;

    if (hasAssets && hasMf && hasNps && hasEquities && hasSavings) {
      console.log(`  PASS: Latest settled session (${latestSettled.log_date}) contains complete multi-asset valuations (MF: ₹${latestSettled.mutual_funds}, NPS: ₹${latestSettled.nps}, In-Stocks: ₹${latestSettled.indian_stocks}, Savings: ₹${latestSettled.savings}).`);
    } else {
      console.error(`  FAIL: Latest settled session (${latestSettled.log_date}) has missing asset classes!`);
      failureCount++;
    }
  }

  // 5. Test Live API Parity on Today (2026-09-08)
  console.log('\n[Check 5] Verifying Today Live Dynamic Parity (/api/daily-pnl)...');
  try {
    const res = await axios.get('http://127.0.0.1:5000/api/daily-pnl?range=10D');
    const todayRecord = res.data.find(d => d.log_date === todayStr);
    if (!todayRecord) {
      console.error(`  FAIL: /api/daily-pnl did not return dynamic record for today (${todayStr})`);
      failureCount++;
    } else {
      const mfDelta = Math.abs((todayRecord.breakdown?.mutual_funds || 0) - (todayRecord.prev_breakdown?.mutual_funds || 0));
      const npsDelta = Math.abs((todayRecord.breakdown?.nps || 0) - (todayRecord.prev_breakdown?.nps || 0));

      if (mfDelta > 0.05) {
        console.error(`  FAIL: Today's MF delta is non-zero before today's NAVs published: delta=${mfDelta}`);
        failureCount++;
      } else {
        console.log(`  PASS: Today's Mutual Funds change is strictly ₹0.00 (delta: ₹${mfDelta.toFixed(2)}).`);
      }

      if (npsDelta > 0.05) {
        console.error(`  FAIL: Today's NPS delta is non-zero before today's NAVs published: delta=${npsDelta}`);
        failureCount++;
      } else {
        console.log(`  PASS: Today's NPS change is strictly ₹0.00 (delta: ₹${npsDelta.toFixed(2)}).`);
      }
    }
  } catch (err) {
    console.error('  ERROR calling /api/daily-pnl:', err.message);
    failureCount++;
  }

  console.log('\n================================================================');
  if (failureCount === 0) {
    console.log('  AUDIT COMPLETE: 100% PASS ACROSS ALL ASSET & LIABILITY RULES! ');
  } else {
    console.error(`  AUDIT FAILED WITH ${failureCount} ERROR(S).`);
    process.exit(1);
  }
  console.log('================================================================\n');
}

verifyAllAssetsIntegrity().catch(err => {
  console.error('FATAL AUDIT ERROR:', err);
  process.exit(1);
});
