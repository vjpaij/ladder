import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { supabase } from '../server/supabaseClient.js';

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
  'users',
  'sips'
];

const BUCKET_NAME = 'ladder_backups';
const LOCAL_BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
const RETENTION_DAYS = 10;
const TEN_DAYS_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
}

// Fetch all rows from a table with pagination safety
export async function fetchAllRows(tableName) {
  let allRows = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(from, from + batchSize - 1);

    if (error) {
      console.warn(`[Backup Warning] Error reading ${tableName}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

// Create a complete compressed backup snapshot (.json.gz)
export async function createCloudBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ladder_backup_${timestamp}.json.gz`;

  console.log(`[Backup Manager] Starting full database backup (${filename})...`);
  const snapshotData = {
    timestamp: new Date().toISOString(),
    version: '1.0',
    compressed: true,
    tables: {},
    stats: {}
  };

  let totalRows = 0;
  for (const table of CORE_TABLES) {
    const rows = await fetchAllRows(table);
    snapshotData.tables[table] = rows;
    snapshotData.stats[table] = rows.length;
    totalRows += rows.length;
    console.log(`  - Fetched ${table}: ${rows.length} rows`);
  }
  snapshotData.totalRows = totalRows;

  const rawJson = JSON.stringify(snapshotData, null, 2);
  const uncompressedBytes = Buffer.byteLength(rawJson);
  
  // Gzip compression (lossless, 90% space reduction)
  const compressedBuffer = zlib.gzipSync(Buffer.from(rawJson, 'utf-8'), { level: 9 });
  const compressedBytes = compressedBuffer.length;

  console.log(`[Backup Manager] Compressed data: ${(uncompressedBytes / (1024 * 1024)).toFixed(2)} MB -> ${(compressedBytes / (1024 * 1024)).toFixed(2)} MB (${((1 - compressedBytes / uncompressedBytes) * 100).toFixed(1)}% savings)`);

  const localFilePath = path.join(LOCAL_BACKUP_DIR, filename);

  // 1. Save local compressed safety copy
  fs.writeFileSync(localFilePath, compressedBuffer);
  console.log(`[Backup Manager] Saved local compressed snapshot to ${localFilePath}`);

  // 2. Upload compressed archive to Supabase Storage bucket 'ladder_backups'
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, compressedBuffer, {
      contentType: 'application/gzip',
      upsert: true
    });

  if (uploadError) {
    console.error('[Backup Manager] Supabase Storage upload error:', uploadError.message);
    throw new Error(`Failed to upload backup to Supabase Storage: ${uploadError.message}`);
  }
  console.log(`[Backup Manager] Successfully uploaded compressed snapshot to Supabase Cloud Storage: ${BUCKET_NAME}/${filename}`);

  // 3. Auto-prune backups older than 10 days (unlimited backups within 10 days)
  await pruneOlderBackups();

  return {
    filename,
    timestamp: snapshotData.timestamp,
    totalRows,
    sizeBytes: compressedBytes,
    uncompressedBytes,
    stats: snapshotData.stats
  };
}

// List all cloud backups in Supabase Storage
export async function listCloudBackups() {
  const { data, error } = await supabase.storage.from(BUCKET_NAME).list('', {
    sortBy: { column: 'name', order: 'desc' }
  });

  if (error) {
    console.warn('[Backup Manager] Failed to list backups from Supabase Storage:', error.message);
    // Fallback to local files if cloud listing has issues
    if (fs.existsSync(LOCAL_BACKUP_DIR)) {
      const files = fs.readdirSync(LOCAL_BACKUP_DIR)
        .filter(f => f.startsWith('ladder_backup_') && (f.endsWith('.json.gz') || f.endsWith('.json')))
        .sort()
        .reverse()
        .map(f => {
          const stats = fs.statSync(path.join(LOCAL_BACKUP_DIR, f));
          return {
            name: f,
            created_at: stats.mtime.toISOString(),
            metadata: { size: stats.size }
          };
        });
      return files;
    }
    return [];
  }

  // Filter and sort backups (both .json.gz and legacy .json)
  const backups = (data || [])
    .filter(item => item.name.startsWith('ladder_backup_') && (item.name.endsWith('.json.gz') || item.name.endsWith('.json')))
    .sort((a, b) => b.name.localeCompare(a.name));

  return backups;
}

// Helper to extract timestamp from filename or created_at
function getBackupTimestamp(backup) {
  if (backup.created_at) {
    const t = new Date(backup.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  // Try matching ladder_backup_YYYY-MM-DDTHH-mm-ss...
  const match = backup.name?.match(/ladder_backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (match) {
    const isoStr = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3Z');
    const t = new Date(isoStr).getTime();
    if (!isNaN(t)) return t;
  }
  return Date.now();
}

// Prune backups older than 10 days (unlimited backups kept within the 10-day window)
export async function pruneOlderBackups() {
  const cutoffTime = Date.now() - TEN_DAYS_MS;
  console.log(`[Backup Manager] Pruning backups older than ${RETENTION_DAYS} days (cutoff: ${new Date(cutoffTime).toISOString()})...`);

  try {
    const backups = await listCloudBackups();
    const toDelete = [];

    for (const b of backups) {
      const bTime = getBackupTimestamp(b);
      if (bTime < cutoffTime) {
        toDelete.push(b.name);
      }
    }

    if (toDelete.length > 0) {
      console.log(`[Backup Manager] Deleting ${toDelete.length} cloud backup(s) older than ${RETENTION_DAYS} days:`, toDelete);
      const { error } = await supabase.storage.from(BUCKET_NAME).remove(toDelete);
      if (error) console.warn('[Backup Manager] Cloud prune warning:', error.message);
      else console.log('[Backup Manager] Pruned older cloud backups successfully.');
    } else {
      console.log(`[Backup Manager] Zero cloud backups exceed the ${RETENTION_DAYS}-day retention window.`);
    }

    // Also prune local backups older than 10 days
    if (fs.existsSync(LOCAL_BACKUP_DIR)) {
      const localFiles = fs.readdirSync(LOCAL_BACKUP_DIR)
        .filter(f => f.startsWith('ladder_backup_') && (f.endsWith('.json.gz') || f.endsWith('.json')));

      localFiles.forEach(f => {
        const filePath = path.join(LOCAL_BACKUP_DIR, f);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoffTime) {
            fs.unlinkSync(filePath);
            console.log(`[Backup Manager] Pruned old local backup: ${f}`);
          }
        } catch (e) {}
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
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Backup Manager] Failed:', err);
      process.exit(1);
    });
}
