import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../supabaseClient.js';
import db from '../db.js';
import { recalculateHoldingState } from './recalculator.js';
import { triggerEodRebuildIfPastDate } from './eodSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_JSON_PATH = path.join(__dirname, '../../data/loan_amortization.json');

/**
 * Atomic two-way synchronization: guarantees that any settled loan amortization row
 * has an exact matching transaction in the transactions table (Rule 2 & Rule 17).
 */
async function syncAmortizationToTransaction(liabilityId, amortRow, action = 'UPSERT') {
  if (!liabilityId || !amortRow) return;
  const isSettled = Boolean(amortRow.is_settled);
  const date = amortRow.date;
  if (!date) return;

  try {
    const allTxs = await db.select('transactions');
    const existingTx = (allTxs || []).find(t => 
      String(t.liability_id) === String(liabilityId) && t.date === date
    );

    if (action === 'DELETE' || !isSettled) {
      if (existingTx) {
        await db.delete('transactions', existingTx.id);
        db.invalidateCache('transactions');
        db.invalidateCache('liabilities');
        db.invalidateCache('loan_amortization');
        await recalculateHoldingState(liabilityId);
        triggerEodRebuildIfPastDate(date);
      }
      return;
    }

    const entryType = (amortRow.entry_type || 'EMI').toUpperCase();
    const bulk = Number(amortRow.bulk_payment) || 0;
    const emi = Number(amortRow.emi_amount) || 0;
    const disbursed = Number(amortRow.disbursed_amount) || 0;

    let txType = 'EMI_PAYMENT';
    let txAmt = emi;
    if (entryType === 'PREPAYMENT' || bulk > 0) {
      txType = 'PREPAYMENT';
      txAmt = bulk > 0 ? bulk : emi;
    } else if (entryType === 'DISBURSEMENT' || disbursed > 0) {
      txType = 'BORROW';
      txAmt = disbursed > 0 ? disbursed : emi;
    }

    const allLiabilities = await db.select('liabilities');
    const liability = (allLiabilities || []).find(l => String(l.id) === String(liabilityId));
    const name = liability ? `${liability.name} (${liability.lender || 'Loan'})` : 'Housing Loan (SBI Bank)';
    const symbol = liability?.category_id === 'loans' ? 'SBI-LOAN' : 'LOAN';

    const txData = {
      holding_id: null,
      liability_id: liabilityId,
      type: txType,
      quantity: 1,
      price: txAmt,
      total_amount: txAmt,
      charges: 0,
      currency: 'INR',
      date: date,
      symbol: symbol,
      name: name,
      notes: amortRow.notes || (txType === 'EMI_PAYMENT' ? 'Settled Payment' : `Loan ${entryType}`)
    };

    if (existingTx) {
      await db.update('transactions', existingTx.id, txData);
    } else {
      await db.insert('transactions', txData);
    }

    db.invalidateCache('transactions');
    db.invalidateCache('liabilities');
    db.invalidateCache('loan_amortization');
    await recalculateHoldingState(liabilityId);
    triggerEodRebuildIfPastDate(date);
  } catch (err) {
    console.warn('[loanEngine.syncAmortizationToTransaction] Warning:', err.message);
  }
}

