// === FILE PURPOSE ===
// Unit tests for AI-CTX.1 Task 2 — TASK_MODEL_FALLBACKS now covers EVERY
// chat-class AITaskType, not just the original four (live_triage,
// twin_interview, twin_learning, knowledge_qa). Verifies:
//   - explicit taskModels[task] always wins over inheritance;
//   - every chat-class task inherits live_assistant's FULL config (provider,
//     model, temperature, maxTokens) when its own is unset;
//   - `embedding` and `transcription` never inherit (embedding stays the
//     unconfigured⇒null privacy guard; transcription falls to first-enabled
//     provider like before);
//   - with no live_assistant config at all, the first-enabled-provider +
//     DEFAULT_MODELS fallback is untouched;
//   - TASK_MIN_OUTPUT_TOKENS floors stay keyed to the REQUESTED task, not the
//     task actually supplying the config.
//
// Mocks the DB the same way ai-provider.embed.test.ts / ai-provider.google.test.ts do.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  embedMany: vi.fn(),
}));

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
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { resolveTaskModel, clearProviderCache } from '../ai-provider';
import { getDb } from '../../db/connection';

interface FakeTable {
  __table: string;
}

/** A `.where()` result that is both directly awaitable AND chainable with
 *  `.limit()` — resolveTaskModel does `await ...where(...)` for the by-id
 *  provider lookup but `await ...where(...).limit(1)` for the final fallback. */
function whereResult(rows: unknown[]) {
  return {
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown[]) => void) => resolve(rows),
  };
}

/** Minimal drizzle-shaped db returning canned rows keyed by the queried table. */
function makeDb(settingsRows: unknown[], providerRows: unknown[]) {
  return {
    select: () => ({
      from: (table: FakeTable) => {
        const rows = table.__table === 'settings' ? settingsRows : table.__table === 'aiProviders' ? providerRows : [];
        return { where: () => whereResult(rows), limit: () => Promise.resolve(rows) };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

/** A settings row for `ai.taskModels`. */
function taskModelsRow(value: Record<string, unknown>) {
  return { key: 'ai.taskModels', value: JSON.stringify(value) };
}

beforeEach(() => {
  clearProviderCache();
  vi.clearAllMocks();
});

describe('resolveTaskModel — chat-class inheritance covers every AITaskType (AI-CTX.1)', () => {
  it('explicit summarization config wins even when live_assistant is configured differently (cloud override)', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          taskModelsRow({
            summarization: { providerId: 'cloud-1', model: 'gpt-5-mini', temperature: 0.2 },
            live_assistant: { providerId: 'local-1', model: 'qwen3-4b' },
          }),
        ],
        [
          { id: 'cloud-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true },
          { id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true },
        ],
      ),
    );

    const resolved = await resolveTaskModel('summarization');

    expect(resolved!.providerId).toBe('cloud-1');
    expect(resolved!.providerName).toBe('openai');
    expect(resolved!.model).toBe('gpt-5-mini');
  });

  it("summarization inherits live_assistant's full config (provider, model, temperature, maxTokens) when unset", async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          taskModelsRow({
            live_assistant: { providerId: 'local-1', model: 'qwen3-4b', temperature: 0.4, maxTokens: 800 },
          }),
        ],
        [{ id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('summarization');

    expect(resolved!.providerId).toBe('local-1');
    expect(resolved!.providerName).toBe('builtin');
    expect(resolved!.model).toBe('qwen3-4b');
    expect(resolved!.temperature).toBe(0.4);
    // summarization has no TASK_MIN_OUTPUT_TOKENS floor, so the inherited 800
    // flows through unmodified — floors are keyed to the REQUESTED task, and
    // summarization isn't one of the floored tasks.
    expect(resolved!.maxTokens).toBe(800);
  });

  // Every one of these was NOT in the original four-entry TASK_MODEL_FALLBACKS —
  // this is the actual breadth extension AI-CTX.1 Task 2 makes.
  it.each([
    'brainstorming',
    'idea_analysis',
    'task_structuring',
    'card_agent',
    'meeting_prep',
    'standup',
    'card-description',
    'background_agent',
    'project_agent',
  ] as const)('%s inherits live_assistant when its own config is unset', async (taskType) => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [taskModelsRow({ live_assistant: { providerId: 'local-1', model: 'qwen3-4b' } })],
        [{ id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel(taskType);

    expect(resolved!.providerId).toBe('local-1');
    expect(resolved!.model).toBe('qwen3-4b');
  });

  it('does NOT inherit when live_assistant itself has no config — falls through to first-enabled-provider + DEFAULT_MODELS', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb([], [{ id: 'cloud-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }]),
    );

    const resolved = await resolveTaskModel('summarization');

    expect(resolved!.providerId).toBe('cloud-1');
    expect(resolved!.model).toBe('gpt-5-mini'); // DEFAULT_MODELS.openai, not an inherited model
    expect(resolved!.temperature).toBeUndefined();
  });

  it('embedding never inherits live_assistant — stays the unconfigured⇒null privacy guard', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [taskModelsRow({ live_assistant: { providerId: 'local-1', model: 'qwen3-4b' } })],
        [{ id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('embedding');

    expect(resolved).toBeNull();
  });

  it('transcription never inherits live_assistant — falls to the first-enabled-provider default instead', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [taskModelsRow({ live_assistant: { providerId: 'local-1', model: 'qwen3-4b' } })],
        [
          { id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true },
          { id: 'cloud-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true },
        ],
      ),
    );

    const resolved = await resolveTaskModel('transcription');

    // Falls to the first enabled provider (builtin, listed first) with its
    // DEFAULT_MODELS entry — never the inherited qwen3-4b live_assistant model.
    expect(resolved!.providerId).toBe('local-1');
    expect(resolved!.model).toBe('default');
  });

  it("twin_learning inheriting live_assistant keeps its OWN 4096 output-token floor (not live_assistant's)", async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [
          taskModelsRow({
            live_assistant: { providerId: 'local-1', model: 'qwen3-4b', maxTokens: 200 },
          }),
        ],
        [{ id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }],
      ),
    );

    const resolved = await resolveTaskModel('twin_learning');

    expect(resolved!.model).toBe('qwen3-4b');
    // Floor applies because the REQUESTED task is twin_learning, even though the
    // inherited config's own maxTokens (200) is lower.
    expect(resolved!.maxTokens).toBe(4096);
  });
});
