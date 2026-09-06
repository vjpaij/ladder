import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function runComprehensiveAudit() {
  console.log('===============================================================');
  console.log('       RUNNING DEEP RECONCILIATION AUDIT ACROSS ENTIRE DB      ');
  console.log('===============================================================\n');

  // Fetch all holdings
  let allHoldings = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('holdings').select('*').range(from, from + 999);
    if (!data || data.length === 0) break;
    allHoldings = allHoldings.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('Total Holdings fetched:', allHoldings.length);

  // Fetch all transactions
  let allTxs = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('transactions').select('*').range(from, from + 999);
    if (!data || data.length === 0) break;
    allTxs = allTxs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('Total Transactions fetched:', allTxs.length);

  // Fetch all liabilities
  const { data: allLiabs } = await supabase.from('liabilities').select('*');
  console.log('Total Liabilities fetched:', allLiabs.length);

  // Fetch all dividends
  let allDivs = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('dividends').select('*').range(from, from + 999);
    if (!data || data.length === 0) break;
    allDivs = allDivs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('Total Dividends fetched:', allDivs.length, '\n');

  // Group transactions by holding_id and liability_id
  const txByHolding = {};
  const txByLiab = {};
  const orphanedTxs = [];

  for (const t of allTxs) {
    if (t.holding_id) {
      if (!txByHolding[t.holding_id]) txByHolding[t.holding_id] = [];
      txByHolding[t.holding_id].push(t);
    } else if (t.liability_id) {
      if (!txByLiab[t.liability_id]) txByLiab[t.liability_id] = [];
      txByLiab[t.liability_id].push(t);
    } else {
      orphanedTxs.push(t);
    }
  }

  console.log('Orphaned transactions (no holding_id and no liability_id):', orphanedTxs.length);

  // 1. Audit Market-based Holdings (in_stocks, us_stocks, mutual_funds, nps)
  const marketCats = ['in_stocks', 'us_stocks', 'mutual_funds', 'nps'];
  const marketHoldings = allHoldings.filter(h => marketCats.includes(h.category_id));

  let qtyMismatches = [];
  let statusMismatches = [];
  let noTxHoldings = [];

  for (const h of marketHoldings) {
    const txs = txByHolding[h.id] || [];
    if (txs.length === 0) {
      noTxHoldings.push(h);
      continue;
    }

    // Sort txs chronologically
    txs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    let netQty = 0;
    let buyQty = 0;
    let sellQty = 0;
    let totalCharges = 0;

    for (const t of txs) {
      const type = (t.type || '').toUpperCase();
      const q = Number(t.quantity) || 0;
      const chg = Number(t.charges) || 0;
      totalCharges += chg;

      if (type === 'BUY' || type === 'INVESTMENT' || type === 'INVESTMENT (SIP)') {
        netQty += q;
        buyQty += q;
      } else if (type === 'BONUS') {
        netQty += q;
        buyQty += q;
      } else if (type === 'SPLIT') {
        // split
      } else if (type === 'SELL' || type === 'REDEMPTION' || type === 'REDEEM') {
        netQty -= q;
        sellQty += q;
      }
    }

    const dbQty = Number(h.quantity) || 0;
    const isQtyMatch = Math.abs(netQty - dbQty) < 0.001 || (h.category_id === 'in_stocks' && Math.abs(netQty - dbQty) < 0.1);
    if (!isQtyMatch) {
      qtyMismatches.push({
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        category: h.category_id,
        dbQty,
        calcNetQty: Number(netQty.toFixed(4)),
        txCount: txs.length
      });
    }

    const expectedStatus = dbQty > 0.0001 ? 'ACTIVE' : 'REDEEMED';
    if (h.status !== expectedStatus) {
      statusMismatches.push({
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        category: h.category_id,
        dbQty,
        status: h.status,
        expectedStatus
      });
    }
  }

  console.log('\n--- MARKET HOLDINGS AUDIT ---');
  console.log('Holdings with no transactions:', noTxHoldings.length);
  console.log('Holdings with Quantity mismatch (DB vs Txs):', qtyMismatches.length);
  if (qtyMismatches.length > 0) console.log('Sample quantity mismatches:', qtyMismatches);
  console.log('Holdings with Status mismatch (ACTIVE vs REDEEMED):', statusMismatches.length);
  if (statusMismatches.length > 0) console.log('Status mismatches:', statusMismatches);

  // 2. Audit Balance Holdings (Bank, EPF)
  const balanceHoldings = allHoldings.filter(h => ['bank', 'epf'].includes(h.category_id));
  console.log('\n--- BALANCE HOLDINGS (BANK & EPF) AUDIT ---');
  for (const h of balanceHoldings) {
    const txs = txByHolding[h.id] || [];
    let netBal = 0;
    for (const t of txs) {
      const amt = Number(t.total_amount) || Number(t.price) || 0;
      const type = (t.type || '').toUpperCase();
      if (['CREDIT', 'DEPOSIT', 'CONTRIBUTION', 'INTEREST', 'BUY'].includes(type)) {
        netBal += amt;
      } else if (['DEBIT', 'WITHDRAWAL', 'SELL'].includes(type)) {
        netBal -= amt;
      }
    }
    const expectedStatus = Number(h.current_price) > 0.01 ? 'ACTIVE' : 'REDEEMED';
    console.log(`[${h.symbol}] ${h.name}: DB price = ${h.current_price}, Calc Tx Bal = ${netBal.toFixed(2)}, DB Status = ${h.status}, Expected Status = ${expectedStatus}, Match = ${Math.abs(Number(h.current_price) - netBal) < 0.01}`);
  }

  // 3. Audit Liabilities
  console.log('\n--- LIABILITIES AUDIT ---');
  for (const l of allLiabs) {
    const txs = txByLiab[l.id] || [];
    let netDebt = 0;
    for (const t of txs) {
      const amt = Number(t.total_amount) || Number(t.price) || 0;
      const type = (t.type || '').toUpperCase();
      if (['BORROW', 'CHARGE'].includes(type)) {
        netDebt += amt;
      } else if (['EMI_PAYMENT', 'BILL_PAYMENT'].includes(type)) {
        netDebt -= amt;
      }
    }
    console.log(`[${l.name}] (${l.category_id}): DB Balance = ${l.outstanding_balance}, Calc Tx Debt = ${netDebt.toFixed(2)}, Txs count = ${txs.length}, Match = ${Math.abs(Number(l.outstanding_balance) - netDebt) < 0.01}`);
  }
}

runComprehensiveAudit();
