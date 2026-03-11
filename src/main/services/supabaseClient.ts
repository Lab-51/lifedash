// === FILE PURPOSE ===
// Supabase client singleton for the main process.
// Lazily initializes on first call to getSupabaseClient().
// Supports overridable URL + anon key via settings, with hardcoded defaults.

// === DEPENDENCIES ===
// @supabase/supabase-js

// === LIMITATIONS ===
// - Lazy init — no crash if offline or unconfigured
// - Client is recreated if config changes (resetSupabaseClient)

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from './logger';

const log = createLogger('SupabaseClient');

// Default Supabase credentials for the LifeDash web companion
const DEFAULT_SUPABASE_URL = 'https://vnfsbhsfwgchfbksmdgj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Ozlt-kMuqu4J-PN5jHmwhg_GIEP51Mp';

let client: SupabaseClient | null = null;
let currentUrl: string = DEFAULT_SUPABASE_URL;
let currentAnonKey: string = DEFAULT_SUPABASE_ANON_KEY;

/**
 * Returns the Supabase client singleton, creating it on first call.
 * Safe to call even if offline — the client will queue requests.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    log.info('Initializing Supabase client');
    client = createClient(currentUrl, currentAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // We handle persistence via safeStorage
      },
    });
  }
  return client;
}

/**
 * Configure the Supabase client with custom URL and anon key.
 * Resets the existing client so it will be recreated on next access.
 */
export function configureSupabase(url: string, anonKey: string): void {
  currentUrl = url || DEFAULT_SUPABASE_URL;
  currentAnonKey = anonKey || DEFAULT_SUPABASE_ANON_KEY;
  client = null;
  log.info('Supabase config updated, client will be recreated on next access');
}

/**
 * Set the auth session on the Supabase client after successful login.
 */
export async function setSupabaseSession(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    log.error('Failed to set Supabase session:', error.message);
    throw new Error(`Failed to set session: ${error.message}`);
  }
  log.info('Supabase session set successfully');
}

/**
 * Reset the client (e.g., on sign-out or config change).
 */
export function resetSupabaseClient(): void {
  client = null;
}

export { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY };
