/**
 * backup_manager.mjs
 * ---------------------------------------------------------------------------
 * Creates, lists, and prunes compressed Supabase cloud backups.
 *
 * Key fix (Rule 30): Backup reads from the server's live in-memory dbCache
 * (canonical source of truth) via GET /api/internal/full-snapshot, NOT from
 * Supabase directly. This ensures entries that failed cloud sync (pending WAL)
 * are always captured in the backup.
 *
 * Before backup: WAL flusher is invoked to attempt Supabase sync first.
 * If WAL entries remain, backup is marked PARTIAL.
 * ---------------------------------------------------------------------------
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import http from 'http';
import { supabase } from '../server/supabaseClient.js';
import { flushWal, getWalStatus } from '../server/services/walFlusherService.js';
import { getFullCacheSnapshot } from '../server/db.js';

export const CORE_TABLES = [
  'categories',
  'fx_rates',
  'holdings',
  'transactions',
  'liabilities',
  'dividends',
  'pnl_history',
  'nps_daily_navs',
  'mutual_fund_holdings',
  'loan_amortization',
  'asset_metadata',
  'sips'
];

const BUCKET_NAME = 'ladder_backups';
const LOCAL_BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
const RETENTION_DAYS = 10;
const TEN_DAYS_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
}

// ─── Fetch All Rows (Supabase) — used ONLY for integrity count comparison ───
export async function fetchSupabaseRowCount(tableName) {
  try {
    let heldNpsCodes = null;
    if (tableName === 'nps_daily_navs') {
      const { data: npsHoldings } = await supabase.from('holdings').select('symbol').eq('category_id', 'nps');
      if (npsHoldings && npsHoldings.length > 0) {
        heldNpsCodes = npsHoldings.map(h => h.symbol).filter(Boolean);
      }
    }

    let query = supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (tableName === 'nps_daily_navs' && heldNpsCodes && heldNpsCodes.length > 0) {
      query = query.in('scheme_code', heldNpsCodes);
    }
    const { count, error } = await query;
    if (error) return null;
    return count;
  } catch (e) {
    return null;
  }
}

// ─── Legacy row fetcher — kept for backward-compat CLI scripts ───────────────
export async function fetchAllRows(tableName) {
  let allRows = [];
  let from = 0;
  const batchSize = 1000;

  let heldNpsCodes = null;
  if (tableName === 'nps_daily_navs') {
    try {
      const { data: npsHoldings } = await supabase.from('holdings').select('symbol').eq('category_id', 'nps');
      if (npsHoldings && npsHoldings.length > 0) {
        heldNpsCodes = npsHoldings.map(h => h.symbol).filter(Boolean);
      }
    } catch (e) {
      console.warn('[Backup Manager] Could not load held NPS symbols for backup scoping:', e.message);
    }
  }

  while (true) {
    let query = supabase.from(tableName).select('*');
    if (tableName === 'nps_daily_navs' && heldNpsCodes && heldNpsCodes.length > 0) {
      query = query.in('scheme_code', heldNpsCodes);
    }
    const { data, error } = await query.range(from, from + batchSize - 1);
    if (error) throw new Error(`Failed to read ${tableName}: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

// ─── Create Cloud Backup (live cache = canonical source of truth) ─────────────
/**
 * @param {object} options
 * @param {string} [options.tagSuffix]  - Optional suffix appended to filename (e.g. '_prerestore')
 */
export async function createCloudBackup({ tagSuffix = '' } = {}) {
  // ── Step 1: Flush WAL before backup so Supabase is as up-to-date as possible
  console.log('[Backup Manager] Flushing WAL before backup...');
  let walStatus;
  try {
    await flushWal({ timeoutMs: 30_000 });
    walStatus = getWalStatus();
  } catch (walErr) {
    console.warn('[Backup Manager] WAL flush warning (continuing):', walErr.message);
    walStatus = { pendingCount: -1, hasAlert: true };
  }

  const isPartial = walStatus.pendingCount > 0;
  if (isPartial) {
    console.warn(
      `[Backup Manager] WAL has ${walStatus.pendingCount} unsynced entries. ` +
      `Backup will include them from local cache but will be marked PARTIAL.`
    );
  }

  // ── Step 2: Read data from live in-memory cache (canonical source of truth)
  console.log('[Backup Manager] Reading data from live in-memory cache (canonical source of truth)...');
  const cacheSnapshot = getFullCacheSnapshot();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const partialTag = isPartial ? '_PARTIAL' : '';
  const filename = `ladder_backup_${timestamp}${partialTag}${tagSuffix}.json.gz`;

  const snapshotData = {
    timestamp: new Date().toISOString(),
    version: '2.0',
    compressed: true,
    source: 'live_cache',
    tables: {},
    stats: {},
    integrity: {
      sourceOfTruth: 'local_cache',
      walPendingAtBackup: walStatus.pendingCount,
      isPartial,
      tableCounts: {}
    }
  };

  let totalRows = 0;

  // ── Step 3: Gather rows from cache for each CORE_TABLE
  for (const table of CORE_TABLES) {
    const cacheRows = cacheSnapshot[table] || [];
    snapshotData.tables[table] = cacheRows;
    snapshotData.stats[table] = cacheRows.length;
    totalRows += cacheRows.length;

    // Get Supabase count for integrity comparison (lightweight HEAD query)
    const sbCount = await fetchSupabaseRowCount(table);
    snapshotData.integrity.tableCounts[table] = {
      cache: cacheRows.length,
      supabase: sbCount,
      synced: sbCount !== null ? cacheRows.length === sbCount : null
    };

    console.log(
      `  - ${table}: cache=${cacheRows.length} rows` +
      (sbCount !== null ? `, supabase=${sbCount} rows` : ' (supabase count unavailable)')
    );
  }

  snapshotData.totalRows = totalRows;

  // ── Step 4: Compress and save
  const rawJson = JSON.stringify(snapshotData, null, 2);
  const uncompressedBytes = Buffer.byteLength(rawJson);
  const compressedBuffer = zlib.gzipSync(Buffer.from(rawJson, 'utf-8'), { level: 9 });
  const compressedBytes = compressedBuffer.length;

  console.log(
    `[Backup Manager] Compressed: ${(uncompressedBytes / (1024 * 1024)).toFixed(2)} MB -> ` +
    `${(compressedBytes / (1024 * 1024)).toFixed(2)} MB ` +
    `(${((1 - compressedBytes / uncompressedBytes) * 100).toFixed(1)}% savings)`
  );

  // Save local compressed safety copy
  const localFilePath = path.join(LOCAL_BACKUP_DIR, filename);
  fs.writeFileSync(localFilePath, compressedBuffer);
  console.log(`[Backup Manager] Saved local compressed snapshot to ${localFilePath}`);

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, compressedBuffer, { contentType: 'application/gzip', upsert: true });

  if (uploadError) {
    console.error('[Backup Manager] Supabase Storage upload error:', uploadError.message);
    throw new Error(`Failed to upload backup to Supabase Storage: ${uploadError.message}`);
  }
  console.log(`[Backup Manager] Uploaded compressed snapshot to Supabase Cloud Storage: ${BUCKET_NAME}/${filename}`);

  // Auto-prune
  await pruneOlderBackups();

  return {
    filename,
    timestamp: snapshotData.timestamp,
    totalRows,
    sizeBytes: compressedBytes,
    uncompressedBytes,
    stats: snapshotData.stats,
    integrity: snapshotData.integrity,
    isPartial
  };
}

