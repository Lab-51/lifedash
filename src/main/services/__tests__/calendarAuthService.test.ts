// Unit tests for the provider-agnostic calendar OAuth engine (Phase G, Task 1).
// Covers PKCE shape, loopback state-validation / one-shot / timeout, the asymmetric
// Google-vs-Microsoft token-exchange body, and encryption-at-rest of token blobs.
// All network/OAuth is mocked — no live calls.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { settings } from '../../db/schema';

// --- Mocks (declared before importing the module under test) -----------------------
vi.mock('electron', () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
// Deterministic, obviously-not-plaintext "encryption" so the at-rest assertions are real.
vi.mock('../secure-storage', () => ({
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => 'enc::' + Buffer.from(s, 'utf8').toString('base64'),
  decryptString: (v: string) => Buffer.from(v.replace('enc::', ''), 'base64').toString('utf8'),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import {
  generatePkcePair,
  startLoopbackListener,
  exchangeCodeForTokens,
  persistCalendarConnection,
  loadCalendarTokens,
  getCalendarStatuses,
  disconnectCalendar,
  storeCalendarClientConfig,
  loadCalendarClientConfig,
  type AuthorizationRequest,
} from '../calendarAuthService';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const googleReq: AuthorizationRequest = {
  provider: 'google',
  clientId: 'google-client-id',
  clientSecret: 'google-secret',
  endpoints: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
    sendClientSecret: true,
  },
};

const microsoftReq: AuthorizationRequest = {
  provider: 'microsoft',
  clientId: 'ms-client-id',
  endpoints: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email Calendars.Read',
    sendClientSecret: false,
  },
};

describe('generatePkcePair (S256)', () => {
  it('produces a verifier in the unreserved charset with length 43–128', () => {
    for (let i = 0; i < 20; i++) {
      const { verifier } = generatePkcePair();
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    }
  });

  it('derives challenge = base64url(SHA256(verifier))', () => {
    const { verifier, challenge } = generatePkcePair();
    const expected = base64url(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });
});

describe('startLoopbackListener', () => {
  it('captures the code when state matches, then closes (one-shot)', async () => {
    const state = 'state-match';
    const listener = await startLoopbackListener({ provider: 'google', state, timeoutMs: 3000 });

    await fetch(`${listener.redirectUri}?code=the-code&state=${state}`);
    await expect(listener.waitForCode).resolves.toBe('the-code');

    // Server closed after the single capture — a second callback can't connect.
    await expect(fetch(`http://127.0.0.1:${listener.port}/?code=again&state=${state}`)).rejects.toThrow();
  });

  it('rejects a callback whose state does not match (CSRF guard)', async () => {
    const listener = await startLoopbackListener({ provider: 'google', state: 'expected', timeoutMs: 3000 });
    // Attach the rejection handler BEFORE the callback fires (it rejects synchronously
    // inside the request handler), so the rejection is never momentarily unhandled.
    const expectation = expect(listener.waitForCode).rejects.toThrow(/state mismatch/i);
    await fetch(`${listener.redirectUri}?code=the-code&state=WRONG`);
    await expectation;
  });

  it('rejects after the timeout elapses with no callback', async () => {
    const listener = await startLoopbackListener({ provider: 'google', state: 's', timeoutMs: 40 });
    await expect(listener.waitForCode).rejects.toThrow(/timed out/i);
  });

  it('uses the provider-correct loopback redirect host (Microsoft=localhost, Google=127.0.0.1)', async () => {
    // Regression: Azure rejects a literal 127.0.0.1 and ignores the port for localhost,
    // so Microsoft must round-trip through http://localhost:{port}; Google uses 127.0.0.1.
    const google = await startLoopbackListener({ provider: 'google', state: 'g', timeoutMs: 3000 });
    const microsoft = await startLoopbackListener({ provider: 'microsoft', state: 'm', timeoutMs: 3000 });
    try {
      expect(google.redirectUri.startsWith('http://127.0.0.1:')).toBe(true);
      expect(microsoft.redirectUri.startsWith('http://localhost:')).toBe(true);
    } finally {
      // Attach the catch BEFORE close() (which rejects waitForCode) so the cancellation
      // is never unhandled, then free the listening sockets so the suite doesn't hang.
      google.waitForCode.catch(() => {});
      microsoft.waitForCode.catch(() => {});
      google.close();
      microsoft.close();
    }
  });
});

describe('exchangeCodeForTokens — asymmetric secret handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetchCapture(): { get: () => URLSearchParams } {
    let captured = '';
    const mock = vi.fn(async (_url: string, init: { body: string }) => {
      captured = init.body;
      return {
        ok: true,
        statusText: 'OK',
        json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', mock);
    return { get: () => new URLSearchParams(captured) };
  }

  it('Google exchange body INCLUDES client_secret (+ PKCE verifier + redirect_uri)', async () => {
    const cap = stubFetchCapture();
    await exchangeCodeForTokens(googleReq, { code: 'c', verifier: 'ver', redirectUri: 'http://127.0.0.1:5/' });
    const body = cap.get();
    expect(body.get('client_secret')).toBe('google-secret');
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5/');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('Microsoft exchange body OMITS client_secret (public client, PKCE only)', async () => {
    const cap = stubFetchCapture();
    await exchangeCodeForTokens(microsoftReq, { code: 'c', verifier: 'ver', redirectUri: 'http://127.0.0.1:5/' });
    const body = cap.get();
    expect(body.get('client_secret')).toBeNull();
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('client_id')).toBe('ms-client-id');
  });
});

describe('token persistence (encrypted at rest)', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { vector } });
    holder.db = drizzle(pg, { schema });
    await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('stores the auth blob NOT as plaintext JSON and without the raw refresh token', async () => {
    const tokens = { accessToken: 'ACCESS', refreshToken: 'SUPER-SECRET-REFRESH', expiresAt: Date.now() + 60_000 };
    await persistCalendarConnection('google', tokens, 'user@example.com');

    const [row] = await holder.db.select().from(settings).where(eq(settings.key, 'calendar:google:auth'));
    expect(row).toBeTruthy();
    // Encrypted → does not contain the raw secret and does not parse as the token object.
    expect(row.value).not.toContain('SUPER-SECRET-REFRESH');
    const parsedAsObject = (() => {
      try {
        const obj = JSON.parse(row.value) as unknown;
        return typeof obj === 'object' && obj !== null && 'tokens' in obj;
      } catch {
        return false;
      }
    })();
    expect(parsedAsObject).toBe(false);
  });

  it('round-trips the tokens through decrypt on read', async () => {
    const loaded = await loadCalendarTokens('google');
    expect(loaded?.refreshToken).toBe('SUPER-SECRET-REFRESH');
    expect(loaded?.accessToken).toBe('ACCESS');
  });

  it('reports connected status and clears it on disconnect', async () => {
    const before = await getCalendarStatuses();
    expect(before.find((s) => s.provider === 'google')?.connected).toBe(true);
    expect(before.find((s) => s.provider === 'microsoft')?.connected).toBe(false);

    await disconnectCalendar('google');
    const after = await getCalendarStatuses();
    expect(after.find((s) => s.provider === 'google')?.connected).toBe(false);
  });
});

