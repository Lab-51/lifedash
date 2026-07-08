// === FILE PURPOSE ===
// Unit tests for the Google Gemini provider wiring (V3.3.5 Task 5). Verifies the
// load-bearing behaviour: the Gemini adapter is built from the safeStorage-decrypted
// API key, an optional proxy baseURL is passed through, connectivity testing hits a
// real (verified) Gemini model id, task-model routing (incl. `twin_interview`)
// resolves a configured Gemini model, and a configured Gemini model counts as a
// frontier provider for the Digital-Twin SOTA gate.
//
// Mocks the AI SDK google adapter, the `ai` package, safeStorage, the DB, and the
// schema so no real network/DB access happens.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports of the module under test
// ---------------------------------------------------------------------------

vi.mock('@ai-sdk/google', () => {
  // createGoogleGenerativeAI(opts) -> callable provider(modelId) -> LanguageModelV3-ish
  const createGoogleGenerativeAI = vi.fn((opts: unknown) => {
    const provider = vi.fn((modelId: string) => ({ specificationVersion: 'v3', __model: modelId, __opts: opts }));
    return provider;
  });
  return { createGoogleGenerativeAI };
});

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('../secure-storage', () => ({
  decryptString: vi.fn((blob: string) => blob),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key' },
  aiProviders: { __table: 'aiProviders', id: 'id', enabled: 'enabled' },
  aiUsage: { __table: 'aiUsage' },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getProvider, clearProviderCache, testConnection, resolveTaskModel } from '../ai-provider';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { decryptString } from '../secure-storage';
import { getDb } from '../../db/connection';
import { isFrontierProvider } from '../../../shared/types/ai';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeTable {
  __table: string;
}

/** Minimal drizzle-shaped db that returns canned rows keyed by the queried table. */
function makeDb(settingsRows: unknown[], providerRows: unknown[]) {
  return {
    select: () => ({
      from: (table: FakeTable) => {
        const rows = table.__table === 'settings' ? settingsRows : table.__table === 'aiProviders' ? providerRows : [];
        return {
          where: () => Promise.resolve(rows),
          limit: () => Promise.resolve(rows),
        };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

beforeEach(() => {
  clearProviderCache();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Adapter construction + safeStorage round-trip
// ---------------------------------------------------------------------------

describe('Google Gemini adapter construction', () => {
  it('decrypts the stored key via safeStorage and builds a Gemini adapter that resolves a model id', () => {
    (decryptString as Mock).mockReturnValue('AIza-plaintext-key');

    const factory = getProvider('gid-1', 'google', 'encrypted-blob', null);

    // API-key round-trip: the encrypted blob is handed to safeStorage, and the
    // decrypted plaintext is passed to the Gemini adapter.
    expect(decryptString).toHaveBeenCalledWith('encrypted-blob');
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'AIza-plaintext-key' }));

    const model = factory('gemini-2.5-flash') as unknown as { __model: string };
    expect(model.__model).toBe('gemini-2.5-flash');
  });

  it('passes a custom baseURL through to the Gemini adapter when a proxy is configured', () => {
    (decryptString as Mock).mockReturnValue('k');

    getProvider('gid-proxy', 'google', 'blob', 'https://proxy.example/v1beta');

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://proxy.example/v1beta' }),
    );
  });

  it('omits baseURL (uses the SDK default endpoint) when none is configured', () => {
    (decryptString as Mock).mockReturnValue('k');

    getProvider('gid-default', 'google', 'blob', null);

    const opts = (createGoogleGenerativeAI as Mock).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect('baseURL' in opts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Connectivity test
// ---------------------------------------------------------------------------

describe('Google Gemini connectivity test', () => {
  it('builds a Gemini adapter, generates against a real Gemini model id, and reports success', async () => {
    (decryptString as Mock).mockReturnValue('AIza-plaintext-key');
    (generateText as Mock).mockResolvedValue({ text: 'ok', usage: {} });

    const res = await testConnection('google', 'encrypted-blob', null);

    expect(res.success).toBe(true);
    expect(createGoogleGenerativeAI).toHaveBeenCalled();
    // The connectivity probe must use a verified `gemini-*` model id (from TEST_MODELS).
    const providerFn = (createGoogleGenerativeAI as Mock).mock.results.at(-1)!.value as Mock;
    expect(providerFn).toHaveBeenCalledWith(expect.stringMatching(/^gemini-/));
  });

  it('reports a friendly failure when the Gemini generate call rejects', async () => {
    (decryptString as Mock).mockReturnValue('bad-key');
    (generateText as Mock).mockRejectedValue(new Error('401 Unauthorized'));

    const res = await testConnection('google', 'encrypted-blob', null);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid API key/i);
  });
});

// ---------------------------------------------------------------------------
// Task-model routing + frontier resolution
// ---------------------------------------------------------------------------

describe('Gemini task-model routing and frontier gate', () => {
  it('treats google as a frontier (SOTA) provider', () => {
    expect(isFrontierProvider('google')).toBe(true);
  });

  it('routes twin_interview to an explicitly configured Gemini model, which counts as frontier', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          {
            key: 'ai.taskModels',
            value: JSON.stringify({ twin_interview: { providerId: 'gid-1', model: 'gemini-2.5-pro' } }),
          },
        ],
        [{ id: 'gid-1', name: 'google', apiKeyEncrypted: 'encrypted-blob', baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('twin_interview');

    expect(resolved).not.toBeNull();
    expect(resolved!.providerName).toBe('google');
    expect(resolved!.model).toBe('gemini-2.5-pro');
    expect(isFrontierProvider(resolved!.providerName)).toBe(true);
  });

  it('lets twin_interview inherit the Live Assistant Gemini config when not set explicitly', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          {
            key: 'ai.taskModels',
            value: JSON.stringify({ live_assistant: { providerId: 'gid-1', model: 'gemini-2.5-flash' } }),
          },
        ],
        [{ id: 'gid-1', name: 'google', apiKeyEncrypted: 'encrypted-blob', baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('twin_interview');

    expect(resolved!.providerName).toBe('google');
    expect(resolved!.model).toBe('gemini-2.5-flash');
  });

  it('routes a non-twin task type (summarization) to a configured Gemini model', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          {
            key: 'ai.taskModels',
            value: JSON.stringify({ summarization: { providerId: 'gid-1', model: 'gemini-2.5-flash-lite' } }),
          },
        ],
        [{ id: 'gid-1', name: 'google', apiKeyEncrypted: 'encrypted-blob', baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('summarization');

    expect(resolved!.providerName).toBe('google');
    expect(resolved!.model).toBe('gemini-2.5-flash-lite');
  });
});
