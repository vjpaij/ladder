import { syncAllMissingNavs } from '../server/services/priceEngine.js';
import { processDueSips } from '../server/services/sipEngine.js';

async function main() {
  const runAt = new Date().toISOString();
  console.log(`[Cloud Cron Worker] Starting NAV & SIP sweep at ${runAt}...`);

  try {
    const navResults = await syncAllMissingNavs();

    if (navResults.skipped) {
      // Non-trading day: exit cleanly with informational message.
      // GitHub Actions will show this as a successful run, not a failure.
      console.log(`[Cloud Cron Worker] Skipped: ${navResults.skipReason}`);
      process.exit(0);
    }

    console.log('[Cloud Cron Worker] NAV sweep completed:', {
      npsUpdated: navResults.npsUpdated,
      mfUpdated: navResults.mfUpdated,
      totalChecked: navResults.totalChecked
    });

    // Only process SIPs on trading days
    const sipResults = await processDueSips();
    console.log('[Cloud Cron Worker] SIP processing completed:', sipResults);

    process.exit(0);
  } catch (err) {
    console.error('[Cloud Cron Worker Fatal Error]:', err);
    process.exit(1);
  }
}

main();
