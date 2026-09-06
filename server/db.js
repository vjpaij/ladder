import { supabase } from './supabaseClient.js';

// Table name mapping helper (e.g. daily_pnl_logs -> pnl_history)
function getSupabaseTableName(tableName) {
  if (tableName === 'daily_pnl_logs') return 'pnl_history';
  return tableName;
}

export function initDatabase() {
  console.log('[Database] Connected to Supabase Cloud PostgreSQL engine.');
}

// Supabase Async Database Interface with Mandatory Pagination Guard
export const db = {
  select: async (tableName) => {
    const sTable = getSupabaseTableName(tableName);
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
    return allRows;
  },

  selectWhere: async (tableName, matchObj) => {
    const sTable = getSupabaseTableName(tableName);
    let allRows = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let query = supabase.from(sTable).select('*').range(from, from + batchSize - 1);
      if (matchObj && typeof matchObj === 'object') {
        query = query.match(matchObj);
      }
      const { data, error } = await query;
      if (error) {
        console.error(`[DB SelectWhere Error - ${sTable}]:`, error.message);
        return allRows.length > 0 ? allRows : [];
      }
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return allRows;
  },

  insert: async (tableName, row) => {
    const sTable = getSupabaseTableName(tableName);
    const { data, error } = await supabase.from(sTable).insert(row).select().single();
    if (error) {
      console.error(`[DB Insert Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }
    return data;
  },

  update: async (tableName, id, updates) => {
    const sTable = getSupabaseTableName(tableName);
    const { data, error } = await supabase.from(sTable).update(updates).eq('id', id).select();
    if (error) {
      console.error(`[DB Update Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }
    return data?.[0] || null;
  },

  delete: async (tableName, id) => {
    const sTable = getSupabaseTableName(tableName);
    const { error } = await supabase.from(sTable).delete().eq('id', id);
    if (error) {
      console.error(`[DB Delete Error - ${sTable}]:`, error.message);
      return false;
    }
    return true;
  }
};

export default db;
