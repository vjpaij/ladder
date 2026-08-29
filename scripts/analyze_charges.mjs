import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

function excelDateToJSDate(serial) {
  if (typeof serial === 'number') {
    const utc_days  = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;                                        
    const date_info = new Date(utc_value * 1000);
    return date_info.toISOString().split('T')[0];
  }
  if (typeof serial === 'string') {
    return serial.split('T')[0];
  }
  return null;
}

// Known symbol aliases confirmed by user
const SYMBOL_MAP = {
  'HDFC': 'HDFCBANK',
  'MAHINDCIE': 'CIEINDIA',
  'HBLPOWER': 'HBLENGINE',
  'ZOMATO': 'ETERNAL',
  'GET&D': 'GVT&D',
  'SKIPPERPP': 'SKIPPER'
};

async function fetchAllIndianTransactions() {
  let allTxs = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, holding_id, symbol, date, type, quantity, price, charges, holdings!inner(category_id)')
      .eq('holdings.category_id', 'in_stocks')
      .range(from, from + step - 1)
      .order('date', { ascending: true });

    if (error) throw error;
    allTxs = allTxs.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return allTxs;
}

async function runDryRun() {
  const wb = xlsx.readFile('charges.xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const excelRows = xlsx.utils.sheet_to_json(sheet);

  const dbTxs = await fetchAllIndianTransactions();


  console.log(`Total Indian Equity DB Transactions in database: ${dbTxs.length}`);
  console.log(`Total rows in charges.xlsx: ${excelRows.length}`);

  // Parse Excel records
  const parsedExcel = excelRows.map((r, idx) => {
    let sym = (r['Trading Symbol'] || '').trim().toUpperCase();
    if (SYMBOL_MAP[sym]) sym = SYMBOL_MAP[sym];
    return {
      rowIndex: idx + 2,
      rawSymbol: (r['Trading Symbol'] || '').trim().toUpperCase(),
      symbol: sym,
      date: excelDateToJSDate(r['Order Date']),
      charges: parseFloat(r['Total Charges']) || 0,
      orderNo: r['Order No']
    };
  }).filter(r => r.symbol && r.date);

  // Aggregate Excel records by Symbol + Date
  const excelMap = new Map();
  for (const r of parsedExcel) {
    const key = `${r.symbol}_${r.date}`;
    if (!excelMap.has(key)) {
      excelMap.set(key, []);
    }
    excelMap.get(key).push(r);
  }

  console.log(`Total unique (Symbol, Date) in charges.xlsx (with alias mapping): ${excelMap.size}`);

  // ==========================================
  // SECTION 1: Pre-May 12, 2023 Analysis
  // ==========================================
  console.log('\n======================================================');
  console.log('1. PRE-MAY 12, 2023 DRY RUN (Proposed for DB Update)');
  console.log('======================================================');

  const preExcelKeys = Array.from(excelMap.keys()).filter(k => k.split('_')[1] < '2023-05-12');
  let preMatchedApplicable = 0;
  const preUnmatchedReport = [];

  for (const key of preExcelKeys) {
    const [sym, dt] = key.split('_');
    const excelOrders = excelMap.get(key);
    const totalExcelCharges = excelOrders.reduce((sum, o) => sum + o.charges, 0);

    const matchingDbTxs = dbTxs.filter(t => t.symbol === sym && t.date === dt && (t.type === 'BUY' || t.type === 'SELL'));

    if (matchingDbTxs.length > 0) {
      preMatchedApplicable++;
    } else {
      // Find nearby transactions for the same symbol in DB within +- 15 days to see possible date mismatch
      const nearbyTxs = dbTxs.filter(t => t.symbol === sym && Math.abs(new Date(t.date) - new Date(dt)) <= 15 * 86400000);
      preUnmatchedReport.push({
        symbol: sym,
        rawSymbol: excelOrders[0].rawSymbol,
        excelDate: dt,
        excelCharges: totalExcelCharges,
        excelOrdersCount: excelOrders.length,
        status: 'No DB transaction on exact date',
        nearbyDbTransactions: nearbyTxs.map(n => ({ date: n.date, type: n.type, qty: n.quantity, price: n.price, charges: n.charges }))
      });
    }
  }

  console.log(`Pre-2023-05-12 Unique (Symbol, Date) in Excel: ${preExcelKeys.length}`);
  console.log(`Successfully matched & ready to apply: ${preMatchedApplicable}`);
  console.log(`Unmatched / Date mismatch to report: ${preUnmatchedReport.length}`);
  console.log('Pre-2023-05-12 Unmatched items:');
  console.log(JSON.stringify(preUnmatchedReport, null, 2));

  // ==========================================
  // SECTION 2: Post-May 12, 2023 (>= 2023-05-12) Analysis
  // ==========================================
  console.log('\n======================================================');
  console.log('2. POST-MAY 12, 2023 DRY RUN & CHARGES STATUS AUDIT');
  console.log('======================================================');

  const postExcelKeys = Array.from(excelMap.keys()).filter(k => k.split('_')[1] >= '2023-05-12');
  let postExactMatchedWithCharges = 0;
  let postExactMatchedZeroCharges = 0;
  const postMissingOrZeroReport = [];

  for (const key of postExcelKeys) {
    const [sym, dt] = key.split('_');
    const excelOrders = excelMap.get(key);
    const totalExcelCharges = excelOrders.reduce((sum, o) => sum + o.charges, 0);

    const matchingDbTxs = dbTxs.filter(t => t.symbol === sym && t.date === dt && (t.type === 'BUY' || t.type === 'SELL'));

    if (matchingDbTxs.length > 0) {
      const hasCharges = matchingDbTxs.some(t => t.charges !== null && t.charges > 0);
      if (hasCharges) {
        postExactMatchedWithCharges++;
      } else {
        postExactMatchedZeroCharges++;
        postMissingOrZeroReport.push({
          symbol: sym,
          rawSymbol: excelOrders[0].rawSymbol,
          excelDate: dt,
          excelCharges: totalExcelCharges,
          status: 'DB transaction exists on exact date but charges = 0/null',
          dbTransactions: matchingDbTxs.map(t => ({ id: t.id, type: t.type, qty: t.quantity, price: t.price, charges: t.charges }))
        });
      }
    } else {
      const nearbyTxs = dbTxs.filter(t => t.symbol === sym && Math.abs(new Date(t.date) - new Date(dt)) <= 15 * 86400000);
      postMissingOrZeroReport.push({
        symbol: sym,
        rawSymbol: excelOrders[0].rawSymbol,
        excelDate: dt,
        excelCharges: totalExcelCharges,
        status: 'No DB transaction on exact date (Date mismatch / Missing in DB)',
        nearbyDbTransactions: nearbyTxs.map(n => ({ date: n.date, type: n.type, qty: n.quantity, price: n.price, charges: n.charges }))
      });
    }
  }

  console.log(`Post-2023-05-12 Unique (Symbol, Date) in Excel: ${postExcelKeys.length}`);
  console.log(`DB Transaction exists and ALREADY has charges populated: ${postExactMatchedWithCharges}`);
  console.log(`DB Transaction exists but charges are ZERO/NULL: ${postExactMatchedZeroCharges}`);
  console.log(`No DB transaction on exact date (Date mismatch / Missing): ${postMissingOrZeroReport.filter(r => r.status.includes('No DB transaction')).length}`);
  console.log(`Total Post-2023-05-12 items needing user review / reported: ${postMissingOrZeroReport.length}`);

  console.log('\n======================================================');
  console.log('SUMMARY REPORT FOR USER');
  console.log('======================================================');
  console.log(`Pre-2023-05-12 Unique (Symbol, Date) in charges.xlsx: ${preExcelKeys.length}`);
  console.log(`- Exact Matched (ready to apply with HDFC/MAHINDCIE alias mapping): ${preMatchedApplicable}`);
  console.log(`- Date Mismatch (excluded from update): ${preUnmatchedReport.length}`);

  const postMissingDateMismatch = postMissingOrZeroReport.filter(r => r.status.includes('No DB transaction'));
  console.log(`\n18 Post-2023-05-12 Date Mismatch / Missing Records in DB:`);
  console.log(JSON.stringify(postMissingDateMismatch, null, 2));
}

runDryRun();




