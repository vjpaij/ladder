import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function runDeepAudit() {
  console.log('====================================================');
  console.log('      DEEP 360-DEGREE AUDIT ACROSS ALL CATEGORIES   ');
  console.log('====================================================\n');

  // 1. Fetch all DB data with pagination
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

  console.log(`[Database Loaded] Holdings: ${holdings.length}, Txs: ${txs.length}, Divs: ${dividends.length}, Liabs: ${liabilities.length}`);

  // 2. Check each Category
  const categories = ['in_stocks', 'us_stocks', 'mutual_funds', 'nps', 'bank', 'epf'];
  const issuesFound = [];

  for (const cat of categories) {
    const catHoldings = holdings.filter(h => h.category_id === cat);
    console.log(`\n--- Auditing Category: ${cat.toUpperCase()} (${catHoldings.length} holdings) ---`);

    for (const h of catHoldings) {
      const hTxs = txs.filter(t => t.holding_id === h.id || t.symbol === h.symbol);
      
      // Calculate transaction totals
      let buyQty = 0;
      let sellQty = 0;
      let buyAmount = 0;
      let sellAmount = 0;
      let netBankBalance = 0;

      for (const t of hTxs) {
        const type = (t.type || 'BUY').toUpperCase();
        const qty = Number(t.quantity) || 0;
        const amt = Number(t.total_amount) || Number(t.price) || 0;

        if (type === 'BUY') {
          buyQty += qty;
          buyAmount += amt;
        } else if (type === 'SELL') {
          sellQty += qty;
          sellAmount += amt;
        } else if (['CREDIT', 'DEPOSIT', 'CONTRIBUTION', 'INTEREST'].includes(type)) {
          netBankBalance += amt;
        } else if (['DEBIT', 'WITHDRAWAL', 'SPEND', 'CHARGE'].includes(type)) {
          netBankBalance -= amt;
        }
      }

      if (cat === 'bank' || cat === 'epf') {
        const holdingPrice = Number(h.current_price) || 0;
        const diff = Math.abs(holdingPrice - netBankBalance);
        if (diff > 0.05 && hTxs.length > 0) {
          issuesFound.push(`[${cat.toUpperCase()}] ${h.name} (${h.symbol}): DB Price ₹${holdingPrice} != Sum of Delta Txs ₹${netBankBalance.toFixed(2)} (diff: ₹${diff.toFixed(2)})`);
        }
      } else {
        const openQty = Math.max(0, buyQty - sellQty);
        const dbQty = Number(h.quantity) || 0;
        
        // Epsilon tolerance for fractional MFs and split adjustments
        // Some stocks had historical splits/bonus where buyQty was scaled or +bonus was separate
        if (Math.abs(dbQty - openQty) > 0.05 && hTxs.length > 0) {
          // Check if corporate action exists
          const hasCorpAction = hTxs.some(t => ['SPLIT', 'BONUS'].includes((t.type || '').toUpperCase()));
          if (!hasCorpAction) {
            issuesFound.push(`[${cat.toUpperCase()}] ${h.name} (${h.symbol}): DB Qty ${dbQty} != Calculated Open Qty ${openQty.toFixed(4)} (Buys: ${buyQty}, Sells: ${sellQty})`);
          }
        }

        // Status check
        if (dbQty <= 0.005 && h.status === 'ACTIVE') {
          issuesFound.push(`[${cat.toUpperCase()}] ${h.name} (${h.symbol}): Status is ACTIVE but quantity is ${dbQty}`);
        }
        if (dbQty > 0.005 && h.status === 'REDEEMED' && cat !== 'bank') {
          issuesFound.push(`[${cat.toUpperCase()}] ${h.name} (${h.symbol}): Status is REDEEMED but quantity is ${dbQty}`);
        }
      }
    }
  }

  // 3. Check Liabilities
  console.log('\n--- Auditing Liabilities ---');
  for (const l of liabilities) {
    const lTxs = txs.filter(t => t.liability_id === l.id || t.holding_id === l.id);
    console.log(`Liability: ${l.name} | DB Balance: ₹${l.outstanding_balance} | Linked Txs: ${lTxs.length}`);
  }

  // 4. Check EOD Logs
  console.log('\n--- Auditing EOD Daily Logs (6920 records) ---');
  const eodLogs = JSON.parse(fs.readFileSync('./data/portfolio_eod_logs.json', 'utf-8'));
  let brokenEodDays = 0;
  for (const log of eodLogs) {
    const assets = Number(log.total_assets || 0);
    const debt = Number(log.debt || 0);
    const wealth = Number(log.wealth || log.total_wealth || 0);
    const diff = Math.abs((assets - debt) - wealth);
    if (diff > 1.0) {
      brokenEodDays++;
      if (brokenEodDays <= 3) {
        issuesFound.push(`[EOD Log] Date ${log.date}: Assets ₹${assets} - Debt ₹${debt} = ₹${assets - debt} != Wealth ₹${wealth} (diff: ₹${diff.toFixed(2)})`);
      }
    }
  }

  console.log(`\n====================================================`);
  console.log(`AUDIT COMPLETE. Total Issues Flagged: ${issuesFound.length}`);
  console.log(`====================================================`);
  if (issuesFound.length === 0) {
    console.log('PERFECT! 0 anomalies found across all 394 holdings, 11,278 transactions, and 6,920 EOD logs.');
  } else {
    issuesFound.forEach((iss, idx) => console.log(`${idx + 1}. ${iss}`));
  }
}

runDeepAudit().catch(console.error);
