// === FILE PURPOSE ===
// Unit tests for the local-only transcription privacy enforcement in
// transcriptionProviderService (GUARD.1 Task 4). Proves the load-bearing contract:
//   - isLocalOnly() reads the generic settings surface, defaults OFF (absent /
//     non-'true' / read error), and reports ON only for the exact 'true' string.
//   - setProviderType() REJECTS selecting a cloud provider while local-only is on
//     (typed LocalOnlyViolationError) and never persists — the main-process backstop
//     behind the UI's disabled cloud rows. Local is always allowed; cloud is allowed
//     when local-only is off.
// The DB is mocked (table-routed by settings key).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../secure-storage', () => ({
  encryptString: (s: string) => `enc(${s})`,
  decryptString: (s: string) => s,
}));
vi.mock('../whisperModelManager', () => ({ getDefaultModelPath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({ settings: { __table: 'settings', key: 'key', value: 'value' } }));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import {
  isLocalOnly,
  setProviderType,
  LocalOnlyViolationError,
  TRANSCRIPTION_LOCAL_ONLY_KEY,
} from '../transcriptionProviderService';
import { getDb } from '../../db/connection';

const PROVIDER_KEY = 'transcription_provider';

// Mutable per-test fixtures for the two settings keys the service reads.
let localOnlyValue: string | null = null;
let providerConfigValue: string | null = null;
let insertSpy: ReturnType<typeof vi.fn>;
let updateSpy: ReturnType<typeof vi.fn>;

type Rows = Record<string, unknown>[];

function rowsForKey(key: unknown): Rows {
  if (key === TRANSCRIPTION_LOCAL_ONLY_KEY) {
    return localOnlyValue === null ? [] : [{ key, value: localOnlyValue }];
  }
  if (key === PROVIDER_KEY) {
    return providerConfigValue === null ? [] : [{ key, value: providerConfigValue }];
  }
  return [];
}

function makeDb() {
  return {
    select: () => ({
      from: () => {
        let out: Rows = [];
        const q: Record<string, unknown> = {
          where: (cond: { eq?: unknown[] }) => {
            out = rowsForKey(cond?.eq?.[1]);
            return q;
          },
          limit: () => q,
          then: (res: (v: Rows) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(out).then(res, rej),
        };
        return q;
      },
    }),
    insert: () => ({ values: insertSpy }),
    update: () => ({ set: () => ({ where: updateSpy }) }),
  };
}

beforeEach(() => {
  localOnlyValue = null;
  providerConfigValue = null;
  insertSpy = vi.fn().mockResolvedValue(undefined);
  updateSpy = vi.fn().mockResolvedValue(undefined);
  vi.mocked(getDb).mockReturnValue(makeDb() as never);
});

describe('isLocalOnly', () => {
  it("is true only for the exact 'true' string", async () => {
    localOnlyValue = 'true';
    expect(await isLocalOnly()).toBe(true);
  });

  it('defaults OFF when the setting is absent', async () => {
    localOnlyValue = null;
    expect(await isLocalOnly()).toBe(false);
  });

  it("is false for any non-'true' value", async () => {
    localOnlyValue = 'false';
    expect(await isLocalOnly()).toBe(false);
  });

  it('treats a DB read error as not enforced (never blocks by accident)', async () => {
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('db down');
    });
    expect(await isLocalOnly()).toBe(false);
  });
});

describe('setProviderType under local-only enforcement', () => {
  it('REJECTS a cloud provider with a typed error and does not persist', async () => {
    localOnlyValue = 'true';
    await expect(setProviderType('deepgram')).rejects.toBeInstanceOf(LocalOnlyViolationError);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects assemblyai too', async () => {
    localOnlyValue = 'true';
    await expect(setProviderType('assemblyai')).rejects.toBeInstanceOf(LocalOnlyViolationError);
  });

  it('always allows selecting local, even when local-only is on', async () => {
    localOnlyValue = 'true';
    await expect(setProviderType('local')).resolves.toBeUndefined();
    // Persisted (no existing row → insert path).
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('allows a cloud provider when local-only is off', async () => {
    localOnlyValue = null; // off
    await expect(setProviderType('deepgram')).resolves.toBeUndefined();
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
