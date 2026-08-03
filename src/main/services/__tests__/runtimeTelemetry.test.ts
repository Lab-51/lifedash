// Runtime telemetry tests (LOCAL-RT.2 Task 1). Covers the load-bearing guarantees:
// tok/s is computed correctly from usage + wall clock at the single provider seam, a
// telemetry failure can NEVER fail a generation, the ring buffer is bounded, the
// ai:runtime-status push fires on runtime transitions AND on builtin provider
// enable/disable — and, above all, that NOTHING on a status or telemetry path calls
// ensureRunning(). That last one is LOCAL-RT.1's optionality guarantee: observing the
// runtime must never spawn it.
//
// llamaRuntimeService is mocked so ensureRunning is a spy that would record a
// violation; the DB is a REAL in-memory PGlite because the `configured` flag is a
// genuine join on the provider table. The AI SDK is mocked — no model is ever called.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { aiProviders, aiUsage } from '../../db/schema';
import { RUNTIME_TELEMETRY_WINDOW } from '../../../shared/types/ai';
import type { LlamaRuntimeStatus } from '../../../shared/types/ai';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn);
    }),
  },
}));

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle>,
  /** The optionality guard: this spy must NEVER be called by an observation path. */
  ensureRunning: vi.fn(),
  status: vi.fn(),
  readContextUsage: vi.fn(async () => null as unknown),
  changeListener: null as null | (() => void),
  generateText: vi.fn(),
  streamText: vi.fn(),
  /** Flip on to simulate the telemetry layer blowing up mid-generation. */
  telemetryThrows: false,
}));

vi.mock('../../db/connection', () => ({ getDb: () => h.db }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getLogDirectory: () => path.join(process.cwd(), '.tmp-logs'),
}));
vi.mock('../secure-storage', () => ({
  encryptString: (s: string) => `enc::${s}`,
  decryptString: (s: string) => s.replace(/^enc::/, ''),
  isEncryptionAvailable: () => true,
}));
vi.mock('../llamaRuntimeService', () => ({
  ensureRunning: h.ensureRunning,
  status: h.status,
  readContextUsage: h.readContextUsage,
  setRuntimeChangeListener: vi.fn((fn: (() => void) | null) => {
    h.changeListener = fn;
  }),
  stop: vi.fn(async () => {}),
  touch: vi.fn(),
  getModelsDir: () => path.join(process.cwd(), '.tmp-models'),
  listAvailableModels: () => [],
  isBinaryAvailable: () => true,
}));
vi.mock('ai', () => ({
  generateText: h.generateText,
  streamText: h.streamText,
  embedMany: vi.fn(),
}));

// Partial mock: keep the REAL ring buffer / snapshot / push logic, but let one test
// make the seam's telemetry call explode so we can prove the generation survives.
vi.mock('../runtimeTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtimeTelemetry')>();
  return {
    ...actual,
    recordGeneration: (timing: Parameters<typeof actual.recordGeneration>[0]) => {
      if (h.telemetryThrows) throw new Error('telemetry exploded');
      actual.recordGeneration(timing);
    },
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  RUNTIME_STATUS_CHANNEL,
  emitRuntimeStatus,
  getRuntimeSnapshot,
  getTelemetrySnapshot,
  initRuntimeTelemetry,
  recordGeneration,
  resetTelemetry,
  stopRuntimeTelemetry,
} from '../runtimeTelemetry';
import { generate, streamGenerate } from '../ai-provider';
import { registerAIProviderHandlers } from '../../ipc/ai-providers';

const handler = (channel: string) => registeredHandlers.get(channel)!;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function idleStatus(overrides: Partial<LlamaRuntimeStatus> = {}): LlamaRuntimeStatus {
  const role = {
    running: false,
    starting: false,
    modelId: null,
    baseUrl: null,
    pid: null,
    lastUsedAt: null,
    crashes: 0,
  };
  return {
    running: false,
    backend: null,
    binaryAvailable: true,
    loadedModels: [],
    chat: role,
    embedding: role,
    idleStopMinutes: 15,
    ...overrides,
  };
}

function fakeWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

let win: ReturnType<typeof fakeWindow>;

