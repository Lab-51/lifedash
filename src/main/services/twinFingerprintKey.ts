// === FILE PURPOSE ===
// The secret key behind the twin's keyed tombstone fingerprints (TWIN-LOOP.3 Task 1).
// A purged fact keeps only a fingerprint so it is never re-learned; an unsalted
// sha256 of a short sentence lets anyone holding the database confirm a guessed
// sentence was deleted. An HMAC under a key that is NOT readable from the database
// removes that — so the key is stored encrypted with Electron safeStorage (DPAPI /
// Keychain / libsecret, machine-bound), exactly like API keys.
//
// Rules:
// - Settings row `twin.fingerprintKey` holds encryptString(base64(32 random bytes)).
// - No row + encryption available -> generate, store, return. No row + encryption
//   unavailable -> null (callers fall back to the legacy unkeyed sha256).
// - A row that exists is NEVER overwritten: a transient keyring failure must not
//   destroy a valid key. An undecryptable row -> null.
// - Never throws: any failure resolves to null. Warnings are logged once per
//   process and carry no key material.
// - The result is cached for the process (the in-flight promise too, so two
//   concurrent first calls never race to create two keys).
//
// === DEPENDENCIES ===
// node:crypto (randomBytes), drizzle-orm, db/connection, db/schema (settings),
// secure-storage (safeStorage wrapper), logger.

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { decryptString, encryptString, isEncryptionAvailable } from './secure-storage';
import { createLogger } from './logger';

const log = createLogger('TwinFingerprintKey');

/** Settings key of the encrypted fingerprint key. */
export const TWIN_FINGERPRINT_KEY_SETTING = 'twin.fingerprintKey';

const KEY_BYTES = 32;

let cached: Promise<Buffer | null> | null = null;
let warned = false;

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  log.warn(message);
}

async function readKeyRow(): Promise<string | undefined> {
  const rows = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, TWIN_FINGERPRINT_KEY_SETTING));
  return rows[0]?.value;
}

function decodeKey(stored: string): Buffer | null {
  try {
    const key = Buffer.from(decryptString(stored), 'base64');
    if (key.length === KEY_BYTES) return key;
  } catch {
    // fall through — reported below without any detail of the stored value
  }
  warnOnce('Fingerprint key exists but could not be read; new purges use the unkeyed fingerprint');
  return null;
}

async function loadOrCreateKey(): Promise<Buffer | null> {
  try {
    const existing = await readKeyRow();
    if (existing !== undefined) return decodeKey(existing);

    if (!isEncryptionAvailable()) {
      warnOnce('OS encryption unavailable; no fingerprint key, purges use the unkeyed fingerprint');
      return null;
    }
    const value = encryptString(randomBytes(KEY_BYTES).toString('base64'));
    // DoNothing, never DoUpdate: if a row appeared meanwhile it wins and is read back,
    // so an existing key is never replaced.
    await getDb().insert(settings).values({ key: TWIN_FINGERPRINT_KEY_SETTING, value }).onConflictDoNothing();
    const stored = await readKeyRow();
    return stored === undefined ? null : decodeKey(stored);
  } catch (err) {
    warnOnce(
      `Fingerprint key unavailable (${err instanceof Error ? err.name : 'error'}); purges use the unkeyed fingerprint`,
    );
    return null;
  }
}

/**
 * The process-wide HMAC key for tombstone fingerprints, or null when it cannot be
 * read or created. Never throws, never overwrites an existing key row.
 * Must not be awaited for the first time inside a database transaction (it reads
 * through getDb(), which a held PGlite transaction would block).
 */
export function getFingerprintKey(): Promise<Buffer | null> {
  cached ??= loadOrCreateKey();
  return cached;
}

/** Clear the process cache and the log-once flag. Test-only. */
export function _resetFingerprintKeyCache(): void {
  cached = null;
  warned = false;
}
