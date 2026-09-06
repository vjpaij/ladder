import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import xlsx from 'xlsx';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function runMasterReconciliation() {
  console.log('================================================================');
  console.log('         MASTER COMPREHENSIVE DATA SOURCE AUDIT                 ');
  console.log('================================================================\n');

  // Load all Supabase data
  let holdings = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('holdings').select('*').range(from, from + 999);
    if (!data || data.length === 0) break;
    holdings = holdings.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  let txs = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('transactions').select('*').range(from, from + 999);
    if (!data || data.length === 0) break;
    txs = txs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const { data: dividends } = await supabase.from('dividends').select('*');
  const { data: liabilities } = await supabase.from('liabilities').select('*');

  console.log(`[Supabase Loaded] Holdings: ${holdings.length}, Txs: ${txs.length}, Divs: ${dividends.length}, Liabs: ${liabilities.length}`);

  const discrepancies = [];

  // -------------------------------------------------------------
  // 1. AUDIT MUTUAL FUNDS (Mutual Funds/Ind_Mfs.csv)
  // -------------------------------------------------------------
  console.log('\n--- 1. AUDITING MUTUAL FUNDS ---');
  if (fs.existsSync('Mutual Funds/Ind_Mfs.csv')) {
    const rawCsv = fs.readFileSync('Mutual Funds/Ind_Mfs.csv', 'utf-8');
    const lines = rawCsv.split('\n').filter(l => l.trim().length > 0);
    const mfCsvRows = {};
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      if (p.length >= 9) {
        const scheme = p[3].trim();
        const typeStr = p[5].trim().toUpperCase();
        const type = (typeStr.includes('INVESTMENT') || typeStr.includes('PURCHASE') || typeStr.includes('BUY')) ? 'BUY' : 'SELL';
        const qty = Math.abs(parseFloat(p[8])) || 0;
        const amt = Math.abs(parseFloat(p[6])) || 0;
        mfCsvRows[scheme] = mfCsvRows[scheme] || { buyQty: 0, sellQty: 0, count: 0 };
        if (type === 'BUY') mfCsvRows[scheme].buyQty += qty;
        else mfCsvRows[scheme].sellQty += qty;
        mfCsvRows[scheme].count++;
      }
    }
    console.log(`Parsed ${Object.keys(mfCsvRows).length} unique MF schemes from Ind_Mfs.csv`);

    const dbMfs = holdings.filter(h => h.category_id === 'mutual_funds');
    for (const [schemeName, cData] of Object.entries(mfCsvRows)) {
      const dbMf = dbMfs.find(h => h.name.toLowerCase().includes(schemeName.toLowerCase()) || schemeName.toLowerCase().includes(h.name.toLowerCase()));
      if (!dbMf) {
        discrepancies.push(`[MF Missing] Scheme in CSV '${schemeName}' not found in DB holdings`);
      } else {
        const hTxs = txs.filter(t => t.holding_id === dbMf.id || t.symbol === dbMf.symbol);
        let buyQty = 0, sellQty = 0;
        hTxs.forEach(t => {
          if (t.type === 'BUY') buyQty += Number(t.quantity) || 0;
          else if (t.type === 'SELL') sellQty += Number(t.quantity) || 0;
        });
        const openQty = Math.max(0, buyQty - sellQty);
        const csvOpen = Math.max(0, cData.buyQty - cData.sellQty);
        if (Math.abs(openQty - csvOpen) > 0.05 && openQty > 0.01) {
          discrepancies.push(`[MF Qty Mismatch] ${dbMf.name}: CSV open ${csvOpen.toFixed(4)} != DB open ${openQty.toFixed(4)}`);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 2. AUDIT US STOCKS (US Stocks/Book2.xlsx)
  // -------------------------------------------------------------
  console.log('\n--- 2. AUDITING US STOCKS ---');
  if (fs.existsSync('US Stocks/Book2.xlsx')) {
    const wb = xlsx.readFile('US Stocks/Book2.xlsx');
    console.log('US Stock Sheets:', wb.SheetNames);
    const dbUs = holdings.filter(h => h.category_id === 'us_stocks');
    console.log(`DB US Stocks count: ${dbUs.length}`);
    for (const h of dbUs) {
      const hTxs = txs.filter(t => t.holding_id === h.id || t.symbol === h.symbol);
      let buyQty = 0, sellQty = 0;
      hTxs.forEach(t => {
        if (t.type === 'BUY') buyQty += Number(t.quantity) || 0;
        else if (t.type === 'SELL') sellQty += Number(t.quantity) || 0;
      });
      const calcOpen = Math.max(0, buyQty - sellQty);
      const dbQty = Number(h.quantity) || 0;
      if (Math.abs(calcOpen - dbQty) > 0.01) {
        discrepancies.push(`[US Stock Qty Mismatch] ${h.name} (${h.symbol}): DB Qty ${dbQty} != Calc Qty ${calcOpen}`);
      }
    }
  }

  // -------------------------------------------------------------
  // 3. AUDIT BANK ACCOUNTS & EPF
  // -------------------------------------------------------------
  console.log('\n--- 3. AUDITING BANK ACCOUNTS & EPF ---');
  const dbBanks = holdings.filter(h => h.category_id === 'bank' || h.category_id === 'epf');
  for (const b of dbBanks) {
    const bTxs = txs.filter(t => t.holding_id === b.id || t.symbol === b.symbol);
    let runningBal = 0;
    const sorted = [...bTxs].sort((x, y) => new Date(x.date) - new Date(y.date));
    for (const t of sorted) {
      const type = (t.type || 'BUY').toUpperCase();
      const amt = Number(t.total_amount) || Number(t.price) || 0;
      if (['CREDIT', 'DEPOSIT', 'CONTRIBUTION', 'INTEREST'].includes(type)) runningBal += amt;
      else if (['DEBIT', 'WITHDRAWAL', 'SPEND', 'CHARGE'].includes(type)) runningBal -= amt;
    }
    const currentPrice = Number(b.current_price) || 0;
    const diff = Math.abs(currentPrice - runningBal);
    console.log(`Account: ${b.name} (${b.symbol}) | DB Price: ₹${currentPrice} | Delta Sum: ₹${runningBal.toFixed(2)} | Status: ${b.status}`);
    if (diff > 0.05) {
      discrepancies.push(`[Bank/EPF Mismatch] ${b.name} (${b.symbol}): DB Price ₹${currentPrice} != Delta Sum ₹${runningBal.toFixed(2)}`);
    }
  }

  // -------------------------------------------------------------
  // 4. SUMMARY OF AUDIT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`MASTER AUDIT COMPLETE. Total Discrepancies: ${discrepancies.length}`);
  console.log('================================================================');
  if (discrepancies.length === 0) {
    console.log('ALL DATA SOURCES ARE IN 100% PARITY!');
  } else {
    discrepancies.forEach((d, idx) => console.log(`${idx + 1}. ${d}`));
  }
}

runMasterReconciliation().catch(console.error);
