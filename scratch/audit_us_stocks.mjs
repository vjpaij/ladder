import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function auditUsStocks() {
  console.log('=== AUDITING US STOCKS HOLDINGS & TRANSACTIONS ===');
  
  const { data: usHoldings } = await supabase.from('holdings').select('*').eq('category_id', 'us_stocks');
  console.log('US Holdings count in DB:', usHoldings?.length);
  for (const h of (usHoldings || [])) {
    const { data: txs } = await supabase.from('transactions').select('*').eq('holding_id', h.id);
    const { data: divs } = await supabase.from('dividends').select('*').eq('holding_id', h.id);
    const divTxs = txs?.filter(t => t.type === 'DIVIDEND') || [];
    console.log(`[${h.symbol}] ${h.name} | Qty: ${h.quantity} | AvgBuy: $${h.avg_buy_price} | Price: $${h.current_price} | Status: ${h.status} | Txs: ${txs?.length} (DivTxs: ${divTxs.length}) | Divs: ${divs?.length}`);
  }
}

auditUsStocks();