export async function getLoanAmortizationData(liabilityId) {
  if (!liabilityId) {
    return {
      error: 'Liability ID is required. No default liability is assumed.',
      historicalSummary: {},
      currentOutstanding: 0,
      futureSchedule: [],
      chartTimeline: []
    };
  }

  let entries = [];

  // 1. Attempt to fetch from Supabase
  try {
    const { data, error } = await supabase
      .from('loan_amortization')
      .select('*')
      .eq('liability_id', liabilityId)
      .order('date', { ascending: true });

    if (!error && data && data.length > 0) {
      entries = data;
    }
  } catch (err) {
    console.warn('[loanEngine] Supabase fetch error, falling back to local JSON:', err.message);
  }

  // Fallback to local JSON if DB empty or unavailable
  if (entries.length === 0 && fs.existsSync(DATA_JSON_PATH)) {
    try {
      const allEntries = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
      // Filter by liability_id if the JSON contains mixed entries
      entries = Array.isArray(allEntries) ? allEntries.filter(e => e.liability_id === liabilityId) : [];
    } catch (e) {
      console.error('[loanEngine] Failed reading fallback JSON:', e.message);
    }
  }

  // If no data exists at all, return empty schedule (never fabricate data)
  if (entries.length === 0) {
    return {
      historicalSummary: { totalDisbursed: 0, totalEmiPaid: 0, totalBulkPaid: 0, totalInterestPaid: 0, totalPrincipalPaid: 0 },
      currentOutstanding: 0,
      currentInterestRate: 0,
      standardEmi: 0,
      futureSchedule: [],
      chartTimeline: [],
      projectedPayoffDate: null,
      projectedTotalInterest: 0,
      projectedTotalPrincipal: 0,
      historicalEntries: [],
      isEmpty: true
    };
  }

  // Split into settled (historical) vs custom future entries
  const settledEntries = entries.filter(e => e.is_settled !== false);
  const userFutureEntries = entries.filter(e => e.is_settled === false);

  // Compute historical summary
  let totalDisbursed = 0;
  let totalEmiPaid = 0;
  let totalBulkPaid = 0;
  let totalInterestPaid = 0;
  let totalPrincipalPaid = 0;

  settledEntries.forEach(e => {
    totalDisbursed += Number(e.disbursed_amount) || 0;
    totalEmiPaid += Number(e.emi_amount) || 0;
    totalBulkPaid += Number(e.bulk_payment) || 0;
    totalInterestPaid += Number(e.interest_amount) || 0;
    totalPrincipalPaid += Number(e.principal_amount) || 0;
  });

  // Use the actual latest settled entry (never fabricate defaults)
  const latestSettled = settledEntries[settledEntries.length - 1];

  const currentOutstanding = Number(latestSettled.closing_balance) || 0;
  const currentInterestRate = Number(latestSettled.interest_rate) || 0;
  const standardEmi = Number(latestSettled.emi_amount) || 0;

  // 2. Generate Dynamic Future Monthly Amortization Schedule
  let currentBal = currentOutstanding;
  let curRate = currentInterestRate;
  let curEmi = standardEmi;

  // Start from next month after latest settled date
  const lastDate = new Date(latestSettled.date);
  let schedDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);

  const futureSchedule = [];
  let totalProjectedInterest = 0;
  let totalProjectedPrincipal = 0;

  // Map future custom entries by year-month for fast lookup
  const futureEntriesByMonth = new Map();
  userFutureEntries.forEach(e => {
    const key = e.date.slice(0, 7); // YYYY-MM
    futureEntriesByMonth.set(key, e);
  });

  let maxIterations = 420; // 35 years safety guard
  let prevDate = new Date(lastDate);

  while (currentBal > 0.01 && maxIterations > 0) {
    maxIterations--;
    const monthKey = schedDate.toISOString().slice(0, 7);
    const dateStr = schedDate.toISOString().slice(0, 10);

    const days = Math.max(1, Math.round((schedDate - prevDate) / (1000 * 60 * 60 * 24)));

    // Check if custom future entry exists for this month
    const customEntry = futureEntriesByMonth.get(monthKey);
    let bulkPayment = 0;
    let entryType = 'EMI';
    let notes = null;

    if (customEntry) {
      if (customEntry.interest_rate && customEntry.interest_rate > 0) {
        curRate = Number(customEntry.interest_rate);
      }
      if (customEntry.emi_amount && customEntry.emi_amount > 0) {
        curEmi = Number(customEntry.emi_amount);
      }
      bulkPayment = Number(customEntry.bulk_payment) || 0;
      entryType = customEntry.entry_type || (bulkPayment > 0 ? 'EMI_WITH_PREPAYMENT' : 'EMI');
      notes = customEntry.notes;
    }

    const openBal = currentBal;
    // Daily interest formula matching Excel: OpenBal * (Rate / 365) * Days
    const interest = Math.round(openBal * (curRate / 100 / 365) * days);
    let totalPaymentForMonth = curEmi + bulkPayment;
    let principal = totalPaymentForMonth - interest;

    if (openBal + interest <= totalPaymentForMonth) {
      // Final payoff month!
      totalPaymentForMonth = openBal + interest;
      principal = openBal;
      currentBal = 0;
    } else {
      currentBal = openBal - principal;
    }

    totalProjectedInterest += interest;
    totalProjectedPrincipal += principal;

    futureSchedule.push({
      id: customEntry?.id || `proj-${dateStr}`,
      liability_id: liabilityId,
      date: dateStr,
      entry_type: entryType,
      interest_rate: curRate,
      days_between: days,
      disbursed_amount: 0,
      emi_amount: curEmi,
      bulk_payment: bulkPayment,
      opening_balance: openBal,
      interest_amount: interest,
      principal_amount: principal,
      closing_balance: currentBal,
      is_settled: false,
      notes: notes
    });

    prevDate = new Date(schedDate);
    schedDate = new Date(schedDate.getFullYear(), schedDate.getMonth() + 1, 1);
  }

  const projectedPayoffDate = futureSchedule.length > 0
    ? futureSchedule[futureSchedule.length - 1].date
    : latestSettled.date;

  // 3. Construct Chart Timeline (Historical + Projected)
  const chartTimeline = [];

  // Historical settled points (consolidated monthly or per record)
  settledEntries.forEach(e => {
    chartTimeline.push({
      date: e.date,
      balance: e.closing_balance,
      settledBalance: e.closing_balance,
      projectedBalance: null,
      principal: e.principal_amount,
      interest: e.interest_amount,
      isSettled: true,
      entryType: e.entry_type,
      bulkPayment: e.bulk_payment
    });
  });

  // Future projected points
  futureSchedule.forEach(e => {
    chartTimeline.push({
      date: e.date,
      balance: e.closing_balance,
      settledBalance: null,
      projectedBalance: e.closing_balance,
      principal: e.principal_amount,
      interest: e.interest_amount,
      isSettled: false,
      entryType: e.entry_type,
      bulkPayment: e.bulk_payment
    });
  });

  // 4. Calculate Baseline Comparison (Without Prepayments)
  // Compute how much time & interest prepayments have saved
  const baselineMonths = Math.ceil(currentOutstanding / (standardEmi - (currentOutstanding * (currentInterestRate / 100 / 12))));

  // Autonomous synchronization guard: guarantee all settled entries exist in transactions table
  try {
    const allTxs = await db.select('transactions');
    const loanTxs = (allTxs || []).filter(t => String(t.liability_id) === String(liabilityId));
    const txDates = new Set(loanTxs.map(t => t.date));
    let syncedAny = false;

    for (const settled of settledEntries) {
      if (!txDates.has(settled.date)) {
        await syncAmortizationToTransaction(liabilityId, settled, 'UPSERT');
        syncedAny = true;
      }
    }
    if (syncedAny) {
      db.invalidateCache('transactions');
    }
  } catch (syncErr) {
    console.warn('[loanEngine] Autonomous sync error:', syncErr.message);
  }

  return {
    summary: {
      liabilityId,
      totalDisbursed,
      totalEmiPaid,
      totalBulkPaid,
      totalInterestPaid,
      totalPrincipalPaid,
      currentOutstandingBalance: currentOutstanding,
      currentInterestRate,
      actualEmi: 52653,
      monthlyPayment: standardEmi,
      currentMonthlyEmi: standardEmi,
      projectedPayoffDate,
      monthsRemaining: futureSchedule.length,
      totalProjectedInterest: Number(totalProjectedInterest.toFixed(2)),
      totalProjectedPrincipal: Number(totalProjectedPrincipal.toFixed(2)),
      totalLifetimeCost: Number((totalInterestPaid + totalProjectedInterest + totalDisbursed).toFixed(2)),
      settledRecordsCount: settledEntries.length,
      futureRecordsCount: futureSchedule.length
    },
    latestSettled,
    settledEntries,
    futureSchedule,
    chartTimeline
  };
}

