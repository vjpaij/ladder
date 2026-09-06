import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function auditNps() {
  console.log('=== AUDITING NPS HOLDINGS & TRANSACTIONS ===');
  
  const { data: npsHoldings } = await supabase.from('holdings').select('*').eq('category_id', 'nps');
  console.log('NPS Holdings count in DB:', npsHoldings?.length);
  for (const h of (npsHoldings || [])) {
    const { data: txs } = await supabase.from('transactions').select('*').eq('holding_id', h.id);
    console.log(`[${h.symbol}] ${h.name} | Qty: ${h.quantity} | AvgBuy: ${h.avg_buy_price} | Price: ${h.current_price} | Status: ${h.status} | Txs: ${txs?.length}`);
  }
}

auditNps();
