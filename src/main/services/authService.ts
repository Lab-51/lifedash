// === FILE PURPOSE ===
// Auth session management for cloud sync.
// Opens a BrowserWindow with a login form, handles Supabase auth,
// stores refresh tokens securely via Electron safeStorage.

// === DEPENDENCIES ===
// electron (BrowserWindow, safeStorage), @supabase/supabase-js

// === LIMITATIONS ===
// - Refresh token stored via safeStorage (OS-level encryption)
// - If safeStorage unavailable, tokens are not persisted across restarts

import { BrowserWindow } from 'electron';
import { getSupabaseClient, setSupabaseSession, resetSupabaseClient, DEFAULT_SUPABASE_URL } from './supabaseClient';
import { isEncryptionAvailable, encryptString, decryptString } from './secure-storage';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLogger } from './logger';
import type { AuthState } from '../../shared/types/sync';

const log = createLogger('AuthService');

const SETTINGS_KEY_REFRESH_TOKEN = 'sync.refreshToken';
const SETTINGS_KEY_USER_EMAIL = 'sync.userEmail';
const SETTINGS_KEY_USER_ID = 'sync.userId';
const SETTINGS_KEY_LAST_SYNCED = 'sync.lastSyncedAt';

/**
 * Open a BrowserWindow with a simple login form that authenticates via Supabase.
 * Returns the AuthState after successful authentication.
 */
export async function openAuthWindow(): Promise<AuthState> {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 480,
      height: 600,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Sign In to LifeDash Cloud',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Remove the menu bar from the auth window
    authWindow.setMenuBarVisibility(false);

    const supabaseUrl = DEFAULT_SUPABASE_URL;

    // Build a simple HTML login form that calls Supabase auth REST API
    const html = buildAuthHtml(supabaseUrl);
    authWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Listen for the custom auth-success event from the page
    authWindow.webContents.on('console-message', async (_event, _level, message) => {
      if (message.startsWith('AUTH_SUCCESS:')) {
        try {
          const payload = JSON.parse(message.replace('AUTH_SUCCESS:', ''));
          const { access_token, refresh_token, user } = payload;

          // Set session on the Supabase client
          await setSupabaseSession(access_token, refresh_token);

          // Store refresh token and user info
          await storeAuthData(refresh_token, user.id, user.email);

          const authState: AuthState = {
            isAuthenticated: true,
            user: { id: user.id, email: user.email },
            lastSyncedAt: null,
          };

          authWindow.close();
          resolve(authState);
        } catch (err) {
          log.error('Failed to process auth success:', err);
          authWindow.close();
          reject(new Error('Authentication failed. Please try again.'));
        }
      } else if (message.startsWith('AUTH_ERROR:')) {
        log.error('Auth window error:', message);
      }
    });

    // Handle window close without auth
    authWindow.on('closed', () => {
      // If the promise hasn't been resolved yet, resolve with disconnected state
      resolve({
        isAuthenticated: false,
        user: null,
        lastSyncedAt: null,
      });
    });
  });
}

/**
 * Sign out — clear Supabase session and stored tokens.
 */
export async function signOut(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  } catch (err) {
    log.warn('Supabase signOut call failed (may already be signed out):', err);
  }

  resetSupabaseClient();

  // Clear stored auth data
  try {
    const db = getDb();
    await db.delete(settings).where(eq(settings.key, SETTINGS_KEY_REFRESH_TOKEN));
    await db.delete(settings).where(eq(settings.key, SETTINGS_KEY_USER_EMAIL));
    await db.delete(settings).where(eq(settings.key, SETTINGS_KEY_USER_ID));
  } catch (err) {
    log.warn('Failed to clear stored auth data:', err);
  }

  log.info('Signed out and cleared auth data');
}

/**
 * Get the current auth state (from Supabase session or stored data).
 */
export async function getAuthState(): Promise<AuthState> {
  try {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      return {
        isAuthenticated: true,
        user: {
          id: session.user.id,
          email: session.user.email || '',
        },
        lastSyncedAt: await getLastSyncedAt(),
      };
    }
  } catch (err) {
    log.debug('No active Supabase session:', err);
  }

  // Check stored user data (may have been authenticated before)
  try {
    const db = getDb();
    const userIdRow = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY_USER_ID));
    const emailRow = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY_USER_EMAIL));

    if (userIdRow.length > 0 && emailRow.length > 0) {
      // Try to restore session from stored refresh token
      const restored = await tryRestoreSession();
      if (restored) {
        return {
          isAuthenticated: true,
          user: {
            id: userIdRow[0].value,
            email: emailRow[0].value,
          },
          lastSyncedAt: await getLastSyncedAt(),
        };
      }
    }
  } catch (err) {
    log.debug('Failed to check stored auth data:', err);
  }

  return {
    isAuthenticated: false,
    user: null,
    lastSyncedAt: null,
  };
}

/**
 * Attempt to restore session from stored refresh token.
 * Called on app startup.
 */