/** Push payloads captured for RUNTIME_STATUS_CHANNEL, newest last. */
function pushes() {
  return win.webContents.send.mock.calls.filter((c) => c[0] === RUNTIME_STATUS_CHANNEL);
}

/**
 * The push is fire-and-forget (`void emitRuntimeStatus()`) and its snapshot queries the
 * real PGlite, so it settles over several turns of the event loop — draining microtasks
 * is not enough. Used to assert the ABSENCE of a push; use waitForPushes otherwise.
 */
async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Wait until exactly `n` pushes have landed (and stay there through one more settle). */
async function waitForPushes(n: number) {
  await vi.waitFor(() => expect(pushes()).toHaveLength(n));
}

const SEAM = {
  providerId: '',
  providerName: 'lmstudio' as const,
  apiKeyEncrypted: null,
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model',
  taskType: 'summarization',
};

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  h.db = drizzle(pg, { schema });
  await migrate(h.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  h.telemetryThrows = false;
  h.changeListener = null;
  h.status.mockReturnValue(idleStatus());
  h.readContextUsage.mockResolvedValue(null);
  resetTelemetry();
  await h.db.delete(aiUsage);
  await h.db.delete(aiProviders);
  win = fakeWindow();
  initRuntimeTelemetry(win as never);
});

afterEach(() => {
  stopRuntimeTelemetry();
  vi.useRealTimers();
});

// ===========================================================================
describe('tok/s at the provider seam', () => {
  it('computes tokens per second from output tokens and wall-clock elapsed', async () => {
    recordGeneration({
      providerName: 'builtin',
      model: 'gemma-4-E4B-it-Q4_K_M',
      outputTokens: 200,
      elapsedMs: 4_000,
      streaming: false,
    });

    const snapshot = await getTelemetrySnapshot();
    expect(snapshot.latest?.tokensPerSecond).toBeCloseTo(50, 6);
    expect(snapshot.latest?.outputTokens).toBe(200);
    expect(snapshot.latest?.streaming).toBe(false);
    expect(snapshot.latest?.ttftMs).toBeNull();
  });

  it('ignores unmeasurable samples (no output tokens, or no elapsed time)', async () => {
    recordGeneration({
      providerName: 'openai',
      model: 'gpt-5-mini',
      outputTokens: 0,
      elapsedMs: 900,
      streaming: false,
    });
    recordGeneration({ providerName: 'openai', model: 'gpt-5-mini', outputTokens: 10, elapsedMs: 0, streaming: false });
    expect((await getTelemetrySnapshot()).latest).toBeNull();
  });

  it('measures generate() end to end: 100 tokens over 2s reads as 50 tok/s', async () => {
    vi.useFakeTimers();
    h.generateText.mockImplementation(async () => {
      vi.advanceTimersByTime(2_000);
      return {
        text: 'hello',
        reasoning: [],
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 100, totalTokens: 105 },
      };
    });

    await generate({ ...SEAM, prompt: 'hi' });

    const snapshot = await getTelemetrySnapshot();
    expect(snapshot.latest?.tokensPerSecond).toBeCloseTo(50, 6);
    expect(snapshot.latest?.model).toBe('local-model');
    expect(snapshot.latest?.streaming).toBe(false);
  });

  it('measures streamGenerate() to the LAST token and records TTFT separately', async () => {
    vi.useFakeTimers();
    let opts: {
      onChunk?: () => void;
      onFinish?: (e: { usage: { outputTokens: number } }) => void;
    } = {};
    h.streamText.mockImplementation((o: typeof opts) => {
      opts = o;
      return { textStream: [] };
    });

    streamGenerate({ ...SEAM, messages: [{ role: 'user', content: 'hi' }] });

    vi.advanceTimersByTime(300); // time to first token
    opts.onChunk?.();
    opts.onChunk?.(); // later chunks must not move TTFT
    vi.advanceTimersByTime(1_700); // ...to the last token: 2s total
    opts.onFinish?.({ usage: { outputTokens: 60 } });

    const snapshot = await getTelemetrySnapshot();
    expect(snapshot.latest?.streaming).toBe(true);
    expect(snapshot.latest?.ttftMs).toBe(300);
    expect(snapshot.latest?.elapsedMs).toBe(2_000);
    expect(snapshot.latest?.tokensPerSecond).toBeCloseTo(30, 6);
  });

  it('does NOT write an ai_usage row from the streaming path (callers log usage themselves)', async () => {
    let opts: { onFinish?: (e: { usage: { outputTokens: number } }) => void } = {};
    h.streamText.mockImplementation((o: typeof opts) => {
      opts = o;
      return { textStream: [] };
    });

    streamGenerate({ ...SEAM, messages: [{ role: 'user', content: 'hi' }] });
    opts.onFinish?.({ usage: { outputTokens: 12 } });
    await settle();

    expect(await h.db.select().from(aiUsage)).toHaveLength(0);
  });
});

