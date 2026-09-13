import express from 'express';
import path from 'path';
import { fork } from 'child_process';
import db from '../db.js';
import { createCloudBackup, listCloudBackups } from '../../scripts/backup_manager.mjs';
import { restoreCloudBackup } from '../../scripts/restore_backup.mjs';
import { authenticateToken } from '../middleware/auth.js';

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
    res.json({ success: true, message: 'Cloud backup created successfully in Supabase Storage!', result });
  } catch (err) {
    console.error('[API Cloud Backup Create Error]:', err.message);
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
  restoreJobs.set(jobId, { status: 'initiated', message: 'Restore initiated, waiting for process...', startedAt: new Date().toISOString() });

  try {
    const job = restoreJobs.get(jobId);
    job.status = 'running';
    job.message = 'Restoring database tables from cloud snapshot...';

    const result = await restoreCloudBackup(filename);
    db.invalidateCache();

    job.status = 'running';
    job.message = 'Database restored. Rebuilding historical EOD valuation records in background...';

    // Respond immediately so HTTP connection does not time out on long EOD rebuilds
    res.json({
      success: true,
      jobId,
      status: 'running',
      message: 'Database restored. Rebuilding historical EOD valuation records in background...',
      result
    });

    // Run EOD rebuild asynchronously in background with process timeout protection
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
        job.status = 'failed';
        job.error = bgErr.message;
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