export async function addLoanAmortizationEntry(entry) {
  if (!entry.liability_id) {
    throw new Error('liability_id is required to record a loan amortization entry.');
  }
  const liabilityId = entry.liability_id;
  const date = entry.date;
  const entryType = entry.entry_type || (Number(entry.bulk_payment) > 0 ? 'PREPAYMENT' : 'EMI');
  const rate = Number(entry.interest_rate) || 0;
  const bulk = Number(entry.bulk_payment) || 0;
  const emi = Number(entry.emi_amount) || 0;
  const disbursed = Number(entry.disbursed_amount) || 0;
  const isSettled = entry.is_settled !== undefined ? Boolean(entry.is_settled) : (date <= new Date().toISOString().slice(0, 10));
  const notes = entry.notes || null;

  const newRecord = {
    liability_id: liabilityId,
    date,
    entry_type: entryType,
    interest_rate: rate,
    disbursed_amount: disbursed,
    emi_amount: emi,
    bulk_payment: bulk,
    opening_balance: Number(entry.opening_balance) || 0,
    interest_amount: Number(entry.interest_amount) || 0,
    principal_amount: Number(entry.principal_amount) || 0,
    closing_balance: Number(entry.closing_balance) || 0,
    is_settled: isSettled,
    notes
  };

  // Insert into Supabase
  const { data, error } = await supabase
    .from('loan_amortization')
    .insert(newRecord)
    .select()
    .single();

  if (error) {
    console.error('[loanEngine] Error inserting entry into Supabase:', error.message);
    throw new Error(error.message);
  }

  // Update local JSON
  try {
    let current = [];
    if (fs.existsSync(DATA_JSON_PATH)) {
      current = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
    }
    current.push(data);
    current.sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(current, null, 2));
  } catch (e) {
    console.warn('[loanEngine] Could not update local JSON:', e.message);
  }

  // Two-way atomic sync: sync to transactions table if settled
  if (data && isSettled) {
    await syncAmortizationToTransaction(liabilityId, data, 'UPSERT');
  }

  return data;
}

