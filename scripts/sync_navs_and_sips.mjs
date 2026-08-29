import { syncAllMissingNavs } from '../server/services/priceEngine.js';
import { processDueSips } from '../server/services/sipEngine.js';

async function main() {
  console.log(`[Cloud Cron Worker] Starting NAV & SIP sweep at ${new Date().toISOString()}...`);
  try {
    const navResults = await syncAllMissingNavs();
    console.log('[Cloud Cron Worker] Completed NAV sweep:', navResults);

    const sipResults = await processDueSips();
    console.log('[Cloud Cron Worker] Completed SIP processing:', sipResults);

    process.exit(0);
  } catch (err) {
    console.error('[Cloud Cron Worker Fatal Error]:', err);
    process.exit(1);
  }
}

main();
