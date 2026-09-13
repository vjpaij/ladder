import path from 'path';
import { fork } from 'child_process';

/**
 * Automatic background EOD rebuild trigger when any past-dated transaction is added, updated, or removed
 */
export function triggerEodRebuildIfPastDate(txDate) {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (txDate && String(txDate).slice(0, 10) < todayStr) {
    console.log(`[EOD Auto-Sync] Past-dated transaction detected (${txDate} < ${todayStr}). Triggering background EOD rebuild...`);
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild_portfolio_eod.mjs');
      const child = fork(scriptPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (e) {
      console.warn('[EOD Auto-Sync Warning]:', e.message);
    }
  }
}
