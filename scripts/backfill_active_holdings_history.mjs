import fs from 'fs';
import path from 'path';
import { fetchHistoricalPricesForSymbol } from '../server/services/historicalPriceStore.js';

async function backfill() {
  const histPath = path.join(process.cwd(), 'data', 'historical_prices.json');
  let hist = {};
  if (fs.existsSync(histPath)) {
    hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
  }

  const dbPath = path.join(process.cwd(), 'data', 'db_cache_snapshot.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const holdings = db.tables?.holdings?.data || [];
  const active = holdings.filter(h => (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') && Number(h.quantity) > 0);

  console.log(`[Backfill] Found ${active.length} active equity holdings.`);

  let updatedCount = 0;
  for (const h of active) {
    const sym = h.symbol;
    const cleanSym = sym.replace(/\.(NS|BO)$/i, '');
    const currentBars = hist[sym] ? Object.keys(hist[sym]).length : (hist[cleanSym] ? Object.keys(hist[cleanSym]).length : 0);

    if (currentBars < 200) {
      console.log(`[Backfill] ${sym} has only ${currentBars} bars. Fetching full multi-year history (from 2024-01-01)...`);
      try {
        const fresh = await fetchHistoricalPricesForSymbol(sym, h.category_id, '2024-01-01');
        const freshKeys = Object.keys(fresh);
        if (freshKeys.length > currentBars) {
          hist[cleanSym] = { ...(hist[cleanSym] || {}), ...fresh };
          hist[sym] = hist[cleanSym];
          console.log(`[Backfill] Successfully backfilled ${sym}: now has ${Object.keys(hist[cleanSym]).length} bars.`);
          updatedCount++;
        } else {
          console.log(`[Backfill] ${sym} returned ${freshKeys.length} bars (genuine new listing or limited data).`);
        }
      } catch (err) {
        console.error(`[Backfill] Failed to fetch ${sym}:`, err.message);
      }
      // Small pause to be gentle on Yahoo Finance
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (updatedCount > 0) {
    fs.writeFileSync(histPath, JSON.stringify(hist, null, 2));
    console.log(`[Backfill] Saved ${updatedCount} backfilled holdings to ${histPath}.`);
  } else {
    console.log('[Backfill] All active holdings already have sufficient history.');
  }
}

backfill().catch(console.error);
