import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../server/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXCEL_PATH = 'C:\\Users\\Vijay Pai\\Documents\\Finance\\Investment.xlsx';
const OUTPUT_JSON_PATH = path.join(__dirname, '../data/loan_amortization.json');
const HOUSING_LOAN_ID = '00000000-0000-0000-0000-000000000010';

function formatYMD(serial) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y) return null;
  const y = parsed.y;
  const m = String(parsed.m).padStart(2, '0');
  const d = String(parsed.d).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  console.log('[Loan Amortization] Reading Excel workbook:', EXCEL_PATH);
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('Excel file not found at:', EXCEL_PATH);
    process.exit(1);
  }

  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets['Loan Amortization'];
  if (!ws) {
    console.error('Tab "Loan Amortization" not found in workbook!');
    process.exit(1);
  }

  const rawRows = XLSX.utils.sheet_to_json(ws);
  console.log(`[Loan Amortization] Loaded ${rawRows.length} total raw rows.`);

  const actualRecords = [];
  let totalDisbursed = 0;
  let totalEmiPaid = 0;
  let totalBulkPaid = 0;
  let totalInterestPaid = 0;
  let totalPrincipalPaid = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const serial = Number(r.Date);
    if (isNaN(serial)) continue; // skip header/summary rows like 'Total'

    const dateStr = formatYMD(serial);
    if (!dateStr) continue;

    // Only ingest actual historical records up to September 2026
    if (dateStr > '2026-09-05') break;

    const rateRaw = Number(r['Interest Rate']) || 0;
    const ratePct = rateRaw < 1 ? Number((rateRaw * 100).toFixed(4)) : rateRaw;
    const daysBetween = Number(r['Days Between']) || 0;
    const disbursed = Number(r['Loan Disbursed']) || 0;
    const emi = Number(r['EMI']) || 0;
    const bulk = Number(r['Bulk Payment']) || 0;
    const openingBal = Number(r['Opening Balance']) || 0;
    const interest = Number(r['Interest']) || 0;
    const principal = Number(r['Principal']) || 0;
    const closingBal = Number(r['Closing Balance']) || 0;

    let entryType = 'EMI';
    if (disbursed > 0 && emi === 0 && bulk === 0) {
      entryType = 'DISBURSEMENT';
    } else if (bulk > 0 && emi > 0) {
      entryType = 'EMI_WITH_PREPAYMENT';
    } else if (bulk > 0 && emi === 0) {
      entryType = 'PREPAYMENT';
    } else if (emi > 0) {
      entryType = 'EMI';
    } else if (daysBetween > 0 && interest === 0 && principal === 0) {
      entryType = 'RATE_CHANGE';
    } else {
      entryType = 'FEE_OR_ADJUSTMENT';
    }

    totalDisbursed += disbursed;
    totalEmiPaid += emi;
    totalBulkPaid += bulk;
    totalInterestPaid += interest;
    totalPrincipalPaid += principal;

    actualRecords.push({
      liability_id: HOUSING_LOAN_ID,
      date: dateStr,
      entry_type: entryType,
      interest_rate: ratePct,
      days_between: daysBetween,
      disbursed_amount: disbursed,
      emi_amount: emi,
      bulk_payment: bulk,
      opening_balance: openingBal,
      interest_amount: interest,
      principal_amount: principal,
      closing_balance: closingBal,
      is_settled: true,
      notes: r.Column1 ? String(r.Column1) : null
    });
  }

  console.log(`[Loan Amortization] Processed ${actualRecords.length} historical records.`);
  console.log(`- Total Disbursed: ₹${totalDisbursed.toLocaleString('en-IN')}`);
  console.log(`- Total EMI Paid: ₹${totalEmiPaid.toLocaleString('en-IN')}`);
  console.log(`- Total Bulk Prepayments: ₹${totalBulkPaid.toLocaleString('en-IN')}`);
  console.log(`- Total Interest Paid: ₹${totalInterestPaid.toLocaleString('en-IN')}`);
  console.log(`- Total Principal Paid: ₹${totalPrincipalPaid.toLocaleString('en-IN')}`);
  const latest = actualRecords[actualRecords.length - 1];
  console.log(`- Latest Balance (${latest.date}): ₹${latest.closing_balance.toLocaleString('en-IN')}`);

  // Save local JSON backup
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(actualRecords, null, 2));
  console.log(`[Loan Amortization] Saved ${actualRecords.length} records to ${OUTPUT_JSON_PATH}`);

  // Populate into Supabase table loan_amortization
  console.log('[Loan Amortization] Syncing with Supabase table loan_amortization...');
  // Clear existing records for this liability to prevent duplicates
  const { error: delError } = await supabase
    .from('loan_amortization')
    .delete()
    .eq('liability_id', HOUSING_LOAN_ID);

  if (delError) {
    console.warn('[Supabase Warning] Could not clear existing records:', delError.message);
  }

  // Batch insert in chunks of 50
  for (let i = 0; i < actualRecords.length; i += 50) {
    const chunk = actualRecords.slice(i, i + 50);
    const { error: insError } = await supabase
      .from('loan_amortization')
      .insert(chunk);
    if (insError) {
      console.error(`[Supabase Error] Chunk ${i}-${i + chunk.length}:`, insError.message);
    }
  }

  console.log('[Loan Amortization] Successfully ingested all records into Supabase!');
}

main().catch(err => {
  console.error('[Loan Amortization] Ingestion script failed:', err);
  process.exit(1);
});
