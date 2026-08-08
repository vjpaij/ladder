import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Warning: SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export default supabase;
