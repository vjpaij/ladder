import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { supabase } from '../server/supabaseClient.js';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const TABLES = [
  'users',
  'categories',
  'holdings',
  'transactions',
  'liabilities',
  'dividends',
  'pnl_history',
  'fx_rates'
];

async function fetchAllRows(tableName) {
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.warn(`[Snapshot] Warning on ${tableName}:`, error.message);
      break;
    }

    if (data && data.length > 0) {
      allRows.push(...data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

export async function createSnapshot() {
  console.log('[Snapshot] Initiating full database and files backup...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotData = {
    metadata: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      tables: {}
    },
    tables: {},
    files: {}
  };

  for (const table of TABLES) {
    process.stdout.write(`[Snapshot] Fetching table: ${table}... `);
    const rows = await fetchAllRows(table);
    snapshotData.tables[table] = rows;
    snapshotData.metadata.tables[table] = rows.length;
    console.log(`${rows.length} rows.`);
  }

  // Backup portfolio_eod_logs.json if present
  const eodPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
  if (fs.existsSync(eodPath)) {
    const eodContent = fs.readFileSync(eodPath, 'utf-8');
    const eodJson = JSON.parse(eodContent);
    snapshotData.files['portfolio_eod_logs.json'] = eodJson;
    console.log(`[Snapshot] Backed up portfolio_eod_logs.json: ${eodJson.length} entries.`);
  }

  const jsonString = JSON.stringify(snapshotData, null, 2);
  const checksum = crypto.createHash('sha256').update(jsonString).digest('hex');
  snapshotData.metadata.sha256 = checksum;

  const targetFile = path.join(BACKUP_DIR, `snapshot_${timestamp}.json`);
  fs.writeFileSync(targetFile, JSON.stringify(snapshotData, null, 2), 'utf-8');

  // Also save a latest pointer
  const latestFile = path.join(BACKUP_DIR, 'snapshot_latest.json');
  fs.copyFileSync(targetFile, latestFile);

  console.log(`[Snapshot] Backup successfully created at: ${targetFile}`);
  console.log(`[Snapshot] SHA256 Checksum: ${checksum}`);
  console.log('[Snapshot] Table Summary:', JSON.stringify(snapshotData.metadata.tables, null, 2));

  return targetFile;
}

createSnapshot().catch(err => {
  console.error('[Snapshot Error]:', err);
  process.exit(1);
});
