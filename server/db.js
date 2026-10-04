import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { supabase } from './supabaseClient.js';

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');
const isOfflineMode = process.env.OFFLINE_CACHE_MODE === 'true' || process.env.VITE_OFFLINE_CACHE_MODE === 'true';

function readLocalUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const content = fs.readFileSync(USERS_FILE, 'utf-8');
      return JSON.parse(content || '[]');
    }
  } catch (e) {
    console.warn('[DB Users] Failed to read users.json:', e.message);
  }
  return [];
}

function writeLocalUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[DB Users] Failed to write users.json:', e.message);
  }
}

// Table name mapping helper (e.g. daily_pnl_logs -> pnl_history)
function getSupabaseTableName(tableName) {
  if (tableName === 'daily_pnl_logs') return 'pnl_history';
  return tableName;
}

// ─── In-Memory Cache ─────────────────────────────────────────────────────────
const dbCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Snapshot Paths ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data');
const SNAPSHOT_FILE     = path.join(DATA_DIR, 'db_cache_snapshot.json');
const SNAPSHOT_TMP      = path.join(DATA_DIR, 'db_cache_snapshot.tmp.json');
const SNAPSHOT_BAK      = path.join(DATA_DIR, 'db_cache_snapshot.bak.json');

// ─── WAL (Write-Ahead Log) ────────────────────────────────────────────────────
// appendToWal is imported lazily to avoid circular deps at module load time.
let _appendToWal = null;
function getWalAppender() {
  if (!_appendToWal) {
    try {
      // Dynamic import evaluated once and cached
      import('./services/walFlusherService.js').then(mod => {
        _appendToWal = mod.appendToWal;
      });
    } catch (e) {
      // WAL not available — will be retried next call
    }
  }
  return _appendToWal;
}

function recordToWal(operation, table, id, payload) {
  try {
    const appender = getWalAppender();
    if (appender) {
      appender(operation, table, id, payload);
    } else {
      // Direct file write as emergency fallback if the import hasn't resolved yet
      const WAL_FILE = path.join(DATA_DIR, 'pending_writes.json');
      let entries = [];
      try {
        if (fs.existsSync(WAL_FILE)) entries = JSON.parse(fs.readFileSync(WAL_FILE, 'utf-8') || '[]');
      } catch (_) { /* ignore */ }
      entries.push({
        operation, table, id: String(id), payload,
        failedAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        retryCount: 0
      });
      fs.writeFileSync(WAL_FILE, JSON.stringify(entries, null, 2), 'utf-8');
    }
  } catch (e) {
    console.error('[DB WAL] CRITICAL: Could not record to WAL:', e.message);
  }
}

// ─── Checksum Helpers ─────────────────────────────────────────────────────────
function computeChecksum(tablesObj) {
  try {
    return crypto.createHash('sha256').update(JSON.stringify(tablesObj)).digest('hex');
  } catch (e) {
    return null;
  }
}

function verifyChecksum(snapshot) {
  if (!snapshot.checksum || !snapshot.tables) return false;
  const expected = computeChecksum(snapshot.tables);
  return expected === snapshot.checksum;
}

// ─── Debounced Snapshot Save ──────────────────────────────────────────────────
let saveTimeout = null;
export function debouncedSaveSnapshot() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveCacheSnapshotToDisk();
  }, 2000);
}

/**
 * Atomic two-phase snapshot write with SHA-256 checksum and .bak redundancy.
 * Phase 1: Write to .tmp
 * Phase 2: Atomic rename .tmp -> primary
 * Phase 3: Copy primary -> .bak
 */
