import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function fastAudit() {
  console.log('=== FAST BATCH AUDIT OF INDIAN STOCKS ===');

  const wb1 = XLSX.readFile('./Indian Stocks/Book1.xlsx');
  const b1Rows = XLSX.utils.sheet_to_json(wb1.Sheets['Sheet1'], { defval: '' });
  const b1SymRows = {};
  for (const r of b1Rows) {
    const sym = r['Display Symbol'];
    if (!sym || !r['Type'] || !r['Transaction Date']) continue;
    if (!b1SymRows[sym]) b1SymRows[sym] = [];
    b1SymRows[sym].push(r);
  }

  // Fetch all in_stocks holdings
  let inHoldings = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('holdings').select('*').eq('category_id', 'in_stocks').range(from, from + 999);
    if (!data || data.length === 0) break;
    inHoldings = inHoldings.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  // Fetch all in_stocks transactions in bulk
  const holdingIds = inHoldings.map(h => h.id);
  let allTxs = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('transactions').select('id, holding_id, type, date, quantity, price, total_amount, charges').in('holding_id', holdingIds).range(from, from + 999);
    if (!data || data.length === 0) break;
    allTxs = allTxs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const txByHolding = {};
  for (const t of allTxs) {
    if (!txByHolding[t.holding_id]) txByHolding[t.holding_id] = [];
    txByHolding[t.holding_id].push(t);
  }

  let countMismatches = 0;
  for (const h of inHoldings) {
    const b1Count = (b1SymRows[h.symbol] || []).length;
    const dbCount = (txByHolding[h.id] || []).length;
    if (b1Count !== dbCount) {
      countMismatches++;
      console.log(`[Mismatch] ${h.symbol}: Book1 = ${b1Count} rows, DB = ${dbCount} txs`);
    }
  }

  console.log(`\nAudit Complete: ${inHoldings.length} symbols checked.`);
  console.log(`Total Symbols with count mismatch: ${countMismatches}`);
  console.log(`Total Transactions in Book1: ${Object.values(b1SymRows).reduce((s, r) => s + r.length, 0)}`);
  console.log(`Total Transactions in DB: ${allTxs.length}`);
}

fastAudit();
