// === FILE PURPOSE ===
// TWIN-LOOP.2 Task 1 — resolveTwinLearningModel / getTwinLearningModelInfo.
// Fact learning reads every meeting's notes, so it may run only on a model the user
// chose for it (`ai.taskModels.twin_learning`) or on a LOCAL model inherited from
// `live_assistant` — never resolveTaskModel's first-enabled-provider fallback.
//
// The fake DB filters on the eq() predicate (unlike ai-provider.taskRouting.test's
// canned rows) so a by-id provider lookup and the enabled-provider fallback behave
// like the real thing; the fallback case below is a control that resolveTaskModel
// itself DOES return a cloud provider in that state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('ai', () => ({ generateText: vi.fn(), streamText: vi.fn(), embedMany: vi.fn() }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn(() => vi.fn()) }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => vi.fn()) }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn(() => vi.fn()) }));
vi.mock('ollama-ai-provider', () => ({ createOllama: vi.fn(() => vi.fn()) }));
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
vi.mock('drizzle-orm', () => ({ eq: vi.fn((col: string, val: unknown) => ({ col, val })) }));

import {
  resolveTaskModel,
  resolveTwinLearningModel,
  getTwinLearningModelInfo,
  isLocalProvider,
  clearProviderCache,
} from '../ai-provider';
import { getDb } from '../../db/connection';

interface FakeTable {
  __table: string;
}
type Row = Record<string, unknown>;

/** drizzle-shaped fake whose where(eq(col, val)) filters rows on that column. */
function makeDb(settingsRows: Row[], providerRows: Row[]) {
  return {
    select: () => ({
      from: (table: FakeTable) => {
        const rows = table.__table === 'settings' ? settingsRows : table.__table === 'aiProviders' ? providerRows : [];
        return {
          where: (pred: { col: string; val: unknown }) => {
            const filtered = rows.filter((r) => r[pred.col] === pred.val);
            return {
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              then: (res: (v: Row[]) => void) => res(filtered),
            };
          },
        };
      },
    }),
  };
}

const CLOUD = { id: 'cloud-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true };
const LOCAL = { id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true };

function arrange(taskModels: Record<string, unknown> | null, providers: Row[]) {
  const settingsRows = taskModels ? [{ key: 'ai.taskModels', value: JSON.stringify(taskModels) }] : [];
  (getDb as Mock).mockReturnValue(makeDb(settingsRows, providers));
}

beforeEach(() => {
  clearProviderCache();
  vi.clearAllMocks();
});

describe('resolveTwinLearningModel', () => {
  it('uses an explicit twin_learning model, even a cloud one (the user chose it)', async () => {
    arrange({ twin_learning: { providerId: 'cloud-1', model: 'gpt-5-mini' } }, [CLOUD, LOCAL]);
    const resolved = await resolveTwinLearningModel();
    expect(resolved).toMatchObject({ providerId: 'cloud-1', providerName: 'openai', model: 'gpt-5-mini' });
  });

  it('explicit twin_learning wins over a different live_assistant', async () => {
    arrange(
      {
        twin_learning: { providerId: 'cloud-1', model: 'gpt-5-mini' },
        live_assistant: { providerId: 'local-1', model: 'qwen3' },
      },
      [CLOUD, LOCAL],
    );
    expect((await resolveTwinLearningModel())?.providerId).toBe('cloud-1');
  });

  it('no twin_learning + a LOCAL live_assistant → used (inherited local)', async () => {
    arrange({ live_assistant: { providerId: 'local-1', model: 'qwen3' } }, [CLOUD, LOCAL]);
    expect(await resolveTwinLearningModel()).toMatchObject({
      providerId: 'local-1',
      providerName: 'builtin',
      model: 'qwen3',
    });
  });

  it('no twin_learning + a CLOUD live_assistant (inherited cloud) → null', async () => {
    arrange({ live_assistant: { providerId: 'cloud-1', model: 'gpt-5-mini' } }, [CLOUD, LOCAL]);
    expect(await resolveTwinLearningModel()).toBeNull();
  });

  it('nothing configured + a cloud provider enabled → null (the old silent-fallback case)', async () => {
    arrange(null, [CLOUD]);
    // Control: the general resolver DOES silently fall back to this cloud provider.
    expect(await resolveTaskModel('twin_learning')).toMatchObject({ providerName: 'openai' });
    expect(await resolveTwinLearningModel()).toBeNull();
  });

  it('nothing configured + only a local provider enabled → still null (never first-enabled)', async () => {
    arrange({}, [LOCAL]);
    expect(await resolveTwinLearningModel()).toBeNull();
  });

  it('an explicit twin_learning whose provider is disabled → null, not the enabled cloud fallback', async () => {
    arrange({ twin_learning: { providerId: 'gone-1', model: 'x' } }, [
      { ...LOCAL, id: 'gone-1', enabled: false },
      CLOUD,
    ]);
    expect(await resolveTwinLearningModel()).toBeNull();
  });

  it('malformed ai.taskModels → null', async () => {
    (getDb as Mock).mockReturnValue(makeDb([{ key: 'ai.taskModels', value: '{not json' }], [CLOUD]));
    expect(await resolveTwinLearningModel()).toBeNull();
  });
});

describe('getTwinLearningModelInfo', () => {
  it('explicit cloud → willLearn, explicit, not local', async () => {
    arrange({ twin_learning: { providerId: 'cloud-1', model: 'gpt-5-mini' } }, [CLOUD]);
    expect(await getTwinLearningModelInfo()).toEqual({
      providerLabel: 'openai',
      modelLabel: 'gpt-5-mini',
      isLocal: false,
      explicit: true,
      willLearn: true,
    });
  });

  it('inherited local → willLearn, local, not explicit', async () => {
    arrange({ live_assistant: { providerId: 'local-1', model: 'qwen3' } }, [LOCAL]);
    expect(await getTwinLearningModelInfo()).toEqual({
      providerLabel: 'builtin',
      modelLabel: 'qwen3',
      isLocal: true,
      explicit: false,
      willLearn: true,
    });
  });

  it('inherited cloud → willLearn false with no labels', async () => {
    arrange({ live_assistant: { providerId: 'cloud-1', model: 'gpt-5-mini' } }, [CLOUD]);
    expect(await getTwinLearningModelInfo()).toEqual({
      providerLabel: null,
      modelLabel: null,
      isLocal: false,
      explicit: false,
      willLearn: false,
    });
  });
});

describe('isLocalProvider', () => {
  it('treats builtin, lmstudio and ollama as local and every cloud provider as not', () => {
    for (const name of ['builtin', 'lmstudio', 'ollama']) expect(isLocalProvider(name)).toBe(true);
    for (const name of ['openai', 'anthropic', 'google', 'kimi']) expect(isLocalProvider(name)).toBe(false);
  });
});
