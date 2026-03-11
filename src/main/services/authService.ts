// === FILE PURPOSE ===
// Auth session management for cloud sync.
// Opens a BrowserWindow with a login form, handles Supabase auth,
// stores refresh tokens securely via Electron safeStorage.

// === DEPENDENCIES ===
// electron (BrowserWindow, safeStorage), @supabase/supabase-js

// === LIMITATIONS ===
// - Refresh token stored via safeStorage (OS-level encryption)
// - If safeStorage unavailable, tokens are not persisted across restarts

import { BrowserWindow, app } from 'electron';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
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
      title: 'LifeDash Cloud',
      backgroundColor: '#0d1117',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Use a separate partition so the main window's strict CSP doesn't block
        // inline scripts in our auth HTML.
        partition: 'auth-window',
      },
    });

    // Remove the menu bar from the auth window
    authWindow.setMenuBarVisibility(false);

    const supabaseUrl = DEFAULT_SUPABASE_URL;

    // Write HTML to a temp file and load it (data: URLs block JS in Electron)
    const html = buildAuthHtml(supabaseUrl);
    const tmpPath = join(app.getPath('temp'), 'lifedash-auth.html');
    writeFileSync(tmpPath, html, 'utf-8');
    authWindow.loadFile(tmpPath);

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
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup */ }
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https:; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; font-src https: data:; connect-src https:;" />
  <title>LifeDash Cloud</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Rajdhani', sans-serif;
      background: #0d1117;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 380px;
      border: 1px solid #1a2332;
      background: #0a0e17;
      position: relative;
      padding: 40px 32px 32px;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: #3ee8e4;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 8px;
      text-align: center;
      letter-spacing: 0.08em;
    }
    h1 .accent {
      color: #3ee8e4;
    }
    .subtitle {
      font-family: 'Rajdhani', sans-serif;
      font-size: 0.9rem;
      color: #7a8ba0;
      text-align: center;
      margin-bottom: 28px;
      font-weight: 500;
    }
    .field {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-family: 'Rajdhani', sans-serif;
      font-size: 0.7rem;
      font-weight: 600;
      color: #7a8ba0;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      font-family: 'Rajdhani', sans-serif;
      font-size: 0.95rem;
      background: #0a0e17;
      border: 1px solid #1a2332;
      border-radius: 2px;
      color: #e2e8f0;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus {
      border-color: #3ee8e4;
      box-shadow: 0 0 8px rgba(62, 232, 228, 0.15);
    }
    input::placeholder {
      color: #3d4f63;
    }
    .btn {
      width: 100%;
      padding: 12px;
      font-family: 'Rajdhani', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 8px;
      letter-spacing: 0.04em;
    }
    .btn-primary {
      background: #3ee8e4;
      color: #0d1117;
    }
    .btn-primary:hover {
      background: #1ac5c1;
      box-shadow: 0 0 12px rgba(62, 232, 228, 0.25);
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      color: #ef4444;
      font-size: 0.8125rem;
      margin-top: 12px;
      text-align: center;
    }
    .success {
      margin-top: 16px;
      padding: 14px 16px;
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 2px;
      background: rgba(34, 197, 94, 0.06);
      color: #22c55e;
      font-size: 0.85rem;
      text-align: center;
      line-height: 1.5;
    }
    .success .check {
      font-size: 1.25rem;
      display: block;
      margin-bottom: 6px;
    }
    .toggle {
      text-align: center;
      margin-top: 20px;
    }
    .toggle span {
      color: #3ee8e4;
      font-size: 0.8125rem;
      cursor: pointer;
      text-decoration: none;
      font-weight: 500;
    }
    .toggle span:hover { text-decoration: underline; }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(13, 17, 23, 0.3);
      border-top-color: #3ee8e4;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <h1>LIFEDASH <span class="accent">CLOUD</span></h1>
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
    <div id="success" class="success" style="display:none;">
      <span class="check">\u2713</span>
      Account created! Check your email to confirm, then sign in.
    </div>
    <div class="toggle">
      <span id="toggle-mode">Don&#39;t have an account? Sign Up</span>
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
    const successEl = document.getElementById('success');
    const toggleEl = document.getElementById('toggle-mode');

    function switchToSignIn() {
      isSignUp = false;
      btn.textContent = 'Sign In';
      toggleEl.textContent = "Don\x27t have an account? Sign Up";
      form.style.display = '';
      successEl.style.display = 'none';
      toggleEl.parentElement.style.display = '';
    }

    toggleEl.addEventListener('click', () => {
      isSignUp = !isSignUp;
      btn.textContent = isSignUp ? 'Sign Up' : 'Sign In';
      toggleEl.textContent = isSignUp
        ? 'Already have an account? Sign In'
        : "Don\x27t have an account? Sign Up";
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
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
          form.style.display = 'none';
          toggleEl.parentElement.style.display = 'none';
          successEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Sign Up';
          setTimeout(switchToSignIn, 3000);
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