export function saveCacheSnapshotToDisk() {
  try {
    const serialized = {};
    for (const [key, entry] of dbCache.entries()) {
      serialized[key] = { data: entry.data, timestamp: entry.timestamp };
    }
    const checksum = computeChecksum(serialized);
    const payload = JSON.stringify({ savedAt: Date.now(), checksum, tables: serialized }, null, 2);

    // Phase 1: Write to temp file
    fs.writeFileSync(SNAPSHOT_TMP, payload, 'utf-8');
    // Phase 2: Atomic rename to primary (safe on Windows NTFS)
    fs.renameSync(SNAPSHOT_TMP, SNAPSHOT_FILE);
    // Phase 3: Copy to backup
    fs.copyFileSync(SNAPSHOT_FILE, SNAPSHOT_BAK);
  } catch (e) {
    console.warn('[DB Cache] Failed to save atomic disk snapshot:', e.message);
  }
}

/**
 * Read and verify a snapshot file. Returns parsed snapshot or null.
 */
function readAndVerifySnapshot(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const snapshot = JSON.parse(raw);
    if (!snapshot || !snapshot.tables) return null;
    if (snapshot.checksum && !verifyChecksum(snapshot)) {
      console.error(`[DB Cache] CHECKSUM MISMATCH on ${path.basename(filePath)}. File may be corrupted.`);
      return null;
    }
    return snapshot;
  } catch (e) {
    console.warn(`[DB Cache] Failed to read/parse ${path.basename(filePath)}:`, e.message);
    return null;
  }
}

export function restoreCacheSnapshotFromDisk() {
  try {
    // Try primary first, then .bak fallback
    let snapshot = readAndVerifySnapshot(SNAPSHOT_FILE);
    if (!snapshot) {
      console.warn('[DB Cache] Primary snapshot failed validation — trying .bak fallback...');
      snapshot = readAndVerifySnapshot(SNAPSHOT_BAK);
    }
    if (!snapshot) {
      console.error('[DB Cache] Both primary and .bak snapshots failed validation. Falling back to Supabase cold-fetch.');
      return false;
    }

    let count = 0;
    let rows = 0;
    for (const [key, entry] of Object.entries(snapshot.tables)) {
      dbCache.set(key, entry);
      count++;
      if (Array.isArray(entry.data)) rows += entry.data.length;
    }
    const ageHours = snapshot.savedAt ? ((Date.now() - snapshot.savedAt) / 3600000).toFixed(1) : '0.0';
    console.log(`[DB Cache] Restored ${count} tables (${rows} rows) from local disk snapshot (0 Supabase egress). Age: ${ageHours}h`);
    return true;
  } catch (e) {
    console.warn('[DB Cache] Failed to restore disk snapshot:', e.message);
  }
  return false;
}

export function initDatabase() {
  if (isOfflineMode) {
    console.log('[Database] Operating in 100% OFFLINE LOCAL CACHE MODE. Zero Supabase egress guaranteed.');
  } else {
    console.log('[Database] Connected to Supabase Cloud PostgreSQL engine with In-Memory Egress Guard.');
  }
}

export function getCacheEntry(tableName) {
  const entry = dbCache.get(tableName);
  if (!entry) return null;
  if (!isOfflineMode && (Date.now() - entry.timestamp > CACHE_TTL_MS)) {
    dbCache.delete(tableName);
    return null;
  }
  return entry.data;
}

export function setCacheEntry(tableName, data) {
  dbCache.set(tableName, { data, timestamp: Date.now() });
  debouncedSaveSnapshot();
}

/**
 * Update a single cached row directly in RAM without invalidating or re-fetching the table.
 */
export function updateCacheRow(tableName, id, updates) {
  const sTable = getSupabaseTableName(tableName);
  const entry = dbCache.get(sTable);
  if (entry && Array.isArray(entry.data)) {
    const idx = entry.data.findIndex(r => String(r.id) === String(id));
    if (idx !== -1) {
      entry.data[idx] = { ...entry.data[idx], ...updates };
      debouncedSaveSnapshot();
      return entry.data[idx];
    }
  }
  return null;
}

