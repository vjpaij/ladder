import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fork } from 'child_process';
import db, { initDatabase, warmCache } from './db.js';
import { supabase } from './supabaseClient.js';
import { 
  refreshAllHoldingsPrices, 
  refreshActiveHoldingsPrices, 
  liveQuoteCache, 
  fetchFxRate,
  syncAllMissingNavs 
} from './services/priceEngine.js';
import { createCloudBackup } from '../scripts/backup_manager.mjs';
import { JWT_SECRET } from './middleware/auth.js';
import { triggerEodRebuildIfPastDate } from './services/eodSync.js';
import { runComprehensiveSelfHealing } from './services/selfHealingService.js';

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
app.listen(PORT, () => {
  console.log(`[Ladder Server] Running on http://localhost:${PORT}`);

  // Self-scheduling non-overlapping real-time active price & forex sync loop
  const runLiveTicker = async () => {
    try {
      await refreshActiveHoldingsPrices();
    } catch (err) {
      console.warn('[LiveTicker Warning]:', err.message);
    }
    setTimeout(runLiveTicker, 2000);
  };

  // Start ticker runner after initial boot delay
  setTimeout(runLiveTicker, 1500);

  // Background self-healing: scan and resolve any data gaps (FX rates, missing quotes, NAVs)
  setTimeout(async () => {
    try {
      console.log('[Self-Healing Engine] Running comprehensive background self-healing scan...');
      await runComprehensiveSelfHealing();
    } catch (err) {
      console.warn('[Self-Healing Engine Warning]:', err.message);
    }
  }, 5000);

  // Full comprehensive portfolio sync & self-healing scan (every 10 minutes)
  setInterval(async () => {
    try {
      await refreshAllHoldingsPrices();
      await runComprehensiveSelfHealing();
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
      setTimeout(() => {
        console.log(`[EOD Scheduler] Triggering scheduled EOD rebuild (${label})...`);
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

  // Check on boot if yesterday's EOD log was missed (e.g. server was stopped)
  const checkMissedEodRebuild = async () => {
    try {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('pnl_history')
        .select('log_date')
        .order('log_date', { ascending: false })
        .limit(1);

      if (error) {
        console.warn('[Startup EOD Check] Query error:', error.message);
        return;
      }

      const latestLogDate = data?.[0]?.log_date;
      if (!latestLogDate) return;

      if (latestLogDate < yesterdayStr) {
        console.log(`[Startup EOD Check] Latest EOD log is ${latestLogDate}, but yesterday was ${yesterdayStr}. Triggering catch-up rebuild...`);
        const child = fork('./scripts/rebuild_portfolio_eod.mjs');
        child.on('exit', (code) => {
          console.log(`[Startup EOD Check] Catch-up rebuild finished with code ${code}`);
        });
        child.on('error', (err) => {
          console.error('[Startup EOD Check] Error starting catch-up rebuild:', err.message);
        });
      } else {
        console.log(`[Startup EOD Check] EOD logs are up to date (latest: ${latestLogDate}).`);
      }
    } catch (e) {
      console.warn('[Startup EOD Check] Failed to check missed rebuild:', e.message);
    }
  };

  checkMissedEodRebuild();

  // Pre-warm database cache on boot to eliminate cold starts and protect egress
  warmCache().catch(err => console.warn('[WarmCache Error]:', err.message));
});
