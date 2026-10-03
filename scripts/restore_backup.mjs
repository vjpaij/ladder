/**
 * restore_backup.mjs
 * ---------------------------------------------------------------------------
 * Restores a compressed Supabase backup snapshot.
 *
 * Key fixes (Rule 31):
 *  - Uses supabaseAdmin (Service Role key) to bypass RLS on all tables.
 *  - Performs a pre-restore safety backup before wiping ANY table.
 *  - `users` table is NEVER wiped — credentials live in data/users.json.
 *  - Post-restore: rebuilds RAM cache via warmCache({ forceRefresh: true })
 *    and overwrites db_cache_snapshot.json with fresh Supabase data.
 *  - Clears pending_writes.json (WAL) after successful restore.
 * ---------------------------------------------------------------------------
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { supabaseAdmin } from '../server/supabaseAdminClient.js';
import { listCloudBackups, CORE_TABLES, createCloudBackup } from './backup_manager.mjs';
import { clearWal } from '../server/services/walFlusherService.js';
import { warmCache, saveCacheSnapshotToDisk } from '../server/db.js';

const BUCKET_NAME = 'ladder_backups';
const LOCAL_BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

/**
 * Main restore function.
 * @param {string|null} specificFilename - filename to restore, or null for latest
 * @param {function|null} onProgress - optional progress callback(table, done, total)
 */
export async function restoreCloudBackup(specificFilename = null, onProgress = null) {
  if (!supabaseAdmin) {
    throw new Error(
      'Restore requires SUPABASE_SERVICE_ROLE_KEY. ' +
      'Please set it in .env and restart the server.'
    );
  }

  // ── Step 1: Resolve target backup file ───────────────────────────────────
  let targetFile = specificFilename;
  if (!targetFile) {
    console.log('[Restore Manager] No backup specified. Finding latest backup in Supabase Storage...');
    const backups = await listCloudBackups();
    if (!backups || backups.length === 0) {
      throw new Error('No backups found in Supabase Cloud Storage.');
    }
    targetFile = backups[0].name;
  }

  if (
    typeof targetFile !== 'string' ||
    targetFile !== path.basename(targetFile) ||
    !/^ladder_backup_[\w\-]+\.json(?:\.gz)?$/.test(targetFile)
  ) {
    throw new Error('Invalid backup filename.');
  }

  // ── Step 2: Pre-restore safety backup ─────────────────────────────────────
  console.log('[Restore Manager] Creating pre-restore safety backup before wiping any data...');
  try {
    const safetyBackup = await createCloudBackup({ tagSuffix: '_prerestore' });
    console.log(`[Restore Manager] Safety backup created: ${safetyBackup.filename}`);
  } catch (safetyErr) {
    throw new Error(
      `Pre-restore safety backup FAILED — aborting restore to protect data: ${safetyErr.message}`
    );
  }

  // ── Step 3: Download and decompress snapshot ──────────────────────────────
  console.log(`[Restore Manager] Restoring from snapshot: ${targetFile}...`);
  let rawJson = null;

  const { data, error } = await supabaseAdmin.storage.from(BUCKET_NAME).download(targetFile);
  if (!error && data) {
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    rawJson = targetFile.endsWith('.gz')
      ? zlib.gunzipSync(buffer).toString('utf-8')
      : buffer.toString('utf-8');
    console.log(`  Downloaded and decompressed ${targetFile} (${(rawJson.length / (1024 * 1024)).toFixed(2)} MB uncompressed)`);
  } else {
    // Fallback to local file
    const localPath = path.join(LOCAL_BACKUP_DIR, targetFile);
    if (fs.existsSync(localPath)) {
      const buffer = fs.readFileSync(localPath);
      rawJson = targetFile.endsWith('.gz')
        ? zlib.gunzipSync(buffer).toString('utf-8')
        : buffer.toString('utf-8');
      console.log(`  Loaded fallback local snapshot from ${localPath}`);
    } else {
      throw new Error(
        `Failed to download from Supabase Storage and no local fallback found: ${error?.message}`
      );
    }
  }

  const snapshot = JSON.parse(rawJson);
  if (!snapshot.tables) {
    throw new Error('Invalid snapshot structure: missing tables object.');
  }

  console.log(`[Restore Manager] Snapshot timestamp: ${snapshot.timestamp}, total rows recorded: ${snapshot.totalRows || 'unknown'}`);

  // ── Step 4: Restore tables in dependency order (NO users table) ──────────
  // NOTE: 'users' is intentionally excluded — credentials live in data/users.json
  const restoreOrder = [
    'categories',
    'fx_rates',
    'liabilities',
    'holdings',
    'transactions',
    'dividends',
    'sips',
    'loan_amortization',
    'nps_daily_navs',
    'mutual_fund_holdings',
    'asset_metadata',
    'pnl_history'
  ];

  const restoredCounts = {};
  const totalTables = restoreOrder.length;
  let doneCount = 0;

  for (const table of restoreOrder) {
    const rows = snapshot.tables[table];

    // Gracefully skip tables not present in backup (e.g. older backup formats)
    if (!Array.isArray(rows)) {
      console.warn(`  [Restore Manager] Table '${table}' not found in snapshot — skipping.`);
      restoredCounts[table] = 0;
      doneCount++;
      if (onProgress) onProgress(table, doneCount, totalTables);
      continue;
    }

    console.log(`  Restoring ${table} (${rows.length} rows)...`);

    // Clear existing data using admin client (bypasses RLS)
    const { error: delErr } = await supabaseAdmin.from(table).delete().not('id', 'is', null);
    if (delErr) {
      throw new Error(`Failed to clear ${table}: ${delErr.message}`);
    }

    // Insert rows in batches using admin client
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const { error: insErr } = await supabaseAdmin.from(table).insert(chunk);
      if (insErr) {
        throw new Error(`Failed to restore ${table}: ${insErr.message}`);
      }
    }

    restoredCounts[table] = rows.length;
    doneCount++;
    if (onProgress) onProgress(table, doneCount, totalTables);
    console.log(`  Restored ${table}: ${rows.length} rows`);
  }

  // ── Step 5: Post-restore — rebuild RAM cache from fresh Supabase data ─────
  console.log('[Restore Manager] Rebuilding in-memory cache from restored Supabase data...');
  try {
    await warmCache({ forceRefresh: true });
    saveCacheSnapshotToDisk();
    console.log('[Restore Manager] Cache rebuilt and snapshot written to disk.');
  } catch (cacheErr) {
    console.warn('[Restore Manager] Cache rebuild warning (non-fatal):', cacheErr.message);
  }

  // ── Step 6: Clear WAL — Supabase is now authoritative ────────────────────
  try {
    clearWal();
  } catch (walErr) {
    console.warn('[Restore Manager] WAL clear warning (non-fatal):', walErr.message);
  }

  console.log('[Restore Manager] All tables successfully restored from cloud backup!');
  return {
    success: true,
    snapshotFile: targetFile,
    timestamp: snapshot.timestamp,
    restoredCounts
  };
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('restore_backup.mjs')) {
  const fileArg = process.argv[2] || null;
  restoreCloudBackup(fileArg)
    .then((res) => {
      console.log('\n[Restore Completed Successfully]');
      console.log('Restored rows:', res.restoredCounts);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Restore Failed]:', err.message);
      process.exit(1);
    });
}
