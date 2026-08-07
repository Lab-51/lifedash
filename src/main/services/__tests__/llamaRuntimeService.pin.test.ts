// Recording-pin tests for the built-in llama sidecar (AI-RESIL.2 Task 2).
//
// The defect under test is the one Task 1's drain CANNOT reach: live_triage and the
// live assistant fire on CADENCE, so between two calls the chat role is momentarily
// idle with nothing in flight, and a different-model request landing in that gap swaps
// the session's model out — the next cadence call then pays a multi-GB cold reload.
// The pin holds the role for the whole recording; other models queue VISIBLY.
//
// Two layers are pinned here: the runtime semantics (queue / displace / FIFO / crash /
// stop / abort) and the lifecycle wiring that must never leak a pin past a recording's
// end by ANY exit path.
//
// The cadence tests deliberately reproduce the real in-process SEQUENCE
// (triage -> other-model request -> triage), not isolated ensureRunning calls — the
// 2026-08-06 lesson that a probe which does not reproduce the ordering proves nothing.
//
// FAKE TIMERS, narrowly: only setTimeout/clearTimeout, matching the swap suite, so the
// crash backoff and drain cap are drivable while setImmediate/Date stay real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Fake child process -------------------------------------------------------------
class FakeChild extends EventEmitter {
  pid = Math.floor(Math.random() * 100000) + 100;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killCount = 0;
  modelId = '';
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(signal?: string): boolean {
    this.killCount += 1;
    h.events.push(`stop:${this.modelId}`);
    this.simulateExit(0, signal ?? 'SIGTERM');
    return true;
  }

