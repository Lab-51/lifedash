// Lifecycle tests for the llama-server sidecar supervisor (LOCAL-RT.1 Task 2).
// Covers the load-bearing guarantees: NOTHING spawns until a routed request asks
// for it, the two roles are independently lazy, ports are probed, health failures
// fall back vulkan -> cpu, crashes are capped, and idle processes free their VRAM.
//
// child_process is mocked (no real llama-server is started here); node:net and
// node:fs are REAL so the free-port probe and binary/model resolution are exercised
// as shipped. The real sidecar is covered by the dev-mode manual check.

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
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(signal?: string): boolean {
    this.killCount += 1;
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
  /** Per-spawn hook: return true to let the child stay alive (healthy start). */
  onSpawn: null as null | ((child: FakeChild, index: number) => void),
}));

vi.mock('node:child_process', () => ({
  spawn: (bin: string, args: string[]) => {
    const child = new FakeChild();
    h.spawnCalls.push({ bin, args });
    h.children.push(child);
    h.onSpawn?.(child, h.children.length - 1);
    return child;
  },
}));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-llama-'));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => tmpRoot,
    getPath: () => tmpRoot,
  },
}));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getLogDirectory: () => path.join(tmpRoot, 'logs'),
}));
vi.mock('../../db/connection', () => ({
  getDb: () => {
    throw new Error('no database in unit tests');
  },
}));

// --- Fixture layout -----------------------------------------------------------------
const binDir = path.join(tmpRoot, 'bin');
const modelsDir = path.join(tmpRoot, 'models');
const CHAT_MODEL = 'gemma-test-Q4_K_M';
const EMBED_MODEL = 'embeddinggemma-test-Q8_0';
const ALT_CHAT_MODEL = 'qwen-test-Q4_K_M';
const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

function writeFixtures(backends: string[]): void {
  fs.rmSync(binDir, { recursive: true, force: true });
  for (const backend of backends) {
    fs.mkdirSync(path.join(binDir, backend), { recursive: true });
    fs.writeFileSync(path.join(binDir, backend, exe), '');
  }
  fs.mkdirSync(modelsDir, { recursive: true });
  for (const id of [CHAT_MODEL, EMBED_MODEL, ALT_CHAT_MODEL]) {
    fs.writeFileSync(path.join(modelsDir, `${id}.gguf`), '');
  }
}

/** Health responder: 200 for every /health probe unless overridden. */
function healthyFetch() {
  return vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);
}

type Service = typeof import('../llamaRuntimeService');

