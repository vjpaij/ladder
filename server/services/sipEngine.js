import fs from 'fs';
import path from 'path';
import { supabase } from '../supabaseClient.js';
import db from '../db.js';
import { fetchMutualFundNav } from './priceEngine.js';
import { isTradingDay, getNextTradingDay } from './marketCalendar.js';
import { recalculateHoldingState } from './recalculator.js';

const SIP_HISTORY_FILE = path.join(process.cwd(), 'data', 'sip_history.json');

/**
 * Returns recorded SIP execution and skip history (latest first)
 * Reads from Supabase sip_history table with local JSON file fallback.
 */
export async function getSipExecutionHistory() {
  try {
    const { data, error } = await supabase
      .from('sip_history')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(200);
    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (e) {
    console.warn('[SIP Engine] Failed reading from Supabase sip_history:', e.message);
  }

  // Fallback to local JSON file
  try {
    if (fs.existsSync(SIP_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(SIP_HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[SIP Engine] Failed reading sip history from file:', e.message);
  }
  return [];
}

/**
 * Appends execution records to Supabase sip_history table and local JSON file
 */
async function appendSipHistory(records) {
  if (!records || records.length === 0) return;

  // Persist to Supabase
  try {
    const dbRecords = records.map(r => ({
      sip_id: r.sipId || null,
      symbol: r.symbol || '',
      name: r.name || '',
      action: r.status || 'EXECUTED',
      units: r.units ? Number(r.units) : null,
      nav: r.nav ? Number(r.nav) : null,
      amount: r.amount ? Number(r.amount) : null,
      notes: r.reason || (r.autoClosed ? 'Auto-closed: reached end date' : 'SIP executed successfully'),
      executed_at: r.timestamp || new Date().toISOString()
    }));
    await supabase.from('sip_history').insert(dbRecords);
  } catch (e) {
    console.warn('[SIP Engine] Failed inserting to Supabase sip_history:', e.message);
  }

  // Maintain local JSON cache
  try {
    let existing = [];
    if (fs.existsSync(SIP_HISTORY_FILE)) {
      existing = JSON.parse(fs.readFileSync(SIP_HISTORY_FILE, 'utf-8'));
    }
    const updated = [...records, ...existing].slice(0, 200);
    fs.writeFileSync(SIP_HISTORY_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[SIP Engine] Failed writing sip history to file:', e.message);
  }
}

/**
 * Sweeps and executes all due recurring SIPs
 * 
 * Improvements:
 * 1. Holiday & weekend awareness: defer execution on non-trading days using isTradingDay().
 * 2. Handles end_date auto-closure: if a SIP reaches its end date, auto-closes it.
 * 3. Skips execution safely if NAV cannot be fetched (prevents incorrect unit allocation).
 * 4. Logs executed, skipped, and auto-closed events into data/sip_history.json for full UI transparency.
 */
export async function processDueSips() {
  const today = new Date().toISOString().split('T')[0];

  // If today is a non-trading day (weekend or NSE market holiday), defer execution
  if (!isTradingDay(today)) {
    console.log(`[SIP Engine] Today (${today}) is a non-trading session (weekend or NSE holiday). Execution deferred to next open business day.`);
    return { processedCount: 0, processedSips: [], skippedSips: [], reason: 'Non-trading day deferral' };
  }

  console.log(`[SIP Engine] Checking for due SIPs as of ${today}...`);

  const { data: dueSips, error } = await supabase
    .from('sips')
    .select('*')
    .eq('status', 'ACTIVE')
    .lte('next_run_date', today);

  if (error) {
    console.error('[SIP Engine Error fetching due SIPs]:', error.message);
    return { error: error.message, processedCount: 0 };
  }

  if (!dueSips || dueSips.length === 0) {
    console.log('[SIP Engine] No due SIPs to execute today.');
    return { processedCount: 0, processedSips: [], skippedSips: [] };
  }

  console.log(`[SIP Engine] Found ${dueSips.length} due SIPs to execute.`);
  const processedSips = [];
  const skippedSips = [];
  const historyEvents = [];

  for (const sip of dueSips) {
    try {
      // Check if SIP has passed its end_date -- auto-close if so
      if (sip.end_date && sip.next_run_date > sip.end_date) {
        await supabase
          .from('sips')
          .update({ status: 'CLOSED', updated_at: new Date().toISOString() })
          .eq('id', sip.id);
        console.log(`[SIP Engine] Auto-closed SIP for ${sip.name} -- end date ${sip.end_date} reached.`);
        const skipItem = { sipId: sip.id, name: sip.name, symbol: sip.symbol, amount: Number(sip.amount), reason: `End date ${sip.end_date} reached` };
        skippedSips.push(skipItem);
        historyEvents.push({
          id: `${sip.id}-${today}-closed-${Date.now()}`,
          timestamp: new Date().toISOString(),
          date: today,
          sipId: sip.id,
          name: sip.name,
          symbol: sip.symbol,
          amount: Number(sip.amount),
          status: 'CLOSED',
          reason: `End date ${sip.end_date} reached`
        });
        continue;
      }

      const quote = await fetchMutualFundNav(sip.symbol);
      const nav = quote?.price;

      // Safety: do NOT execute if fresh market NAV is unavailable
      if (!nav || nav <= 0) {
        console.warn(`[SIP Engine] Skipping SIP for ${sip.name}: could not fetch valid NAV (got ${nav}). Will retry on next market session.`);
        const skipItem = { sipId: sip.id, name: sip.name, symbol: sip.symbol, amount: Number(sip.amount), reason: 'NAV unavailable or market closed' };
        skippedSips.push(skipItem);
        historyEvents.push({
          id: `${sip.id}-${today}-skip-${Date.now()}`,
          timestamp: new Date().toISOString(),
          date: today,
          sipId: sip.id,
          name: sip.name,
          symbol: sip.symbol,
          amount: Number(sip.amount),
          status: 'SKIPPED',
          reason: 'NAV unavailable or market closed'
        });
        continue;
      }

      const totalAmount = Number(sip.amount);
      const charges = parseFloat((totalAmount * 0.00015).toFixed(2)); // 0.015% stamp duty
      const netInvested = totalAmount - charges;
      const units = parseFloat((netInvested / nav).toFixed(4));

      // 1. Insert BUY / SIP transaction
      await db.insert('transactions', {
        holding_id: sip.holding_id,
        type: 'BUY',
        quantity: units,
        price: nav,
        total_amount: totalAmount,
        charges: charges,
        currency: 'INR',
        date: today,
        symbol: sip.symbol,
        name: sip.name,
        notes: `Automated Recurring SIP Execution: Rs.${totalAmount.toLocaleString()} @ NAV Rs.${nav.toFixed(4)}`
      });

      // 2. Recompute holding position accurately
      await recalculateHoldingState(sip.holding_id);

      // 3. Compute next run date based on frequency (Weekly, Fortnightly, Monthly, Quarterly)
      const currentNext = new Date(sip.next_run_date);
      const freq = (sip.frequency || 'MONTHLY').toUpperCase();

      if (freq === 'WEEKLY') {
        currentNext.setDate(currentNext.getDate() + 7);
      } else if (freq === 'FORTNIGHTLY') {
        currentNext.setDate(currentNext.getDate() + 14);
      } else if (freq === 'QUARTERLY') {
        currentNext.setMonth(currentNext.getMonth() + 3);
      } else {
        currentNext.setMonth(currentNext.getMonth() + 1);
      }

      const newNextRunDate = currentNext.toISOString().split('T')[0];

      // 4. Check if next run date exceeds end_date -- auto-close if so
      const sipUpdates = {
        last_run_date: sip.next_run_date,
        next_run_date: newNextRunDate,
        updated_at: new Date().toISOString()
      };

      if (sip.end_date && newNextRunDate > sip.end_date) {
        sipUpdates.status = 'CLOSED';
        console.log(`[SIP Engine] Final execution for ${sip.name} -- closing SIP as end date ${sip.end_date} will be exceeded.`);
      }

      await supabase
        .from('sips')
        .update(sipUpdates)
        .eq('id', sip.id);

      const processedItem = {
        sipId: sip.id,
        name: sip.name,
        amount: totalAmount,
        nav,
        units,
        executedDate: sip.next_run_date,
        newNextRunDate,
        autoClosed: sipUpdates.status === 'CLOSED'
      };
      processedSips.push(processedItem);

      historyEvents.push({
        id: `${sip.id}-${today}-success-${Date.now()}`,
        timestamp: new Date().toISOString(),
        date: today,
        sipId: sip.id,
        name: sip.name,
        symbol: sip.symbol,
        amount: totalAmount,
        status: 'SUCCESS',
        nav,
        units,
        autoClosed: sipUpdates.status === 'CLOSED'
      });

      console.log(`[SIP Engine] Successfully executed SIP for ${sip.name}: Rs.${totalAmount} (${units} units). Next: ${sipUpdates.status === 'CLOSED' ? 'CLOSED' : newNextRunDate}`);
    } catch (sipErr) {
      console.error(`[SIP Engine Error executing SIP ${sip.id}]:`, sipErr.message);
      skippedSips.push({ sipId: sip.id, name: sip.name, symbol: sip.symbol, amount: Number(sip.amount), reason: sipErr.message });
      historyEvents.push({
        id: `${sip.id}-${today}-failed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        date: today,
        sipId: sip.id,
        name: sip.name,
        symbol: sip.symbol,
        amount: Number(sip.amount),
        status: 'FAILED',
        reason: sipErr.message
      });
    }
  }

  // Persist history records
  appendSipHistory(historyEvents);

  return { processedCount: processedSips.length, processedSips, skippedCount: skippedSips.length, skippedSips };
}
