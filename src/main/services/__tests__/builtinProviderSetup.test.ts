// LOCAL-RT.2c: downloading a model now switches the built-in runtime on by itself.
// The danger this file guards is the flip side of that convenience — a download
// must never silently re-point a task the user already assigned (LM Studio, a
// cloud provider, or another local model) just because a transfer finished.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rows = vi.hoisted(() => ({
  providers: [] as { id: string; name: string; enabled: boolean }[],
  settings: new Map<string, string>(),
  updated: [] as { id: string; set: Record<string, unknown> }[],
  inserted: [] as { name: string; displayName: string | null }[],
}));

// Minimal drizzle-shaped fake: only the four call chains this module uses.
vi.mock('../../db/connection', () => ({
  getDb: () => ({
    select: () => ({
      from: (table: { _name?: string }) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table._name === 'settings'
                ? [...rows.settings.entries()].map(([key, value]) => ({ key, value }))
                : rows.providers,
            ),
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          rows.updated.push({ id: rows.providers[0]?.id ?? '', set });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: { _name?: string }) => ({
      values: (values: Record<string, string | null>) => {
        if (table._name === 'settings') {
          return {
            onConflictDoUpdate: ({ set }: { set: { value: string } }) => {
              rows.settings.set('ai.taskModels', set.value);
              return Promise.resolve();
            },
          };
        }
        rows.inserted.push({ name: String(values.name), displayName: values.displayName ?? null });
        return { returning: () => Promise.resolve([{ id: 'prov-created' }]) };
      },
    }),
  }),
}));

vi.mock('../../db/schema', () => ({
  aiProviders: { _name: 'aiProviders', id: 'id', name: 'name', enabled: 'enabled' },
  settings: { _name: 'settings', key: 'key' },
}));

const listAvailableModels = vi.hoisted(() => vi.fn<() => { id: string; file: string }[]>(() => []));
vi.mock('../llamaRuntimeConfig', () => ({ listAvailableModels }));

const { activateBuiltinAfterDownload, reconcileBuiltinFromDisk } = await import('../builtinProviderSetup');

const taskModels = () => JSON.parse(rows.settings.get('ai.taskModels') ?? '{}');

beforeEach(() => {
  rows.providers = [];
  rows.settings.clear();
  rows.updated = [];
  rows.inserted = [];
});

describe('activateBuiltinAfterDownload — making a finished download usable', () => {
  it('creates an enabled builtin provider and routes the chat slot when nothing is assigned', async () => {
    const changed = await activateBuiltinAfterDownload('qwen3-4b-Q4_K_M', 'chat');

    expect(changed).toBe(true);
    expect(rows.inserted).toEqual([{ name: 'builtin', displayName: 'Built-in AI' }]);
    expect(taskModels()).toEqual({ live_assistant: { providerId: 'prov-created', model: 'qwen3-4b-Q4_K_M' } });
  });

  it('routes an embedding download to the embedding slot, not the chat slot', async () => {
    await activateBuiltinAfterDownload('embeddinggemma-300m-Q8_0', 'embedding');

    expect(taskModels()).toEqual({ embedding: { providerId: 'prov-created', model: 'embeddinggemma-300m-Q8_0' } });
  });

  it('NEVER overwrites a task the user already assigned elsewhere', async () => {
    // The carve-out that keeps this convenience from being destructive: a
    // working LM Studio setup must survive a model download.
    rows.settings.set('ai.taskModels', JSON.stringify({ live_assistant: { providerId: 'lmstudio-1', model: 'qwen' } }));

    const changed = await activateBuiltinAfterDownload('qwen3-4b-Q4_K_M', 'chat');

    expect(taskModels().live_assistant).toEqual({ providerId: 'lmstudio-1', model: 'qwen' });
    // The provider row is still created — that is purely additive and is what
    // makes the model selectable and the indicator visible.
    expect(rows.inserted).toHaveLength(1);
    expect(changed).toBe(true);
  });

  it('preserves unrelated assignments while filling the empty slot', async () => {
    rows.settings.set(
      'ai.taskModels',
      JSON.stringify({ meeting_summary: { providerId: 'openai-1', model: 'gpt-4o' } }),
    );

    await activateBuiltinAfterDownload('qwen3-4b-Q4_K_M', 'chat');

    expect(taskModels()).toEqual({
      meeting_summary: { providerId: 'openai-1', model: 'gpt-4o' },
      live_assistant: { providerId: 'prov-created', model: 'qwen3-4b-Q4_K_M' },
    });
  });

  it('re-enables a disabled builtin row instead of inserting a duplicate', async () => {
    rows.providers = [{ id: 'prov-old', name: 'builtin', enabled: false }];

    const changed = await activateBuiltinAfterDownload('qwen3-4b-Q4_K_M', 'chat');

    expect(rows.inserted).toHaveLength(0);
    expect(rows.updated).toEqual([{ id: 'prov-old', set: { enabled: true } }]);
    expect(changed).toBe(true);
  });

  it('is idempotent — a second download changes nothing once set up', async () => {
    rows.providers = [{ id: 'prov-old', name: 'builtin', enabled: true }];
    rows.settings.set('ai.taskModels', JSON.stringify({ live_assistant: { providerId: 'prov-old', model: 'a' } }));

    const changed = await activateBuiltinAfterDownload('another-model', 'chat');

    expect(changed).toBe(false);
    expect(rows.inserted).toHaveLength(0);
    expect(rows.updated).toHaveLength(0);
    expect(taskModels().live_assistant).toEqual({ providerId: 'prov-old', model: 'a' });
  });

  it('replaces an unreadable taskModels blob rather than compounding it', async () => {
    rows.settings.set('ai.taskModels', '{not json');

    await activateBuiltinAfterDownload('qwen3-4b-Q4_K_M', 'chat');

    expect(taskModels()).toEqual({ live_assistant: { providerId: 'prov-created', model: 'qwen3-4b-Q4_K_M' } });
  });
});

describe('reconcileBuiltinFromDisk — models downloaded before auto-activation existed', () => {
  it('writes nothing when no model files are installed', async () => {
    listAvailableModels.mockReturnValue([]);

    expect(await reconcileBuiltinFromDisk()).toBe(false);
    expect(rows.inserted).toHaveLength(0);
    expect(rows.settings.size).toBe(0);
  });

  it('activates a model that was already on disk, chat before embedding', async () => {
    // Embedding listed first on purpose: sorting must not let it decide the
    // chat slot, and it must not be mistaken for a chat model.
    listAvailableModels.mockReturnValue([
      { id: 'embeddinggemma-300m-Q8_0', file: 'embeddinggemma-300m-Q8_0.gguf' },
      { id: 'qwen3-4b-Q4_K_M', file: 'qwen3-4b-Q4_K_M.gguf' },
    ]);

    expect(await reconcileBuiltinFromDisk()).toBe(true);
    expect(taskModels()).toEqual({
      live_assistant: { providerId: 'prov-created', model: 'qwen3-4b-Q4_K_M' },
      embedding: { providerId: 'prov-created', model: 'embeddinggemma-300m-Q8_0' },
    });
  });

  it('still respects an assignment the user already made', async () => {
    listAvailableModels.mockReturnValue([{ id: 'qwen3-4b-Q4_K_M', file: 'qwen3-4b-Q4_K_M.gguf' }]);
    rows.settings.set('ai.taskModels', JSON.stringify({ live_assistant: { providerId: 'lmstudio-1', model: 'q' } }));

    await reconcileBuiltinFromDisk();

    expect(taskModels().live_assistant).toEqual({ providerId: 'lmstudio-1', model: 'q' });
  });
});