// ===========================================================================
describe('telemetry is fire-and-forget', () => {
  it('a throwing telemetry layer does NOT fail the generation', async () => {
    h.telemetryThrows = true;
    h.generateText.mockResolvedValue({
      text: 'still fine',
      reasoning: [],
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 50, totalTokens: 55 },
    });

    await expect(generate({ ...SEAM, prompt: 'hi' })).resolves.toMatchObject({ text: 'still fine' });
  });

  it('a throwing telemetry layer does NOT surface out of a finished stream', async () => {
    h.telemetryThrows = true;
    let opts: { onFinish?: (e: { usage: { outputTokens: number } }) => void } = {};
    h.streamText.mockImplementation((o: typeof opts) => {
      opts = o;
      return { textStream: [] };
    });

    streamGenerate({ ...SEAM, messages: [{ role: 'user', content: 'hi' }] });
    expect(() => opts.onFinish?.({ usage: { outputTokens: 12 } })).not.toThrow();
  });
});

// ===========================================================================
describe('ring buffer', () => {
  it(`keeps at most ${RUNTIME_TELEMETRY_WINDOW} samples per provider+model`, async () => {
    for (let i = 1; i <= RUNTIME_TELEMETRY_WINDOW + 5; i++) {
      recordGeneration({
        providerName: 'builtin',
        model: 'gemma',
        outputTokens: i,
        elapsedMs: 1_000,
        streaming: false,
      });
    }
    const stats = (await getTelemetrySnapshot()).byModel['builtin:gemma'];
    expect(stats.samples).toBe(RUNTIME_TELEMETRY_WINDOW);
    // Oldest evicted: the newest sample is the 15th, and the window averages 6..15.
    expect(stats.lastTokensPerSecond).toBeCloseTo(15, 6);
    expect(stats.averageTokensPerSecond).toBeCloseTo(10.5, 6);
  });

  it('keys samples by provider AND model so two local models never blend', async () => {
    recordGeneration({ providerName: 'builtin', model: 'a', outputTokens: 10, elapsedMs: 1_000, streaming: false });
    recordGeneration({ providerName: 'builtin', model: 'b', outputTokens: 40, elapsedMs: 1_000, streaming: false });
    recordGeneration({ providerName: 'lmstudio', model: 'a', outputTokens: 80, elapsedMs: 1_000, streaming: false });

    const byModel = (await getTelemetrySnapshot()).byModel;
    expect(Object.keys(byModel).sort()).toEqual(['builtin:a', 'builtin:b', 'lmstudio:a']);
    expect(byModel['builtin:a'].averageTokensPerSecond).toBeCloseTo(10, 6);
    expect(byModel['lmstudio:a'].averageTokensPerSecond).toBeCloseTo(80, 6);
  });
});

