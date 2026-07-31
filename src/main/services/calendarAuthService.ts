// === FILE PURPOSE ===
// Provider-agnostic OAuth plumbing for Phase G (Calendar Integration). Hand-rolled
// Authorization-Code + PKCE (S256) via the SYSTEM BROWSER and a 127.0.0.1 loopback
// listener — no MSAL/googleapis deps (Google hard-blocks OAuth in embedded windows).
//
// The Google (Task 2) and Microsoft (Task 3) adapters supply provider-specific
// endpoints/scopes and drive this engine: they call runAuthorizationCodeFlow /
// refreshAccessToken with their OAuthProviderEndpoints, then persist via the token
// helpers here. Asymmetric exchange: Google sends client_secret, Microsoft sends none.
//
// === DEPENDENCIES ===
// node:crypto, node:http, global fetch, electron (shell), secure-storage, drizzle.
//
// === SECURITY ===
// - `state` is generated and validated on the callback (mismatch is rejected).
// - The authorize URL is validated (https + same host as the configured endpoint)
//   before shell.openExternal, mirroring the app:open-external allowlist.
// - Tokens + client configs are encrypted at rest via safeStorage; plaintext tokens
//   never cross IPC.

import { shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings, calendarEvents } from '../db/schema';
import { isEncryptionAvailable, encryptString, decryptString } from './secure-storage';
import { createLogger } from './logger';
import type {
  CalendarProvider,
  CalendarClientConfig,
  CalendarTokens,
  CalendarAccountStatus,
  CalendarProviderAdapter,
} from '../../shared/types/calendar';

const log = createLogger('CalendarAuth');

/** Default authorization timeout — the user has 5 minutes to complete consent. */
export const CALENDAR_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

// Encrypted KV keys in the `settings` table (one auth + one client blob per provider).
const AUTH_KEY: Record<CalendarProvider, string> = {
  google: 'calendar:google:auth',
  microsoft: 'calendar:microsoft:auth',
};
const CLIENT_KEY: Record<CalendarProvider, string> = {
  google: 'calendar:google:client',
  microsoft: 'calendar:microsoft:client',
};

const PROVIDERS: CalendarProvider[] = ['google', 'microsoft'];

/** Thrown when a refresh fails with invalid_grant — the user must re-consent. */
export class CalendarReauthRequiredError extends Error {
  constructor(message = 'Calendar authorization expired — reconnect required') {
    super(message);
    this.name = 'CalendarReauthRequiredError';
  }
}

/**
 * Provider endpoint descriptor supplied by the Google/Microsoft adapters. This is
 * the seam that keeps this service provider-agnostic: the adapter passes URLs +
 * scope + whether to send the client secret.
 */
export interface OAuthProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  /** Space-delimited scopes. */
  scope: string;
  /** Google Desktop clients: true. Microsoft public clients: false (PKCE only). */
  sendClientSecret: boolean;
  /** Extra static authorize params (e.g. Google access_type=offline&prompt=consent). */
  extraAuthParams?: Record<string, string>;
}

/** A single provider's OAuth request context (endpoints + this user's client id/secret). */
export interface AuthorizationRequest {
  provider: CalendarProvider;
  endpoints: OAuthProviderEndpoints;
  clientId: string;
  /** Present only for Google; never sent for Microsoft. */
  clientSecret?: string;
}

interface PkcePair {
  verifier: string;
  challenge: string;
}

/** What we persist per provider under AUTH_KEY (encrypted). */
interface StoredCalendarAuth {
  tokens: CalendarTokens;
  accountEmail?: string;
  needsReauth: boolean;
  lastSyncAt?: string;
  lastError?: string;
}

// === PKCE ==========================================================================

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a PKCE pair (S256). The verifier is base64url(64 random bytes) → 86 chars
 * from `[A-Za-z0-9\-_]` (a subset of the RFC-7636 unreserved set, length 43–128).
 * The challenge is base64url(SHA256(verifier)).
 */
