import fs from 'fs';
import path from 'path';
import { supabase } from '../server/supabaseClient.js';
import { recalculateHoldingState } from '../server/services/recalculator.js';

const eodFile = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
if (!fs.existsSync(eodFile)) {
  console.error('portfolio_eod_logs.json not found!');
  process.exit(1);
}

const logs = JSON.parse(fs.readFileSync(eodFile, 'utf-8'));
console.log(`[Migration] Loaded ${logs.length} EOD entries from 2007 to 2026.`);

const INSTRUMENTS = [
  { key: 'hdfc', id: '00000000-0000-0000-0000-000000000001', symbol: 'HDFC-SAVINGS', name: 'HDFC Bank Savings Account', cat: 'bank' },
  { key: 'indusind', id: '00000000-0000-0000-0000-000000000002', symbol: 'INDUSIND-SAVINGS', name: 'IndusInd Bank Savings Account', cat: 'bank' },
  { key: 'idfc', id: '00000000-0000-0000-0000-000000000003', symbol: 'IDFC-SAVINGS', name: 'IDFC FIRST Bank Savings Account', cat: 'bank' },
  { key: 'rbl', id: '00000000-0000-0000-0000-000000000004', symbol: 'RBL-SAVINGS', name: 'RBL Bank Savings Account', cat: 'bank' },
  { key: 'sbi', id: '00000000-0000-0000-0000-000000000005', symbol: 'SBI-SAVINGS', name: 'State Bank of India (SBI) Savings Account', cat: 'bank' },
  { key: 'federal', id: '00000000-0000-0000-0000-000000000006', symbol: 'FEDERAL-SAVINGS', name: 'Federal Bank Savings Account', cat: 'bank' },
  { key: 'epf', id: '00000000-0000-0000-0000-000000000007', symbol: 'EPF-RETIREMENT', name: 'EPF', cat: 'epf' },
  { key: 'loan', id: '00000000-0000-0000-0000-000000000010', symbol: 'SBI-LOAN', name: 'Housing Loan (SBI Bank)', cat: 'loans' },
  { key: 'credits', id: '00000000-0000-0000-0000-000000000011', symbol: 'ICICI-AMAZON-CC', name: 'ICICI Amazon Card', cat: 'credit_cards' }
];

async function migrate() {
  const allTxsToInsert = [];

  for (const inst of INSTRUMENTS) {
    let prev = 0;
    let seq = 1;

    for (const log of logs) {
      const val = Number(log[inst.key]) || 0;
      const diff = val - prev;

      if (Math.abs(diff) > 0.001) {
        let type = 'CREDIT';
        let notes = '';

        if (inst.cat === 'bank') {
          type = diff > 0 ? 'CREDIT' : 'DEBIT';
          notes = diff > 0 ? `Bank Deposit / Inflow: +₹${Math.abs(diff).toFixed(2)}` : `Bank Withdrawal / Spend: -₹${Math.abs(diff).toFixed(2)}`;
        } else if (inst.cat === 'epf') {
          type = diff > 0 ? 'CONTRIBUTION' : 'WITHDRAWAL';
          notes = diff > 0 ? `EPF Contribution: +₹${Math.abs(diff).toFixed(2)}` : `EPF Withdrawal: -₹${Math.abs(diff).toFixed(2)}`;
        } else if (inst.cat === 'loans') {
          type = diff > 0 ? 'BORROW' : 'EMI_PAYMENT';
          notes = diff > 0 ? `Loan Disbursement: +₹${Math.abs(diff).toFixed(2)}` : `Loan EMI / Prepayment: -₹${Math.abs(diff).toFixed(2)}`;
        } else if (inst.cat === 'credit_cards') {
          type = diff > 0 ? 'CHARGE' : 'BILL_PAYMENT';
          notes = diff > 0 ? `Card Expense: +₹${Math.abs(diff).toFixed(2)}` : `Card Payment: -₹${Math.abs(diff).toFixed(2)}`;
        }

        const isLiability = ['loans', 'credit_cards'].includes(inst.cat);

        allTxsToInsert.push({
          holding_id: isLiability ? null : inst.id,
          liability_id: isLiability ? inst.id : null,
          type: type,
          quantity: 1,
          price: Math.abs(diff),
          total_amount: Math.abs(diff),
          charges: 0,
          currency: 'INR',
          date: log.date,
          symbol: inst.symbol,
          name: inst.name,
          notes: notes
        });

        prev = val;
        seq++;
      }
    }
  }

  console.log(`[Migration] Generated ${allTxsToInsert.length} total delta transactions across Bank, EPF, Loans & Cards.`);

  // Purge any existing transactions for these holding IDs and liability IDs
  for (const inst of INSTRUMENTS) {
    if (['loans', 'credit_cards'].includes(inst.cat)) {
      await supabase.from('transactions').delete().eq('liability_id', inst.id);
    } else {
      await supabase.from('transactions').delete().eq('holding_id', inst.id);
    }
  }

  // Batch insert in smaller chunks (100 rows) to avoid statement timeouts
  const batchSize = 100;
  for (let i = 0; i < allTxsToInsert.length; i += batchSize) {
    const chunk = allTxsToInsert.slice(i, i + batchSize);
    process.stdout.write(`[Migration] Inserting batch ${i} - ${i + chunk.length}... `);
    const { error } = await supabase.from('transactions').insert(chunk);
    if (error) {
      console.error('Batch Insert Error:', error.message);
      throw error;
    }
    console.log('Done.');
  }

  console.log('[Migration] All delta transactions saved to database!');

  // Recalculate holding state for all 9 instruments
  for (const inst of INSTRUMENTS) {
    console.log(`[Migration] Recalculating ${inst.name}...`);
    await recalculateHoldingState(inst.id);
  }

  console.log('[Migration] Bank, EPF, Loans & Credit Cards delta-ledger migration complete!');
}

migrate().catch(err => {
  console.error('[Migration Failed]:', err);
  process.exit(1);
});
