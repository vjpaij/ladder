import { supabase } from './supabaseClient.js';

// Table name mapping helper (e.g. daily_pnl_logs -> pnl_history)
function getSupabaseTableName(tableName) {
  if (tableName === 'daily_pnl_logs') return 'pnl_history';
  return tableName;
}

// In-memory reactive cache with TTL & instant invalidation
const dbCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export function initDatabase() {
  console.log('[Database] Connected to Supabase Cloud PostgreSQL engine with In-Memory Egress Guard.');
}

function getCacheEntry(tableName) {
  const entry = dbCache.get(tableName);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    dbCache.delete(tableName);
    return null;
  }
  return entry.data;
}

function setCacheEntry(tableName, data) {
  dbCache.set(tableName, { data, timestamp: Date.now() });
}

export function invalidateCache(tableName) {
  if (!tableName) {
    dbCache.clear();
    console.log('[DB Cache] Invalidated entire in-memory cache.');
    return;
  }
  const sTable = getSupabaseTableName(tableName);
  dbCache.delete(sTable);
  // Cross-invalidation for related tables
  if (sTable === 'transactions' || sTable === 'dividends') {
    dbCache.delete('holdings');
  }
  if (sTable === 'holdings') {
    dbCache.delete('transactions');
  }
}

// Supabase Async Database Interface with Mandatory Pagination Guard & In-Memory Cache
export const db = {
  select: async (tableName, options = {}) => {
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
        return allRows.length > 0 ? allRows : [];
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
    const sTable = getSupabaseTableName(tableName);
    const { data, error } = await supabase.from(sTable).insert(row).select().single();
    if (error) {
      console.error(`[DB Insert Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }
    invalidateCache(sTable);
    return data;
  },

  update: async (tableName, id, updates) => {
    const sTable = getSupabaseTableName(tableName);
    const { data, error } = await supabase.from(sTable).update(updates).eq('id', id).select();
    if (error) {
      console.error(`[DB Update Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }
    invalidateCache(sTable);
    return data?.[0] || null;
  },

  delete: async (tableName, id) => {
    const sTable = getSupabaseTableName(tableName);
    const { error } = await supabase.from(sTable).delete().eq('id', id);
    if (error) {
      console.error(`[DB Delete Error - ${sTable}]:`, error.message);
      return false;
    }
    invalidateCache(sTable);
    return true;
  },

  invalidateCache: (tableName) => {
    invalidateCache(tableName);
  }
};

// Preload high-frequency tables into the in-memory cache on server startup
export async function warmCache() {
  const tables = ['categories', 'holdings', 'liabilities', 'dividends', 'transactions'];
  const start = Date.now();
  let totalRows = 0;
  for (const table of tables) {
    const rows = await db.select(table);
    totalRows += rows.length;
  }
  const duration = Date.now() - start;
  console.log(`[DB Cache] Warmed ${tables.length} tables in ${duration}ms with ${totalRows} total rows.`);
}

export default db;
