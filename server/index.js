import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fork } from 'child_process';

// Global resilience handlers to prevent unexpected daemon exits
process.on('uncaughtException', (err) => {
  console.warn('[Server Resilience] Uncaught exception intercepted:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Server Resilience] Unhandled promise rejection intercepted:', reason?.message || reason);
});

import db, { initDatabase, warmCache } from './db.js';
import { supabase } from './supabaseClient.js';
import { 
  refreshAllHoldingsPrices, 
  refreshActiveHoldingsPrices, 
  persistHoldingClosingPrices,
  liveQuoteCache, 
  fetchFxRate,
  syncAllMissingNavs,
  isIndianMarketOpen,
  isUsMarketOpen,
  isAnyMarketOpen,
  isTradingDay,
  getLastTradingDay,
  getTodayIST,
  getYesterdayIST
} from './services/priceEngine.js';
import { createCloudBackup } from '../scripts/backup_manager.mjs';
import { JWT_SECRET } from './middleware/auth.js';
import { triggerEodRebuildIfPastDate } from './services/eodSync.js';
import { runComprehensiveSelfHealing } from './services/selfHealingService.js';
import { processDueSips } from './services/sipEngine.js';

// Import Modular API Route Controllers
import authRouter from './routes/auth.js';
import fxRouter from './routes/fx.js';
import summaryRouter from './routes/summary.js';
import holdingsRouter from './routes/holdings.js';
import transactionsRouter from './routes/transactions.js';
import liabilitiesRouter from './routes/liabilities.js';
import dividendsRouter from './routes/dividends.js';
import calendarRouter from './routes/calendar.js';
import backupRouter from './routes/backup.js';
import databaseRouter from './routes/database.js';
import sipsRouter from './routes/sips.js';
import searchRouter from './routes/search.js';
import reportsRouter from './routes/reports.js';

// Re-export background EOD rebuild helper for backward compatibility
export { triggerEodRebuildIfPastDate };

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Process-level resilience against unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Server Warning] Unhandled Promise Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.warn('[Server Warning] Uncaught Exception:', err?.message || err);
});

// Initialize DB engine connection
initDatabase();

// -------------------------------------------------------------
// Mount Modular API Routers
// -------------------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api', fxRouter);
app.use('/api', summaryRouter);
app.use('/api', holdingsRouter);
app.use('/api', transactionsRouter);
app.use('/api', liabilitiesRouter);
app.use('/api', dividendsRouter);
app.use('/api', calendarRouter);
app.use('/api', backupRouter);
app.use('/api', databaseRouter);
app.use('/api', sipsRouter);
app.use('/api', searchRouter);
app.use('/api', reportsRouter);