// ─── List Cloud Backups ───────────────────────────────────────────────────────
export async function listCloudBackups() {
  const { data, error } = await supabase.storage.from(BUCKET_NAME).list('', {
    sortBy: { column: 'name', order: 'desc' }
  });

  if (error) {
    console.warn('[Backup Manager] Failed to list backups from Supabase Storage:', error.message);
    if (fs.existsSync(LOCAL_BACKUP_DIR)) {
      const files = fs.readdirSync(LOCAL_BACKUP_DIR)
        .filter(f => f.startsWith('ladder_backup_') && (f.endsWith('.json.gz') || f.endsWith('.json')))
        .sort()
        .reverse()
        .map(f => {
          const stats = fs.statSync(path.join(LOCAL_BACKUP_DIR, f));
          return { name: f, created_at: stats.mtime.toISOString(), metadata: { size: stats.size } };
        });
      return files;
    }
    return [];
  }

  return (data || [])
    .filter(item => item.name.startsWith('ladder_backup_') && (item.name.endsWith('.json.gz') || item.name.endsWith('.json')))
    .sort((a, b) => b.name.localeCompare(a.name));
}

// ─── Prune Old Backups ────────────────────────────────────────────────────────
function getBackupTimestamp(backup) {
  if (backup.created_at) {
    const t = new Date(backup.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  const match = backup.name?.match(/ladder_backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (match) {
    const isoStr = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3Z');
    const t = new Date(isoStr).getTime();
    if (!isNaN(t)) return t;
  }
  return Date.now();
}

export async function pruneOlderBackups() {
  const cutoffTime = Date.now() - TEN_DAYS_MS;
  console.log(`[Backup Manager] Pruning backups older than ${RETENTION_DAYS} days...`);

  try {
    const backups = await listCloudBackups();
    const toDelete = backups.filter(b => getBackupTimestamp(b) < cutoffTime).map(b => b.name);

    if (toDelete.length > 0) {
      console.log(`[Backup Manager] Deleting ${toDelete.length} old cloud backup(s):`, toDelete);
      const { error } = await supabase.storage.from(BUCKET_NAME).remove(toDelete);
      if (error) console.warn('[Backup Manager] Cloud prune warning:', error.message);
      else console.log('[Backup Manager] Pruned older cloud backups successfully.');
    } else {
      console.log(`[Backup Manager] Zero cloud backups exceed the ${RETENTION_DAYS}-day retention window.`);
    }

    // Prune local backups
    if (fs.existsSync(LOCAL_BACKUP_DIR)) {
      fs.readdirSync(LOCAL_BACKUP_DIR)
        .filter(f => f.startsWith('ladder_backup_') && (f.endsWith('.json.gz') || f.endsWith('.json')))
        .forEach(f => {
          const filePath = path.join(LOCAL_BACKUP_DIR, f);
          try {
            if (fs.statSync(filePath).mtimeMs < cutoffTime) {
              fs.unlinkSync(filePath);
              console.log(`[Backup Manager] Pruned old local backup: ${f}`);
            }
          } catch (e) {
            console.warn(`[Backup Manager] Warning pruning local backup ${f}:`, e.message);
          }
        });
    }
  } catch (err) {
    console.warn('[Backup Manager] Prune warning:', err.message);
  }
}

// Direct execution via CLI
if (process.argv[1] && process.argv[1].endsWith('backup_manager.mjs')) {
  createCloudBackup()
    .then((res) => {
      console.log('\n[Backup Manager] Summary:');
      console.log(`  File: ${res.filename}`);
      console.log(`  Rows: ${res.totalRows}`);
      console.log(`  Compressed Size: ${(res.sizeBytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`  Uncompressed Size: ${(res.uncompressedBytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`  Partial: ${res.isPartial}`);
      console.log(`  Integrity:`, JSON.stringify(res.integrity, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Backup Manager] Failed:', err);
      process.exit(1);
    });
}
