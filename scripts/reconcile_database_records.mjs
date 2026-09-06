import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { recalculateHoldingState } from '../server/services/recalculator.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function reconcileDatabase() {
  console.log('===============================================================');
  console.log('       STARTING COMPLETE DATABASE & LEDGER RECONCILIATION      ');
  console.log('===============================================================\n');

  // 1. Reconcile Bank & EPF Holdings Status
  console.log('[Step 1/4] Reconciling Bank Accounts & EPF Holdings Status...');
  const { data: bankEpfHoldings, error: bankErr } = await supabase
    .from('holdings')
    .select('*')
    .in('category_id', ['bank', 'epf']);

  if (bankErr) throw bankErr;

  for (const h of bankEpfHoldings) {
    const curPrice = Number(h.current_price) || 0;
    const newStatus = curPrice > 0.01 ? 'ACTIVE' : 'REDEEMED';
    if (h.status !== newStatus) {
      console.log(`  Updating ${h.symbol} (${h.name}): balance = ₹${curPrice} -> status = ${newStatus}`);
      const { error: updErr } = await supabase
        .from('holdings')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', h.id);
      if (updErr) console.error(`  Error updating ${h.symbol}:`, updErr.message);
    } else {
      console.log(`  ${h.symbol} (${h.name}): already has status = ${h.status} (balance = ₹${curPrice})`);
    }
  }

  // 2. Reconcile Mutual Funds with Rounding / Liquidations
  console.log('\n[Step 2/4] Reconciling Mutual Funds Fractional Epsilon Units...');
  const mfFixes = [
    { symbol: '120823', name: 'Quant Multi Cap Fund-GROWTH OPTION-Direct Plan', quantity: 0, status: 'REDEEMED', sell_qty: 278.7601 },
    { symbol: '118551', name: 'Franklin U.S. Opportunities Equity Active Fund of Funds - Direct - Growth', quantity: 0, status: 'REDEEMED', sell_qty: 1075.6770 },
    { symbol: '120539', name: 'Aditya Birla Sun Life Digital India Fund - Growth - Direct Plan', quantity: 0, status: 'REDEEMED', sell_qty: 1005.8650 },
    { symbol: '118834', name: 'Mirae Asset Large & Midcap Fund - Direct Plan - Growth', quantity: 0, status: 'REDEEMED', sell_qty: 2386.1872 }
  ];

  for (const fix of mfFixes) {
    const { data: mfHolding } = await supabase.from('holdings').select('*').eq('symbol', fix.symbol);
    if (mfHolding && mfHolding.length > 0) {
      const h = mfHolding[0];
      console.log(`  Fixing MF ${h.symbol} (${h.name}): qty ${h.quantity} -> 0, status -> REDEEMED`);
      await supabase
        .from('holdings')
        .update({
          quantity: 0,
          status: 'REDEEMED',
          sell_qty: fix.sell_qty || h.buy_qty,
          unrealized_pnl: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', h.id);
    }
  }

  // 3. Reconcile Missing US Stock Dividends in Transactions Table
  console.log('\n[Step 3/4] Reconciling US Stock Dividends into Transactions Table...');
  // Fetch all US dividends
  const { data: usDivs, error: usDivErr } = await supabase
    .from('dividends')
    .select('*')
    .eq('currency', 'USD');

  if (usDivErr) throw usDivErr;
  console.log(`  Found ${usDivs.length} US Stock dividends in 'dividends' table.`);

  // Check how many US dividends are in 'transactions' table
  const { data: existingUsDivTxs } = await supabase
    .from('transactions')
    .select('id, holding_id, date, total_amount')
    .eq('currency', 'USD')
    .eq('type', 'DIVIDEND');

  const existingKeys = new Set((existingUsDivTxs || []).map(t => `${t.holding_id}_${t.date}_${Number(t.total_amount).toFixed(2)}`));
  console.log(`  Found ${existingUsDivTxs?.length || 0} existing US dividend transactions in DB.`);

  const missingDivTxs = [];
  for (const d of usDivs) {
    const amt = Number(d.amount_original) || 0;
    const date = d.payment_date || d.ex_date;
    const key = `${d.holding_id}_${date}_${amt.toFixed(2)}`;
    if (!existingKeys.has(key)) {
      missingDivTxs.push({
        holding_id: d.holding_id,
        user_id: null,
        symbol: d.symbol,
        name: d.name,
        type: 'DIVIDEND',
        quantity: 0,
        price: 0,
        total_amount: amt,
        currency: 'USD',
        fx_rate: Number(d.fx_rate) || 83.5,
        charges: 0,
        net_amount: amt,
        date: date,
        notes: `Dividend $${amt.toFixed(2)} | FX: ₹${(Number(d.fx_rate) || 83.5).toFixed(2)}/$`
      });
    }
  }

  if (missingDivTxs.length > 0) {
    console.log(`  Inserting ${missingDivTxs.length} missing US dividend transactions...`);
    const { error: insErr } = await supabase.from('transactions').insert(missingDivTxs);
    if (insErr) {
      console.error('  Error inserting US dividend transactions:', insErr.message);
      throw insErr;
    }
    console.log('  Successfully inserted all US dividend transactions!');
  } else {
    console.log('  All US dividend transactions are already present in DB.');
  }

  // 4. Run Recalculation across all holdings and liabilities
  console.log('\n[Step 4/4] Recalculating all 397 holdings and liabilities...');
  const { data: allHoldings } = await supabase.from('holdings').select('id, name, symbol, category_id');
  let count = 0;
  for (const h of allHoldings || []) {
    await recalculateHoldingState(h.id);
    count++;
    if (count % 50 === 0 || count === allHoldings.length) {
      console.log(`  Recalculated ${count}/${allHoldings.length} holdings...`);
    }
  }

  console.log('\n===============================================================');
  console.log('   DATABASE & LEDGER RECONCILIATION COMPLETED SUCCESSFULLY!    ');
  console.log('===============================================================');
}

reconcileDatabase().catch(err => {
  console.error('[Reconciliation Error]:', err);
  process.exit(1);
});
