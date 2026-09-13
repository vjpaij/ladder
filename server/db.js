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
      invalidateCache('users');
      return newUser;
    }

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
    if (tableName === 'users') {
      const users = readLocalUsers();
      const idx = users.findIndex(u => String(u.id) === String(id));
      if (idx !== -1) {
        users[idx] = { ...users[idx], ...updates };
        writeLocalUsers(users);
        invalidateCache('users');
        return users[idx];
      }
      return null;
    }

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
    if (tableName === 'users') {
      let users = readLocalUsers();
      users = users.filter(u => String(u.id) !== String(id));
      writeLocalUsers(users);
      invalidateCache('users');
      return true;
    }

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

// Preload high-frequency tables into the in-memory cache on server startup.
// pnl_history is included (last 365 days) to protect Dashboard and Calendar from cold-start egress.
export async function warmCache() {
  const tables = ['categories', 'holdings', 'liabilities', 'dividends', 'transactions'];
  const start = Date.now();
  let totalRows = 0;

  // Warm standard tables via paginated db.select
  for (const table of tables) {
    const rows = await db.select(table);
    totalRows += rows.length;
  }

  // Warm pnl_history separately — fetch latest 365 records only (avoids loading 6,900+ rows)
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

  const duration = Date.now() - start;
  console.log(`[DB Cache] Warmed ${tables.length + 1} tables in ${duration}ms with ${totalRows} total rows.`);
}

export default db;