export function invalidateCache(tableName) {
  if (!tableName) {
    dbCache.clear();
    console.log('[DB Cache] Invalidated entire in-memory cache.');
    return;
  }
  const sTable = getSupabaseTableName(tableName);

  // STRICT RULE: Write-through tables are kept resident in RAM and updated in-place.
  // Never evict them to prevent cloud egress spikes, dropped data, or race conditions.
  if (['transactions', 'holdings', 'dividends', 'categories', 'liabilities'].includes(sTable)) {
    return;
  }

  dbCache.delete(sTable);

  if (sTable === 'loan_amortization') {
    dbCache.delete('loan_amortization');
  }
  if (sTable === 'pnl_history' || sTable === 'daily_pnl_logs') {
    dbCache.delete('pnl_history');
  }
  if (sTable === 'sips' || sTable === 'recurring_sips' || sTable === 'sip_history') {
    dbCache.delete('sips');
    dbCache.delete('recurring_sips');
    dbCache.delete('sip_history');
  }
}

/**
 * Surgically removes a single row by ID from a write-through cached table.
 */
export function removeFromCache(tableName, id) {
  const sTable = getSupabaseTableName(tableName);
  const entry = dbCache.get(sTable);
  if (entry && Array.isArray(entry.data)) {
    const before = entry.data.length;
    entry.data = entry.data.filter(r => String(r.id) !== String(id));
    if (entry.data.length !== before) {
      debouncedSaveSnapshot();
    }
  }
}

/**
 * Force-evicts a table from the cache, bypassing write-through protection.
 * ONLY for bulk destructive operations (restore backup, import wipe).
 */
export function forceEvict(tableName) {
  const sTable = getSupabaseTableName(tableName);
  dbCache.delete(sTable);
  debouncedSaveSnapshot();
  console.log(`[DB Cache] Force-evicted '${sTable}' (destructive operation path).`);
}

/**
 * Returns the full current dbCache map — used by backup to read canonical data.
 */
export function getFullCacheSnapshot() {
  const result = {};
  for (const [key, entry] of dbCache.entries()) {
    result[key] = Array.isArray(entry.data) ? entry.data : [];
  }
  return result;
}

function ensureTableCached(sTable) {
  if (!dbCache.has(sTable)) {
    restoreCacheSnapshotFromDisk();
  }
}