// -------------------------------------------------------------
// Server Boot & Background Schedulers
// -------------------------------------------------------------
app.listen(PORT, async () => {
  console.log(`[Ladder Server] Running on http://localhost:${PORT}`);

  // 1. Pre-warm database cache on boot first to eliminate cold starts and protect egress
  try {
    await warmCache();
  } catch (err) {
    console.warn('[WarmCache Error]:', err.message);
  }

  // 1b. Prime liveQuoteCache from cached holdings on server boot (0 Supabase egress)
  try {
    const cachedHoldings = await db.select('holdings');
    if (Array.isArray(cachedHoldings)) {
      let primedCount = 0;
      for (const h of cachedHoldings) {
        if (!h.symbol) continue;
        const nse = Number(h.nse_price) || 0;
        const bse = Number(h.bse_price) || 0;
        const cur = Number(h.current_price) || 0;
        const highest = h.category_id === 'in_stocks' ? Math.max(cur, nse, bse) : cur;
        if (highest > 0 || nse > 0 || bse > 0) {
          liveQuoteCache.set(h.symbol, {
            price: highest > 0 ? highest : cur,
            nse_price: nse,
            bse_price: bse,
            dayChange: h.day_change !== undefined ? Number(h.day_change) : 0,
            dayChangePct: h.day_change_pct !== undefined ? Number(h.day_change_pct) : 0,
            quoteDate: h.quote_date || null
          });
          primedCount++;
        }
      }
      console.log(`[PriceEngine] Primed liveQuoteCache with ${primedCount} holdings from local cache on boot (0 egress).`);
    }

    // Synchronize latest authoritative NAVs for active NPS and MF holdings
    await syncAllMissingNavs({ persistToDb: true });
  } catch (err) {
    console.warn('[PriceEngine Priming Warning]:', err.message);
  }

  // 2. Self-scheduling non-overlapping real-time active price & forex sync loop
  // Runs every 10s during active market trading hours for open markets, and pauses when markets are closed
  let lastTickerMarketState = null;
  const runLiveTicker = async () => {
    let nextDelay = 30000;
    try {
      const inOpen = isIndianMarketOpen();
      const usOpen = isUsMarketOpen();
      const open = inOpen || usOpen;
      if (!open) {
        if (lastTickerMarketState !== 'CLOSED') {
          console.log('[LiveTicker] Markets are currently closed. Live price polling is paused.');
          lastTickerMarketState = 'CLOSED';
        }
        nextDelay = 30000;
      } else {
        if (lastTickerMarketState !== 'OPEN') {
          console.log(`[LiveTicker] Market session is active (IN: ${inOpen ? 'OPEN' : 'CLOSED'}, US: ${usOpen ? 'OPEN' : 'CLOSED'}). Polling live quotes every 10s.`);
          lastTickerMarketState = 'OPEN';
        }
        await refreshActiveHoldingsPrices();
        nextDelay = 10000;
      }
    } catch (err) {
      console.warn('[LiveTicker Warning]:', err.message);
      nextDelay = 15000;
    }
    setTimeout(runLiveTicker, nextDelay);
  };

  // Start ticker runner after initial boot delay
  setTimeout(runLiveTicker, 3000);

  // 3. Startup self-healing: scan and resolve any data gaps once after warm-up
  setTimeout(async () => {
    try {
      console.log('[Self-Healing Engine] Running single startup background self-healing scan...');
      await runComprehensiveSelfHealing();
    } catch (err) {
      console.warn('[Self-Healing Engine Warning]:', err.message);
    }
  }, 10000);

  // 4. Daily midnight self-healing scheduler: runs strictly once per day at 00:05 AM IST (18:35 UTC)
  const scheduleDailySelfHealing = () => {
    const getNextMidnightDelay = () => {
      const now = new Date();
      // 18:35 UTC is exactly 00:05 AM IST next day
      const nextTarget = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        18, 35, 0, 0
      ));
      if (nextTarget.getTime() <= now.getTime()) {
        nextTarget.setUTCDate(nextTarget.getUTCDate() + 1);
      }
      return nextTarget.getTime() - now.getTime();
    };

    const armNextHealing = () => {
      const delay = getNextMidnightDelay();
      console.log(`[Self-Healing Scheduler] Next automated daily self-healing scheduled in ${(delay / 3600000).toFixed(2)}h`);
      setTimeout(async () => {
        try {
          console.log('[Self-Healing Scheduler] Running scheduled daily self-healing scan...');
          await runComprehensiveSelfHealing();
        } catch (err) {
          console.warn('[Self-Healing Scheduler Warning]:', err.message);
        } finally {
          armNextHealing();
        }
      }, delay);
    };

    armNextHealing();
  };

  scheduleDailySelfHealing();

  // 5. Full comprehensive portfolio sync (every 10 minutes)
  // EGRESS GUARD: persistToDb is strictly FALSE to update RAM with 0 Supabase egress.
  // On non-trading days (weekends/holidays), skip when markets are closed to protect egress.
  setInterval(async () => {
    try {
      const today = getTodayIST();
      const anyOpen = isAnyMarketOpen();
      const isTodayTrading = isTradingDay(today, 'NSE') || isTradingDay(today, 'NYSE');
      if (!anyOpen && !isTodayTrading) {
        return; // Non-trading day and markets closed; prices cannot change.
      }
      await refreshAllHoldingsPrices({ persistToDb: false });
    } catch (err) {
      console.warn('[FullPriceSync Warning]:', err.message);
    }
  }, 10 * 60 * 1000);

  // Automated daily cloud backup scheduler: runs everyday at 08:25 AM IST (02:55 UTC)
  const scheduleDailyCloudBackup = () => {
    const getNextBackupDelay = () => {
      const now = new Date();
      // 02:55:00 UTC is exactly 08:25:00 AM IST (UTC + 5:30)
      const nextTarget = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        2, 55, 0, 0
      ));
      if (nextTarget.getTime() <= now.getTime()) {
        nextTarget.setUTCDate(nextTarget.getUTCDate() + 1);
      }
      return nextTarget.getTime() - now.getTime();
    };

    const armNext = () => {
      const delay = getNextBackupDelay();
      const targetTime = new Date(Date.now() + delay);
      console.log(`[Backup Scheduler] Next automated 08:25 AM IST cloud backup scheduled for ${targetTime.toISOString()} (in ${(delay / 3600000).toFixed(2)}h)`);
      setTimeout(async () => {
        console.log('[Backup Scheduler] Running daily 08:25 AM IST cloud backup...');
        try {
          await createCloudBackup();
          console.log('[Backup Scheduler] Daily backup finished successfully.');
        } catch (err) {
          console.error('[Backup Scheduler] Daily backup error:', err.message);
        } finally {
          armNext();
        }
      }, delay);
    };

    armNext();
  };

  scheduleDailyCloudBackup();

  // Sweep due SIPs periodically so automation continues when the UI is closed.
  const runSipSweep = async () => {
    try {
      await processDueSips();
    } catch (err) {
      console.warn('[SIP Scheduler Warning]:', err.message);
    }
  };
  setTimeout(runSipSweep, 2000);
  setInterval(runSipSweep, 15 * 60 * 1000);

  // Automated daily EOD rebuild scheduler: runs twice daily
  // 1. 06:30 PM IST (13:00 UTC) — post Indian market close & NAV settlement
  // 2. 07:00 AM IST (01:30 UTC) — post US market close
  const scheduleDailyEodRebuild = () => {
    const getNextRebuildDelay = () => {
      const now = new Date();
      const targets = [
        { hour: 1, minute: 30, label: '07:00 AM IST' },
        { hour: 13, minute: 0, label: '06:30 PM IST' }
      ].map(t => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), t.hour, t.minute, 0, 0));
        if (d.getTime() <= now.getTime()) {
          d.setUTCDate(d.getUTCDate() + 1);
        }
        return { time: d.getTime(), label: t.label, date: d };
      });
      targets.sort((a, b) => a.time - b.time);
      const next = targets[0];
      return { delay: next.time - now.getTime(), label: next.label, date: next.date };
    };

    const armNextRebuild = () => {
      const { delay, label, date } = getNextRebuildDelay();
      console.log(`[EOD Scheduler] Next automated EOD rebuild (${label}) scheduled for ${date.toISOString()} (in ${(delay / 3600000).toFixed(2)}h)`);
      setTimeout(async () => {
        console.log(`[EOD Scheduler] Triggering scheduled EOD rebuild (${label})...`);
        try {
          // Persist official closing prices to Supabase holdings table once at session close
          await persistHoldingClosingPrices();
        } catch (e) {
          console.warn('[EOD Scheduler] Closing price persist warning:', e.message);
        }
        const child = fork('./scripts/rebuild_portfolio_eod.mjs');
        child.on('exit', (code) => {
          console.log(`[EOD Scheduler] Scheduled rebuild (${label}) completed with exit code ${code}`);
          armNextRebuild();
        });
        child.on('error', (err) => {
          console.error(`[EOD Scheduler] Error forking rebuild script:`, err.message);
          armNextRebuild();
        });
      }, delay);
    };

    armNextRebuild();
  };

  scheduleDailyEodRebuild();

  // Check on boot if previous completed trading session's EOD log was missed (e.g. server was stopped)
  const checkMissedEodRebuild = async () => {
    try {
      const yesterday = getYesterdayIST();
      const lastCompletedTradingDay = getLastTradingDay(yesterday, 'NSE');

      // Check cached pnl_history first (0 egress)
      const pnlHistory = await db.select('pnl_history');
      let latestLogDate = null;
      if (pnlHistory && pnlHistory.length > 0) {
        latestLogDate = pnlHistory.reduce((max, r) => (!max || r.log_date > max) ? r.log_date : max, null);
      } else {
        const { data, error } = await supabase
          .from('pnl_history')
          .select('log_date')
          .order('log_date', { ascending: false })
          .limit(1);
        if (!error && data?.[0]) {
          latestLogDate = data[0].log_date;
        }
      }

      if (!latestLogDate) return;

      // Only trigger rebuild if the latest log date is strictly older than the last completed trading session
      if (latestLogDate < lastCompletedTradingDay) {
        console.log(`[Startup EOD Check] Latest EOD log is ${latestLogDate}, but last completed trading session was ${lastCompletedTradingDay}. Triggering catch-up rebuild...`);
        const child = fork('./scripts/rebuild_portfolio_eod.mjs');
        child.on('exit', (code) => {
          console.log(`[Startup EOD Check] Catch-up rebuild finished with code ${code}`);
        });
        child.on('error', (err) => {
          console.error('[Startup EOD Check] Error starting catch-up rebuild:', err.message);
        });
      } else {
        console.log(`[Startup EOD Check] EOD logs are up to date with last trading session (latest: ${latestLogDate}, last trading day: ${lastCompletedTradingDay}).`);
      }
    } catch (e) {
      console.warn('[Startup EOD Check] Failed to check missed rebuild:', e.message);
    }
  };

  checkMissedEodRebuild();
});
