import fs from 'fs';
import path from 'path';
import { supabase } from './supabaseClient.js';

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

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

// In-memory reactive cache with 24-hour TTL & write-through mutation
const dbCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours TTL (persists in Node RAM, updated write-through)
const SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'db_cache_snapshot.json');

let saveTimeout = null;
export function debouncedSaveSnapshot() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveCacheSnapshotToDisk();
  }, 2000);
}

export function saveCacheSnapshotToDisk() {
  try {
    const serialized = {};
    for (const [key, entry] of dbCache.entries()) {
      serialized[key] = {
        data: entry.data,
        timestamp: entry.timestamp
      };
    }
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({
      savedAt: Date.now(),
      tables: serialized
    }), 'utf-8');
  } catch (e) {
    console.warn('[DB Cache] Failed to save disk snapshot:', e.message);
  }
}

export function restoreCacheSnapshotFromDisk() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
      const snapshot = JSON.parse(raw);
      if (snapshot && snapshot.tables && (Date.now() - (snapshot.savedAt || 0) < CACHE_TTL_MS)) {
        let count = 0;
        let rows = 0;
        for (const [key, entry] of Object.entries(snapshot.tables)) {
          dbCache.set(key, entry);
          count++;
          if (Array.isArray(entry.data)) rows += entry.data.length;
        }
        console.log(`[DB Cache] Restored ${count} tables (${rows} rows) from local disk snapshot (0 Supabase egress consumed). Snapshot age: ${((Date.now() - snapshot.savedAt) / 3600000).toFixed(1)}h`);
        return true;
      }
    }
  } catch (e) {
    console.warn('[DB Cache] Failed to restore disk snapshot:', e.message);
  }
  return false;
}

export function initDatabase() {
  console.log('[Database] Connected to Supabase Cloud PostgreSQL engine with In-Memory Egress Guard.');
}

export function getCacheEntry(tableName) {
  const entry = dbCache.get(tableName);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
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
  dbCache.delete(sTable);

  // STRICT EGRESS RULE: Holding price changes must NEVER invalidate transactions!
  // Only invalidate tightly coupled sub-tables where rows are split or amortized:
  if (sTable === 'liabilities' || sTable === 'loan_amortization') {
    dbCache.delete('liabilities');
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

// Supabase Async Database Interface with Mandatory Pagination Guard & In-Memory Cache
export const db = {
  select: async (tableName, options = {}) => {
    if (tableName === 'users') {
      return readLocalUsers();
    }

    const { forceRefresh = false } = options;
    const sTable = getSupabaseTableName(tableName);

    // Check in-memory cache first
    const cached = getCacheEntry(sTable);
    if (cached !== null && !forceRefresh) {
      return cached;
    }

    // Fetch from Supabase with pagination safety
    let allRows = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from(sTable)
        .select('*')
        .range(from, from + batchSize - 1);
      if (error) {
        console.error(`[DB Select Error - ${sTable}]:`, error.message);
        throw new Error(`Failed to read ${sTable}: ${error.message}`);
      }
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    setCacheEntry(sTable, allRows);
    return allRows;
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

    // If table is cached, filter in-memory with 0 network egress
    const cached = getCacheEntry(sTable);
    if (cached !== null && !forceRefresh) {
      if (!matchObj || Object.keys(matchObj).length === 0) return cached;
      return cached.filter(row => {
        return Object.entries(matchObj).every(([k, v]) => row[k] === v);
      });
    }

    // Otherwise fetch table into cache and filter
    const allRows = await db.select(sTable, { forceRefresh });
    if (!matchObj || Object.keys(matchObj).length === 0) return allRows;
    return allRows.filter(row => {
      return Object.entries(matchObj).every(([k, v]) => row[k] === v);
    });
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
    const { data, error } = await supabase.from(sTable).insert(row).select().single();
    if (error) {
      console.error(`[DB Insert Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }
    
    // Write-through update: push directly to RAM cache so subsequent reads do not re-query cloud DB
    const cached = dbCache.get(sTable);
    if (cached && Array.isArray(cached.data)) {
      cached.data.push(data);
      debouncedSaveSnapshot();
    }
    return data;
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
    // Omit .select() to return 204 No Content headers with 0 response bytes, protecting egress
    const { error } = await supabase.from(sTable).update(updates).eq('id', id);
    if (error) {
      console.error(`[DB Update Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }

    // Write-through update: mutate in-memory cache directly
    const cached = dbCache.get(sTable);
    let updatedRow = null;
    if (cached && Array.isArray(cached.data)) {
      const idx = cached.data.findIndex(u => String(u.id) === String(id));
      if (idx !== -1) {
        cached.data[idx] = { ...cached.data[idx], ...updates };
        updatedRow = cached.data[idx];
        debouncedSaveSnapshot();
      }
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
    const { error } = await supabase.from(sTable).delete().eq('id', id);
    if (error) {
      console.error(`[DB Delete Error - ${sTable}]:`, error.message);
      return false;
    }

    // Write-through update: remove from RAM cache directly
    const cached = dbCache.get(sTable);
    if (cached && Array.isArray(cached.data)) {
      cached.data = cached.data.filter(u => String(u.id) !== String(id));
      debouncedSaveSnapshot();
    }
    return true;
  },

  invalidateCache: (tableName) => {
    invalidateCache(tableName);
  }
};

// Preload high-frequency tables into the in-memory cache on server startup.
// Restores from disk snapshot first to eliminate cold-start egress completely.
export async function warmCache() {
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

  // 1. Restore from disk snapshot if fresh (<24h) to avoid cold-start egress
  const restored = restoreCacheSnapshotFromDisk();
  if (restored) {
    const missingTables = tables.filter(t => !getCacheEntry(t));
    if (missingTables.length === 0 && getCacheEntry('pnl_history')) {
      console.log('[DB Cache] All critical tables verified in cache from disk snapshot. Zero Supabase egress consumed.');
      return;
    }
  }

  const start = Date.now();
  let totalRows = 0;

  // Warm standard tables via paginated db.select
  for (const table of tables) {
    if (getCacheEntry(table)) continue;
    try {
      const rows = await db.select(table);
      totalRows += rows.length;
    } catch (e) {
      console.warn(`[DB Cache] Failed to warm ${table}:`, e.message);
    }
  }

  // Warm pnl_history separately — fetch latest 365 records only (avoids loading 6,900+ rows)
  if (!getCacheEntry('pnl_history')) {
    try {
      const { data: recentEod } = await supabase
        .from('pnl_history')
        .select('*')
        .order('log_date', { ascending: false })
        .limit(365);
      if (recentEod && recentEod.length > 0) {
        // Store in cache sorted ascending for consumer consistency
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
