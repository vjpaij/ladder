import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../server/supabaseClient.js';
import { db, initDatabase, saveCacheSnapshotToDisk } from '../server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_JSON_PATH = path.join(__dirname, '../data/loan_amortization.json');

async function syncLoanAmortization() {
  console.log('--- Syncing Loan Amortization Statement History to Database ---');
  await initDatabase();

  const liabilityId = '00000000-0000-0000-0000-000000000010';
  const rawData = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf-8'));
  console.log(`Loaded ${rawData.length} entries from data/loan_amortization.json`);

  // Ensure item 161 (the RATE_CHANGE on 2026-10-15) has correct chain balance
  const lastIndex = rawData.length - 1;
  const prevRow = rawData[lastIndex - 1];
  const lastRow = rawData[lastIndex];

  if (lastRow.entry_type === 'RATE_CHANGE') {
    lastRow.opening_balance = prevRow.closing_balance;
    lastRow.closing_balance = prevRow.closing_balance;
    lastRow.disbursed_amount = 0;
    lastRow.bulk_payment = 0;
    lastRow.interest_amount = 0;
    lastRow.principal_amount = 0;
    lastRow.emi_amount = 0;
    lastRow.notes = lastRow.notes || `Interest rate changed to ${lastRow.interest_rate}% p.a.`;
    lastRow.is_settled = true;
  }

  // Save updated JSON back to file
  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(rawData, null, 2));
  console.log('✓ Validated and updated data/loan_amortization.json');

  // Clear existing rows for this liability in Supabase
  console.log('Clearing existing rows in Supabase loan_amortization...');
  const { error: delError } = await supabase
    .from('loan_amortization')
    .delete()
    .eq('liability_id', liabilityId);

  if (delError) {
    console.warn('Delete existing rows warning:', delError.message);
  }

  // Sanitize rows for insert
  const rowsToInsert = rawData.map(r => ({
    liability_id: r.liability_id || liabilityId,
    date: r.date,
    entry_type: r.entry_type || 'EMI',
    interest_rate: Number(r.interest_rate) || 7.25,
    days_between: Number(r.days_between) || 0,
    disbursed_amount: Number(r.disbursed_amount) || 0,
    emi_amount: Number(r.emi_amount) || 0,
    bulk_payment: Number(r.bulk_payment) || 0,
    opening_balance: Number(r.opening_balance) || 0,
    interest_amount: Number(r.interest_amount) || 0,
    principal_amount: Number(r.principal_amount) || 0,
    closing_balance: Number(r.closing_balance) || 0,
    is_settled: r.is_settled !== false,
    notes: r.notes || null
  }));

  // Batch insert into Supabase (chunks of 50)
  const batchSize = 50;
  for (let i = 0; i < rowsToInsert.length; i += batchSize) {
    const chunk = rowsToInsert.slice(i, i + batchSize);
    const { error: insError } = await supabase
      .from('loan_amortization')
      .insert(chunk);

    if (insError) {
      console.error(`Failed to insert batch ${i} - ${i + chunk.length}:`, insError.message);
      throw insError;
    }
  }

  console.log(`✓ Successfully inserted all ${rowsToInsert.length} records into Supabase loan_amortization!`);

  // Verify in Supabase
  const { count, error: countErr } = await supabase
    .from('loan_amortization')
    .select('*', { count: 'exact', head: true })
    .eq('liability_id', liabilityId);

  console.log(`✓ Supabase loan_amortization count: ${count}`);

  // Update liabilities table with latest verified status
  const finalBal = rawData[lastIndex].closing_balance;
  const finalRate = rawData[lastIndex].interest_rate || 7.5;
  console.log(`Updating liability ${liabilityId} with outstanding_balance=${finalBal}, interest_rate=${finalRate}`);

  await supabase
    .from('liabilities')
    .update({
      outstanding_balance: finalBal,
      interest_rate: finalRate,
      updated_at: new Date().toISOString()
    })
    .eq('id', liabilityId);

  // Invalidate in-memory caches
  db.invalidateCache('loan_amortization');
  db.invalidateCache('liabilities');
  db.invalidateCache('transactions');
  saveCacheSnapshotToDisk({ allowEmptyReplacement: true });

  console.log('✓ In-memory caches invalidated and snapshot persisted to disk.');
  console.log('--- Migration Complete ---');
}

syncLoanAmortization()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  });
