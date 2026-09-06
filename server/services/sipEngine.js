import { supabase } from '../supabaseClient.js';
import db from '../db.js';
import { fetchMutualFundNav } from './priceEngine.js';
import { recalculateHoldingState } from './recalculator.js';

/**
 * Sweeps and executes all due recurring SIPs
 * 
 * Improvements over initial version:
 * 1. Handles end_date auto-closure: if a SIP reaches its end date, auto-closes it.
 * 2. Skips execution if NAV cannot be fetched (prevents incorrect unit allocation).
 * 3. Logs skipped SIPs for debugging.
 */
export async function processDueSips() {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().getDay(); // 0 = Sunday, 6 = Saturday

  // If today is a weekend, defer execution until the next open market day (Monday)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log(`[SIP Engine] Today (${today}) is a weekend session. Execution will automatically process on the next open market business day.`);
    return { processedCount: 0, processedSips: [], skippedSips: [], reason: 'Weekend deferral' };
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

  for (const sip of dueSips) {
    try {
      // Check if SIP has passed its end_date -- auto-close if so
      if (sip.end_date && sip.next_run_date > sip.end_date) {
        await supabase
          .from('sips')
          .update({ status: 'CLOSED', updated_at: new Date().toISOString() })
          .eq('id', sip.id);
        console.log(`[SIP Engine] Auto-closed SIP for ${sip.name} -- end date ${sip.end_date} reached.`);
        skippedSips.push({ sipId: sip.id, name: sip.name, reason: `End date ${sip.end_date} reached` });
        continue;
      }

      const quote = await fetchMutualFundNav(sip.symbol);
      const nav = quote?.price;

      // Safety: do NOT execute if fresh market NAV is unavailable
      if (!nav || nav <= 0) {
        console.warn(`[SIP Engine] Skipping SIP for ${sip.name}: could not fetch valid NAV (got ${nav}). Will retry on next market session.`);
        skippedSips.push({ sipId: sip.id, name: sip.name, reason: 'NAV unavailable or market closed' });
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

      processedSips.push({
        sipId: sip.id,
        name: sip.name,
        amount: totalAmount,
        nav,
        units,
        executedDate: sip.next_run_date,
        newNextRunDate,
        autoClosed: sipUpdates.status === 'CLOSED'
      });

      console.log(`[SIP Engine] Successfully executed SIP for ${sip.name}: Rs.${totalAmount} (${units} units). Next: ${sipUpdates.status === 'CLOSED' ? 'CLOSED' : newNextRunDate}`);
    } catch (sipErr) {
      console.error(`[SIP Engine Error executing SIP ${sip.id}]:`, sipErr.message);
      skippedSips.push({ sipId: sip.id, name: sip.name, reason: sipErr.message });
    }
  }

  return { processedCount: processedSips.length, processedSips, skippedCount: skippedSips.length, skippedSips };
}
