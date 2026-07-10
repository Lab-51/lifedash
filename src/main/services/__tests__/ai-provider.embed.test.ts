// === FILE PURPOSE ===
// Unit tests for the V3.4 embedding seam in ai-provider.ts. Verifies the
// load-bearing behaviour without any network/DB:
//   - embed() resolves the embedding provider, builds the embedding model, and
//     calls AI SDK embedMany;
//   - it surfaces the provider-ECHOED model (response.model) — NOT the requested
//     id — so Task 4's rebuild-on-mismatch guard sees real provenance;
//   - it batches at ≤64 texts/call;
//   - resolveTaskModel('embedding') NEVER falls back to a cloud provider (privacy);
//   - resolveTaskModel floors twin_learning/knowledge_qa output tokens at ≥4096.
//
// Mocks the AI SDK, the OpenAI adapter, safeStorage, the DB, and the schema.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  // Default: echo requested count of 2-dim vectors + a canned echoed model.
  embedMany: vi.fn(async ({ values }: { values: string[] }) => ({
    embeddings: values.map(() => [0.1, 0.2]),
    usage: { tokens: values.length },
    responses: [{ body: { model: 'text-embedding-embeddinggemma-300m' } }],
  })),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((opts: unknown) => ({
    chat: vi.fn((modelId: string) => ({ __chat: modelId })),
    textEmbeddingModel: vi.fn((modelId: string) => ({ __embModel: modelId, __opts: opts })),
  })),
}));

vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => vi.fn()) }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn(() => ({ textEmbeddingModel: vi.fn() })) }));
vi.mock('ollama-ai-provider', () => ({ createOllama: vi.fn(() => ({ textEmbeddingModel: vi.fn() })) }));

vi.mock('../secure-storage', () => ({ decryptString: vi.fn((blob: string) => `decrypted:${blob}`) }));
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

import { embed, resolveTaskModel, clearProviderCache } from '../ai-provider';
import { embedMany } from 'ai';
import { getDb } from '../../db/connection';

interface FakeTable {
  __table: string;
}

/** Minimal drizzle-shaped db returning canned rows keyed by the queried table. */
function makeDb(settingsRows: unknown[], providerRows: unknown[]) {
  return {
    select: () => ({
      from: (table: FakeTable) => {
        const rows = table.__table === 'settings' ? settingsRows : table.__table === 'aiProviders' ? providerRows : [];
        return { where: () => Promise.resolve(rows), limit: () => Promise.resolve(rows) };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

/** A DB configured with a local LM Studio embedding model routed to `embedding`. */
function lmStudioEmbeddingDb() {
  return makeDb(
    [
      {
        key: 'ai.taskModels',
        value: JSON.stringify({
          embedding: { providerId: 'lms-1', model: 'text-embedding-embeddinggemma-300m' },
        }),
      },
    ],
    [{ id: 'lms-1', name: 'lmstudio', apiKeyEncrypted: null, baseUrl: 'http://127.0.0.1:1234/v1', enabled: true }],
  );
}

beforeEach(() => {
  clearProviderCache();
  vi.clearAllMocks();
});

describe('embed() — local embedding via embedMany', () => {
  it('resolves the embedding provider, calls embedMany, and returns vectors', async () => {
    (getDb as Mock).mockReturnValue(lmStudioEmbeddingDb());

    const result = await embed(['hallo welt'], 'embedding');

    expect(embedMany).toHaveBeenCalledTimes(1);
    const call = (embedMany as Mock).mock.calls[0][0] as { model: { __embModel: string }; values: string[] };
    expect(call.model.__embModel).toBe('text-embedding-embeddinggemma-300m');
    expect(call.values).toEqual(['hallo welt']);
    expect(result.embeddings).toEqual([[0.1, 0.2]]);
  });

  it('surfaces the provider-ECHOED model, not the requested id (routing finding)', async () => {
    (getDb as Mock).mockReturnValue(lmStudioEmbeddingDb());
    // Simulate LM Studio routing an invalid/other id to a different loaded model
    // and echoing the ACTUAL model in response.model.
    (embedMany as Mock).mockResolvedValueOnce({
      embeddings: [[0.1, 0.2]],
      usage: { tokens: 2 },
      responses: [{ body: { model: 'text-embedding-nomic-embed-text-v1.5' } }],
    });

    const result = await embed(['x'], 'embedding');

    expect(result.model).toBe('text-embedding-nomic-embed-text-v1.5');
  });

  it('falls back to the requested id when the provider does not echo a model', async () => {
    (getDb as Mock).mockReturnValue(lmStudioEmbeddingDb());
    (embedMany as Mock).mockResolvedValueOnce({ embeddings: [[0.1, 0.2]], usage: { tokens: 2 }, responses: [] });

    const result = await embed(['x'], 'embedding');

    expect(result.model).toBe('text-embedding-embeddinggemma-300m');
  });

  it('batches at ≤64 texts per embedMany call', async () => {
    (getDb as Mock).mockReturnValue(lmStudioEmbeddingDb());
    const texts = Array.from({ length: 130 }, (_, i) => `t${i}`);

    const result = await embed(texts, 'embedding');

    // 130 = 64 + 64 + 2 → three calls; all embeddings accumulated in order.
    expect(embedMany).toHaveBeenCalledTimes(3);
    expect(result.embeddings).toHaveLength(130);
  });

  it('returns empty without calling embedMany for an empty input', async () => {
    (getDb as Mock).mockReturnValue(lmStudioEmbeddingDb());

    const result = await embed([], 'embedding');

    expect(embedMany).not.toHaveBeenCalled();
    expect(result.embeddings).toEqual([]);
  });

  it('throws a clear error when no embedding provider is configured', async () => {
    // No ai.taskModels config, and only a cloud provider enabled → embedding
    // resolves to null (no cloud fallback), so embed() throws.
    (getDb as Mock).mockReturnValue(
      makeDb([], [{ id: 'oa-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }]),
    );

    await expect(embed(['x'], 'embedding')).rejects.toThrow(/No embedding provider configured/);
    expect(embedMany).not.toHaveBeenCalled();
  });
});

describe('resolveTaskModel — V3.4 task routing', () => {
  it('never falls back to a cloud provider for the embedding task (privacy default)', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb([], [{ id: 'oa-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }]),
    );

    const resolved = await resolveTaskModel('embedding');

    expect(resolved).toBeNull();
  });

  it('floors twin_learning output tokens at 4096 even when configured lower', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          {
            key: 'ai.taskModels',
            value: JSON.stringify({ twin_learning: { providerId: 'oa-1', model: 'gpt-5-mini', maxTokens: 500 } }),
          },
        ],
        [{ id: 'oa-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('twin_learning');

    expect(resolved!.maxTokens).toBe(4096);
  });

  it('floors knowledge_qa output tokens at 4096 when inherited from live_assistant (no explicit budget)', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          {
            key: 'ai.taskModels',
            value: JSON.stringify({ live_assistant: { providerId: 'oa-1', model: 'gpt-5-mini' } }),
          },
        ],
        [{ id: 'oa-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('knowledge_qa');

    expect(resolved!.model).toBe('gpt-5-mini');
    expect(resolved!.maxTokens).toBe(4096);
  });
});
