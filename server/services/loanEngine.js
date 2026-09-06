import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_JSON_PATH = path.join(__dirname, '../../data/loan_amortization.json');
const DEFAULT_LIABILITY_ID = '00000000-0000-0000-0000-000000000010';

export async function getLoanAmortizationData(liabilityId = DEFAULT_LIABILITY_ID) {
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
      entries = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
    } catch (e) {
      console.error('[loanEngine] Failed reading fallback JSON:', e.message);
    }
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

  const latestSettled = settledEntries.length > 0
    ? settledEntries[settledEntries.length - 1]
    : {
        date: '2026-09-01',
        closing_balance: 4464447,
        interest_rate: 7.25,
        emi_amount: 60000
      };

  const currentOutstanding = Number(latestSettled.closing_balance) || 0;
  const currentInterestRate = Number(latestSettled.interest_rate) || 7.25;
  const standardEmi = Number(latestSettled.emi_amount) || 60000;

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
      totalDisbursed: Number(totalDisbursed.toFixed(2)),
      totalEmiPaid: Number(totalEmiPaid.toFixed(2)),
      totalBulkPaid: Number(totalBulkPaid.toFixed(2)),
      totalInterestPaid: Number(totalInterestPaid.toFixed(2)),
      totalPrincipalPaid: Number(totalPrincipalPaid.toFixed(2)),
      currentOutstandingBalance: Number(currentOutstanding.toFixed(2)),
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
  const liabilityId = entry.liability_id || DEFAULT_LIABILITY_ID;
  const date = entry.date;
  const entryType = entry.entry_type || (entry.bulk_payment > 0 ? 'PREPAYMENT' : 'EMI');
  const rate = Number(entry.interest_rate) || 7.25;
  const bulk = Number(entry.bulk_payment) || 0;
  const emi = Number(entry.emi_amount) || 60000;
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

  return data;
}

export async function deleteLoanAmortizationEntry(id) {
  // Check if id is a valid UUID
  const isUuid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

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

  return { success: true, id };
}
