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

/**
 * Recursive Amortization Chain Recalculator
 * Re-simulates the entire chronological statement history of a loan from inception.
 * Guarantees that opening_balance, days_between, interest_amount, principal_amount,
 * and closing_balance strictly maintain mathematical continuity across all entries.
 */
export async function recomputeSettledAmortizationChain(liabilityId) {
  if (!liabilityId) return [];

  // Fetch all rows from Supabase
  let entries = [];
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
    console.warn('[loanEngine.recomputeSettledAmortizationChain] Supabase fetch error:', err.message);
  }

  if (entries.length === 0 && fs.existsSync(DATA_JSON_PATH)) {
    try {
      const local = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
      entries = Array.isArray(local) ? local.filter(e => e.liability_id === liabilityId) : [];
    } catch (e) {
      console.warn('[loanEngine.recomputeSettledAmortizationChain] Local JSON read error:', e.message);
    }
  }

  if (!entries || entries.length === 0) return [];

  // Separate settled vs future custom projections
  const settled = entries.filter(e => e.is_settled !== false);
  const future = entries.filter(e => e.is_settled === false);
  if (settled.length === 0) return entries;

  // Chronological sort
  settled.sort((a, b) => a.date.localeCompare(b.date));

  let prevClosing = 0;
  let prevDate = null;
  let currentRate = 7.25;

  for (let i = 0; i < settled.length; i++) {
    const row = settled[i];
    const rowDate = new Date(row.date);

    // Opening balance strictly inherits previous row's closing balance
    row.opening_balance = i === 0 ? 0 : prevClosing;

    // Days between statements
    if (prevDate) {
      const diffDays = Math.max(0, Math.round((rowDate - prevDate) / (1000 * 60 * 60 * 24)));
      row.days_between = diffDays;
    } else {
      row.days_between = Number(row.days_between) || 0;
    }

    // Rate resolution
    if (Number(row.interest_rate) > 0) {
      currentRate = Number(row.interest_rate);
    } else {
      row.interest_rate = currentRate;
    }

    const type = (row.entry_type || 'EMI').toUpperCase();

    if (type === 'RATE_CHANGE') {
      row.disbursed_amount = 0;
      row.bulk_payment = 0;
      row.interest_amount = 0;
      row.principal_amount = 0;
      row.emi_amount = 0;
      row.closing_balance = row.opening_balance;
      row.notes = row.notes || `Interest rate changed to ${currentRate}% p.a.`;
    } else if (type === 'PREPAYMENT') {
      const bulk = Number(row.bulk_payment) || Number(row.emi_amount) || 0;
      row.bulk_payment = bulk;
      row.disbursed_amount = 0;
      row.interest_amount = 0;
      row.principal_amount = bulk;
      row.closing_balance = Math.max(0, row.opening_balance - bulk);
      row.notes = row.notes || `Bulk Prepayment ₹${bulk}`;
    } else if (type === 'DISBURSEMENT') {
      const disbursed = Number(row.disbursed_amount) || 0;
      row.disbursed_amount = disbursed;
      row.interest_amount = 0;
      row.principal_amount = 0;
      row.closing_balance = row.opening_balance + disbursed;
      row.notes = row.notes || `Loan Disbursement ₹${disbursed}`;
    } else if (type === 'FEE_OR_ADJUSTMENT') {
      const adj = Number(row.disbursed_amount) || 0;
      row.interest_amount = 0;
      row.principal_amount = 0;
      row.closing_balance = row.opening_balance + adj;
    } else {
      // Standard EMI or MONTHLY_PAYMENT
      const emi = Number(row.emi_amount) || 60000;
      row.emi_amount = emi;
      row.disbursed_amount = 0;
      const bulk = Number(row.bulk_payment) || 0;
      const interest = Math.round(row.opening_balance * (currentRate / 100 / 365) * row.days_between);
      row.interest_amount = interest;
      const principal = Math.max(0, Math.min(row.opening_balance, (emi - interest) + bulk));
      row.principal_amount = principal;
      row.closing_balance = Math.max(0, row.opening_balance - principal);
    }

    prevClosing = row.closing_balance;
    prevDate = rowDate;
  }

  // Batch persist updated settled rows to Supabase
  for (let i = 0; i < settled.length; i += 50) {
    const chunk = settled.slice(i, i + 50);
    for (const r of chunk) {
      if (r.id && !String(r.id).startsWith('proj-')) {
        await supabase
          .from('loan_amortization')
          .update({
            opening_balance: r.opening_balance,
            days_between: r.days_between,
            interest_rate: r.interest_rate,
            disbursed_amount: r.disbursed_amount,
            emi_amount: r.emi_amount,
            bulk_payment: r.bulk_payment,
            interest_amount: r.interest_amount,
            principal_amount: r.principal_amount,
            closing_balance: r.closing_balance,
            notes: r.notes,
            updated_at: new Date().toISOString()
          })
          .eq('id', r.id);
      }
    }
  }

  // Update local JSON
  try {
    const fullDataset = [...settled, ...future];
    fullDataset.sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(fullDataset, null, 2));
  } catch (e) {
    console.warn('[loanEngine.recomputeSettledAmortizationChain] Error writing DATA_JSON_PATH:', e.message);
  }

  // Synchronize liabilities table with latest settled state
  const latest = settled[settled.length - 1];
  if (latest) {
    try {
      await supabase
        .from('liabilities')
        .update({
          outstanding_balance: latest.closing_balance,
          interest_rate: currentRate,
          updated_at: new Date().toISOString()
        })
        .eq('id', liabilityId);

      await db.update('liabilities', liabilityId, {
        outstanding_balance: latest.closing_balance,
        interest_rate: currentRate,
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[loanEngine.recomputeSettledAmortizationChain] Error updating liability:', e.message);
    }
  }

  await recomputeSettledAmortizationChain(liabilityId);
    db.invalidateCache('loan_amortization');
  db.invalidateCache('liabilities');
  return settled;
}

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
    if (entryType === 'RATE_CHANGE') {
      // Rate changes are amortization recalculation parameters, not monetary cash flows.
      return;
    }
    const bulk = Number(amortRow.bulk_payment) || 0;
    const emi = Number(amortRow.emi_amount) || 0;
    const disbursed = Number(amortRow.disbursed_amount) || 0;

    let txType = 'EMI_PAYMENT';
    // For EMI payments, txAmt must strictly equal the principal portion, because in recalculator.js
    // netDebt is reduced by tx.total_amount. Subtracting full EMI would mistakenly deduct interest
    // from remaining principal debt.
    const principalPaid = Number(amortRow.principal_amount) || Math.max(0, emi - (Number(amortRow.interest_amount) || 0));
    let txAmt = principalPaid;
    if (entryType === 'PREPAYMENT' || bulk > 0) {
      txType = 'PREPAYMENT';
      txAmt = bulk > 0 ? bulk : principalPaid;
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

  // 1b. Auto-seed / sync from local JSON if local has more entries than DB
  if (fs.existsSync(DATA_JSON_PATH)) {
    try {
      const allEntries = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
      const relevantLocal = Array.isArray(allEntries) ? allEntries.filter(e => e.liability_id === liabilityId) : [];
      if (relevantLocal.length > entries.length) {
        console.log(`[loanEngine] Auto-seeding Supabase from local JSON (${relevantLocal.length} local vs ${entries.length} in DB)`);
        for (let i = 0; i < relevantLocal.length; i += 50) {
          const chunk = relevantLocal.slice(i, i + 50);
          await supabase.from('loan_amortization').upsert(chunk, { onConflict: 'liability_id,date,entry_type' });
        }
        entries = relevantLocal;
      } else if (entries.length === 0 && relevantLocal.length > 0) {
        entries = relevantLocal;
      }
    } catch (e) {
      console.error('[loanEngine] Failed reading/syncing fallback JSON:', e.message);
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
  
  // Find latest valid rate and EMI (fall back to previous rows if latest was a pure prepayment or disbursement)
  const lastWithRate = [...settledEntries].reverse().find(e => Number(e.interest_rate) > 0);
  const currentInterestRate = lastWithRate ? Number(lastWithRate.interest_rate) : (Number(latestSettled.interest_rate) || 7.25);

  const lastWithEmi = [...settledEntries].reverse().find(e => Number(e.emi_amount) > 0);
  const standardEmi = lastWithEmi ? Number(lastWithEmi.emi_amount) : 60000;

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
      actualEmi: standardEmi,
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
  const entryType = (entry.entry_type || (Number(entry.bulk_payment) > 0 ? 'PREPAYMENT' : 'EMI')).toUpperCase();
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
    opening_balance: 0,
    interest_amount: 0,
    principal_amount: 0,
    closing_balance: 0,
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

  // If settled, recompute entire chronological chain
  let updatedRow = data;
  if (isSettled) {
    const chain = await recomputeSettledAmortizationChain(liabilityId);
    updatedRow = chain.find(r => r.id === data.id || (r.date === date && r.entry_type === entryType)) || data;
    await syncAmortizationToTransaction(liabilityId, updatedRow, 'UPSERT');
  } else {
    // If future projected row, update local JSON
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
  }

  if (rate > 0) {
    try {
      await db.update('liabilities', liabilityId, { interest_rate: rate, updated_at: new Date().toISOString() });
      db.invalidateCache('liabilities');
    } catch (e) {
      console.warn('[loanEngine] Could not update liability interest_rate:', e.message);
    }
  }

  db.invalidateCache('loan_amortization');
  db.invalidateCache('liabilities');
  return updatedRow;
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

  // Recompute settled chain and sync
  const targetLiabId = data?.liability_id || updates.liability_id;
  if (data && targetLiabId) {
    if (data.is_settled) {
      await recomputeSettledAmortizationChain(targetLiabId);
      await syncAmortizationToTransaction(targetLiabId, data, 'UPSERT');
    } else {
      await syncAmortizationToTransaction(targetLiabId, data, 'DELETE');
    }
  }
  if (updates.interest_rate && Number(updates.interest_rate) > 0) {
    try {
      const liabilityId = data?.liability_id || updates.liability_id;
      if (liabilityId) {
        await db.update('liabilities', liabilityId, { interest_rate: Number(updates.interest_rate), updated_at: new Date().toISOString() });
        db.invalidateCache('liabilities');
      }
    } catch (e) {
      console.warn('[loanEngine] Could not update liability interest_rate on edit:', e.message);
    }
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

  // Recompute settled chain and sync delete
  if (targetRow) {
    await syncAmortizationToTransaction(targetRow.liability_id, targetRow, 'DELETE');
    if (targetRow.liability_id) {
      await recomputeSettledAmortizationChain(targetRow.liability_id);
    }
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
