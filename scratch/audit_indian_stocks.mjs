import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function auditIndianStocks() {
  console.log('=== AUDITING INDIAN STOCKS HOLDINGS & TRANSACTIONS ===');

  const wb1 = XLSX.readFile('./Indian Stocks/Book1.xlsx');
  const b1Rows = XLSX.utils.sheet_to_json(wb1.Sheets['Sheet1'], { defval: '' });
  const b1Symbols = [...new Set(b1Rows.map(r => r['Display Symbol']).filter(Boolean))];

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
  console.log('Indian Stock Holdings in DB:', inHoldings.length, 'vs Book1 unique symbols:', b1Symbols.length);

  const dbSymMap = {};
  inHoldings.forEach(h => dbSymMap[h.symbol] = h);

  // Check missing symbols
  const missingInDb = b1Symbols.filter(s => !dbSymMap[s]);
  console.log('Symbols in Book1 but missing in DB:', missingInDb.length, missingInDb);

  // For all holdings, check transaction count
  let txMismatchCount = 0;
  for (const sym of b1Symbols) {
    const h = dbSymMap[sym];
    if (!h) continue;

    const b1SymRows = b1Rows.filter(r => r['Display Symbol'] === sym && r['Type'] !== '' && r['Transaction Date'] !== '');
    const { data: txs } = await supabase.from('transactions').select('id, type').eq('holding_id', h.id);

    if ((txs?.length || 0) !== b1SymRows.length) {
      txMismatchCount++;
      if (txMismatchCount <= 5) {
        console.log(`[Tx Count Mismatch] Symbol ${sym}: DB txs = ${txs?.length} vs Book1 rows = ${b1SymRows.length}`);
      }
    }
  }

  console.log('Total Symbols with transaction count mismatch:', txMismatchCount);
}

auditIndianStocks();