  simulateExit(code: number | null, signal: string | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

const h = vi.hoisted(() => ({
  spawnCalls: [] as { bin: string; args: string[] }[],
  children: [] as FakeChild[],
  /** Ordered start/stop transcript — the only way to prove the role never swapped. */
  events: [] as string[],
  logs: [] as string[],
  /** Task types resolveTaskModel was asked for, in order. */
  taskModelCalls: [] as string[],
  taskModel: null as null | {
    providerId: string;
    providerName: string;
    apiKeyEncrypted: string | null;
    baseUrl: string | null;
    model: string;
  },
  taskModelThrows: false,
  transcriptionStopFails: false,
}));

vi.mock('node:child_process', () => ({
  spawn: (bin: string, args: string[]) => {
    const child = new FakeChild();
    child.modelId = args[args.indexOf('--alias') + 1] ?? '?';
    h.spawnCalls.push({ bin, args });
    h.children.push(child);
    h.events.push(`start:${child.modelId}`);
    return child;
  },
}));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-llama-pin-'));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => tmpRoot, getPath: () => tmpRoot },
  BrowserWindow: class {},
}));
vi.mock('../logger', () => ({
  createLogger: () => ({
    info: (...parts: unknown[]) => h.logs.push(parts.join(' ')),
    warn: (...parts: unknown[]) => h.logs.push(parts.join(' ')),
    error: (...parts: unknown[]) => h.logs.push(parts.join(' ')),
    debug: vi.fn(),
  }),
  getLogDirectory: () => path.join(tmpRoot, 'logs'),
}));
vi.mock('../../db/connection', () => ({
  getDb: () => {
    throw new Error('no database in unit tests');
  },
}));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key' },
  aiProviders: { __table: 'aiProviders', id: 'id', enabled: 'enabled' },
  aiUsage: { __table: 'aiUsage' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

// The wiring's ONLY question of ai-provider is "which provider/model does the live
// assistant use", so that is all this stands in for. Mocking the module also keeps the
// whole AI SDK out of a test about process supervision.
vi.mock('../ai-provider', () => ({
  resolveTaskModel: async (taskType: string) => {
    h.taskModelCalls.push(taskType);
    if (h.taskModelThrows) throw new Error('no database');
    return h.taskModel;
  },
}));

vi.mock('../transcriptionService', () => ({
  setMainWindow: vi.fn(),
  start: vi.fn(async () => undefined),
  addChunk: vi.fn(),
  stop: vi.fn(async () => {
    if (h.transcriptionStopFails) throw new Error('transcription flush failed');
  }),
  getProgress: () => ({ currentSegment: 0, totalSegments: 0, backendUsed: 'test' }),
  getLastTranscript: () => '',
}));
vi.mock('../liveTriageService', () => ({
  setMainWindow: vi.fn(),
  startTriage: vi.fn(),
  stopTriage: vi.fn(),
}));

// --- Fixture layout -----------------------------------------------------------------
const binDir = path.join(tmpRoot, 'bin');
const modelsDir = path.join(tmpRoot, 'models');
/** Sorts first among the non-embedding fixtures, so it is also what `default` resolves to. */
const CHAT_MODEL = 'gemma-test-Q4_K_M';
const ALT_CHAT_MODEL = 'qwen-test-Q4_K_M';
const ALT2_CHAT_MODEL = 'phi-test-Q4_K_M';
const EMBED_MODEL = 'embeddinggemma-test-Q8_0';
const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

function writeFixtures(): void {
  fs.rmSync(binDir, { recursive: true, force: true });
  for (const backend of ['vulkan', 'cpu']) {
    fs.mkdirSync(path.join(binDir, backend), { recursive: true });
    fs.writeFileSync(path.join(binDir, backend, exe), '');
  }
  fs.mkdirSync(modelsDir, { recursive: true });
  for (const id of [CHAT_MODEL, ALT_CHAT_MODEL, ALT2_CHAT_MODEL, EMBED_MODEL]) {
    fs.writeFileSync(path.join(modelsDir, `${id}.gguf`), '');
  }
}

type Service = typeof import('../llamaRuntimeService');
type Audio = typeof import('../audioProcessor');

/** Fresh registry holding the runtime AND the recording lifecycle, so audioProcessor's
 *  pin calls land on the very llamaRuntimeService instance the assertions read. */
async function loadModules(): Promise<{ svc: Service; audio: Audio }> {
  vi.resetModules();
  const svc = await import('../llamaRuntimeService');
  const audio = await import('../audioProcessor');
  return { svc, audio };
}

/** A `live_assistant` routed to the built-in provider. */
function builtinTask(model: string) {
  return { providerId: 'p-builtin', providerName: 'builtin', apiKeyEncrypted: null, baseUrl: null, model };
}

/** Drain microtasks (and a few real event-loop turns) without touching the fake clock. */
async function flush(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((r) => setImmediate(r));
}

beforeEach(() => {
  h.spawnCalls.length = 0;
  h.children.length = 0;
  h.events.length = 0;
  h.logs.length = 0;
  h.taskModelCalls.length = 0;
  h.taskModel = null;
  h.taskModelThrows = false;
  h.transcriptionStopFails = false;
  writeFixtures();
  process.env.LIFEDASH_LLAMA_BIN_DIR = binDir;
  process.env.LIFEDASH_LLAMA_MODELS_DIR = modelsDir;
  process.env.LIFEDASH_LLAMA_IDLE_MINUTES = '0';
  process.env.LIFEDASH_LLAMA_HEALTH_TIMEOUT_MS = '2000';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response),
  );
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.LIFEDASH_LLAMA_BIN_DIR;
  delete process.env.LIFEDASH_LLAMA_MODELS_DIR;
  delete process.env.LIFEDASH_LLAMA_IDLE_MINUTES;
  delete process.env.LIFEDASH_LLAMA_HEALTH_TIMEOUT_MS;
});

