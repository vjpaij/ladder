import { supabase } from './supabaseClient.js';

// Table name mapping helper (e.g. daily_pnl_logs -> pnl_history)
function getSupabaseTableName(tableName) {
  if (tableName === 'daily_pnl_logs') return 'pnl_history';
  return tableName;
}

export function initDatabase() {
  console.log('[Database] Connected to Supabase Cloud PostgreSQL engine.');
}

// Supabase Async Database Interface
export const db = {
  select: async (tableName) => {
    const sTable = getSupabaseTableName(tableName);
    const { data, error } = await supabase.from(sTable).select('*');
    if (error) {
      console.error(`[DB Select Error - ${sTable}]:`, error.message);
      return [];
    }
    return data || [];
  },

  selectWhere: async (tableName, matchObj) => {
    const sTable = getSupabaseTableName(tableName);
    let query = supabase.from(sTable).select('*');
    if (matchObj && typeof matchObj === 'object') {
      query = query.match(matchObj);
    }
    const { data, error } = await query;
    if (error) {
      console.error(`[DB SelectWhere Error - ${sTable}]:`, error.message);
      return [];
    }
    return data || [];
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
    const { data, error } = await supabase.from(sTable).update(updates).eq('id', id).select().single();
    if (error) {
      console.error(`[DB Update Error - ${sTable}]:`, error.message);
      throw new Error(error.message);
    }
    return data;
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
