/**
 * supabaseAdminClient.js
 * ---------------------------------------------------------------------------
 * Privileged Supabase client using the Service Role key.
 * Bypasses Row-Level Security (RLS) for bulk restore operations,
 * WAL flusher retries, and startup divergence reconciliation.
 *
 * CRITICAL: This client MUST NEVER be used for user-facing CRUD routes.
 * Those must use the anon key with RLS enforced (server/supabaseClient.js).
 * ---------------------------------------------------------------------------
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn(
    '[SupabaseAdmin] WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. ' +
    'Restore, WAL flush, and startup reconciliation will be unavailable.'
  );
}

export const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  : null;

export default supabaseAdmin;