// ===========================================================================
describe('OPTIONALITY GUARD — observing must never spawn', () => {
  it('never calls ensureRunning from any status, telemetry or snapshot path', async () => {
    registerAIProviderHandlers(win as never);

    await getRuntimeSnapshot();
    await getTelemetrySnapshot();
    await emitRuntimeStatus();
    recordGeneration({ providerName: 'builtin', model: 'gemma', outputTokens: 5, elapsedMs: 100, streaming: false });
    await handler('ai:get-runtime-snapshot')({});
    await handler('ai:check-builtin')({});
    h.changeListener?.();
    await settle();

    expect(h.ensureRunning).not.toHaveBeenCalled();
  });

  it('reads context usage only for an already-running sidecar, and degrades to null', async () => {
    h.readContextUsage.mockResolvedValue(null); // not running
    expect((await getTelemetrySnapshot()).context).toBeNull();

    h.readContextUsage.mockResolvedValue({ role: 'chat', usedTokens: 43, contextTokens: 16_384, processing: false });
    expect((await getTelemetrySnapshot()).context).toEqual({
      role: 'chat',
      usedTokens: 43,
      contextTokens: 16_384,
      processing: false,
    });
    expect(h.ensureRunning).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('combined pull payload', () => {
  it('reports configured=false when no builtin row exists, even though a binary shipped', async () => {
    const snapshot = await getRuntimeSnapshot();
    // binaryPresent is NOT the visibility signal — binaries ship with every install.
    expect(snapshot.binaryPresent).toBe(true);
    expect(snapshot.configured).toBe(false);
    expect(snapshot.runtime.running).toBe(false);
    expect(snapshot.telemetry).toEqual({ latest: null, byModel: {}, context: null });
  });

  it('reports configured=true only while an ENABLED builtin row exists', async () => {
    const [row] = await h.db.insert(aiProviders).values({ name: 'builtin', enabled: true }).returning();
    expect((await getRuntimeSnapshot()).configured).toBe(true);

    await h.db.update(aiProviders).set({ enabled: false });
    expect((await getRuntimeSnapshot()).configured).toBe(false);

    await h.db.delete(aiProviders);
    expect((await getRuntimeSnapshot()).configured).toBe(false);
    expect(row.name).toBe('builtin');
  });

  it('ignores an enabled row for a different provider', async () => {
    await h.db.insert(aiProviders).values({ name: 'openai', enabled: true });
    expect((await getRuntimeSnapshot()).configured).toBe(false);
  });
});

// ===========================================================================
describe('ai:runtime-status push channel', () => {
  it('pushes on a runtime lifecycle transition', async () => {
    expect(h.changeListener).toBeTypeOf('function');
    h.changeListener?.();

    await waitForPushes(1);
    expect(pushes()[0][1]).toMatchObject({ configured: false, binaryPresent: true });
  });

  it('pushes after each completed generation so tok/s is fresh', async () => {
    recordGeneration({
      providerName: 'builtin',
      model: 'gemma',
      outputTokens: 100,
      elapsedMs: 2_000,
      streaming: false,
    });

    await waitForPushes(1);
    expect(pushes()[0][1].telemetry.latest.tokensPerSecond).toBeCloseTo(50, 6);
  });

  it('pushes when a builtin provider row is created, enabled/disabled, and deleted', async () => {
    registerAIProviderHandlers(win as never);

    const created = (await handler('ai:create-provider')({}, { name: 'builtin' })) as { id: string };
    await waitForPushes(1);

    await handler('ai:update-provider')({}, created.id, { enabled: false });
    await waitForPushes(2);
    expect(pushes()[1][1].configured).toBe(false);

    await handler('ai:update-provider')({}, created.id, { enabled: true });
    await waitForPushes(3);
    expect(pushes()[2][1].configured).toBe(true);

    await handler('ai:delete-provider')({}, created.id);
    await waitForPushes(4);
    expect(pushes()[3][1].configured).toBe(false);
  });

  it('stays silent for provider CRUD that cannot change the indicator', async () => {
    registerAIProviderHandlers(win as never);

    const created = (await handler('ai:create-provider')({}, { name: 'openai' })) as { id: string };
    await handler('ai:update-provider')({}, created.id, { enabled: false });
    await handler('ai:delete-provider')({}, created.id);
    await settle();

    expect(pushes()).toHaveLength(0);
  });

  it('is best-effort: a destroyed window does not throw', async () => {
    stopRuntimeTelemetry();
    initRuntimeTelemetry({ isDestroyed: () => true, webContents: { send: vi.fn() } } as never);
    await expect(emitRuntimeStatus()).resolves.toBeUndefined();
  });
});