// ------------------------------------------------------------------------------------
describe('the pinned model holds the chat role', () => {
  it('holds the session model across the cadence, with an other-model request in between', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);

    const triage1 = await svc.ensureRunning('chat', CHAT_MODEL); // cadence call 1
    const other = svc.ensureRunning('chat', ALT_CHAT_MODEL); // lands BETWEEN two calls
    await flush();
    const triage2 = await svc.ensureRunning('chat', CHAT_MODEL); // cadence call 2
    await flush();
    const triage3 = await svc.ensureRunning('chat', CHAT_MODEL); // cadence call 3

    expect(triage2.baseUrl).toBe(triage1.baseUrl);
    expect(triage3.baseUrl).toBe(triage1.baseUrl);
    expect(h.spawnCalls).toHaveLength(1);
    expect(h.events).toEqual([`start:${CHAT_MODEL}`]); // never stopped, never reloaded

    // ...and the other model is not lost, only deferred.
    svc.setChatModelPin(null);
    expect((await other).modelId).toBe(ALT_CHAT_MODEL);
    expect(h.events).toEqual([`start:${CHAT_MODEL}`, `stop:${CHAT_MODEL}`, `start:${ALT_CHAT_MODEL}`]);
  });

  it('queues a different-model request with an honest log instead of failing it', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    svc.setChatModelPin(CHAT_MODEL);

    const queued = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();
    expect(h.spawnCalls).toHaveLength(1);
    expect(h.children[0].killCount).toBe(0);
    expect(h.logs.join('\n')).toContain(
      `chat request for ${ALT_CHAT_MODEL} queued behind recording pin (${CHAT_MODEL})`,
    );

    svc.setChatModelPin(null);
    expect((await queued).modelId).toBe(ALT_CHAT_MODEL);
  });

  it('lets the pinned model displace a model already squatting the role', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', ALT_CHAT_MODEL); // stray model loaded before the pin
    svc.setChatModelPin(CHAT_MODEL);

    const endpoint = await svc.ensureRunning('chat', CHAT_MODEL);

    expect(endpoint.modelId).toBe(CHAT_MODEL);
    expect(h.events).toEqual([`start:${ALT_CHAT_MODEL}`, `stop:${ALT_CHAT_MODEL}`, `start:${CHAT_MODEL}`]);
    expect(h.logs.join('\n')).not.toContain('queued behind recording pin');
  });

  it('leaves the embedding role entirely alone', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);

    const endpoint = await svc.ensureRunning('embedding', EMBED_MODEL);

    expect(endpoint.modelId).toBe(EMBED_MODEL);
    expect(h.logs.join('\n')).not.toContain('queued behind recording pin');
  });

  it('wakes queued requests FIFO when the pin clears', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    svc.setChatModelPin(CHAT_MODEL);

    const order: string[] = [];
    const first = svc.ensureRunning('chat', ALT_CHAT_MODEL).then(() => order.push('alt'));
    const second = svc.ensureRunning('chat', ALT2_CHAT_MODEL).then(() => order.push('alt2'));
    await flush();
    expect(h.spawnCalls).toHaveLength(1);

    svc.setChatModelPin(null);
    await Promise.all([first, second]);

    expect(order).toEqual(['alt', 'alt2']);
    expect(h.events).toEqual([
      `start:${CHAT_MODEL}`,
      `stop:${CHAT_MODEL}`,
      `start:${ALT_CHAT_MODEL}`,
      `stop:${ALT_CHAT_MODEL}`,
      `start:${ALT2_CHAT_MODEL}`,
    ]);
  });

  it('is idempotent — re-pinning the same model changes nothing', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);
    svc.setChatModelPin(CHAT_MODEL);

    expect(svc.getChatModelPin()).toBe(CHAT_MODEL);
    expect(h.logs.filter((l) => l.includes('chat role pinned to')).length).toBe(1);
  });

  it('survives a crash of the pinned process — the restart comes back on the same model', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);
    await svc.ensureRunning('chat', CHAT_MODEL);

    h.children[0].simulateExit(1); // unexpected death wipes RoleState via emptyRole()
    expect(svc.getChatModelPin()).toBe(CHAT_MODEL); // ...but not the pin

    // and the pin still governs the now-free role
    const queued = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();
    expect(h.spawnCalls).toHaveLength(1);

    const restart = svc.ensureRunning('chat', CHAT_MODEL);
    await vi.advanceTimersByTimeAsync(1_500); // crash backoff
    expect((await restart).modelId).toBe(CHAT_MODEL);
    expect(h.spawnCalls).toHaveLength(2);

    svc.setChatModelPin(null);
    await queued;
  });
});

describe('stop() never leaves anything parked behind the pin', () => {
  it('clears the pin and rejects queued requests with a typed error, resurrecting nothing', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);
    await svc.ensureRunning('chat', CHAT_MODEL);
    const alt = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    const alt2 = svc.ensureRunning('chat', ALT2_CHAT_MODEL);
    await flush();

    await expect(svc.stop('chat')).resolves.toBeUndefined(); // no hang on quit

    // Structural match on the code, never on the user-facing prose (MEET-DEL.1).
    await expect(alt).rejects.toMatchObject({ code: 'LLAMA_RUNTIME_STOPPED' });
    await expect(alt2).rejects.toMatchObject({ code: 'LLAMA_RUNTIME_STOPPED' });
    expect(svc.getChatModelPin()).toBeNull();
    expect(h.spawnCalls).toHaveLength(1); // nothing was cold-started on the way out
    expect(svc.status().chat.running).toBe(false);
  });

  it('the shutdown stop-all clears the pin too', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);
    await svc.ensureRunning('chat', CHAT_MODEL);
    await svc.ensureRunning('embedding', EMBED_MODEL);
    const queued = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();

    await expect(svc.stop()).resolves.toBeUndefined();

    await expect(queued).rejects.toBeInstanceOf(svc.LlamaRuntimeStoppedError);
    expect(svc.getChatModelPin()).toBeNull();
    expect(svc.status().running).toBe(false);
  });
});

