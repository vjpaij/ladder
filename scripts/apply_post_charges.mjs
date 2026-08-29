import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

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

// User-confirmed symbol aliases
const SYMBOL_MAP = {
  'HDFC': 'HDFCBANK',
  'MAHINDCIE': 'CIEINDIA',
  'HBLPOWER': 'HBLENGINE',
  'ZOMATO': 'ETERNAL',
  'GET&D': 'GVT&D',
  'SKIPPERPP': 'SKIPPER'
};

async function fetchAllRecords(table, filterCol, filterVal) {
  let allRows = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let query = supabase.from(table).select('*');
    if (filterCol && filterVal) {
      query = query.eq(filterCol, filterVal);
    }
    const { data, error } = await query.range(from, from + step - 1);
    if (error) throw error;
    allRows = allRows.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return allRows;
}

async function applyPostCharges() {
  console.log('=== STARTING POST-MAY 12 2023 MISSING CHARGES UPDATE ===\n');

  // 1. Read charges.xlsx
  const wb = xlsx.readFile('charges.xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const excelRows = xlsx.utils.sheet_to_json(sheet);

  console.log(`Total rows in charges.xlsx: ${excelRows.length}`);

  // 2. Fetch Indian equity holdings and transactions from DB
  const holdings = await fetchAllRecords('holdings', 'category_id', 'in_stocks');
  const holdingsMap = new Map();
  holdings.forEach(h => holdingsMap.set(h.id, h));

  const allTxs = await fetchAllRecords('transactions', null, null);
  const inStocksTxs = allTxs.filter(t => holdingsMap.has(t.holding_id));
  console.log(`Total Indian Equity holdings in DB: ${holdings.length}`);
  console.log(`Total Indian Equity transactions in DB: ${inStocksTxs.length}`);

  // 3. Filter Excel rows for strictly >= 2023-05-12
  const postExcelRows = excelRows.map((r, idx) => {
    let sym = (r['Trading Symbol'] || '').trim().toUpperCase();
    if (SYMBOL_MAP[sym]) sym = SYMBOL_MAP[sym];
    return {
      rawSymbol: (r['Trading Symbol'] || '').trim().toUpperCase(),
      symbol: sym,
      date: excelDateToJSDate(r['Order Date']),
      charges: parseFloat(r['Total Charges']) || 0,
      orderNo: r['Order No']
    };
  }).filter(r => r.symbol && r.date && r.date >= '2023-05-12');

  console.log(`Total Excel rows on or after 2023-05-12: ${postExcelRows.length}`);

  // 4. Aggregate Excel charges by (Symbol, Date)
  const excelAgg = new Map();
  for (const r of postExcelRows) {
    const key = `${r.symbol}_${r.date}`;
    if (!excelAgg.has(key)) {
      excelAgg.set(key, { symbol: r.symbol, rawSymbol: r.rawSymbol, date: r.date, totalCharges: 0, count: 0 });
    }
    const item = excelAgg.get(key);
    item.totalCharges += r.charges;
    item.count++;
  }

  console.log(`Total unique (Symbol, Date) combinations in Excel (>= 2023-05-12): ${excelAgg.size}\n`);

  let updatedTxCount = 0;
  let alreadyHasChargesCount = 0;
  let skippedDateMismatchCount = 0;
  const skippedReport = [];
  const updatedHoldingIds = new Set();

  for (const [key, item] of excelAgg.entries()) {
    const sym = item.symbol;
    const dt = item.date;
    const totalCharge = parseFloat(item.totalCharges.toFixed(2));

    // Find DB transactions for this symbol on this date
    const matchingTxs = inStocksTxs.filter(t => t.symbol === sym && t.date === dt && (t.type === 'BUY' || t.type === 'SELL'));

    if (matchingTxs.length === 0) {
      skippedDateMismatchCount++;
      skippedReport.push({
        symbol: sym,
        rawSymbol: item.rawSymbol,
        date: dt,
        excelCharges: totalCharge,
        reason: 'No DB transaction on exact date'
      });
      continue;
    }

    // Check if charges are already populated (> 0) on any transaction for this symbol on this date
    const alreadyHasCharges = matchingTxs.some(t => t.charges !== null && t.charges > 0);
    if (alreadyHasCharges) {
      alreadyHasChargesCount++;
      continue;
    }

    // If multiple transactions exist on this date, pick the one with highest trade value (qty * price)
    matchingTxs.sort((a, b) => {
      const valA = (Number(a.quantity) || 0) * (Number(a.price) || 0);
      const valB = (Number(b.quantity) || 0) * (Number(b.price) || 0);
      return valB - valA;
    });

    const targetTx = matchingTxs[0];
    const targetHoldingId = targetTx.holding_id;
    updatedHoldingIds.add(targetHoldingId);

    // 1. Update target transaction with total charges and recalculated net_amount
    const newNetAmount = parseFloat(((Number(targetTx.total_amount) || 0) + totalCharge).toFixed(2));
    const { error: updErr } = await supabase
      .from('transactions')
      .update({
        charges: totalCharge,
        net_amount: newNetAmount
      })
      .eq('id', targetTx.id);

    if (updErr) {
      console.error(`Error updating transaction ${targetTx.id} (${sym} ${dt}):`, updErr.message);
      continue;
    }

    // 2. If there were other transactions on the same date for this symbol, ensure their charges = 0
    if (matchingTxs.length > 1) {
      for (let i = 1; i < matchingTxs.length; i++) {
        const otherTx = matchingTxs[i];
        if (otherTx.charges !== 0) {
          await supabase
            .from('transactions')
            .update({
              charges: 0,
              net_amount: parseFloat((Number(otherTx.total_amount) || 0).toFixed(2))
            })
            .eq('id', otherTx.id);
        }
      }
    }

    updatedTxCount++;
  }

  console.log(`Already had charges populated (> 0): ${alreadyHasChargesCount}`);
  console.log(`Successfully updated ${updatedTxCount} transactions in database.`);
  console.log(`Skipped ${skippedDateMismatchCount} date mismatches.\n`);

  // 5. Recalculate holding-level total_charges for all affected holdings
  console.log(`Recalculating total_charges for ${updatedHoldingIds.size} affected holdings...`);
  
  for (const hId of updatedHoldingIds) {
    const { data: hTxs, error: hTxErr } = await supabase
      .from('transactions')
      .select('charges')
      .eq('holding_id', hId);

    if (hTxErr) {
      console.error(`Error fetching transactions for holding ${hId}:`, hTxErr.message);
      continue;
    }

    const totalHoldingCharges = hTxs.reduce((sum, t) => sum + (Number(t.charges) || 0), 0);
    const roundedTotalCharges = parseFloat(totalHoldingCharges.toFixed(2));

    const { error: hUpdErr } = await supabase
      .from('holdings')
      .update({
        total_charges: roundedTotalCharges,
        updated_at: new Date().toISOString()
      })
      .eq('id', hId);

    if (hUpdErr) {
      console.error(`Error updating holding ${hId}:`, hUpdErr.message);
    }
  }

  console.log('Holding total_charges recalculation complete.\n');

  console.log('=== SKIPPED DATE MISMATCH REPORT (POST-MAY 12 2023) ===');
  console.log(JSON.stringify(skippedReport, null, 2));
}

applyPostCharges().catch(console.error);