// Supabase Async Database Interface with WAL, Mandatory Pagination Guard & In-Memory Cache
export const db = {
  select: async (tableName, options = {}) => {
    if (tableName === 'users') {
      return readLocalUsers();
    }

    const { forceRefresh = false } = options;
    const sTable = getSupabaseTableName(tableName);

    // 1. Check in-memory cache first
    let cached = getCacheEntry(sTable);
    if (cached !== null && Array.isArray(cached) && cached.length > 0 && !forceRefresh) {
      return cached;
    }

    // 2. Try restoring from local disk snapshot before any cloud call if cache is missing or empty
    if (cached === null || (Array.isArray(cached) && cached.length === 0)) {
      restoreCacheSnapshotFromDisk();
      cached = getCacheEntry(sTable);
      if (cached !== null && Array.isArray(cached) && cached.length > 0 && !forceRefresh) {
        return cached;
      }
    }

    // 3. If in offline mode, return whatever is in cache or initialize empty array
    if (isOfflineMode) {
      const fallback = cached || [];
      setCacheEntry(sTable, fallback);
      return fallback;
    }

    // 4. Fetch from Supabase with pagination safety and resilient cache fallback
    let allRows = [];
    let from = 0;
    const batchSize = 1000;
    try {
      while (true) {
        const { data, error } = await supabase
          .from(sTable)
          .select('*')
          .range(from, from + batchSize - 1);
        if (error) {
          console.warn(`[DB Select Network/Egress Warning - ${sTable}]:`, error.message);
          if (cached !== null && Array.isArray(cached) && cached.length > 0) return cached;
          break;
        }
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
    } catch (netErr) {
      console.warn(`[DB Select Network Exception - ${sTable}]:`, netErr.message);
      if (cached !== null && Array.isArray(cached) && cached.length > 0) return cached;
    }

    if (allRows.length > 0) {
      setCacheEntry(sTable, allRows);
      return allRows;
    }

    // Never wipe out an existing cached collection if cloud returned empty/error
    if (cached !== null && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    // Final fallback to disk snapshot before giving up
    restoreCacheSnapshotFromDisk();
    const diskCached = getCacheEntry(sTable);
    if (diskCached !== null && Array.isArray(diskCached) && diskCached.length > 0) {
      return diskCached;
    }

    return cached || [];
  },

  selectWhere: async (tableName, matchObj, options = {}) => {
    if (tableName === 'users') {
      const users = readLocalUsers();
      if (!matchObj || Object.keys(matchObj).length === 0) return users;
      return users.filter(row => {
        return Object.entries(matchObj).every(([k, v]) => row[k] === v);
      });
    }

    const { forceRefresh = false } = options;
    const sTable = getSupabaseTableName(tableName);

    // Filter resident in-memory cached rows first (0 Supabase egress)
    const allRows = await db.select(sTable, { forceRefresh });
    if (Array.isArray(allRows)) {
      if (!matchObj || Object.keys(matchObj).length === 0) return allRows;
      return allRows.filter(row => {
        return Object.entries(matchObj).every(([k, v]) => String(row[k]) === String(v));
      });
    }

    return [];
  },

  insert: async (tableName, row) => {
    if (tableName === 'users') {
      const users = readLocalUsers();
      const nextId = users.length ? Math.max(...users.map(u => Number(u.id) || 0)) + 1 : 1;
      const newUser = { id: nextId, ...row };
      users.push(newUser);
      writeLocalUsers(users);
      return newUser;
    }

    const sTable = getSupabaseTableName(tableName);
    ensureTableCached(sTable);

    const newId = row.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const insertedRow = { id: newId, created_at: new Date().toISOString(), ...row };

    // Write-through update: push directly to RAM cache
    const cached = dbCache.get(sTable);
    if (cached && Array.isArray(cached.data)) {
      cached.data.push(insertedRow);
      saveCacheSnapshotToDisk();
    } else {
      setCacheEntry(sTable, [insertedRow]);
      saveCacheSnapshotToDisk();
    }

    // Dual-write to Supabase (Ingress is always attempted) — record to WAL on any failure
    try {
      const { error } = await supabase.from(sTable).insert(insertedRow);
      if (error) {
        console.warn(`[DB Insert Supabase Warning - ${sTable}]:`, error.message);
        recordToWal('insert', sTable, newId, insertedRow);
      }
    } catch (e) {
      console.warn(`[DB Insert Network Exception - ${sTable}]:`, e.message);
      recordToWal('insert', sTable, newId, insertedRow);
    }

    return insertedRow;
  },

  update: async (tableName, id, updates) => {
    if (tableName === 'users') {
      const users = readLocalUsers();
      const idx = users.findIndex(u => String(u.id) === String(id));
      if (idx !== -1) {
        users[idx] = { ...users[idx], ...updates };
        writeLocalUsers(users);
        return users[idx];
      }
      return null;
    }

    const sTable = getSupabaseTableName(tableName);
    ensureTableCached(sTable);

    // Write-through update: mutate in-memory cache directly
    const cached = dbCache.get(sTable);
    let updatedRow = null;
    if (cached && Array.isArray(cached.data)) {
      const idx = cached.data.findIndex(u => String(u.id) === String(id));
      if (idx !== -1) {
        cached.data[idx] = { ...cached.data[idx], ...updates, updated_at: new Date().toISOString() };
        updatedRow = cached.data[idx];
        saveCacheSnapshotToDisk();
      }
    }

    // Dual-write to Supabase (Ingress is always attempted) — record to WAL on any failure
    try {
      let supaUpdates = { ...updates };
      if (sTable === 'holdings') {
        delete supaUpdates.day_change;
        delete supaUpdates.day_change_pct;
        delete supaUpdates.quote_date;
      }
      if (Object.keys(supaUpdates).length > 0) {
        const { error } = await supabase.from(sTable).update(supaUpdates).eq('id', id);
        if (error) {
          console.warn(`[DB Update Supabase Warning - ${sTable}]:`, error.message);
          recordToWal('update', sTable, id, supaUpdates);
        }
      }
    } catch (e) {
      console.warn(`[DB Update Network Exception - ${sTable}]:`, e.message);
      recordToWal('update', sTable, id, updates);
    }

    return updatedRow || { id, ...updates };
  },

  delete: async (tableName, id) => {
    if (tableName === 'users') {
      let users = readLocalUsers();
      users = users.filter(u => String(u.id) !== String(id));
      writeLocalUsers(users);
      return true;
    }

    const sTable = getSupabaseTableName(tableName);
    ensureTableCached(sTable);

    // Write-through update: remove from RAM cache directly
    const cached = dbCache.get(sTable);
    if (cached && Array.isArray(cached.data)) {
      cached.data = cached.data.filter(u => String(u.id) !== String(id));
      saveCacheSnapshotToDisk();
    }

    // Dual-write delete to Supabase (Ingress is always attempted) — record to WAL on any failure
    try {
      const { error } = await supabase.from(sTable).delete().eq('id', id);
      if (error) {
        console.warn(`[DB Delete Supabase Warning - ${sTable}]:`, error.message);
        recordToWal('delete', sTable, id, { id });
      }
    } catch (e) {
      console.warn(`[DB Delete Network Exception - ${sTable}]:`, e.message);
      recordToWal('delete', sTable, id, { id });
    }

    return true;
  },

  invalidateCache: (tableName) => {
    invalidateCache(tableName);
  },

  removeFromCache: (tableName, id) => {
    removeFromCache(tableName, id);
  },

  forceEvict: (tableName) => {
    forceEvict(tableName);
  }
};

// Preload high-frequency tables into the in-memory cache on server startup.
// Restores from disk snapshot first to eliminate cold-start egress completely.
export async function warmCache({ forceRefresh = false } = {}) {
  const tables = [
    'categories',
    'holdings',
    'liabilities',
    'dividends',
    'transactions',
    'sips',
    'sip_history',
    'asset_metadata',
    'mutual_fund_holdings'
  ];

  // 1. Restore from disk snapshot first to avoid cold-start egress (unless forced)
  if (!forceRefresh) {
    const restored = restoreCacheSnapshotFromDisk();
    if (restored || isOfflineMode) {
      console.log('[DB Cache] OFFLINE_CACHE_MODE or snapshot active. 100% of queries served from local memory/disk. Zero Supabase egress.');
      return;
    }
  } else {
    console.log('[DB Cache] Force-refresh requested — skipping disk snapshot, fetching from Supabase...');
    dbCache.clear();
  }

  const start = Date.now();
  let totalRows = 0;

  // Warm standard tables via paginated db.select
  for (const table of tables) {
    if (!forceRefresh && getCacheEntry(table)) continue;
    try {
      const rows = await db.select(table, { forceRefresh });
      totalRows += rows.length;
    } catch (e) {
      console.warn(`[DB Cache] Failed to warm ${table}:`, e.message);
    }
  }

  // Warm pnl_history separately — fetch latest 365 records only (avoids loading 6,900+ rows)
  if (forceRefresh || !getCacheEntry('pnl_history')) {
    try {
      const { data: recentEod } = await supabase
        .from('pnl_history')
        .select('*')
        .order('log_date', { ascending: false })
        .limit(365);
      if (recentEod && recentEod.length > 0) {
        setCacheEntry('pnl_history', recentEod.slice().reverse());
        totalRows += recentEod.length;
      }
    } catch (e) {
      console.warn('[DB Cache] pnl_history warm-up failed:', e.message);
    }
  }

  saveCacheSnapshotToDisk();
  const duration = Date.now() - start;
  console.log(`[DB Cache] Warmed ${tables.length + 1} tables in ${duration}ms with ${totalRows} total rows.`);
}

export default db;
