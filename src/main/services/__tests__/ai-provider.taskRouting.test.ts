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

import { resolveTaskModel, clearProviderCache, sanitizeTemperature } from '../ai-provider';
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
            live_assistant: { providerId: 'local-1', model: 'qwen3-4b', temperature: 0.4, maxTokens: 6000 },
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
    // Flows through unmodified: `builtin` is a local provider, where summarization's
    // floor never applies (the local ceiling is the context window, which the user
    // sized themselves). This test is about inheritance, not about the floor.
    expect(resolved!.maxTokens).toBe(6000);
  });

  // -------------------------------------------------------------------------
  // summarization's output-token policy (BRIEF-QUAL.1, corrected 2026-08-22)
  // -------------------------------------------------------------------------
  // The bug this replaces: a floor in TASK_MIN_OUTPUT_TOKENS materialises a cap out
  // of an ABSENT one, so an unconfigured user started sending max_output_tokens 4096
  // to a reasoning model, whose hidden thinking is charged against it — an 88-minute
  // extraction was cut off at exactly 4096 completion tokens, twice, and became a
  // failure card. The rule is now RAISE-ONLY, and absent stays absent wherever the
  // adapter can omit the field.

  function summarizationWith(providerName: string, maxTokens?: number, temperature?: number) {
    const config: Record<string, unknown> = { providerId: 'p-1', model: 'm-1' };
    if (maxTokens !== undefined) config.maxTokens = maxTokens;
    if (temperature !== undefined) config.temperature = temperature;
    (getDb as Mock).mockReturnValue(
      makeDb(
        [taskModelsRow({ summarization: config as never })],
        [{ id: 'p-1', name: providerName, apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }],
      ),
    );
    return resolveTaskModel('summarization');
  }

  it.each(['openai', 'google', 'builtin', 'lmstudio', 'ollama'])(
    'sends NO cap for %s when the user configured none — the provider default wins',
    async (providerName) => {
      const resolved = await summarizationWith(providerName);
      // undefined reaches generate() as `maxOutputTokens: undefined`, which every one
      // of these adapters omits from the request body (verified in node_modules).
      expect(resolved!.maxTokens).toBeUndefined();
    },
  );

  it('supplies 16384 for anthropic when none is configured — its adapter always sends a max_tokens', async () => {
    // @ai-sdk/anthropic falls back to the model's own ceiling, but to 4096 for an
    // UNRECOGNISED model id — an absent value there is not safe.
    const resolved = await summarizationWith('anthropic');
    expect(resolved!.maxTokens).toBe(16_384);
  });

  it('supplies 16384 for kimi too — sanitizeMaxTokens would otherwise fabricate 4096', async () => {
    // Absent does not stay absent for kimi: REASONING_MIN_TOKENS raises it downstream
    // in generate(), which is the very cap that truncated the extraction. Returning
    // undefined here would be ineffective rather than safe.
    const resolved = await summarizationWith('kimi');
    expect(resolved!.maxTokens).toBe(16_384);
  });

  it.each(['openai', 'anthropic', 'google', 'kimi'])(
    'raises an explicitly configured cap below the floor to 16384 on %s',
    async (providerName) => {
      const resolved = await summarizationWith(providerName, 2_000);
      expect(resolved!.maxTokens).toBe(16_384);
    },
  );

  it('keeps an explicitly configured cap ABOVE the floor untouched', async () => {
    const resolved = await summarizationWith('openai', 32_000);
    expect(resolved!.maxTokens).toBe(32_000);
  });

  it.each(['builtin', 'lmstudio', 'ollama'])(
    "passes an explicit cap through UNCHANGED on %s — a local ceiling is the user's own",
    async (providerName) => {
      const resolved = await summarizationWith(providerName, 2_000);
      expect(resolved!.maxTokens).toBe(2_000);
    },
  );

  it('applies the same policy on the first-enabled-provider fallback path', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb([], [{ id: 'cloud-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }]),
    );
    const resolved = await resolveTaskModel('summarization');
    expect(resolved!.maxTokens).toBeUndefined(); // NOT a fabricated 4096
  });

  it.each(['twin_learning', 'knowledge_qa'])(
    '%s keeps its ORIGINAL floor semantics — an absent value still materialises 4096',
    async (taskType) => {
      (getDb as Mock).mockReturnValue(
        makeDb(
          [taskModelsRow({ [taskType]: { providerId: 'p-1', model: 'm-1' } } as never)],
          [{ id: 'p-1', name: 'openai', apiKeyEncrypted: 'blob', baseUrl: null, enabled: true }],
        ),
      );
      const resolved = await resolveTaskModel(taskType);
      expect(resolved!.maxTokens).toBe(4096);
    },
  );

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
    // No cap is fabricated for summarization from an absent value (BRIEF-QUAL.1).
    expect(resolved!.maxTokens).toBeUndefined();
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

  // -------------------------------------------------------------------------
  // summarization's local sampling-temperature default (LOCAL-QUAL.1)
  // -------------------------------------------------------------------------
  // Local models run brief extraction (and the writer, which shares this task —
  // BRIEF-QUAL.1) at their chat-default sampling unless a lower value is set here.
  // Strict JSON extraction wants low temperature, and small local models showed
  // sampling-sensitive name drift and owner wobble at chat-default sampling on the
  // built-in tier. Cloud stays untouched: several cloud models reject or ignore the
  // parameter, and their observed output is the accepted benchmark.

  it.each(['builtin', 'lmstudio', 'ollama'])(
    'defaults temperature to 0.2 for %s summarization when the user configured none',
    async (providerName) => {
      const resolved = await summarizationWith(providerName);
      expect(resolved!.temperature).toBe(0.2);
    },
  );

  it.each(['openai', 'anthropic', 'google', 'kimi'])(
    'leaves temperature absent for %s summarization when the user configured none — cloud byte-identical',
    async (providerName) => {
      const resolved = await summarizationWith(providerName);
      expect(resolved!.temperature).toBeUndefined();
    },
  );

  it('keeps an explicitly configured temperature untouched on a local provider — explicit config always wins', async () => {
    const resolved = await summarizationWith('builtin', undefined, 0.7);
    expect(resolved!.temperature).toBe(0.7);
  });

  it('does not default temperature on a non-summarization task, even on a local provider', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb(
        [taskModelsRow({ twin_learning: { providerId: 'p-1', model: 'm-1' } })],
        [{ id: 'p-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }],
      ),
    );
    const resolved = await resolveTaskModel('twin_learning');
    expect(resolved!.temperature).toBeUndefined();
  });

  it('applies the local temperature default on the first-enabled-provider fallback path too — the likely half-ship spot', async () => {
    (getDb as Mock).mockReturnValue(
      makeDb([], [{ id: 'local-1', name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }]),
    );
    const resolved = await resolveTaskModel('summarization');
    expect(resolved!.temperature).toBe(0.2);
  });

  it('sanitizeTemperature still strips temperature for providers that require fixed values (e.g. kimi) — unmodified by this task', () => {
    expect(sanitizeTemperature('kimi', 0.2)).toBeUndefined();
    expect(sanitizeTemperature('kimi', 0.7)).toBeUndefined();
    expect(sanitizeTemperature('openai', 0.2)).toBe(0.2); // control: non-fixed provider passes through
  });
});
