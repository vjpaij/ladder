import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getSyncLogs, logSyncEvent } from '../services/syncLogService.js';
import { refreshAllHoldingsPrices } from '../services/priceEngine.js';

const router = express.Router();

/**
 * GET /api/sync-logs
 * Retrieves sync execution logs for the last 10 days
 */
router.get('/sync-logs', authenticateToken, (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 10;
    const limit = parseInt(req.query.limit, 10) || 200;
    const logs = getSyncLogs({ days, limit });
    res.json({
      success: true,
      count: logs.length,
      days,
      logs
    });
  } catch (err) {
    console.error('[API /sync-logs Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync-logs/trigger
 * Manually trigger on-demand sync from logs modal
 */
router.post('/sync-logs/trigger', authenticateToken, async (req, res) => {
  const start = Date.now();
  try {
    const result = await refreshAllHoldingsPrices();
    const duration = Date.now() - start;
    const log = logSyncEvent({
      jobType: 'MANUAL_SYNC',
      jobName: 'On-Demand Manual Asset Sync',
      scheduledTime: 'On-Demand Trigger',
      runTime: new Date().toISOString(),
      status: 'SUCCESS',
      durationMs: duration,
      details: `Updated ${result.updatedHoldings || 0} holdings across Indian Stocks, US Stocks, Mutual Funds, and NPS.`
    });
    res.json({ success: true, log, ...result });
  } catch (err) {
    const duration = Date.now() - start;
    const log = logSyncEvent({
      jobType: 'MANUAL_SYNC',
      jobName: 'On-Demand Manual Asset Sync',
      scheduledTime: 'On-Demand Trigger',
      runTime: new Date().toISOString(),
      status: 'FAILED',
      durationMs: duration,
      details: 'Sync failed: ' + err.message,
      error: err.message
    });
    res.status(500).json({ error: err.message, log });
  }
});

export default router;