export async function tryRestoreSession(): Promise<boolean> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY_REFRESH_TOKEN));

    if (rows.length === 0) return false;

    const storedValue = rows[0].value;
    let refreshToken: string;

    // Decrypt if encryption is available
    if (isEncryptionAvailable()) {
      try {
        refreshToken = decryptString(storedValue);
      } catch {
        log.warn('Failed to decrypt refresh token, clearing stored data');
        await db.delete(settings).where(eq(settings.key, SETTINGS_KEY_REFRESH_TOKEN));
        return false;
      }
    } else {
      refreshToken = storedValue;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      log.info('Failed to restore session from refresh token:', error?.message);
      return false;
    }

    // Update stored refresh token (it may have rotated)
    await storeRefreshToken(data.session.refresh_token);

    log.info('Session restored from stored refresh token');
    return true;
  } catch (err) {
    log.debug('Session restore failed:', err);
    return false;
  }
}

// --- Internal helpers ---

async function storeAuthData(refreshToken: string, userId: string, email: string): Promise<void> {
  const db = getDb();

  // Store refresh token (encrypted if possible)
  await storeRefreshToken(refreshToken);

  // Store user info (not sensitive, plain text)
  await db.insert(settings)
    .values({ key: SETTINGS_KEY_USER_ID, value: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: userId, updatedAt: new Date() } });

  await db.insert(settings)
    .values({ key: SETTINGS_KEY_USER_EMAIL, value: email })
    .onConflictDoUpdate({ target: settings.key, set: { value: email, updatedAt: new Date() } });
}

async function storeRefreshToken(refreshToken: string): Promise<void> {
  const db = getDb();
  const value = isEncryptionAvailable() ? encryptString(refreshToken) : refreshToken;

  await db.insert(settings)
    .values({ key: SETTINGS_KEY_REFRESH_TOKEN, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function getLastSyncedAt(): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY_LAST_SYNCED));
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

/**
 * Build the HTML for the auth window login form.
 * Uses Supabase auth REST API directly.
 */
function buildAuthHtml(supabaseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign In</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .container {
      width: 100%;
      max-width: 360px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      font-size: 0.875rem;
      color: #94a3b8;
      text-align: center;
      margin-bottom: 32px;
    }
    .field {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 0.75rem;
      font-weight: 500;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      font-size: 0.9375rem;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #e2e8f0;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: #6366f1;
    }
    .btn {
      width: 100%;
      padding: 12px;
      font-size: 0.9375rem;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 8px;
    }
    .btn-primary {
      background: #6366f1;
      color: white;
    }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .error {
      color: #f87171;
      font-size: 0.8125rem;
      margin-top: 12px;
      text-align: center;
    }
    .toggle {
      text-align: center;
      margin-top: 20px;
    }
    .toggle a {
      color: #6366f1;
      font-size: 0.8125rem;
      cursor: pointer;
      text-decoration: none;
    }
    .toggle a:hover { text-decoration: underline; }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>LifeDash Cloud</h1>
    <p class="subtitle">Sign in to enable cloud sync</p>

    <form id="auth-form">
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" required autocomplete="email" placeholder="you@example.com" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" required autocomplete="current-password" placeholder="Your password" />
      </div>
      <button type="submit" class="btn btn-primary" id="submit-btn">Sign In</button>
    </form>
    <div id="error" class="error" style="display:none;"></div>
    <div class="toggle">
      <a id="toggle-mode" href="#">Don't have an account? Sign Up</a>
    </div>
  </div>

  <script>
    const SUPABASE_URL = '${supabaseUrl}';
    const AUTH_URL = SUPABASE_URL + '/auth/v1';
    const API_KEY = '${getApiKeyForHtml()}';

    let isSignUp = false;
    const form = document.getElementById('auth-form');
    const btn = document.getElementById('submit-btn');
    const errorEl = document.getElementById('error');
    const toggleEl = document.getElementById('toggle-mode');

    toggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      isSignUp = !isSignUp;
      btn.textContent = isSignUp ? 'Sign Up' : 'Sign In';
      toggleEl.textContent = isSignUp
        ? 'Already have an account? Sign In'
        : "Don't have an account? Sign Up";
      errorEl.style.display = 'none';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + (isSignUp ? 'Signing up...' : 'Signing in...');

      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        const endpoint = isSignUp ? '/signup' : '/token?grant_type=password';
        const res = await fetch(AUTH_URL + endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
          },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error_description || data.msg || data.error || 'Authentication failed');
        }

        if (isSignUp && !data.access_token) {
          errorEl.textContent = 'Check your email to confirm your account, then sign in.';
          errorEl.style.display = 'block';
          errorEl.style.color = '#4ade80';
          btn.disabled = false;
          btn.textContent = 'Sign Up';
          return;
        }

        // Send success to main process via console.log (intercepted by console-message event)
        console.log('AUTH_SUCCESS:' + JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          user: { id: data.user.id, email: data.user.email },
        }));
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        errorEl.style.color = '#f87171';
        btn.disabled = false;
        btn.textContent = isSignUp ? 'Sign Up' : 'Sign In';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Helper to get the anon key for embedding in the auth HTML.
 * This is a publishable key — safe to embed in client-side code.
 */
function getApiKeyForHtml(): string {
  // Uses the module-level import from supabaseClient
  return 'sb_publishable_Ozlt-kMuqu4J-PN5jHmwhg_GIEP51Mp';
}
