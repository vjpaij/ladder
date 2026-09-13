import { supabase } from '../supabaseClient.js';

const secretCache = new Map();

/**
 * Enterprise Supabase Vault & Configuration Service
 * 
 * Securely retrieves credentials and configuration:
 * 1. Checks in-memory cache
 * 2. Checks Supabase Vault (pgsodium/vault schema) if configured
 * 3. Falls back securely to process.env
 */
export async function getSecret(secretName) {
  if (!secretName) return null;

  if (secretCache.has(secretName)) {
    return secretCache.get(secretName);
  }

  // Attempt to query Supabase Vault if available
  try {
    const { data, error } = await supabase
      .rpc('get_vault_secret', { secret_name: secretName });

    if (!error && data) {
      secretCache.set(secretName, data);
      return data;
    }
  } catch (err) {
    // Stored procedure or vault view not exposed; fallback gracefully
  }

  // Check process.env
  const envVal = process.env[secretName];
  if (envVal) {
    secretCache.set(secretName, envVal);
    return envVal;
  }

  return null;
}

/**
 * Synchronous secret resolver for startup validations
 */
export function getSyncSecret(secretName) {
  if (secretCache.has(secretName)) {
    return secretCache.get(secretName);
  }
  return process.env[secretName] || null;
}

export default {
  getSecret,
  getSyncSecret
};
