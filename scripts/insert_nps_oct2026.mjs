/**
 * Idempotently restores the six missing October 2026 NPS ledger transactions.
 * NAVs are cross-checked against data/historical_prices.json before any write.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { supabaseAdmin } from '../server/supabaseAdminClient.js';
import {
  db,
  restoreCacheSnapshotFromDisk,
  setCacheEntry,
  saveCacheSnapshotToDisk,
} from '../server/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemes = [
  { symbol: 'SM002027', name: 'UTI Scheme E Tier I Direct', buyNav: 67.1819, buyAmount: 3125.25, sellNav: 67.4536, sellAmount: 32.40 },
  { symbol: 'SM003027', name: 'LIC Scheme G Tier I Direct', buyNav: 31.1755, buyAmount: 625.05, sellNav: 31.1811, sellAmount: 7.17 },
  { symbol: 'SM008019', name: 'HDFC Scheme C Tier I Direct', buyNav: 30.8009, buyAmount: 416.70, sellNav: 30.8233, sellAmount: 5.02 },
];

function roundTo(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function stableId(key) {
  const hex = crypto.createHash('sha256').update(`ladder:${key}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function buildRows(navHistory, septemberRows, canonicalHoldingIds) {
  const createdAt = new Date().toISOString();
  const octoberRows = schemes.flatMap((scheme) => {
    const holdingId = canonicalHoldingIds.get(scheme.symbol);
    for (const [date, expected] of [['2026-10-01', scheme.buyNav], ['2026-10-05', scheme.sellNav]]) {
      const actual = Number(navHistory[scheme.symbol]?.[date]);
      if (!Number.isFinite(actual) || actual !== expected) {
        throw new Error(`NAV check failed for ${scheme.symbol} on ${date}; expected ${expected}, found ${actual || 'missing'}. No transactions were written.`);
      }
    }
    const buyQuantity = roundTo(scheme.buyAmount / scheme.buyNav, 4);
    const sellQuantity = roundTo(scheme.sellAmount / scheme.sellNav, 4);
    return [
      {
        id: stableId(`${holdingId}:2026-10-01:BUY`), holding_id: holdingId,
        symbol: scheme.symbol, name: scheme.name, type: 'BUY', date: '2026-10-01',
        quantity: buyQuantity, price: scheme.buyNav, total_amount: scheme.buyAmount,
        net_amount: scheme.buyAmount, currency: 'INR', charges: 0, fx_rate: null,
        liability_id: null, notes: 'NPS monthly SIP contribution Oct 2026', created_at: createdAt,
      },
      {
        id: stableId(`${holdingId}:2026-10-05:SELL`), holding_id: holdingId,
        symbol: scheme.symbol, name: scheme.name, type: 'SELL', date: '2026-10-05',
        quantity: sellQuantity, price: scheme.sellNav, total_amount: scheme.sellAmount,
        net_amount: scheme.sellAmount, currency: 'INR', charges: 0, fx_rate: null,
        liability_id: null, notes: 'NPS quarterly fund management fee deduction Q3-FY27 Oct 2026', created_at: createdAt,
      },
    ];
  });
  return [...septemberRows, ...octoberRows];
}

function calculateHoldingState(transactions, holding) {
  const rows = transactions
    .filter((tx) => String(tx.holding_id) === String(holding.id))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''));
  const lots = [];
  let buyQty = 0;
  let sellQty = 0;
  let buyAmount = 0;
  let chargesTotal = 0;
  let realizedPnl = 0;
  let quantity = 0;

  for (const tx of rows) {
    const qty = Number(tx.quantity) || 0;
    const price = Number(tx.price) || 0;
    const charges = Number(tx.charges) || 0;
    chargesTotal += charges;
    if (tx.type === 'BUY') {
      buyQty += qty;
      quantity += qty;
      buyAmount += qty * price + charges;
      lots.push({ qty, remaining: qty, price, charges });
    } else if (tx.type === 'SELL') {
      sellQty += qty;
      let remaining = qty;
      let cost = 0;
      let allocatedCharges = 0;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const sold = Math.min(lot.remaining, remaining);
        cost += sold * lot.price;
        if (lot.qty > 0) allocatedCharges += (sold / lot.qty) * lot.charges;
        lot.remaining -= sold;
        remaining -= sold;
      }
      quantity = Math.max(0, quantity - qty);
      realizedPnl += qty * price - charges - cost - allocatedCharges;
    }
  }

  const activeLots = lots.filter((lot) => lot.remaining > 0);
  const openQuantity = activeLots.reduce((sum, lot) => sum + lot.remaining, 0);
  const openCost = activeLots.reduce((sum, lot) => sum + lot.remaining * lot.price + (lot.qty > 0 ? (lot.remaining / lot.qty) * lot.charges : 0), 0);
  return {
    ...holding,
    quantity: Number(quantity.toFixed(9)),
    buy_qty: Number(buyQty.toFixed(4)),
    sell_qty: Number(sellQty.toFixed(4)),
    avg_buy_price: Number((openQuantity > 0 ? openCost / openQuantity : (buyQty > 0 ? buyAmount / buyQty : 0)).toFixed(4)),
    realized_pnl: Number(realizedPnl.toFixed(2)),
    total_charges: Number(chargesTotal.toFixed(2)),
    status: quantity > 0.0001 ? 'ACTIVE' : 'REDEEMED',
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required; no writes were made.');
  const navHistory = JSON.parse(fs.readFileSync(path.join(root, 'data', 'historical_prices.json'), 'utf8'));
  restoreCacheSnapshotFromDisk();
  const cachedTransactions = await db.select('transactions');
  const cachedHoldings = await db.select('holdings');
  const { data: cloudHoldings, error: holdingsError } = await supabaseAdmin
    .from('holdings').select('id,symbol,category_id').in('symbol', schemes.map((scheme) => scheme.symbol)).range(0, 99);
  if (holdingsError) throw new Error(`Could not resolve live NPS holdings: ${holdingsError.message}`);
  const canonicalHoldingIds = new Map((cloudHoldings || [])
    .filter((holding) => holding.category_id === 'nps')
    .map((holding) => [holding.symbol, holding.id]));
  for (const scheme of schemes) {
    if (!canonicalHoldingIds.has(scheme.symbol)) throw new Error(`Cloud NPS holding ${scheme.symbol} was not found; no rows were written.`);
  }

  const septemberRows = schemes.map((scheme) => {
    const source = cachedTransactions.find((tx) => tx.symbol === scheme.symbol && tx.date === '2026-09-01' && tx.type === 'BUY');
    if (!source) throw new Error(`Verified September ledger row for ${scheme.symbol} is missing from the local snapshot.`);
    const nav = Number(navHistory[scheme.symbol]?.['2026-09-01']);
    if (!Number.isFinite(nav) || Math.abs(nav - Number(source.price)) > 0.00005) {
      throw new Error(`September NAV check failed for ${scheme.symbol}; no rows were written.`);
    }
    return { ...source, holding_id: canonicalHoldingIds.get(scheme.symbol) };
  });
  const candidates = buildRows(navHistory, septemberRows, canonicalHoldingIds);

  const { data: remoteRows, error: queryError } = await supabaseAdmin
    .from('transactions')
    .select('id,holding_id,date,symbol,type,quantity,price,total_amount,notes')
    .in('holding_id', [...canonicalHoldingIds.values()])
    .gte('date', '2026-09-01')
    .lte('date', '2026-10-05')
    .range(0, 999);
  if (queryError) throw new Error(`Supabase duplicate check failed: ${queryError.message}`);

  const remoteKeys = new Map((remoteRows || []).map((row) => [`${row.holding_id}:${row.date}:${row.type}`, row]));
  const toInsert = [];
  for (const candidate of candidates) {
    const key = `${candidate.holding_id}:${candidate.date}:${candidate.type}`;
    const existing = remoteKeys.get(key);
    if (!existing) {
      toInsert.push(candidate);
      continue;
    }
    const matches = existing.symbol === candidate.symbol
      && Math.abs(Number(existing.quantity) - candidate.quantity) < 0.00005
      && Math.abs(Number(existing.price) - candidate.price) < 0.00005
      && Math.abs(Number(existing.total_amount) - candidate.total_amount) < 0.005;
    if (!matches) throw new Error(`Conflicting cloud transaction already exists for ${key}; refusing to change it.`);
  }

  if (toInsert.length) {
    const { error: insertError } = await supabaseAdmin.from('transactions').insert(toInsert);
    if (insertError) throw new Error(`Supabase insert failed: ${insertError.message}`);
  }

  // Update the verified local cache through db.js so its checksum and backup
  // are regenerated by the canonical atomic snapshot writer.
  restoreCacheSnapshotFromDisk();
  const remappedCacheTransactions = cachedTransactions.map((tx) => {
    const replacementId = canonicalHoldingIds.get(tx.symbol);
    return replacementId && tx.holding_id !== replacementId ? { ...tx, holding_id: replacementId } : tx;
  });
  const cachedIds = new Set(remappedCacheTransactions.map((tx) => String(tx.id)));
  const canonicalRows = [...(remoteRows || []), ...toInsert];
  const mergedTransactions = [...remappedCacheTransactions, ...canonicalRows.filter((tx) => !cachedIds.has(String(tx.id)))];
  setCacheEntry('transactions', mergedTransactions);

  const nextHoldings = cachedHoldings.slice();
  for (const scheme of schemes) {
    const index = nextHoldings.findIndex((holding) => holding.symbol === scheme.symbol);
    if (index < 0) throw new Error(`Holding ${scheme.symbol} is missing from the verified cache.`);
    const updated = calculateHoldingState(mergedTransactions, { ...nextHoldings[index], id: canonicalHoldingIds.get(scheme.symbol) });
    const { error: updateError } = await supabaseAdmin.from('holdings').update({
      quantity: updated.quantity, buy_qty: updated.buy_qty, sell_qty: updated.sell_qty,
      avg_buy_price: updated.avg_buy_price, realized_pnl: updated.realized_pnl,
      total_charges: updated.total_charges, status: updated.status, updated_at: updated.updated_at,
    }).eq('id', canonicalHoldingIds.get(scheme.symbol));
    if (updateError) throw new Error(`Could not recalculate ${scheme.symbol}: ${updateError.message}`);
    nextHoldings[index] = { ...updated, id: canonicalHoldingIds.get(scheme.symbol) };
    console.log(`${scheme.symbol}: quantity=${updated.quantity}, avg cost=${updated.avg_buy_price}`);
  }
  setCacheEntry('holdings', nextHoldings);
  saveCacheSnapshotToDisk();
  console.log(`Restored ${toInsert.length} missing NPS transactions (September ledger repair plus October entries); ${candidates.length - toInsert.length} already matched in Supabase.`);
}

main().catch((error) => {
  console.error('[NPS restore failed]', error.message);
  process.exitCode = 1;
});
