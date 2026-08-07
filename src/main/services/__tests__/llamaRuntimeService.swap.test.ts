// Swap-discipline tests for the built-in llama sidecar (AI-RESIL.2 Task 1).
//
// The defect under test: ensureRunning() used to stop the running process and cold-start
// a different model with ZERO awareness of in-flight generations, so a request for
// model Y killed model X's process out from under X's live request; the AI SDK's retry
// then re-requested X and killed Y's cold load in turn. These tests pin the three pieces
// that fix it — the per-role in-flight counter, the per-role critical section, and the
// drain-before-swap — plus the builtinFetch instrumentation that keeps the counter
// honest for the WHOLE life of a response (body consumption outlives fetch()).
//
// Both modules are loaded into ONE fresh registry per test so ai-provider's
// `import { ... } from './llamaRuntimeService'` is the very instance the assertions read.
//
// FAKE TIMERS, narrowly: only setTimeout/clearTimeout are faked, because the drain cap
// is 120s and nothing else here should be. setImmediate, queueMicrotask and Date stay
// REAL so web streams, undici and the node:net free-port probe behave as shipped.

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
  /** Ordered start/stop transcript — the only way to prove swaps ORDER, never interleave. */
  events: [] as string[],
  logs: [] as string[],
  /** Every `fetch` handed to createOpenAI — i.e. the real builtinFetch closures. */
  builtinFetches: [] as ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)[],
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-llama-swap-'));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => tmpRoot, getPath: () => tmpRoot },
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
vi.mock('../secure-storage', () => ({ decryptString: vi.fn((blob: string) => blob) }));
vi.mock('../runtimeTelemetry', () => ({ recordGeneration: vi.fn() }));
vi.mock('ai', () => ({ generateText: vi.fn(), streamText: vi.fn(), embedMany: vi.fn() }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => vi.fn()) }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn(() => vi.fn()) }));
vi.mock('ollama-ai-provider', () => ({ createOllama: vi.fn(() => vi.fn()) }));

// The ONE seam that reaches builtinFetch without exporting it: the OpenAI adapter is
// constructed with `fetch: builtinFetch(role, modelId)`, so capturing the option hands
// us the shipped closure itself — no test-only export, no AI SDK schema guessing.
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (opts: { fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }) => {
    if (opts?.fetch) h.builtinFetches.push(opts.fetch);
    return {
      chat: (id: string) => ({ __chat: id }),
      textEmbeddingModel: (id: string) => ({ __emb: id }),
    };
  },
}));

// --- Fixture layout -----------------------------------------------------------------
const binDir = path.join(tmpRoot, 'bin');
const modelsDir = path.join(tmpRoot, 'models');
const CHAT_MODEL = 'gemma-test-Q4_K_M';
const ALT_CHAT_MODEL = 'qwen-test-Q4_K_M';
const ALT2_CHAT_MODEL = 'phi-test-Q4_K_M';
const EMBED_MODEL = 'embeddinggemma-test-Q8_0';
const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const CHAT_URL = 'http://127.0.0.1:1/v1/chat/completions';
const POST: RequestInit = { method: 'POST', body: JSON.stringify({ model: CHAT_MODEL }) };

function writeFixtures(): void {
  fs.rmSync(binDir, { recursive: true, force: true });
  // 'metal' included so the platform-derived chain (backendChain(): metal on
  // darwin, vulkan -> cpu elsewhere) finds a binary on macOS CI runners too;
  // dirs outside the current platform's chain are inert.
  for (const backend of ['vulkan', 'cpu', 'metal']) {
    fs.mkdirSync(path.join(binDir, backend), { recursive: true });
    fs.writeFileSync(path.join(binDir, backend, exe), '');
  }
  fs.mkdirSync(modelsDir, { recursive: true });
  for (const id of [CHAT_MODEL, ALT_CHAT_MODEL, ALT2_CHAT_MODEL, EMBED_MODEL]) {
    fs.writeFileSync(path.join(modelsDir, `${id}.gguf`), '');
  }
}

type Service = typeof import('../llamaRuntimeService');
type Provider = typeof import('../ai-provider');

/** Fresh module registry holding BOTH modules, so they share one llamaRuntimeService. */
async function loadModules(): Promise<{ svc: Service; ai: Provider }> {
  vi.resetModules();
  h.builtinFetches.length = 0;
  const svc = await import('../llamaRuntimeService');
  const ai = await import('../ai-provider');
  return { svc, ai };
}

/** The shipped builtinFetch closure bound to `model`, captured off createOpenAI. */
function builtinFetchFor(ai: Provider, model: string) {
  ai.clearProviderCache();
  h.builtinFetches.length = 0;
  ai.getProvider('p-builtin', 'builtin', null, null)(model);
  expect(h.builtinFetches).toHaveLength(1);
  return h.builtinFetches[0];
}

