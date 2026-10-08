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

async function batchClearTable(table) {
  // 1. Fast single-statement clear for independent / non-timeout tables
  if (['pnl_history', 'asset_metadata', 'mutual_fund_holdings', 'nps_daily_navs', 'loan_amortization', 'sips', 'dividends', 'fx_rates', 'liabilities', 'categories'].includes(table)) {
    let q = supabaseAdmin.from(table).delete();
    if (table === 'pnl_history') q = q.gte('log_date', '1900-01-01');
    else if (table === 'asset_metadata') q = q.neq('symbol', '__NONE__');
    else if (table === 'nps_daily_navs') q = q.neq('scheme_code', '__NONE__');
    else q = q.neq('id', '00000000-0000-0000-0000-000000000000');
    
    const { error } = await q;
    if (!error) return;
    console.warn(`  [Restore Manager] Single-statement clear warning for ${table} (${error.message}); falling back to batch clear.`);
  }

  // 2. High-speed 400-key PK batch deletion for large indexed tables (transactions, holdings)
  let pk = 'id';
  if (table === 'pnl_history') pk = 'log_date';
  else if (table === 'asset_metadata') pk = 'symbol';
  else if (table === 'nps_daily_navs') pk = 'scheme_code';

  const batchSize = 400;
  while (true) {
    const { data: rows, error: selErr } = await supabaseAdmin
      .from(table)
      .select(pk)
      .limit(batchSize);

    if (selErr) {
      console.warn(`  [Restore Manager] Select batch warning for ${table}:`, selErr.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    const keys = Array.from(new Set(rows.map(r => r[pk]).filter(Boolean)));
    if (keys.length === 0) break;

    const { error: delErr } = await supabaseAdmin
      .from(table)
      .delete()
      .in(pk, keys);

    if (delErr) {
      throw new Error(`Failed deleting batch from ${table}: ${delErr.message}`);
    }

    if (rows.length < batchSize) break;
  }
}

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

  // ── Step 4: Two-Phase Foreign-Key Safe Table Restoration ─────────────────
  // Phase 4A: Wipe all tables in REVERSE dependency order (Children -> Parents)
  // Prevents foreign key constraint violations (e.g. holdings -> categories, transactions -> holdings)
  const deleteOrder = [
    'pnl_history',
    'asset_metadata',
    'mutual_fund_holdings',
    'nps_daily_navs',
    'loan_amortization',
    'sips',
    'dividends',
    'transactions',
    'holdings',
    'liabilities',
    'fx_rates',
    'categories'
  ];

  console.log('[Restore Manager] Phase 1: Clearing existing cloud tables in reverse dependency order...');
  for (const table of deleteOrder) {
    console.log(`  Clearing table ${table}...`);
    await batchClearTable(table);
  }

  // Phase 4B: Insert all rows in FORWARD dependency order (Parents -> Children)
  const insertOrder = [
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

  console.log('[Restore Manager] Phase 2: Inserting restored rows in dependency order...');
  const restoredCounts = {};
  const totalTables = insertOrder.length;
  let doneCount = 0;

const VALID_COLUMNS_BY_TABLE = {
  categories: new Set(['id', 'name', 'type', 'icon', 'color', 'created_at', 'valuation_model', 'default_currency', 'default_exchange', 'price_fetcher', 'has_dividends']),
  fx_rates: new Set(['id', 'currency_pair', 'rate', 'date', 'source', 'created_at', 'updated_at']),
  liabilities: new Set(['id', 'user_id', 'category_id', 'name', 'lender', 'total_principal', 'outstanding_balance', 'interest_rate', 'monthly_emi', 'due_day', 'created_at', 'updated_at']),
  holdings: new Set([
    'id', 'user_id', 'category_id', 'symbol', 'name', 'exchange', 'quantity', 'avg_buy_price',
    'current_price', 'nse_price', 'bse_price', 'currency', 'sector', 'is_latest_today',
    'created_at', 'updated_at', 'buy_qty', 'sell_qty', 'realized_pnl', 'unrealized_pnl',
    'pnl_pct', 'total_charges', 'status'
  ]),
  transactions: new Set([
    'id', 'holding_id', 'user_id', 'type', 'quantity', 'price', 'total_amount', 'currency',
    'date', 'notes', 'created_at', 'charges', 'net_amount', 'symbol', 'name', 'fx_rate', 'liability_id'
  ]),
  dividends: new Set([
    'id', 'user_id', 'holding_id', 'amount_original', 'currency', 'fx_rate', 'amount_inr',
    'ex_date', 'payment_date', 'created_at', 'symbol', 'name'
  ]),
  sips: new Set([
    'id', 'holding_id', 'symbol', 'name', 'amount', 'frequency', 'day_of_month',
    'next_run_date', 'last_run_date', 'status', 'created_at', 'updated_at', 'start_date', 'end_date'
  ]),
  loan_amortization: new Set([
    'id', 'liability_id', 'period_number', 'payment_date', 'opening_balance', 'monthly_payment',
    'principal_paid', 'interest_paid', 'extra_prepayment', 'charges', 'closing_balance', 'is_settled',
    'payment_type', 'notes', 'created_at', 'updated_at'
  ]),
  nps_daily_navs: new Set(['scheme_code', 'scheme_name', 'nav', 'nav_date', 'created_at']),
  mutual_fund_holdings: new Set(['id', 'scheme_code', 'scheme_name', 'company_name', 'symbol', 'allocation_pct', 'sector', 'mcap_category', 'last_updated']),
  asset_metadata: new Set(['symbol', 'name', 'category_id', 'market_cap', 'mcap_category', 'sector', 'industry', 'last_updated']),
  pnl_history: new Set([
    'log_date', 'total_assets_inr', 'total_liabilities_inr', 'net_worth_inr', 'daily_pnl_inr',
    'pnl_percentage', 'hdfc', 'indusind', 'idfc', 'rbl', 'sbi', 'federal', 'savings',
    'mutual_funds', 'indian_stocks', 'us_stocks', 'nps', 'epf', 'loan', 'credits', 'debt',
    'wealth', 'breakdown'
  ])
};

function sanitizeRowForTable(table, row) {
  const allowed = VALID_COLUMNS_BY_TABLE[table];
  if (!allowed || !row || typeof row !== 'object') return row;
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    if (allowed.has(k)) {
      clean[k] = v;
    }
  }
  return clean;
}

  for (const table of insertOrder) {
    const rows = snapshot.tables[table];

    // Gracefully skip tables not present in backup (e.g. older backup formats)
    if (!Array.isArray(rows) || rows.length === 0) {
      restoredCounts[table] = 0;
      doneCount++;
      if (onProgress) onProgress(table, doneCount, totalTables);
      continue;
    }

    console.log(`  Restoring ${table} (${rows.length} rows)...`);

    // Insert rows in batches using admin client
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize).map(r => sanitizeRowForTable(table, r));
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

    // Immediately synchronize local portfolio_eod_logs.json from restored pnl_history
    const restoredPnl = snapshot.tables?.pnl_history;
    if (Array.isArray(restoredPnl) && restoredPnl.length > 0) {
      const eodLogsPath = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
      const mappedLogs = restoredPnl.map(p => ({
        date: p.log_date,
        total_assets: p.total_assets_inr,
        wealth: p.net_worth_inr,
        total_wealth: p.net_worth_inr,
        daily_pnl: p.daily_pnl_inr,
        pnl_percentage: p.pnl_percentage,
        hdfc: p.hdfc,
        indusind: p.indusind,
        idfc: p.idfc,
        rbl: p.rbl,
        sbi: p.sbi,
        federal: p.federal,
        savings: p.savings,
        mutual_funds: p.mutual_funds,
        indian_stocks: p.indian_stocks,
        us_stocks: p.us_stocks,
        nps: p.nps,
        epf: p.epf,
        loan: p.loan,
        credits: p.credits,
        debt: p.debt,
        breakdown: p.breakdown
      })).sort((a, b) => a.date.localeCompare(b.date));
      fs.writeFileSync(eodLogsPath, JSON.stringify(mappedLogs, null, 2), 'utf-8');
      console.log(`[Restore Manager] Synchronized ${mappedLogs.length} logs to portfolio_eod_logs.json.`);
    }

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
