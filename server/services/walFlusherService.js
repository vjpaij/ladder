/**
 * walFlusherService.js
 * ---------------------------------------------------------------------------
 * Write-Ahead Log (WAL) flusher for guaranteed Supabase dual-write persistence.
 *
 * Architecture:
 *  - data/pending_writes.json stores every insert/update/delete that failed
 *    its Supabase write, so no user data is silently lost.
 *  - This service retries all WAL entries until they confirm in Supabase.
 *  - Entries are removed only after confirmed Supabase acknowledgement.
 *  - Up to MAX_RETRIES failures per entry trigger a persistent alert flag.
 *
 * Usage:
 *  - Call initWalFlusher() on server startup ONCE.
 *  - Call flushWal() directly before any backup operation (synchronous mode).
 *  - Call appendToWal(op, table, id, payload) from db.js on any Supabase failure.
 * ---------------------------------------------------------------------------
 */
import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../supabaseAdminClient.js';

const WAL_FILE = path.join(process.cwd(), 'data', 'pending_writes.json');
const MAX_RETRIES = 5;
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds

// NOTE: WAL flusher ALWAYS writes to Supabase via the admin client regardless
// of OFFLINE_CACHE_MODE. Offline mode gates user-facing reads only — the WAL
// flusher's job is specifically to bridge the gap between local cache and Supabase.

let _walFlusherInterval = null;
let _hasPendingAlert = false;

// ─── WAL File Helpers ────────────────────────────────────────────────────────