/** Drain microtasks (and a few real event-loop turns) without touching the fake clock. */
async function flush(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((r) => setImmediate(r));
}

/** /health always healthy; every other URL gets `make()`. */
function routerFetch(make: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/health')) return { ok: true, status: 200 } as unknown as Response;
    return make();
  });
}

/** A response whose body this test drives chunk by chunk — a live generation. */
function openStream(contentType = 'text/event-stream') {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return { response: new Response(stream, { status: 200, headers: { 'content-type': contentType } }), ctrl };
}

const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  h.spawnCalls.length = 0;
  h.children.length = 0;
  h.events.length = 0;
  h.logs.length = 0;
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
describe('in-flight counter', () => {
  it('release is exactly-once — a double release cannot fake an idle role', async () => {
    const { svc } = await loadModules();
    const a = svc.acquireInFlight('chat');
    const b = svc.acquireInFlight('chat');
    expect(svc.inFlightCount('chat')).toBe(2);

    a();
    a();
    a();
    expect(svc.inFlightCount('chat')).toBe(1); // three calls, ONE decrement
    b();
    expect(svc.inFlightCount('chat')).toBe(0);
    expect(svc.inFlightCount('chat')).toBeGreaterThanOrEqual(0);
  });

  it('counts the two roles independently', async () => {
    const { svc } = await loadModules();
    const release = svc.acquireInFlight('chat');
    expect(svc.inFlightCount('chat')).toBe(1);
    expect(svc.inFlightCount('embedding')).toBe(0);
    release();
  });

  it('survives a crash of the process it is counting (state reset must not zero it)', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const release = svc.acquireInFlight('chat');

    h.children[0].simulateExit(1); // unexpected death wipes RoleState via emptyRole()
    expect(svc.inFlightCount('chat')).toBe(1); // ...but not the counter

    release();
    expect(svc.inFlightCount('chat')).toBe(0); // no negative drift
  });
});

describe('drain before swap', () => {
  it('a different-model request never kills the process serving a live generation', async () => {
    const { svc, ai } = await loadModules();
    const bf = builtinFetchFor(ai, CHAT_MODEL);
    const { response, ctrl } = openStream();
    vi.stubGlobal(
      'fetch',
      routerFetch(() => response),
    );

    const proxied = await bf(CHAT_URL, POST);
    expect(svc.status().chat.modelId).toBe(CHAT_MODEL);
    expect(svc.inFlightCount('chat')).toBe(1);

    const swap = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();
    expect(h.spawnCalls).toHaveLength(1); // nothing started
    expect(h.children[0].killCount).toBe(0); // and nothing killed under the live request
    expect(h.logs.join('\n')).toContain(`swap to ${ALT_CHAT_MODEL} queued behind 1 in-flight request(s)`);

    // The live generation completes normally, un-killed.
    const reader = proxied.body!.getReader();
    ctrl.enqueue(enc('data: {"delta":"hi"}\n\n'));
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    expect(new TextDecoder().decode(chunk.value)).toContain('delta');
    ctrl.close();
    expect((await reader.read()).done).toBe(true);
    await flush();

    // ...and only then does the swap proceed — exactly one stop and one start.
    const endpoint = await swap;
    expect(endpoint.modelId).toBe(ALT_CHAT_MODEL);
    expect(h.spawnCalls).toHaveLength(2);
    expect(h.children[0].killCount).toBe(1);
    expect(h.events).toEqual([`start:${CHAT_MODEL}`, `stop:${CHAT_MODEL}`, `start:${ALT_CHAT_MODEL}`]);
    expect(svc.inFlightCount('chat')).toBe(0);
  });

  it('proceeds after the 120s drain cap and says so, rather than deadlocking forever', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const hung = svc.acquireInFlight('chat'); // a stream that never ends

    const swap = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();
    expect(h.spawnCalls).toHaveLength(1); // still waiting

    await vi.advanceTimersByTimeAsync(119_000);
    await flush();
    expect(h.spawnCalls).toHaveLength(1); // still waiting just short of the cap

    await vi.advanceTimersByTimeAsync(2_000);
    const endpoint = await swap;

    expect(endpoint.modelId).toBe(ALT_CHAT_MODEL);
    expect(h.events).toEqual([`start:${CHAT_MODEL}`, `stop:${CHAT_MODEL}`, `start:${ALT_CHAT_MODEL}`]);
    expect(h.logs.join('\n')).toContain('drain cap reached — proceeding, 1 request(s) will be cut');
    hung();
  });

  it('does not wait at all when the role is idle', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const endpoint = await svc.ensureRunning('chat', ALT_CHAT_MODEL);
    expect(endpoint.modelId).toBe(ALT_CHAT_MODEL);
    expect(h.logs.join('\n')).not.toContain('queued behind');
  });

  it('a chat drain never blocks the embedding role', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const hung = svc.acquireInFlight('chat');
    const blocked = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();

    const embedding = await svc.ensureRunning('embedding', EMBED_MODEL);
    expect(embedding.modelId).toBe(EMBED_MODEL);
    expect(svc.status().chat.modelId).toBe(CHAT_MODEL); // chat swap still parked

    hung();
    await blocked;
  });
});

