import express from 'express';
import path from 'path';
import { fork } from 'child_process';
import db from '../db.js';
import { createCloudBackup, listCloudBackups, deleteCloudBackup, deleteAllCloudBackups } from '../../scripts/backup_manager.mjs';
import { restoreCloudBackup } from '../../scripts/restore_backup.mjs';
import { authenticateToken } from '../middleware/auth.js';
import { getWalStatus, flushWal } from '../services/walFlusherService.js';

const router = express.Router();

// -------------------------------------------------------------
// Supabase Cloud 3-Tier Rolling Backup & Restore API
// -------------------------------------------------------------
router.get('/cloud-backups', authenticateToken, async (req, res) => {
  try {
    const backups = await listCloudBackups();
    res.json({ success: true, backups });
  } catch (err) {
    console.error('[API Cloud Backups List Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/cloud-backups/create', authenticateToken, async (req, res) => {
  try {
    const result = await createCloudBackup();
    const message = result.isPartial
      ? `Backup created with PARTIAL sync warning: ${result.integrity?.walPendingAtBackup || 0} entries pending cloud sync. Local data captured.`
      : 'Cloud backup created successfully from live data.';
    res.json({ success: true, message, result });
  } catch (err) {
    console.error('[API Cloud Backup Create Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/cloud-backups/delete', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Filename is required for deletion.' });
    }
    const result = await deleteCloudBackup(filename);
    res.json({ success: true, message: `Backup "${result.filename}" deleted successfully.`, result });
  } catch (err) {
    console.error('[API Cloud Backup Delete Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/cloud-backups/delete-all', authenticateToken, async (req, res) => {
  try {
    const result = await deleteAllCloudBackups();
    res.json({
      success: true,
      message: `All backups deleted successfully (${result.deletedCloudCount} cloud, ${result.deletedLocalCount} local).`,
      result
    });
  } catch (err) {
    console.error('[API Cloud Backup Delete All Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// In-process restore job ledger: jobId -> { status, message, startedAt, completedAt, error? }
const restoreJobs = new Map();
let restoreInProgress = false;

router.post('/cloud-backups/restore', authenticateToken, async (req, res) => {
  if (restoreInProgress) {
    return res.status(409).json({ error: 'Another restore is already in progress.' });
  }
  const { filename } = req.body || {};
  if (filename !== undefined && (typeof filename !== 'string' || !filename.trim())) {
    return res.status(400).json({ error: 'Invalid backup filename specified.' });
  }

  restoreInProgress = true;
  const jobId = `restore_${Date.now()}`;
  restoreJobs.set(jobId, {
    status: 'initiated',
    message: 'Restore initiated...',
    startedAt: new Date().toISOString(),
    progress: { table: null, done: 0, total: 0 }
  });

  try {
    const job = restoreJobs.get(jobId);
    job.status = 'running';
    job.message = 'Restoring database tables from cloud snapshot...';

    // Progress callback — updates job for polling
    const onProgress = (table, done, total) => {
      job.progress = { table, done, total };
      job.message = `Restoring ${table} (${done}/${total})...`;
    };

    const result = await restoreCloudBackup(filename || null, onProgress);

    // Invalidate RAM cache — warmCache(forceRefresh) is called inside restoreCloudBackup
    db.invalidateCache();

    job.status = 'running';
    job.message = 'Database restored. Rebuilding historical EOD valuation records in background...';

    // Respond immediately so HTTP connection does not time out
    res.json({
      success: true,
      jobId,
      status: 'running',
      message: job.message,
      result
    });

    // If the restored snapshot already included complete pnl_history, the restoration is 100% complete immediately!
    const restoredPnl = result?.restoredCounts?.pnl_history || 0;
    if (restoredPnl > 0) {
      job.status = 'succeeded';
      job.message = `Database fully restored from "${result.snapshotFile}" with all ${restoredPnl} EOD records synchronized!`;
      job.completedAt = new Date().toISOString();
      restoreInProgress = false;
      return;
    }

    // Otherwise, for legacy backups lacking pnl_history, rebuild in background
    (async () => {
      try {
        await new Promise((resolve, reject) => {
          const scriptPath = path.join(process.cwd(), 'scripts', 'rebuild_portfolio_eod.mjs');
          const child = fork(scriptPath, [], { stdio: 'pipe' });
          const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('EOD rebuild timed out after 5 minutes'));
          }, 5 * 60 * 1000);

          child.on('exit', (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error(`EOD rebuild exited with code ${code}`));
          });
          child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        job.status = 'succeeded';
        job.message = `Database fully restored from "${result.snapshotFile}" and EOD history synchronized.`;
        job.completedAt = new Date().toISOString();
      } catch (bgErr) {
        console.error('[API Cloud Backup Background EOD Rebuild Error]:', bgErr.message);
        // EOD rebuild failure is non-fatal — restore itself succeeded
        job.status = 'succeeded';
        job.message = `Restore complete. EOD rebuild had a warning: ${bgErr.message}`;
        job.completedAt = new Date().toISOString();
      } finally {
        restoreInProgress = false;
        setTimeout(() => restoreJobs.delete(jobId), 10 * 60 * 1000);
      }
    })();
  } catch (err) {
    console.error('[API Cloud Backup Restore Error]:', err.message);
    restoreInProgress = false;
    const job = restoreJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = new Date().toISOString();
    }
    res.status(500).json({ jobId, error: err.message, status: 'failed' });
    setTimeout(() => restoreJobs.delete(jobId), 10 * 60 * 1000);
  }
});

// Polling endpoint: clients check job progress after initiating restore
router.get('/cloud-backups/restore/status', authenticateToken, (req, res) => {
  const { jobId } = req.query;
  if (!jobId || !restoreJobs.has(jobId)) {
    return res.status(404).json({ error: 'Job not found or already expired.' });
  }
  res.json({ success: true, job: restoreJobs.get(jobId) });
});

export default router;