describe('an aborted request leaves the queue', () => {
  it('dequeues on abort, so clearing the pin does not resurrect it', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);
    await svc.ensureRunning('chat', CHAT_MODEL);

    const controller = new AbortController();
    const queued = svc.ensureRunning('chat', ALT_CHAT_MODEL, { abortSignal: controller.signal });
    await flush();
    controller.abort();

    await expect(queued).rejects.toThrow();

    svc.setChatModelPin(null);
    await flush();
    expect(h.spawnCalls).toHaveLength(1);
    expect(h.events).toEqual([`start:${CHAT_MODEL}`]); // the abandoned request never ran
  });

  it('never queues an already-aborted request', async () => {
    const { svc } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);

    const queued = svc.ensureRunning('chat', ALT_CHAT_MODEL, { abortSignal: AbortSignal.abort() });
    await expect(queued).rejects.toThrow();

    svc.setChatModelPin(null);
    await flush();
    expect(h.spawnCalls).toHaveLength(0);
  });
});

describe('recording lifecycle wiring', () => {
  it('a built-in live assistant pins the chat role for the whole recording', async () => {
    h.taskModel = builtinTask('default');
    const { svc, audio } = await loadModules();

    await audio.startRecording('meeting-default');

    expect(h.taskModelCalls).toEqual(['live_assistant']);
    expect(svc.getChatModelPin()).toBe(CHAT_MODEL); // the sentinel resolved to a real id

    await audio.stopRecording();
    expect(svc.getChatModelPin()).toBeNull();
  });

  it('pins the explicitly configured built-in model', async () => {
    h.taskModel = builtinTask(ALT_CHAT_MODEL);
    const { svc, audio } = await loadModules();

    await audio.startRecording('meeting-explicit');
    expect(svc.getChatModelPin()).toBe(ALT_CHAT_MODEL);

    await audio.stopRecording();
    expect(svc.getChatModelPin()).toBeNull();
  });

  it('never pins the runtime for a cloud live assistant', async () => {
    h.taskModel = {
      providerId: 'p-openai',
      providerName: 'openai',
      apiKeyEncrypted: null,
      baseUrl: null,
      model: 'gpt-5-mini',
    };
    const { svc, audio } = await loadModules();

    await audio.startRecording('meeting-cloud');
    expect(svc.getChatModelPin()).toBeNull();

    await audio.stopRecording();
    expect(svc.getChatModelPin()).toBeNull();
  });

  it('releases the pin when stopping the recording FAILS', async () => {
    h.taskModel = builtinTask('default');
    const { svc, audio } = await loadModules();
    await audio.startRecording('meeting-failure');
    expect(svc.getChatModelPin()).toBe(CHAT_MODEL);

    h.transcriptionStopFails = true;
    await expect(audio.stopRecording()).rejects.toThrow(/transcription flush failed/);

    expect(svc.getChatModelPin()).toBeNull();
  });

  it('releases the pin even when there is no recording to stop', async () => {
    const { svc, audio } = await loadModules();
    svc.setChatModelPin(CHAT_MODEL);

    await expect(audio.stopRecording()).rejects.toThrow(/Not currently recording/);

    expect(svc.getChatModelPin()).toBeNull();
  });

  it('leaves the recording unpinned rather than failing it when the provider cannot be resolved', async () => {
    h.taskModelThrows = true;
    const { svc, audio } = await loadModules();

    await expect(audio.startRecording('meeting-broken-config')).resolves.toBeUndefined();
    expect(svc.getChatModelPin()).toBeNull();

    await audio.stopRecording();
  });

  it('leaves the recording unpinned when no provider is configured at all', async () => {
    h.taskModel = null;
    const { svc, audio } = await loadModules();

    await audio.startRecording('meeting-no-provider');
    expect(svc.getChatModelPin()).toBeNull();

    await audio.stopRecording();
  });
});
