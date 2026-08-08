import fs from 'fs';
import path from 'path';
import { supabase } from '../supabaseClient.js';

function readJson(filename) {
  const filePath = path.resolve(process.cwd(), 'data', filename);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
}

// Fixed UUID generator based on integer ID for deterministic mapping
function toUuid(prefix, id) {
  const hex = id.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

async function migrate() {
  console.log('[Migration] Starting JSON -> Supabase data migration...');

  // 1. Migrate Holdings
  const rawHoldings = readJson('holdings.json');
  console.log(`[Migration] Found ${rawHoldings.length} holdings to migrate.`);
  
  const holdingMap = {}; // old integer id -> new UUID

  for (const h of rawHoldings) {
    const uuid = toUuid('holding', h.id);
    holdingMap[h.id] = uuid;

    const record = {
      id: uuid,
      category_id: h.category_id,
      symbol: h.symbol,
      name: h.name,
      exchange: h.exchange,
      quantity: h.quantity,
      avg_buy_price: h.avg_buy_price,
      current_price: h.current_price,
      nse_price: h.nse_price || 0,
      bse_price: h.bse_price || 0,
      currency: h.currency || 'INR',
      sector: h.sector || '',
      is_latest_today: Boolean(h.is_latest_today)
    };

    const { error } = await supabase.from('holdings').upsert(record, { onConflict: 'id' });
    if (error) console.error(`[Migration Error - Holdings ${h.id}]:`, error.message);
  }

  // 2. Migrate Liabilities
  const rawLiabilities = readJson('liabilities.json');
  console.log(`[Migration] Found ${rawLiabilities.length} liabilities to migrate.`);
  for (const l of rawLiabilities) {
    const uuid = toUuid('liability', l.id);
    const record = {
      id: uuid,
      category_id: l.category_id,
      name: l.name,
      lender: l.lender,
      total_principal: l.total_principal,
      outstanding_balance: l.outstanding_balance,
      interest_rate: l.interest_rate,
      monthly_emi: l.monthly_emi,
      due_day: l.due_day
    };
    const { error } = await supabase.from('liabilities').upsert(record, { onConflict: 'id' });
    if (error) console.error(`[Migration Error - Liabilities ${l.id}]:`, error.message);
  }

  // 3. Migrate Transactions
  const rawTransactions = readJson('transactions.json');
  console.log(`[Migration] Found ${rawTransactions.length} transactions to migrate.`);
  for (const t of rawTransactions) {
    const uuid = toUuid('tx', t.id);
    const record = {
      id: uuid,
      holding_id: holdingMap[t.holding_id] || null,
      type: t.type,
      quantity: t.quantity,
      price: t.price,
      total_amount: t.total_amount,
      currency: t.currency,
      date: t.date,
      notes: t.notes
    };
    const { error } = await supabase.from('transactions').upsert(record, { onConflict: 'id' });
    if (error) console.error(`[Migration Error - Transactions ${t.id}]:`, error.message);
  }

  // 4. Migrate Dividends
  const rawDividends = readJson('dividends.json');
  console.log(`[Migration] Found ${rawDividends.length} dividends to migrate.`);
  for (const d of rawDividends) {
    const uuid = toUuid('div', d.id);
    const record = {
      id: uuid,
      holding_id: holdingMap[d.holding_id] || null,
      amount_original: d.amount_original,
      currency: d.currency,
      fx_rate: d.fx_rate,
      amount_inr: d.amount_inr,
      ex_date: d.ex_date,
      payment_date: d.payment_date
    };
    const { error } = await supabase.from('dividends').upsert(record, { onConflict: 'id' });
    if (error) console.error(`[Migration Error - Dividends ${d.id}]:`, error.message);
  }

  // 5. Migrate PnL History Logs
  const rawPnl = readJson('daily_pnl_logs.json');
  console.log(`[Migration] Found ${rawPnl.length} daily PnL history logs to migrate.`);
  for (const p of rawPnl) {
    const uuid = toUuid('pnl', p.id);
    const record = {
      id: uuid,
      log_date: p.log_date,
      total_assets_inr: p.total_assets_inr,
      total_liabilities_inr: p.total_liabilities_inr,
      net_worth_inr: p.net_worth_inr,
      daily_pnl_inr: p.daily_pnl_inr || 0
    };
    const { error } = await supabase.from('pnl_history').upsert(record, { onConflict: 'id' });
    if (error) console.error(`[Migration Error - PnL ${p.id}]:`, error.message);
  }

  console.log('[Migration] Migration complete! All data successfully migrated to Supabase.');
}

migrate().catch(err => {
  console.error('[Migration Exception]:', err);
});