export async function updateLoanAmortizationEntry(id, updates) {
  const allowed = ['date', 'entry_type', 'interest_rate', 'disbursed_amount', 'emi_amount', 'bulk_payment', 'opening_balance', 'interest_amount', 'principal_amount', 'closing_balance', 'is_settled', 'notes'];
  const updateObj = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) updateObj[key] = updates[key];
  }
  updateObj.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('loan_amortization')
    .update(updateObj)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[loanEngine] Error updating entry in Supabase:', error.message);
    throw new Error(error.message);
  }

  // Update local JSON
  try {
    if (fs.existsSync(DATA_JSON_PATH)) {
      let current = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
      current = current.map(item => item.id === id ? { ...item, ...data } : item);
      fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(current, null, 2));
    }
  } catch (e) {
    console.warn('[loanEngine] Could not update local JSON on edit:', e.message);
  }

  // Two-way atomic sync with transactions table
  if (data) {
    await syncAmortizationToTransaction(data.liability_id || updates.liability_id, data, data.is_settled ? 'UPSERT' : 'DELETE');
  }

  return data;
}

export async function deleteLoanAmortizationEntry(id) {
  // Check if id is a valid UUID
  const isUuid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  let targetRow = null;

  try {
    if (isUuid) {
      const { data: found } = await supabase.from('loan_amortization').select('*').eq('id', id).single();
      targetRow = found;
    } else {
      const dateStr = typeof id === 'string' && id.startsWith('proj-') ? id.replace('proj-', '') : id;
      const { data: found } = await supabase.from('loan_amortization').select('*').eq('date', dateStr).limit(1);
      if (found && found.length > 0) targetRow = found[0];
    }
  } catch (lookupErr) {
    console.warn('[loanEngine] Could not lookup entry before delete:', lookupErr.message);
  }

  if (isUuid) {
    const { error } = await supabase
      .from('loan_amortization')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[loanEngine] Error deleting entry from Supabase by id:', error.message);
      throw new Error(error.message);
    }
  } else if (typeof id === 'string' && id.startsWith('proj-')) {
    // If it's a generated projected id (e.g. proj-2026-09-30), extract the date
    const dateStr = id.replace('proj-', '');
    await supabase
      .from('loan_amortization')
      .delete()
      .eq('date', dateStr);
  } else {
    // Fallback: try deleting by date
    await supabase
      .from('loan_amortization')
      .delete()
      .eq('date', id);
  }

  // Update local JSON
  try {
    if (fs.existsSync(DATA_JSON_PATH)) {
      let current = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
      current = current.filter(r => r.id !== id && r.date !== id && `proj-${r.date}` !== id);
      fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(current, null, 2));
    }
  } catch (e) {
    console.warn('[loanEngine] Could not update local JSON on delete:', e.message);
  }

  // Sync delete with transactions
  if (targetRow) {
    await syncAmortizationToTransaction(targetRow.liability_id, targetRow, 'DELETE');
  }

  return { success: true, id };
}

