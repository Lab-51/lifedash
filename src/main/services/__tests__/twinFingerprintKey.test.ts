// === FILE PURPOSE ===
// TWIN-LOOP.3 Task 1: the keychain-held HMAC key behind keyed tombstone fingerprints.
// Pinned against a real migrated PGlite settings table; secure-storage is mocked (the
// only way to exercise Electron safeStorage outside Electron). Proves: a missing key
// is generated once (32 bytes) and stored ENCRYPTED; an existing row is read back and
// never replaced — not even when it cannot be decrypted; no encryption + no row means
// null and nothing written; and warnings are logged once, without key material.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { settings } from '../../db/schema';

const { logMock, secure } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  secure: { available: true, failDecrypt: false },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
// A reversible stand-in for safeStorage: `enc:` + plaintext.
vi.mock('../secure-storage', () => ({
  isEncryptionAvailable: () => secure.available,
  encryptString: (s: string) => {
    if (!secure.available) throw new Error('Encryption is not available on this system');
    return `enc:${s}`;
  },
  decryptString: (s: string) => {
    if (!secure.available || secure.failDecrypt || !s.startsWith('enc:')) throw new Error('decrypt failed');
    return s.slice('enc:'.length);
  },
}));

import { getFingerprintKey, _resetFingerprintKeyCache, TWIN_FINGERPRINT_KEY_SETTING } from '../twinFingerprintKey';

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  _resetFingerprintKeyCache();
  secure.available = true;
  secure.failDecrypt = false;
  await holder.db.delete(settings);
});

async function keyRow(): Promise<string | undefined> {
  const rows = await holder.db.select().from(settings).where(eq(settings.key, TWIN_FINGERPRINT_KEY_SETTING));
  return rows[0]?.value;
}

describe('getFingerprintKey (real PGlite settings, mocked secure-storage)', () => {
  it('creates a 32-byte key when none exists and stores it only encrypted', async () => {
    const key = await getFingerprintKey();

    expect(key).toBeInstanceOf(Buffer);
    expect(key?.length).toBe(32);
    const stored = await keyRow();
    expect(stored).toBe(`enc:${key?.toString('base64')}`);
  });

  it('reuses the stored key: the same key after a process restart (cache cleared)', async () => {
    const first = await getFingerprintKey();
    expect(await getFingerprintKey()).toBe(first); // cached for the process
    _resetFingerprintKeyCache();

    const second = await getFingerprintKey();

    expect(second?.equals(first as Buffer)).toBe(true);
    expect(await holder.db.select().from(settings)).toHaveLength(1);
  });

  it('two concurrent first calls create ONE key', async () => {
    const [a, b] = await Promise.all([getFingerprintKey(), getFingerprintKey()]);
    expect(a).toBe(b);
    expect(await keyRow()).toBe(`enc:${a?.toString('base64')}`);
  });

  it('never overwrites an existing row it cannot decrypt, and warns once', async () => {
    const original = 'enc-from-another-machine';
    await holder.db.insert(settings).values({ key: TWIN_FINGERPRINT_KEY_SETTING, value: original });

    expect(await getFingerprintKey()).toBeNull();
    _resetFingerprintKeyCache();
    secure.failDecrypt = true; // a keyring that fails outright behaves the same
    expect(await getFingerprintKey()).toBeNull();

    expect(await keyRow()).toBe(original); // row value unchanged after both calls
    expect(logMock.warn).toHaveBeenCalledTimes(2); // once per process (cache reset = new process)
    for (const [msg] of logMock.warn.mock.calls) expect(String(msg)).not.toContain(original);
  });

  it('encryption unavailable and no row: null, nothing written, warned once across calls', async () => {
    secure.available = false;

    expect(await getFingerprintKey()).toBeNull();
    expect(await getFingerprintKey()).toBeNull();

    expect(await keyRow()).toBeUndefined();
    expect(logMock.warn).toHaveBeenCalledTimes(1);
  });
});
