// === FILE PURPOSE ===
// LIVE embedding round-trip confirmation (V3.4 preflight). Exercises the REAL
// embed() seam end to end against a running LM Studio instance — no AI SDK mocks —
// asserting the vectors are 768-dim and that the provider ECHOES the embeddinggemma
// model id (the routing finding).
//
// SKIPPED BY DEFAULT so `npm test` stays green in sandboxes/CI without LM Studio.
// Run it explicitly to confirm the live path:
//   LMSTUDIO_LIVE=1 npx vitest run ai-provider.embed.live
//
// The orchestrator already measured 768 live; this is the app-seam re-confirmation.
// Only getDb / secure-storage / logger are mocked — the AI SDK and OpenAI adapter
// are REAL, so embedMany actually hits http://127.0.0.1:1234/v1/embeddings.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../secure-storage', () => ({ decryptString: vi.fn((b: string) => b) }));
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

import { embed, clearProviderCache } from '../ai-provider';
import { getDb } from '../../db/connection';

const EMBEDDINGGEMMA = 'text-embedding-embeddinggemma-300m';

interface FakeTable {
  __table: string;
}

function liveDb() {
  return {
    select: () => ({
      from: (table: FakeTable) => {
        const rows =
          table.__table === 'settings'
            ? [
                {
                  key: 'ai.taskModels',
                  value: JSON.stringify({ embedding: { providerId: 'lms', model: EMBEDDINGGEMMA } }),
                },
              ]
            : table.__table === 'aiProviders'
              ? [
                  {
                    id: 'lms',
                    name: 'lmstudio',
                    apiKeyEncrypted: null,
                    baseUrl: 'http://127.0.0.1:1234/v1',
                    enabled: true,
                  },
                ]
              : [];
        return { where: () => Promise.resolve(rows), limit: () => Promise.resolve(rows) };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

const LIVE = process.env.LMSTUDIO_LIVE === '1';

beforeEach(() => {
  clearProviderCache();
  vi.clearAllMocks();
});

describe.runIf(LIVE)('embed() — LIVE LM Studio round-trip', () => {
  it('returns 768-dim vectors and echoes the embeddinggemma model id', async () => {
    (getDb as Mock).mockReturnValue(liveDb());

    const result = await embed(['Guten Morgen, wie war das gestrige Meeting?'], 'embedding');

    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toHaveLength(768);
    expect(result.model).toBe(EMBEDDINGGEMMA);
  }, 30_000);

  it('produces batch-consistent 768-dim vectors for multiple inputs', async () => {
    (getDb as Mock).mockReturnValue(liveDb());

    const result = await embed(['erste Notiz', 'zweite Notiz'], 'embedding');

    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(768);
    expect(result.embeddings[1]).toHaveLength(768);
  }, 30_000);
});