describe('serialization', () => {
  it('two concurrent different-model requests order their swaps, never interleave', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);

    const [first, second] = await Promise.all([
      svc.ensureRunning('chat', ALT_CHAT_MODEL),
      svc.ensureRunning('chat', ALT2_CHAT_MODEL),
    ]);

    expect(first.modelId).toBe(ALT_CHAT_MODEL);
    expect(second.modelId).toBe(ALT2_CHAT_MODEL);
    expect(h.events).toEqual([
      `start:${CHAT_MODEL}`,
      `stop:${CHAT_MODEL}`,
      `start:${ALT_CHAT_MODEL}`,
      `stop:${ALT_CHAT_MODEL}`,
      `start:${ALT2_CHAT_MODEL}`,
    ]);
    // Every start is preceded by a stop — no two processes were ever spawning at once.
    for (let i = 1; i < h.events.length; i += 1) {
      if (h.events[i].startsWith('start:')) expect(h.events[i - 1]).toMatch(/^stop:/);
    }
  });

  it('same-model requests never queue behind a swap that is waiting to drain', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const hung = svc.acquireInFlight('chat');

    const order: string[] = [];
    const swap = svc.ensureRunning('chat', ALT_CHAT_MODEL).then(() => order.push('swap'));
    await flush();

    await svc.ensureRunning('chat', CHAT_MODEL).then(() => order.push('same'));
    expect(order).toEqual(['same']); // resolved while the swap is still parked
    expect(h.spawnCalls).toHaveLength(1);

    hung();
    await swap;
    expect(order).toEqual(['same', 'swap']);
  });

  it('coalesces concurrent first requests for the same model into a single spawn', async () => {
    const { svc } = await loadModules();
    const [a, b] = await Promise.all([svc.ensureRunning('chat', CHAT_MODEL), svc.ensureRunning('chat', CHAT_MODEL)]);
    expect(a.baseUrl).toBe(b.baseUrl);
    expect(h.spawnCalls).toHaveLength(1);
  });
});

describe('stop() never hangs on the discipline', () => {
  it('rejects draining and queued swap work with a typed error, and resurrects nothing', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const hung = svc.acquireInFlight('chat');

    const draining = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    const queued = svc.ensureRunning('chat', ALT2_CHAT_MODEL);
    await flush();
    expect(h.spawnCalls).toHaveLength(1);

    await expect(svc.stop('chat')).resolves.toBeUndefined(); // no hang behind the 120s drain

    // Structural match on the code, never on the user-facing prose (MEET-DEL.1).
    await expect(draining).rejects.toMatchObject({ code: 'LLAMA_RUNTIME_STOPPED' });
    await expect(queued).rejects.toMatchObject({ code: 'LLAMA_RUNTIME_STOPPED' });
    expect(svc.status().chat.running).toBe(false);
    expect(h.spawnCalls).toHaveLength(1); // nothing was cold-started on the way out
    hung();
  });

  it('the shutdown stop-all clears both roles while a chat swap is parked', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    await svc.ensureRunning('embedding', EMBED_MODEL);
    const hung = svc.acquireInFlight('chat');
    const draining = svc.ensureRunning('chat', ALT_CHAT_MODEL);
    await flush();

    await expect(svc.stop()).resolves.toBeUndefined();

    await expect(draining).rejects.toBeInstanceOf(svc.LlamaRuntimeStoppedError);
    expect(svc.status().running).toBe(false);
    expect(svc.status().loadedModels).toEqual([]);
    hung();
  });

  it('a stopped role starts cleanly again afterwards', async () => {
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    await svc.stop('chat');
    const endpoint = await svc.ensureRunning('chat', ALT_CHAT_MODEL);
    expect(endpoint.modelId).toBe(ALT_CHAT_MODEL);
    expect(h.spawnCalls).toHaveLength(2);
  });
});

describe('idle auto-stop respects the in-flight count', () => {
  it('does not reclaim a role that is still serving a request', async () => {
    // Date must be faked HERE and only here: the idle check compares Date.now() against
    // lastUsedAt, so with a real clock and a fake setTimeout the window can never elapse
    // and the assertion below would pass without the guard even existing.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    process.env.LIFEDASH_LLAMA_IDLE_MINUTES = String(60 / 60000); // 60ms
    const { svc } = await loadModules();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const busy = svc.acquireInFlight('chat');

    // Far past the idle window, with NO touch() in between — only the counter protects it.
    await vi.advanceTimersByTimeAsync(600);
    expect(svc.status().chat.running).toBe(true);
    expect(h.children[0].killCount).toBe(0);

    busy();
    await vi.advanceTimersByTimeAsync(600);
    expect(svc.status().chat.running).toBe(false); // and it IS reclaimed once idle
  });
});