async function loadService(): Promise<Service> {
  vi.resetModules();
  return import('../llamaRuntimeService');
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

beforeEach(() => {
  h.spawnCalls.length = 0;
  h.children.length = 0;
  h.onSpawn = null;
  writeFixtures(['vulkan', 'cpu']);
  process.env.LIFEDASH_LLAMA_BIN_DIR = binDir;
  process.env.LIFEDASH_LLAMA_MODELS_DIR = modelsDir;
  process.env.LIFEDASH_LLAMA_IDLE_MINUTES = '0'; // disabled unless a test opts in
  process.env.LIFEDASH_LLAMA_HEALTH_TIMEOUT_MS = '2000';
  vi.stubGlobal('fetch', healthyFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LIFEDASH_LLAMA_BIN_DIR;
  delete process.env.LIFEDASH_LLAMA_MODELS_DIR;
  delete process.env.LIFEDASH_LLAMA_IDLE_MINUTES;
  delete process.env.LIFEDASH_LLAMA_HEALTH_TIMEOUT_MS;
  delete process.env.LIFEDASH_LLAMA_BIN;
});

// ------------------------------------------------------------------------------------
describe('optionality — nothing runs until a request asks for it', () => {
  it('spawns nothing on import, status() or availability checks', async () => {
    const svc = await loadService();
    const snapshot = svc.status();
    expect(svc.isBinaryAvailable()).toBe(true);
    expect(svc.listAvailableModels().map((m) => m.id)).toContain(CHAT_MODEL);
    expect(snapshot.running).toBe(false);
    expect(snapshot.chat.running).toBe(false);
    expect(snapshot.embedding.running).toBe(false);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('stop() on a runtime that was never started is a no-op', async () => {
    const svc = await loadService();
    await expect(svc.stop()).resolves.toBeUndefined();
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('reports binaryAvailable=false without spawning when no binary is installed', async () => {
    writeFixtures([]);
    const svc = await loadService();
    expect(svc.isBinaryAvailable()).toBe(false);
    await expect(svc.ensureRunning('chat')).rejects.toThrow(/not installed/i);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('refuses to start with a clear message when the model is not downloaded', async () => {
    const svc = await loadService();
    await expect(svc.ensureRunning('chat', 'not-downloaded')).rejects.toThrow(/not downloaded/i);
    expect(h.spawnCalls).toHaveLength(0);
  });
});

describe('lazy start, port probe and flags', () => {
  it('starts one process on the first request and returns its probed port', async () => {
    const svc = await loadService();
    const endpoint = await svc.ensureRunning('chat');

    expect(h.spawnCalls).toHaveLength(1);
    const { bin, args } = h.spawnCalls[0];
    expect(bin).toBe(path.join(binDir, 'vulkan', exe));

    const port = Number(argValue(args, '--port'));
    expect(port).toBeGreaterThan(1024);
    expect(endpoint.baseUrl).toBe(`http://127.0.0.1:${port}/v1`);
    expect(endpoint.modelId).toBe(CHAT_MODEL);
    expect(endpoint.backend).toBe('vulkan');
    expect(endpoint.apiKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(svc.status().running).toBe(true);
  });

  it('gives each spawn its own port and its own api key', async () => {
    const svc = await loadService();
    const chat = await svc.ensureRunning('chat');
    const embed = await svc.ensureRunning('embedding');
    expect(chat.baseUrl).not.toBe(embed.baseUrl);
    expect(chat.apiKey).not.toBe(embed.apiKey);
  });

  it('passes the chat flag set: bounded context, one slot, jinja, no --device', async () => {
    const svc = await loadService();
    await svc.ensureRunning('chat');
    const { args } = h.spawnCalls[0];

    expect(argValue(args, '-m')).toBe(path.join(modelsDir, `${CHAT_MODEL}.gguf`));
    expect(argValue(args, '--alias')).toBe(CHAT_MODEL);
    expect(argValue(args, '--host')).toBe('127.0.0.1');
    expect(Number(argValue(args, '--ctx-size'))).toBeGreaterThan(0);
    expect(argValue(args, '--parallel')).toBe('1');
    expect(args).toContain('--jinja');
    expect(args).toContain('--no-webui');
    expect(argValue(args, '--cors-origins')).toBe('localhost');
    expect(argValue(args, '--api-key')).toBeTruthy();
    // Chat must NOT get --embeddings (it would disable completions), and --device is
    // deliberately left to llama.cpp's own device fitting.
    expect(args).not.toContain('--embeddings');
    expect(args).not.toContain('--device');
  });

  it('passes the embedding flag set: --embeddings and a full-context ubatch', async () => {
    const svc = await loadService();
    const endpoint = await svc.ensureRunning('embedding');
    const { args } = h.spawnCalls[0];

    expect(endpoint.modelId).toBe(EMBED_MODEL);
    expect(argValue(args, '-m')).toBe(path.join(modelsDir, `${EMBED_MODEL}.gguf`));
    expect(args).toContain('--embeddings');
    expect(Number(argValue(args, '--ubatch-size'))).toBeGreaterThanOrEqual(2048);
    // Context sizing is a chat-only concern; the embedding model's own limit applies.
    expect(args).not.toContain('--ctx-size');
  });

  it('honours the LIFEDASH_LLAMA_CTX override', async () => {
    process.env.LIFEDASH_LLAMA_CTX = '4096';
    try {
      const svc = await loadService();
      await svc.ensureRunning('chat');
      expect(argValue(h.spawnCalls[0].args, '--ctx-size')).toBe('4096');
    } finally {
      delete process.env.LIFEDASH_LLAMA_CTX;
    }
  });
});

describe('role isolation and model switching', () => {
  it('starting chat does not start the embedding process (and vice versa)', async () => {
    const svc = await loadService();
    await svc.ensureRunning('chat');
    expect(h.spawnCalls).toHaveLength(1);
    expect(svc.status().embedding.running).toBe(false);

    await svc.ensureRunning('embedding');
    expect(h.spawnCalls).toHaveLength(2);
    expect(svc.status().chat.running).toBe(true);
    expect(svc.status().embedding.running).toBe(true);
    expect(svc.status().loadedModels).toEqual([CHAT_MODEL, EMBED_MODEL]);
  });

  it('reuses a running process for repeated requests', async () => {
    const svc = await loadService();
    const first = await svc.ensureRunning('chat');
    const second = await svc.ensureRunning('chat', CHAT_MODEL);
    expect(second.baseUrl).toBe(first.baseUrl);
    expect(h.spawnCalls).toHaveLength(1);
  });

  it('coalesces concurrent first requests into a single spawn', async () => {
    const svc = await loadService();
    const [a, b] = await Promise.all([svc.ensureRunning('chat'), svc.ensureRunning('chat')]);
    expect(a.baseUrl).toBe(b.baseUrl);
    expect(h.spawnCalls).toHaveLength(1);
  });

  it('stops the running process before loading a different model for the same role', async () => {
    const svc = await loadService();
    await svc.ensureRunning('chat', CHAT_MODEL);
    const switched = await svc.ensureRunning('chat', ALT_CHAT_MODEL);

    expect(h.spawnCalls).toHaveLength(2);
    expect(h.children[0].killCount).toBeGreaterThan(0);
    expect(switched.modelId).toBe(ALT_CHAT_MODEL);
    expect(argValue(h.spawnCalls[1].args, '-m')).toBe(path.join(modelsDir, `${ALT_CHAT_MODEL}.gguf`));
  });
});

describe('health gating and backend fallback', () => {
  it('fails with a timeout error and kills the child when /health never succeeds', async () => {
    process.env.LIFEDASH_LLAMA_HEALTH_TIMEOUT_MS = '250';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const svc = await loadService();
    await expect(svc.ensureRunning('chat')).rejects.toThrow(/healthy/i);
    for (const child of h.children) expect(child.killCount).toBeGreaterThan(0);
    expect(svc.status().running).toBe(false);
  });

  it('falls back vulkan -> cpu when the GPU build exits during startup, and remembers it', async () => {
    h.onSpawn = (child, index) => {
      if (index === 0) child.simulateExit(1); // vulkan build dies before ever reporting healthy
    };
    const svc = await loadService();
    const endpoint = await svc.ensureRunning('chat');

    expect(h.spawnCalls[0].bin).toBe(path.join(binDir, 'vulkan', exe));
    expect(h.spawnCalls[1].bin).toBe(path.join(binDir, 'cpu', exe));
    expect(endpoint.backend).toBe('cpu');
    expect(svc.status().backend).toBe('cpu');

    // Remembered: the next role does not retry the known-bad vulkan build.
    h.onSpawn = null;
    await svc.ensureRunning('embedding');
    expect(h.spawnCalls).toHaveLength(3);
    expect(h.spawnCalls[2].bin).toBe(path.join(binDir, 'cpu', exe));
  });

  it('uses the LIFEDASH_LLAMA_BIN override when set', async () => {
    const pinned = path.join(binDir, 'cpu', exe);
    process.env.LIFEDASH_LLAMA_BIN = pinned;
    const svc = await loadService();
    await svc.ensureRunning('chat');
    expect(h.spawnCalls[0].bin).toBe(pinned);
  });
});

describe('crash handling', () => {
  it('restarts after a crash and refuses once the restart cap is exhausted', async () => {
    const svc = await loadService();
    for (let attempt = 0; attempt < 4; attempt++) {
      await svc.ensureRunning('chat');
      h.children[h.children.length - 1].simulateExit(1); // unexpected death
    }
    expect(h.spawnCalls).toHaveLength(4);
    await expect(svc.ensureRunning('chat')).rejects.toThrow(/crashed/i);
    expect(h.spawnCalls).toHaveLength(4); // capped — no 5th spawn
  }, 30000);

  it('does not count an explicit stop as a crash', async () => {
    const svc = await loadService();
    await svc.ensureRunning('chat');
    await svc.stop('chat');
    expect(svc.status().chat.crashes).toBe(0);
    await svc.ensureRunning('chat');
    expect(h.spawnCalls).toHaveLength(2);
  });
});

describe('idle auto-stop', () => {
  it('stops an idle process to free memory once the idle window passes', async () => {
    process.env.LIFEDASH_LLAMA_IDLE_MINUTES = String(60 / 60000); // 60ms
    const svc = await loadService();
    await svc.ensureRunning('chat');
    expect(svc.status().chat.running).toBe(true);

    await vi.waitFor(() => expect(svc.status().chat.running).toBe(false), { timeout: 2000 });
    expect(h.children[0].killCount).toBeGreaterThan(0);
  });

  it('never stops when the idle setting is 0', async () => {
    process.env.LIFEDASH_LLAMA_IDLE_MINUTES = '0';
    const svc = await loadService();
    await svc.ensureRunning('chat');
    await new Promise((r) => setTimeout(r, 120));
    expect(svc.status().chat.running).toBe(true);
    expect(svc.status().idleStopMinutes).toBe(0);
  });

  it('touch() keeps a busy process alive past the idle window', async () => {
    process.env.LIFEDASH_LLAMA_IDLE_MINUTES = String(80 / 60000); // 80ms
    const svc = await loadService();
    await svc.ensureRunning('chat');
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 30));
      svc.touch('chat');
    }
    expect(svc.status().chat.running).toBe(true);
    await svc.stop();
  });
});

describe('shutdown', () => {
  it('stop() terminates every role and clears status', async () => {
    const svc = await loadService();
    await svc.ensureRunning('chat');
    await svc.ensureRunning('embedding');
    await svc.stop();

    for (const child of h.children) expect(child.killCount).toBeGreaterThan(0);
    const snapshot = svc.status();
    expect(snapshot.running).toBe(false);
    expect(snapshot.loadedModels).toEqual([]);
  });

  it('writes sidecar output to a rotating per-role log file', async () => {
    const svc = await loadService();
    await svc.ensureRunning('chat');
    h.children[0].stderr.emit('data', Buffer.from('srv llama_server: listening\n'));
    await svc.stop();
    const logFile = path.join(tmpRoot, 'logs', 'llama-chat.log');
    await vi.waitFor(() => expect(fs.readFileSync(logFile, 'utf8')).toContain('listening'));
  });
});
