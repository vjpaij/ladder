/**
 * Unified Daily Sync Orchestrator
 *
 * Coordinates the complete end-of-day sequence deterministically:
 * 1. Price Ingestion: scripts/sync_daily_prices.mjs
 * 2. EOD Rebuild:     scripts/rebuild_portfolio_eod.mjs
 * 3. Integrity Audit: scripts/verify_financial_integrity.mjs
 * 4. Cloud Backup:    scripts/backup_manager.mjs
 */

import { fork } from 'child_process';
import path from 'path';

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const scriptName = path.basename(scriptPath);
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[Daily Sync] Running: ${scriptName}...`);
    console.log(`----------------------------------------------------------------`);
    const start = Date.now();

    const child = fork(scriptPath, args, { stdio: 'inherit' });

    child.on('exit', (code) => {
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`\n[Daily Sync] ✓ ${scriptName} completed successfully in ${duration}s.`);
        resolve({ scriptName, duration, code });
      } else {
        const err = new Error(`${scriptName} failed with exit code ${code}`);
        err.code = code;
        err.scriptName = scriptName;
        reject(err);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function runDailySync() {
  console.log('================================================================');
  console.log('            LADDER UNIFIED DAILY SYNC ORCHESTRATOR              ');
  console.log('================================================================');
  const overallStart = Date.now();
  const results = [];

  try {
    // 1. Ingest daily prices & NAVs
    results.push(await runScript('./scripts/sync_daily_prices.mjs'));

    // 2. Rebuild historical EOD logs & synchronize pnl_history
    results.push(await runScript('./scripts/rebuild_portfolio_eod.mjs'));

    // 3. Verify financial data integrity & invariance assertions
    results.push(await runScript('./scripts/verify_financial_integrity.mjs'));

    // 4. Create compressed cloud backup with 10-day retention
    results.push(await runScript('./scripts/backup_manager.mjs'));

    const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(1);
    console.log('\n================================================================');
    console.log(`       DAILY SYNC COMPLETE: ALL 4 STAGES PASSED (${totalDuration}s)       `);
    console.log('================================================================');
    results.forEach((r, idx) => {
      console.log(`  [Stage ${idx + 1}] ${r.scriptName}: ${r.duration}s (Exit 0)`);
    });
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ [Daily Sync Fatal Error]: ${err.message}`);
    process.exit(1);
  }
}

runDailySync();