export function generatePkcePair(): PkcePair {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function randomState(): string {
  return base64url(randomBytes(16));
}

// === Loopback listener =============================================================

const SUCCESS_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LifeDash</title></head>' +
  '<body style="font-family:sans-serif;background:#0d1117;color:#e2e8f0;display:flex;' +
  'align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>Connected ✓</h2>' +
  '<p>You can close this tab and return to LifeDash.</p></div></body></html>';

export interface LoopbackListener {
  /** The exact redirect_uri to send on BOTH the authorize and token legs. */
  redirectUri: string;
  port: number;
  /** Resolves with the authorization code; rejects on state mismatch, error, or timeout. */
  waitForCode: Promise<string>;
  /** Close the listener immediately (idempotent). */
  close: () => void;
}

/**
 * Start a one-shot loopback listener on an ephemeral 127.0.0.1 port. For Microsoft
 * we ALSO best-effort bind '::1' on the SAME port (some stacks resolve loopback to
 * IPv6) — a bind failure is ignored. The listener validates `state`, captures the
 * code once, then closes.
 */
export async function startLoopbackListener(opts: {
  provider: CalendarProvider;
  state: string;
  timeoutMs?: number;
}): Promise<LoopbackListener> {
  const { provider, state } = opts;
  const timeoutMs = opts.timeoutMs ?? CALENDAR_OAUTH_TIMEOUT_MS;

  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const waitForCode = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  let server6: Server | undefined;
  let timer: NodeJS.Timeout | undefined;

  const closeAll = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    try {
      server.close();
    } catch {
      /* already closed */
    }
    if (server6) {
      try {
        server6.close();
      } catch {
        /* already closed */
      }
    }
  };

  const finish = (err: Error | null, code?: string): void => {
    if (settled) return;
    settled = true;
    closeAll();
    if (err) rejectCode(err);
    else resolveCode(code as string);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    // Always render the same friendly page — never echo query params back.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(SUCCESS_HTML);

    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');

    if (error) {
      finish(new Error(`Authorization denied: ${error}`));
      return;
    }
    // SECURITY: reject any callback whose state does not match the one we generated.
    if (!returnedState || returnedState !== state) {
      finish(new Error('OAuth state mismatch — possible CSRF; aborting'));
      return;
    }
    if (!code) {
      finish(new Error('No authorization code in callback'));
      return;
    }
    finish(null, code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;

  if (provider === 'microsoft') {
    // Best-effort IPv6 loopback bind on the SAME port (localhost↔IPv6 trap mitigation).
    try {
      const s6 = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://[::1]');
        if (url.pathname === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);
        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (returnedState === state && code) finish(null, code);
      });
      await new Promise<void>((resolve, reject) => {
        s6.once('error', reject);
        s6.listen(port, '::1', () => resolve());
      });
      server6 = s6;
    } catch {
      // IPv6 unavailable — the IPv4 listener above is sufficient.
      server6 = undefined;
    }
  }

  timer = setTimeout(() => finish(new Error('Authorization timed out')), timeoutMs);
  // Never keep the event loop alive on this timer.
  if (typeof timer.unref === 'function') timer.unref();

  // Microsoft's registered redirect is `http://localhost` (the Azure portal rejects a
  // literal 127.0.0.1), so we must send `http://localhost:{port}` for the host to match —
  // then rely on the IPv4 listener + the best-effort ::1 dual-bind above to catch
  // whichever address localhost resolves to. Google Desktop clients accept any ephemeral
  // 127.0.0.1 loopback port with no pre-registration, so they use the literal IPv4 host.
  const redirectUri = provider === 'microsoft' ? `http://localhost:${port}` : `http://127.0.0.1:${port}/`;

  return {
    redirectUri,
    port,
    waitForCode,
    close: () => finish(new Error('Authorization cancelled')),
  };
}

// === Authorize URL =================================================================

/**
 * Validate the authorize URL before opening it in the system browser: it must be
 * https and share the host of the configured authorize endpoint. Mirrors the
 * app:open-external allowlist so we never open an arbitrary URL.
 */
function assertSafeAuthorizeUrl(builtUrl: string, endpointUrl: string): void {
  const built = new URL(builtUrl);
  const endpoint = new URL(endpointUrl);
  if (built.protocol !== 'https:') {
    throw new Error('Authorize URL must be https');
  }
  if (built.host !== endpoint.host) {
    throw new Error(`Authorize URL host mismatch: ${built.host}`);
  }
}

