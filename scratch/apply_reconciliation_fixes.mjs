import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function applyFixes() {
  console.log('--- Applying Database Fixes ---');

  // 1. Fix CLEDUCATE transaction on 2025-10-29
  const { data: cleducateTx, error: cErr } = await supabase
    .from('transactions')
    .update({ quantity: 585, total_amount: 49894.65, notes: 'Sell All (585 shares liquidated)' })
    .eq('id', '95714be7-1bb0-42c3-a02e-68dd3dbd2fc8')
    .select();
  console.log('Updated CLEDUCATE transaction:', cleducateTx);

  // 2. Add VIYASH holding and its 3 transactions if not present
  const { data: existingViyash } = await supabase.from('holdings').select('*').eq('symbol', 'VIYASH');
  if (!existingViyash || existingViyash.length === 0) {
    const { data: newViyash, error: vErr } = await supabase
      .from('holdings')
      .insert({
        category_id: 'in_stocks',
        symbol: 'VIYASH',
        name: 'Viyash Scientific Limited',
        exchange: 'NSE',
        quantity: 0,
        avg_buy_price: 236.72,
        current_price: 0,
        nse_price: 0,
        bse_price: 0,
        currency: 'INR',
        sector: 'Healthcare & Pharma',
        status: 'REDEEMED',
        buy_qty: 43,
        sell_qty: 43,
        realized_pnl: -1810.80,
        unrealized_pnl: 0,
        pnl_pct: -17.77,
        total_charges: 36.69
      })
      .select();
    console.log('Inserted VIYASH holding:', newViyash);

    if (newViyash && newViyash[0]) {
      const viyashId = newViyash[0].id;
      const txs = [
        {
          holding_id: viyashId,
          symbol: 'VIYASH',
          name: 'Viyash Scientific Limited',
          date: '2025-11-18',
          type: 'BUY',
          quantity: 43,
          price: 236.72,
          total_amount: 10178.96,
          charges: 12.56,
          currency: 'INR',
          notes: 'Purchase 43 shares'
        },
        {
          holding_id: viyashId,
          symbol: 'VIYASH',
          name: 'Viyash Scientific Limited',
          date: '2025-12-09',
          type: 'SELL',
          quantity: 10,
          price: 195.50,
          total_amount: 1955.00,
          charges: 0,
          currency: 'INR',
          notes: 'Sale 10 shares'
        },
        {
          holding_id: viyashId,
          symbol: 'VIYASH',
          name: 'Viyash Scientific Limited',
          date: '2025-12-09',
          type: 'SELL',
          quantity: 33,
          price: 195.45,
          total_amount: 6449.85,
          charges: 24.13,
          currency: 'INR',
          notes: 'Sale 33 shares (Full exit)'
        }
      ];
      await supabase.from('transactions').insert(txs);
      console.log('Inserted 3 transactions for VIYASH');
    }
  }

  console.log('--- Database Fixes Complete ---');
}

applyFixes().catch(console.error);
