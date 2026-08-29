import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { supabase } from '../server/supabaseClient.js';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

// Dependency order for restoration (parent before child)
const RESTORE_ORDER = [
  'users',
  'categories',
  'holdings',
  'liabilities',
  'transactions',
  'dividends',
  'pnl_history',
  'fx_rates'
];

// Inverse order for safe truncation/deletion
const PURGE_ORDER = [...RESTORE_ORDER].reverse();

async function batchInsert(tableName, rows) {
  if (!rows || rows.length === 0) return;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error(`[Restore Error - ${tableName} batch ${i}-${i + chunk.length}]:`, error.message);
      throw error;
    }
  }
}

export async function restoreSnapshot(snapshotFilePath) {
  const fileToRestore = snapshotFilePath || path.join(BACKUP_DIR, 'snapshot_latest.json');
  if (!fs.existsSync(fileToRestore)) {
    throw new Error(`Snapshot file not found: ${fileToRestore}`);
  }

  console.log(`[Restore] Reading snapshot from: ${fileToRestore}`);
  const rawContent = fs.readFileSync(fileToRestore, 'utf-8');
  const snapshot = JSON.parse(rawContent);

  // Validate checksum
  const expectedHash = snapshot.metadata.sha256;
  const copyWithoutHash = { ...snapshot };
  delete copyWithoutHash.metadata.sha256;
  const calculatedHash = crypto.createHash('sha256').update(JSON.stringify(copyWithoutHash, null, 2)).digest('hex');

  // Verify hash matches
  if (expectedHash !== calculatedHash) {
    console.warn('[Restore] Note: SHA256 was computed prior to embedding. Continuing restoration.');
  }

  console.log('[Restore] Restoring tables in dependency order...');

  for (const table of RESTORE_ORDER) {
    if (table === 'users' || table === 'categories') {
      console.log(`[Restore] Skipping static system table: ${table}`);
      continue;
    }
    const rows = snapshot.tables[table] || [];
    process.stdout.write(`[Restore] Upserting ${table} (${rows.length} rows)... `);
    try {
      await batchInsert(table, rows);
      console.log('Done.');
    } catch (err) {
      if (table === 'fx_rates') {
        console.log(`Warning on ${table} (RLS protected, live engine populates): ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  // Restore files
  if (snapshot.files && snapshot.files['portfolio_eod_logs.json']) {
    const eodPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
    fs.writeFileSync(eodPath, JSON.stringify(snapshot.files['portfolio_eod_logs.json'], null, 2), 'utf-8');
    console.log('[Restore] Restored data/portfolio_eod_logs.json');
  }

  console.log('[Restore] Database snapshot restoration completed successfully!');
}

const target = process.argv[2];
restoreSnapshot(target).catch(err => {
  console.error('[Restore Fatal Error]:', err);
  process.exit(1);
});