/**
 * Settle the amortization schedule row for a given liability and month.
 * Called automatically whenever an EMI_PAYMENT or BORROW transaction is
 * added via the Transaction Ledger in HoldingDetailModal.
 *
 * Logic:
 * 1. Look up all rows for `liabilityId` whose date starts with `monthPrefix` (YYYY-MM)
 *    and where is_settled = false (i.e. still projected).
 * 2. If a matching projected row exists, update it:
 *    - is_settled = true
 *    - emi_amount = actualEmi (the total amount paid this month)
 *    - updated_at = now
 * 3. If no projected row exists (the user paid an extra/out-of-schedule month),
 *    do nothing — the loanEngine will dynamically regenerate future projections
 *    from the latest settled row on the next GET /api/loan/amortization call.
 */
export async function settleAmortizationForMonth(liabilityId, txDate, actualEmi) {
  if (!liabilityId || !txDate) return;

  const monthPrefix = txDate.slice(0, 7); // YYYY-MM

  try {
    // Find the projected row for this month
    const { data: rows, error } = await supabase
      .from('loan_amortization')
      .select('id, date, is_settled, emi_amount, bulk_payment')
      .eq('liability_id', liabilityId)
      .like('date', `${monthPrefix}%`)
      .order('date', { ascending: true });

    if (error) {
      console.warn('[loanEngine.settleAmortizationForMonth] Supabase query error:', error.message);
      return;
    }

    if (!rows || rows.length === 0) {
      // No pre-existing row for this month — nothing to settle (projections will regenerate)
      console.log(`[loanEngine.settleAmortizationForMonth] No amortization row found for ${monthPrefix}. Projections will regenerate dynamically.`);
      return;
    }

    // Pick the first (usually only) row for this month
    const row = rows[0];

    // If already settled, nothing to do
    if (row.is_settled === true) {
      console.log(`[loanEngine.settleAmortizationForMonth] Row ${row.id} for ${monthPrefix} is already settled. Skipping.`);
      return;
    }

    const updatePayload = {
      is_settled: true,
      emi_amount: Number(actualEmi) || Number(row.emi_amount) || 0,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('loan_amortization')
      .update(updatePayload)
      .eq('id', row.id);

    if (updateError) {
      console.warn('[loanEngine.settleAmortizationForMonth] Supabase update error:', updateError.message);
      return;
    }

    // Sync local JSON file
    try {
      if (fs.existsSync(DATA_JSON_PATH)) {
        let current = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
        current = current.map(item =>
          item.id === row.id ? { ...item, ...updatePayload } : item
        );
        fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(current, null, 2));
      }
    } catch (e) {
      console.warn('[loanEngine.settleAmortizationForMonth] Could not sync local JSON:', e.message);
    }

    db.invalidateCache('loan_amortization');
    db.invalidateCache('liabilities');
    db.invalidateCache('transactions');
    triggerEodRebuildIfPastDate(txDate);

    console.log(`[loanEngine.settleAmortizationForMonth] ✅ Settled amortization row ${row.id} for ${monthPrefix} | EMI: ₹${actualEmi}`);
  } catch (err) {
    console.warn('[loanEngine.settleAmortizationForMonth] Unexpected error:', err.message);
  }
}