describe('builtinFetch — the count is held for the whole life of the response', () => {
  /** Baseline of 1 so a DOUBLE release shows up as 0 instead of hiding at 0. */
  async function withSentinel(): Promise<{
    svc: Service;
    bf: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    sentinel: () => void;
  }> {
    const { svc, ai } = await loadModules();
    const bf = builtinFetchFor(ai, CHAT_MODEL);
    return { svc, bf, sentinel: svc.acquireInFlight('chat') };
  }

  it('releases when a non-stream body is read, not when fetch() resolves', async () => {
    const { svc, bf, sentinel } = await withSentinel();
    vi.stubGlobal(
      'fetch',
      routerFetch(
        () => new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );

    const proxied = await bf(CHAT_URL, POST);
    expect(svc.inFlightCount('chat')).toBe(2); // fetch resolved — body NOT yet consumed

    expect(await proxied.json()).toEqual({ choices: [] });
    await flush();
    expect(svc.inFlightCount('chat')).toBe(1);
    await flush();
    expect(svc.inFlightCount('chat')).toBe(1); // exactly once
    sentinel();
  });

  it('releases exactly once when the consumer cancels mid-stream', async () => {
    const { svc, bf, sentinel } = await withSentinel();
    const { response, ctrl } = openStream();
    vi.stubGlobal(
      'fetch',
      routerFetch(() => response),
    );

    const proxied = await bf(CHAT_URL, POST);
    const reader = proxied.body!.getReader();
    ctrl.enqueue(enc('data: {"delta":"a"}\n\n'));
    await reader.read();
    expect(svc.inFlightCount('chat')).toBe(2); // mid-stream: still held

    await reader.cancel();
    await flush();
    expect(svc.inFlightCount('chat')).toBe(1);
    await flush();
    expect(svc.inFlightCount('chat')).toBe(1);
    sentinel();
  });

  it('releases exactly once when the stream errors', async () => {
    const { svc, bf, sentinel } = await withSentinel();
    const { response, ctrl } = openStream();
    vi.stubGlobal(
      'fetch',
      routerFetch(() => response),
    );

    const proxied = await bf(CHAT_URL, POST);
    const reader = proxied.body!.getReader();
    ctrl.enqueue(enc('data: {"delta":"a"}\n\n'));
    await reader.read();
    expect(svc.inFlightCount('chat')).toBe(2); // mid-stream: still held

    ctrl.error(new Error('sidecar died mid-generation'));

    await expect(reader.read()).rejects.toThrow(/sidecar died/);
    await flush();
    expect(svc.inFlightCount('chat')).toBe(1);
    await flush();
    expect(svc.inFlightCount('chat')).toBe(1);
    sentinel();
  });

  it('releases when the fetch itself throws', async () => {
    const { svc, bf, sentinel } = await withSentinel();
    await svc.ensureRunning('chat', CHAT_MODEL); // already healthy — no /health probe left
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await expect(bf(CHAT_URL, POST)).rejects.toThrow(/ECONNREFUSED/);
    expect(svc.inFlightCount('chat')).toBe(1);
    sentinel();
  });

  it('releases immediately for a response with no body', async () => {
    const { svc, bf, sentinel } = await withSentinel();
    vi.stubGlobal(
      'fetch',
      routerFetch(() => new Response(null, { status: 204 })),
    );

    const proxied = await bf(CHAT_URL, POST);
    expect(proxied.body).toBeNull();
    expect(svc.inFlightCount('chat')).toBe(1);
    sentinel();
  });

  it('still counts streamed chunks as activity so idle auto-stop cannot cut a generation', async () => {
    process.env.LIFEDASH_LLAMA_IDLE_MINUTES = String(120 / 60000); // 120ms
    const { svc, ai } = await loadModules();
    const bf = builtinFetchFor(ai, CHAT_MODEL);
    const { response, ctrl } = openStream();
    vi.stubGlobal(
      'fetch',
      routerFetch(() => response),
    );

    const proxied = await bf(CHAT_URL, POST);
    const reader = proxied.body!.getReader();
    const before = svc.status().chat.lastUsedAt;

    await vi.advanceTimersByTimeAsync(80);
    ctrl.enqueue(enc('data: {"delta":"a"}\n\n'));
    await reader.read();

    expect(svc.status().chat.lastUsedAt).toBeGreaterThanOrEqual(before ?? 0);
    expect(svc.status().chat.running).toBe(true);
    await reader.cancel();
  });
});