describe('loadCalendarClientConfig — resolution order (override → embedded → null)', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { vector } });
    holder.db = drizzle(pg, { schema });
    await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('returns null when neither a stored override nor embedded creds exist', async () => {
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', '');
    vi.stubEnv('MICROSOFT_CALENDAR_CLIENT_ID', '');
    expect(await loadCalendarClientConfig('google')).toBeNull();
    expect(await loadCalendarClientConfig('microsoft')).toBeNull();
  });

  it('falls back to the build-time embedded default when no override is stored', async () => {
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', 'embedded-g-id');
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', 'embedded-g-secret');
    vi.stubEnv('MICROSOFT_CALENDAR_CLIENT_ID', 'embedded-ms-id');
    expect(await loadCalendarClientConfig('google')).toEqual({
      provider: 'google',
      clientId: 'embedded-g-id',
      clientSecret: 'embedded-g-secret',
    });
    expect(await loadCalendarClientConfig('microsoft')).toEqual({
      provider: 'microsoft',
      clientId: 'embedded-ms-id',
    });
  });

  it('requires BOTH google id and secret for the embedded default (id alone → null)', async () => {
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', 'only-id');
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', '');
    expect(await loadCalendarClientConfig('google')).toBeNull();
  });

  it('prefers the stored user override over the embedded default', async () => {
    // Embedded creds are present, but a stored override must win.
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', 'embedded-g-id');
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', 'embedded-g-secret');
    await storeCalendarClientConfig({ provider: 'google', clientId: 'user-id', clientSecret: 'user-secret' });
    expect(await loadCalendarClientConfig('google')).toEqual({
      provider: 'google',
      clientId: 'user-id',
      clientSecret: 'user-secret',
    });
  });
});
