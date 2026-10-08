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

import db, { initDatabase, warmCache, getFullCacheSnapshot } from './db.js';
import { supabase } from './supabaseClient.js';
import { supabaseAdmin } from './supabaseAdminClient.js';
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
import { initWalFlusher, flushWal, getWalStatus } from './services/walFlusherService.js';
import { authenticateToken } from './middleware/auth.js';

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
import syncLogsRouter from './routes/syncLogs.js';
import { logSyncEvent } from './services/syncLogService.js';

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
app.use('/api', syncLogsRouter);

// -------------------------------------------------------------
// Sync Status API — surfaces WAL gaps and cache/Supabase divergence
// -------------------------------------------------------------
const SYNC_STATUS_TABLES = ['categories', 'holdings', 'transactions', 'dividends', 'liabilities'];
let _syncStatusCache = null;
let _syncStatusLastRun = 0;
const SYNC_STATUS_TTL_MS = 5 * 60 * 1000; // 5 minutes

app.get('/api/sync-status', authenticateToken, async (req, res) => {
  try {
    const now = Date.now();
    // Return cached result if fresh enough (avoids repeated Supabase COUNT queries)
    if (_syncStatusCache && (now - _syncStatusLastRun) < SYNC_STATUS_TTL_MS && !req.query.force) {
      return res.json(_syncStatusCache);
    }

    const walStatus = getWalStatus();
    const tableCounts = {};
    let totalGap = 0;

    for (const table of SYNC_STATUS_TABLES) {
      const cacheRows = await db.select(table);
      const cacheCount = Array.isArray(cacheRows) ? cacheRows.length : 0;
      let supabaseCount = null;
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        if (!error) supabaseCount = count;
      } catch (_) { /* non-fatal */ }
      const gap = supabaseCount !== null ? Math.max(0, cacheCount - supabaseCount) : 0;
      totalGap += gap;
      tableCounts[table] = { cache: cacheCount, supabase: supabaseCount, gap };
    }

    const result = {
      ok: totalGap === 0 && walStatus.pendingCount === 0,
      walPending: walStatus.pendingCount,
      walHasAlert: walStatus.hasAlert,
      walEntries: walStatus.entries,
      totalRowGap: totalGap,
      tableCounts,
      checkedAt: new Date().toISOString()
    };

    _syncStatusCache = result;
    _syncStatusLastRun = now;
    res.json(result);
  } catch (err) {
    console.error('[API Sync Status Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Internal full-snapshot endpoint — used by backup_manager to read live cache
// Protected by auth token; not exposed to the public internet
// -------------------------------------------------------------
app.get('/api/internal/full-snapshot', authenticateToken, (req, res) => {
  try {
    const snapshot = getFullCacheSnapshot();
    res.json({ success: true, tables: snapshot });
  } catch (err) {
    console.error('[API Internal Snapshot Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

  // 1c. Start WAL flusher — retries any pending Supabase writes from prior sessions
  try {
    initWalFlusher();
  } catch (err) {
    console.warn('[WAL Flusher Init Error]:', err.message);
  }

  // 1d. Startup divergence reconciliation — compare cache vs Supabase row counts
  //     If local cache has more rows than Supabase, upsert the missing rows directly.
  setTimeout(async () => {
    if (!supabaseAdmin) {
      console.warn('[Startup Reconciliation] supabaseAdmin not available — skipping divergence check.');
      return;
    }
    try {
      console.log('[Startup Reconciliation] Comparing cache row counts vs Supabase...');
      const reconcileTables = ['categories', 'holdings', 'transactions', 'dividends', 'liabilities'];
      let totalUpserted = 0;

      for (const table of reconcileTables) {
        const cacheRows = await db.select(table);
        const cacheCount = Array.isArray(cacheRows) ? cacheRows.length : 0;

        const { count, error: countErr } = await supabase
          .from(table).select('*', { count: 'exact', head: true });

        if (countErr || count === null) {
          console.warn(`[Startup Reconciliation] Could not get ${table} count from Supabase — skipping.`);
          continue;
        }

        const gap = Math.max(0, cacheCount - count);
        if (gap === 0) {
          console.log(`[Startup Reconciliation] ${table}: cache=${cacheCount}, supabase=${count} — IN SYNC`);
          continue;
        }

        console.warn(
          `[Startup Reconciliation] DIVERGENCE DETECTED: ${table} — ` +
          `cache has ${cacheCount} rows, Supabase has ${count} rows (gap: ${gap}). Reconciling...`
        );

        // Fetch all existing IDs from Supabase to find what's missing
        let supabaseIds = new Set();
        let from = 0;
        const batchSize = 1000;
        while (true) {
          const { data: idRows, error: idErr } = await supabaseAdmin
            .from(table).select('id').range(from, from + batchSize - 1);
          if (idErr || !idRows || idRows.length === 0) break;
          idRows.forEach(r => supabaseIds.add(String(r.id)));
          if (idRows.length < batchSize) break;
          from += batchSize;
        }

        // Find cache rows whose IDs are absent in Supabase
        const missingRows = cacheRows.filter(r => !supabaseIds.has(String(r.id)));
        if (missingRows.length === 0) {
          console.log(`[Startup Reconciliation] ${table}: no missing IDs found — counts may differ due to deletes. Skipping.`);
          continue;
        }

        console.log(`[Startup Reconciliation] ${table}: upserting ${missingRows.length} missing row(s) to Supabase...`);

        // Upsert in batches of 200 using service role (bypasses RLS)
        const upsertBatch = 200;
        let upserted = 0;
        for (let i = 0; i < missingRows.length; i += upsertBatch) {
          const chunk = missingRows.slice(i, i + upsertBatch);
          const { error: upsertErr } = await supabaseAdmin.from(table).upsert(chunk);
          if (upsertErr) {
            console.error(`[Startup Reconciliation] Failed to upsert ${table} batch:`, upsertErr.message);
          } else {
            upserted += chunk.length;
          }
        }
        totalUpserted += upserted;
        console.log(`[Startup Reconciliation] ${table}: ${upserted}/${missingRows.length} missing rows synced to Supabase.`);
      }

      if (totalUpserted > 0) {
        console.log(`[Startup Reconciliation] Complete. Upserted ${totalUpserted} total row(s) to Supabase.`);
      } else {
        console.log('[Startup Reconciliation] All write-through tables are in sync with Supabase.');
      }
    } catch (reconcileErr) {
      console.warn('[Startup Reconciliation Warning]:', reconcileErr.message);
    }
  }, 15000);

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
        const startTime = Date.now();
        try {
          console.log('[Self-Healing Scheduler] Running scheduled daily self-healing scan...');
          const result = await runComprehensiveSelfHealing();
          logSyncEvent({
            jobType: 'SELF_HEALING',
            jobName: 'Midnight Comprehensive Self-Healing',
            scheduledTime: '00:05 AM IST',
            runTime: new Date().toISOString(),
            status: 'SUCCESS',
            durationMs: Date.now() - startTime,
            details: `Self-healing completed. Healed FX dates: ${result.fxHealed?.updated || 0}, Healed Prices: ${result.pricesHealed?.updated || 0}.`
          });
        } catch (err) {
          console.warn('[Self-Healing Scheduler Warning]:', err.message);
          logSyncEvent({
            jobType: 'SELF_HEALING',
            jobName: 'Midnight Comprehensive Self-Healing',
            scheduledTime: '00:05 AM IST',
            runTime: new Date().toISOString(),
            status: 'FAILED',
            durationMs: Date.now() - startTime,
            details: err.message,
            error: err.message
          });
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
        const startBackup = Date.now();
        try {
          const res = await createCloudBackup();
          console.log('[Backup Scheduler] Daily backup finished successfully.');
          logSyncEvent({
            jobType: 'CLOUD_BACKUP',
            jobName: 'Automated Daily Cloud Backup',
            scheduledTime: '08:25 AM IST',
            runTime: new Date().toISOString(),
            status: 'SUCCESS',
            durationMs: Date.now() - startBackup,
            details: `Lossless gzip backup saved to Supabase Storage (${res.filename || 'success'}).`
          });
        } catch (err) {
          console.error('[Backup Scheduler] Daily backup error:', err.message);
          logSyncEvent({
            jobType: 'CLOUD_BACKUP',
            jobName: 'Automated Daily Cloud Backup',
            scheduledTime: '08:25 AM IST',
            runTime: new Date().toISOString(),
            status: 'FAILED',
            durationMs: Date.now() - startBackup,
            details: err.message,
            error: err.message
          });
        } finally {
          armNext();
        }
      }, delay);
    };

    armNext();
  };

  scheduleDailyCloudBackup();

  // Sweep due SIPs periodically so automation continues when the UI is closed.
  // If any SIPs execute for past dates, trigger an EOD rebuild to sync Calendar entries.
  const runSipSweep = async () => {
    try {
      const result = await processDueSips();
      if (result && result.processedCount > 0) {
        const today = getTodayIST();
        const pastDatedSips = (result.processedSips || []).filter(p => p.executedDate && p.executedDate < today);
        if (pastDatedSips.length > 0) {
          console.log(`[SIP Scheduler] ${pastDatedSips.length} past-dated SIP(s) executed. Triggering EOD rebuild for Calendar sync...`);
          triggerEodRebuildIfPastDate(pastDatedSips[0].executedDate);
        }
      }
    } catch (err) {
      console.warn('[SIP Scheduler Warning]:', err.message);
    }
  };
  setTimeout(runSipSweep, 2000);
  setInterval(runSipSweep, 15 * 60 * 1000);

  // Automated daily EOD rebuild scheduler: runs across 4 target checkpoints
  // 1. 06:30 PM IST (13:00 UTC) — post Indian market close & NAV settlement
  // 2. 11:45 PM IST (18:15 UTC) — post AMFI & Protean late-night NAV publications
  // 3. 00:05 AM IST (18:35 UTC) — post midnight rollover to immediately persist yesterday's session
  // 4. 07:00 AM IST (01:30 UTC) — post US market close
  const scheduleDailyEodRebuild = () => {
    const getNextRebuildDelay = () => {
      const now = new Date();
      const targets = [
        { hour: 1, minute: 30, label: '07:00 AM IST' },
        { hour: 13, minute: 0, label: '06:30 PM IST' },
        { hour: 18, minute: 15, label: '11:45 PM IST' },
        { hour: 18, minute: 35, label: '00:05 AM IST' }
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
        const startRebuild = Date.now();
        try {
          // Persist official closing prices to Supabase holdings table once at session close
          await persistHoldingClosingPrices();
        } catch (e) {
          console.warn('[EOD Scheduler] Closing price persist warning:', e.message);
        }
        const child = fork('./scripts/rebuild_portfolio_eod.mjs');
        child.on('exit', (code) => {
          console.log(`[EOD Scheduler] Scheduled rebuild (${label}) completed with exit code ${code}`);
          logSyncEvent({
            jobType: 'EOD_REBUILD',
            jobName: `EOD Valuation Rebuild (${label})`,
            scheduledTime: label,
            runTime: new Date().toISOString(),
            status: code === 0 ? 'SUCCESS' : 'FAILED',
            durationMs: Date.now() - startRebuild,
            details: code === 0 
              ? `Rebuilt portfolio EOD logs and synchronized historical valuations.`
              : `Rebuild failed with exit code ${code}.`,
            error: code === 0 ? null : `Exit code ${code}`
          });
          armNextRebuild();
        });
        child.on('error', (err) => {
          console.error(`[EOD Scheduler] Error forking rebuild script:`, err.message);
          logSyncEvent({
            jobType: 'EOD_REBUILD',
            jobName: `EOD Valuation Rebuild (${label})`,
            scheduledTime: label,
            runTime: new Date().toISOString(),
            status: 'FAILED',
            durationMs: Date.now() - startRebuild,
            details: err.message,
            error: err.message
          });
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

      let latestLogDate = null;
      try {
        const eodFile = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
        if (fs.existsSync(eodFile)) {
          const raw = fs.readFileSync(eodFile, 'utf8');
          const logs = JSON.parse(raw);
          if (Array.isArray(logs) && logs.length > 0) {
            latestLogDate = logs[logs.length - 1].date;
          }
        }
      } catch (fileErr) {
        // Fall back to DB cache
      }

      if (!latestLogDate) {
        // Check cached pnl_history (0 egress)
        const pnlHistory = await db.select('pnl_history');
        if (pnlHistory && pnlHistory.length > 0) {
          latestLogDate = pnlHistory.reduce((max, r) => (!max || r.log_date > max) ? r.log_date : max, null);
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
