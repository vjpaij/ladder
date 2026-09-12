import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { supabase } from '../server/supabaseClient.js';
import { listCloudBackups, CORE_TABLES } from './backup_manager.mjs';

const BUCKET_NAME = 'ladder_backups';
const LOCAL_BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

export async function restoreCloudBackup(specificFilename = null) {
  let targetFile = specificFilename;

  if (!targetFile) {
    console.log('[Restore Manager] No backup specified. Finding latest backup in Supabase Storage...');
    const backups = await listCloudBackups();
    if (!backups || backups.length === 0) {
      throw new Error('No backups found in Supabase Cloud Storage.');
    }
    targetFile = backups[0].name;
  }

  console.log(`[Restore Manager] Restoring from snapshot: ${targetFile}...`);

  let rawJson = null;
  // Try reading from cloud storage first
  const { data, error } = await supabase.storage.from(BUCKET_NAME).download(targetFile);
  if (!error && data) {
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (targetFile.endsWith('.gz')) {
      rawJson = zlib.gunzipSync(buffer).toString('utf-8');
    } else {
      rawJson = buffer.toString('utf-8');
    }
    console.log(`  ✓ Downloaded and decompressed ${targetFile} from Supabase Storage (${(rawJson.length / (1024 * 1024)).toFixed(2)} MB uncompressed)`);
  } else {
    // Fallback to local file if download failed
    const localPath = path.join(LOCAL_BACKUP_DIR, targetFile);
    if (fs.existsSync(localPath)) {
      const buffer = fs.readFileSync(localPath);
      if (targetFile.endsWith('.gz')) {
        rawJson = zlib.gunzipSync(buffer).toString('utf-8');
      } else {
        rawJson = buffer.toString('utf-8');
      }
      console.log(`  ✓ Loaded fallback local snapshot from ${localPath}`);
    } else {
      throw new Error(`Failed to download from Supabase Storage and no local fallback found: ${error?.message}`);
    }
  }

  const snapshot = JSON.parse(rawJson);
  if (!snapshot.tables) {
    throw new Error('Invalid snapshot structure: missing tables object.');
  }

  console.log(`[Restore Manager] Snapshot timestamp: ${snapshot.timestamp}, total rows recorded: ${snapshot.totalRows}`);

  // Restore tables in foreign key / dependency order
  const restoreOrder = [
    'categories',
    'users',
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

  for (const table of restoreOrder) {
    const rows = snapshot.tables[table];
    if (!rows || !Array.isArray(rows)) {
      console.log(`  - Skipping ${table} (no data in snapshot)`);
      continue;
    }

    console.log(`  - Restoring ${table} (${rows.length} rows)...`);
    
    // Clear existing data safely
    const { error: delErr } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) {
      // In case table uses non-uuid id
      await supabase.from(table).delete().gte('created_at', '1970-01-01');
    }

    // Insert rows in batches of 500
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const { error: insErr } = await supabase.from(table).insert(chunk);
      if (insErr) {
        console.warn(`    [Warning] Batch insert error in ${table}:`, insErr.message);
      }
    }
    restoredCounts[table] = rows.length;
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