function buildAuthorizeUrl(
  req: AuthorizationRequest,
  parts: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(req.endpoints.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', req.clientId);
  url.searchParams.set('redirect_uri', parts.redirectUri);
  url.searchParams.set('scope', req.endpoints.scope);
  url.searchParams.set('state', parts.state);
  url.searchParams.set('code_challenge', parts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(req.endpoints.extraAuthParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

// === Token legs ====================================================================

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function toTokens(json: RawTokenResponse): CalendarTokens {
  return {
    accessToken: json.access_token ?? '',
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    idToken: json.id_token,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

export interface TokenExchangeResult {
  tokens: CalendarTokens;
  accountEmail?: string;
}

/**
 * Exchange the authorization code for tokens. Google includes client_secret;
 * Microsoft omits it (public client, PKCE only). The SAME redirect_uri string used
 * on the authorize leg must be sent here.
 */
export async function exchangeCodeForTokens(
  req: AuthorizationRequest,
  args: { code: string; verifier: string; redirectUri: string },
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: req.clientId,
    code_verifier: args.verifier,
  });
  if (req.endpoints.sendClientSecret && req.clientSecret) {
    body.set('client_secret', req.clientSecret);
  }

  const res = await fetch(req.endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const json = (await res.json()) as RawTokenResponse;
  if (!res.ok || json.error) {
    throw new Error(`Token exchange failed: ${json.error_description || json.error || res.statusText}`);
  }
  return { tokens: toTokens(json), accountEmail: decodeIdTokenEmail(json.id_token) };
}

/**
 * Refresh the access token. Throws {@link CalendarReauthRequiredError} on
 * invalid_grant so callers can flip needsReauth. Microsoft may not rotate the
 * refresh token — we carry the old one forward when the response omits it.
 */
export async function refreshAccessToken(req: AuthorizationRequest, refreshToken: string): Promise<CalendarTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: req.clientId,
  });
  if (req.endpoints.sendClientSecret && req.clientSecret) {
    body.set('client_secret', req.clientSecret);
  }

  const res = await fetch(req.endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const json = (await res.json()) as RawTokenResponse;
  if (json.error === 'invalid_grant') {
    throw new CalendarReauthRequiredError();
  }
  if (!res.ok || json.error) {
    throw new Error(`Token refresh failed: ${json.error_description || json.error || res.statusText}`);
  }
  const tokens = toTokens(json);
  if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
  return tokens;
}

/**
 * Decode the `email` claim from an id_token JWT payload — DISPLAY ONLY. We do NOT
 * verify the JWT signature: the email is never used for any authorization decision,
 * only to show which account is connected in Settings.
 */
export function decodeIdTokenEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split('.');
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

// === Full flow =====================================================================

/**
 * Run the complete Authorization-Code + PKCE flow via the system browser and a
 * one-shot loopback listener, then exchange the code for tokens.
 */
export async function runAuthorizationCodeFlow(
  req: AuthorizationRequest,
  opts?: { timeoutMs?: number },
): Promise<TokenExchangeResult> {
  const { verifier, challenge } = generatePkcePair();
  const state = randomState();
  const listener = await startLoopbackListener({ provider: req.provider, state, timeoutMs: opts?.timeoutMs });

  try {
    const authorizeUrl = buildAuthorizeUrl(req, { redirectUri: listener.redirectUri, state, challenge });
    assertSafeAuthorizeUrl(authorizeUrl, req.endpoints.authorizeUrl);
    await shell.openExternal(authorizeUrl);
    const code = await listener.waitForCode;
    return await exchangeCodeForTokens(req, { code, verifier, redirectUri: listener.redirectUri });
  } finally {
    listener.close();
  }
}

// === Persistence (encrypted-at-rest KV blobs) ======================================

async function writeBlob(key: string, obj: unknown): Promise<void> {
  const json = JSON.stringify(obj);
  const value = isEncryptionAvailable() ? encryptString(json) : json;
  const db = getDb();
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function readBlob<T>(key: string): Promise<T | null> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  if (rows.length === 0) return null;
  let raw = rows[0].value;
  if (isEncryptionAvailable()) {
    try {
      raw = decryptString(raw);
    } catch {
      log.warn(`Failed to decrypt ${key}; treating as absent`);
      return null;
    }
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function deleteBlob(key: string): Promise<void> {
  const db = getDb();
  await db.delete(settings).where(eq(settings.key, key));
}

/** Store the BYO client config (encrypted). The secret is never echoed back over IPC. */
export async function storeCalendarClientConfig(config: CalendarClientConfig): Promise<void> {
  await writeBlob(CLIENT_KEY[config.provider], config);
}

/**
 * The build-time EMBEDDED default client config, assembled from the Vite-injected
 * `process.env.*_CALENDAR_CLIENT_*` defines (see vite.main.config.ts). Read lazily
 * so the values are the build-time literals in packaged builds and real env in tests.
 * Returns null when the credentials for that provider are not baked in (fork/dev).
 */
export function getEmbeddedClientConfig(provider: CalendarProvider): CalendarClientConfig | null {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
    if (clientId && clientSecret) return { provider: 'google', clientId, clientSecret };
    return null;
  }
  const clientId = process.env.MICROSOFT_CALENDAR_CLIENT_ID || '';
  if (clientId) return { provider: 'microsoft', clientId };
  return null;
}

/**
 * Resolve the effective client config for a provider, in priority order:
 *   (a) a stored user-pasted override (calendar:{provider}:client blob), else
 *   (b) the build-time embedded default, else
 *   (c) null (Connect stays disabled).
 */
export async function loadCalendarClientConfig(provider: CalendarProvider): Promise<CalendarClientConfig | null> {
  const stored = await readBlob<CalendarClientConfig>(CLIENT_KEY[provider]);
  if (stored) return stored;
  return getEmbeddedClientConfig(provider);
}

/** Persist a freshly-authorized connection (tokens + display email). Clears needsReauth. */
export async function persistCalendarConnection(
  provider: CalendarProvider,
  tokens: CalendarTokens,
  accountEmail?: string,
): Promise<void> {
  const blob: StoredCalendarAuth = { tokens, accountEmail, needsReauth: false };
  await writeBlob(AUTH_KEY[provider], blob);
}

async function loadCalendarAuth(provider: CalendarProvider): Promise<StoredCalendarAuth | null> {
  return readBlob<StoredCalendarAuth>(AUTH_KEY[provider]);
}

/** Load just the tokens for a provider (adapters need these for refresh/fetch). */
export async function loadCalendarTokens(provider: CalendarProvider): Promise<CalendarTokens | null> {
  const auth = await loadCalendarAuth(provider);
  return auth?.tokens ?? null;
}

/** Persist rotated tokens (after a refresh) without disturbing status metadata. */
export async function updateCalendarTokens(provider: CalendarProvider, tokens: CalendarTokens): Promise<void> {
  const auth = await loadCalendarAuth(provider);
  if (!auth) return;
  await writeBlob(AUTH_KEY[provider], { ...auth, tokens });
}

/** Flip the provider into needs-reauth (dead refresh token). */
export async function markCalendarNeedsReauth(provider: CalendarProvider, message?: string): Promise<void> {
  const auth = await loadCalendarAuth(provider);
  if (!auth) return;
  await writeBlob(AUTH_KEY[provider], { ...auth, needsReauth: true, lastError: message });
}

/** Record the outcome of a poll (sync timestamp and/or last error). */
export async function recordCalendarSync(
  provider: CalendarProvider,
  meta: { lastSyncAt?: string; lastError?: string },
): Promise<void> {
  const auth = await loadCalendarAuth(provider);
  if (!auth) return;
  await writeBlob(AUTH_KEY[provider], { ...auth, ...meta });
}

/**
 * Disconnect a provider: delete its token/auth blob and purge its cached events.
 * The BYO client config is intentionally KEPT so the user can reconnect without
 * re-entering their client id/secret.
 */
export async function disconnectCalendar(provider: CalendarProvider): Promise<void> {
  await deleteBlob(AUTH_KEY[provider]);
  const db = getDb();
  await db.delete(calendarEvents).where(eq(calendarEvents.provider, provider));
}

/** Build the status list for both providers (connected derived from a stored auth blob). */
export async function getCalendarStatuses(): Promise<CalendarAccountStatus[]> {
  const statuses: CalendarAccountStatus[] = [];
  for (const provider of PROVIDERS) {
    const auth = await loadCalendarAuth(provider);
    statuses.push({
      provider,
      connected: auth !== null,
      accountEmail: auth?.accountEmail,
      needsReauth: auth?.needsReauth ?? false,
      lastSyncAt: auth?.lastSyncAt,
      lastError: auth?.lastError,
    });
  }
  return statuses;
}

// === Adapter registry ==============================================================
// Google (Task 2) and Microsoft (Task 3) register their adapter at boot; the IPC
// layer looks one up to drive connect/poll. Empty in this task by design.

const adapters = new Map<CalendarProvider, CalendarProviderAdapter>();

export function registerCalendarAdapter(provider: CalendarProvider, adapter: CalendarProviderAdapter): void {
  adapters.set(provider, adapter);
}

export function getCalendarAdapter(provider: CalendarProvider): CalendarProviderAdapter | null {
  return adapters.get(provider) ?? null;
}