function readWal() {
  try {
    if (fs.existsSync(WAL_FILE)) {
      const raw = fs.readFileSync(WAL_FILE, 'utf-8');
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.warn('[WAL] Failed to read pending_writes.json:', e.message);
  }
  return [];
}

function writeWal(entries) {
  try {
    fs.writeFileSync(WAL_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[WAL] Failed to write pending_writes.json:', e.message);
  }
}

/**
 * Append a failed Supabase operation to the WAL.
 * Called from db.js whenever a Supabase insert/update/delete fails.
 */
export function appendToWal(operation, table, id, payload) {
  try {
    const entries = readWal();
    // De-duplicate: update existing WAL entry for same table+id+operation
    const existingIdx = entries.findIndex(
      e => e.table === table && String(e.id) === String(id) && e.operation === operation
    );
    if (existingIdx !== -1) {
      entries[existingIdx].payload = payload;
      entries[existingIdx].lastAttemptAt = new Date().toISOString();
    } else {
      entries.push({
        operation,   // 'insert' | 'update' | 'delete'
        table,
        id: String(id),
        payload,
        failedAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        retryCount: 0
      });
    }
    writeWal(entries);
    console.warn(`[WAL] Recorded pending ${operation.toUpperCase()} on ${table}[${id}]. Will retry automatically.`);
  } catch (e) {
    console.error('[WAL] CRITICAL: Could not append to WAL:', e.message);
  }
}

/**
 * Flush all pending WAL entries to Supabase.
 * Returns a summary { flushed, failed, remaining }.
 * @param {object} options
 * @param {number} options.timeoutMs  Max ms to spend flushing (default 30s)
 */
export async function flushWal({ timeoutMs = 30_000 } = {}) {
  if (!supabaseAdmin) {
    console.warn('[WAL Flush] supabaseAdmin not available — WAL flush skipped.');
    return { flushed: 0, failed: 0, remaining: readWal().length };
  }

  const entries = readWal();
  if (entries.length === 0) return { flushed: 0, failed: 0, remaining: 0 };

  console.log(`[WAL Flush] Flushing ${entries.length} pending operation(s) to Supabase...`);
  const deadline = Date.now() + timeoutMs;
  const remaining = [...entries];
  let flushed = 0;
  let failed = 0;

  for (let i = remaining.length - 1; i >= 0; i--) {
    if (Date.now() > deadline) {
      console.warn('[WAL Flush] Timeout reached — some entries deferred to next flush cycle.');
      break;
    }
    const entry = remaining[i];
    let success = false;

    try {
      if (entry.operation === 'insert') {
        const { error } = await supabaseAdmin.from(entry.table).upsert(entry.payload);
        success = !error;
        if (error) console.warn(`[WAL Flush] Insert retry failed ${entry.table}[${entry.id}]:`, error.message);
      } else if (entry.operation === 'update') {
        const { error } = await supabaseAdmin
          .from(entry.table)
          .update(entry.payload)
          .eq('id', entry.id);
        success = !error;
        if (error) console.warn(`[WAL Flush] Update retry failed ${entry.table}[${entry.id}]:`, error.message);
      } else if (entry.operation === 'delete') {
        const { error } = await supabaseAdmin
          .from(entry.table)
          .delete()
          .eq('id', entry.id);
        success = !error;
        if (error) console.warn(`[WAL Flush] Delete retry failed ${entry.table}[${entry.id}]:`, error.message);
      }
    } catch (e) {
      console.warn(`[WAL Flush] Exception retrying ${entry.operation} ${entry.table}[${entry.id}]:`, e.message);
    }

    if (success) {
      remaining.splice(i, 1);
      flushed++;
      console.log(`[WAL Flush] Successfully synced ${entry.operation.toUpperCase()} ${entry.table}[${entry.id}] to Supabase.`);
    } else {
      remaining[i].retryCount = (remaining[i].retryCount || 0) + 1;
      remaining[i].lastAttemptAt = new Date().toISOString();
      failed++;
      if (remaining[i].retryCount >= MAX_RETRIES) {
        _hasPendingAlert = true;
        console.error(
          `[WAL Flush] CRITICAL: Entry ${entry.table}[${entry.id}] has failed ${remaining[i].retryCount} times. ` +
          `Manual intervention may be required.`
        );
      }
    }
  }

  writeWal(remaining);
  _hasPendingAlert = remaining.some(e => (e.retryCount || 0) >= MAX_RETRIES);
  console.log(`[WAL Flush] Complete: ${flushed} synced, ${failed} failed, ${remaining.length} remaining.`);
  return { flushed, failed, remaining: remaining.length };
}

/**
 * Returns WAL status for /api/sync-status
 */
export function getWalStatus() {
  const entries = readWal();
  const criticalEntries = entries.filter(e => (e.retryCount || 0) >= MAX_RETRIES);
  return {
    pendingCount: entries.length,
    hasCritical: criticalEntries.length > 0,
    hasAlert: _hasPendingAlert || entries.length > 0,
    entries: entries.map(e => ({
      operation: e.operation,
      table: e.table,
      id: e.id,
      failedAt: e.failedAt,
      retryCount: e.retryCount || 0
    }))
  };
}

/**
 * Clear WAL entirely — only after a restore completes.
 */
export function clearWal() {
  writeWal([]);
  _hasPendingAlert = false;
  console.log('[WAL] Cleared. All pending writes removed (post-restore).');
}

/**
 * Start the background 30-second WAL flush loop.
 * Call once from server startup.
 */
export function initWalFlusher() {
  if (_walFlusherInterval) return; // Already running

  // Flush immediately on startup to resolve any failures from prior server session
  setTimeout(async () => {
    const walEntries = readWal();
    if (walEntries.length > 0) {
      console.log(`[WAL Flusher] Found ${walEntries.length} pending write(s) from prior session. Flushing now...`);
      await flushWal();
    }
  }, 5000);

  _walFlusherInterval = setInterval(async () => {
    try {
      const entries = readWal();
      if (entries.length > 0) {
        await flushWal();
      }
    } catch (e) {
      console.warn('[WAL Flusher] Interval error:', e.message);
    }
  }, FLUSH_INTERVAL_MS);

  console.log('[WAL Flusher] Background WAL flush loop started (30s interval).');
}
