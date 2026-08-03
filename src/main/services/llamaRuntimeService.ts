// === FILE PURPOSE ===
// Supervisor for the bundled llama.cpp `llama-server` sidecar that backs the
// `builtin` AI provider: lazy spawn, /health gating, backend fallback, crash
// backoff, idle auto-stop, rotating logs and graceful shutdown. Where the binaries
// and models live and which flags each role gets is llamaRuntimeConfig.ts.
//
// TOPOLOGY: TWO independent processes, not one. llama-server gates /v1/embeddings
// behind the `--embeddings` startup flag and router mode inherits CLI flags
// uniformly, so a single process cannot serve chat AND embeddings (Task 1 spike:
// HTTP 501, verified with a negative control). Each role therefore gets its own
// process on its own probed port, started independently and lazily.
//
// HARD RULE — OPTIONALITY: nothing in this module runs at import time or at app
// boot. A process only ever spawns from an explicit ensureRunning() call made by
// a routed request. A user who never selects the built-in provider never spawns,
// never downloads, and never sees a behavior change.
//
// === DEPENDENCIES ===
// node:child_process, node:crypto, node:fs, node:path, ./llamaRuntimeConfig
//
// === LIMITATIONS ===
// - One process per role: requesting a different model for a role stops the
//   running one first (VRAM is the scarce resource — whisper shares the GPU).
// - A backend that fails to start is remembered for the rest of the session.
//
// === VERIFICATION STATUS ===
// - GET /health -> HTTP 200 {"status":"ok"} once the model is loaded; HTTP 503
//   while still loading, and it is reachable without the API key — verified by
//   running the binary (llama.cpp b10219).

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger, getLogDirectory } from './logger';
import {
  LLAMA_HOST,
  binaryCandidates,
  buildArgs,
  findFreePort,
  isBinaryAvailable,
  resolveModel,
} from './llamaRuntimeConfig';
import { DEFAULT_IDLE_STOP_MINUTES, LOCAL_AI_IDLE_SETTING_KEY } from '../../shared/types/ai';
import type {
  LlamaBackend,
  LlamaContextUsage,
  LlamaRole,
  LlamaRoleStatus,
  LlamaRuntimeStatus,
} from '../../shared/types/ai';

export {
  getBinaryDir,
  getModelsDir,
  binaryCandidates,
  isBinaryAvailable,
  listAvailableModels,
} from './llamaRuntimeConfig';
export type { LlamaBackend, LlamaContextUsage, LlamaRole, LlamaRoleStatus, LlamaRuntimeStatus };

const log = createLogger('llama');

/** What a routed request needs to talk to the sidecar. Never persisted — the port is dynamic. */
export interface LlamaEndpoint {
  /** OpenAI-compatible base, already ending in /v1. */
  baseUrl: string;
  /** The model id the process was started with; equals its `--alias`, so it is
   *  also the id that must be sent as `model`. */
  modelId: string;
  backend: LlamaBackend;
  /** Per-spawn bearer token (`--api-key`). Locks the loopback port to this app. */
  apiKey: string;
}

// --- Tunables ----------------------------------------------------------------------
const HEALTH_POLL_MS = 400;
const DEFAULT_HEALTH_TIMEOUT_MS = 180_000; // cold load of a multi-GB GGUF + shader compile
const STOP_GRACE_MS = 3_000;
const MAX_CRASH_RESTARTS = 3;
const CRASH_WINDOW_MS = 5 * 60_000;
const CRASH_BACKOFF_MS = [1_000, 2_000, 4_000];
const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** `/slots` is a loopback read of an already-running process — fail fast, never hang a poll. */
const SLOTS_TIMEOUT_MS = 1_500;
// Shared with the renderer's Settings → Local AI control, so both agree on the
// key and the "never written" default instead of duplicating the literals.
const IDLE_SETTING_KEY = LOCAL_AI_IDLE_SETTING_KEY;

// --- Module state ------------------------------------------------------------------
interface RoleState {
  child: ChildProcess | null;
  baseUrl: string | null;
  modelId: string | null;
  modelPath: string | null;
  apiKey: string | null;
  backend: LlamaBackend | null;
  pid: number | null;
  lastUsedAt: number | null;
  starting: Promise<LlamaEndpoint> | null;
  stopRequested: boolean;
  crashes: number;
  lastCrashAt: number;
  idleMs: number;
  idleTimer: NodeJS.Timeout | null;
  logStream: fs.WriteStream | null;
  logBytes: number;
}

function emptyRole(): RoleState {
  return {
    child: null,
    baseUrl: null,
    modelId: null,
    modelPath: null,
    apiKey: null,
    backend: null,
    pid: null,
    lastUsedAt: null,
    starting: null,
    stopRequested: false,
    crashes: 0,
    lastCrashAt: 0,
    idleMs: 0,
    idleTimer: null,
    logStream: null,
    logBytes: 0,
  };
}

const roles: Record<LlamaRole, RoleState> = { chat: emptyRole(), embedding: emptyRole() };
/** Backends that failed to start this session — tried once, then skipped (whisper's pattern). */
const failedBackends = new Set<LlamaBackend>();
let lastGoodBackend: LlamaBackend | null = null;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

// --- Lifecycle observation ------------------------------------------------------------
// A single callback slot rather than an import of the telemetry layer: the observer
// (runtimeTelemetry) already depends on this module for status()/readContextUsage(),
// so importing it back would create a module cycle. Observation is strictly one-way
// and MUST NOT be able to affect the runtime — notifyChange swallows everything.

let changeListener: (() => void) | null = null;

/** Register the observer notified on real lifecycle transitions (start / stop / crash
 *  / model swap). Pass null to clear. Purely informational — see notifyChange. */
export function setRuntimeChangeListener(listener: (() => void) | null): void {
  changeListener = listener;
}

function notifyChange(): void {
  try {
    changeListener?.();
  } catch (err) {
    log.warn('runtime change listener threw (ignored):', (err as Error).message);
  }
}

// --- Rotating log ---------------------------------------------------------------------------

function openLog(role: LlamaRole, state: RoleState): void {
  try {
    const dir = getLogDirectory();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `llama-${role}.log`);
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      /* first run — no file yet */
    }
    if (size > MAX_LOG_BYTES) {
      try {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      } catch {
        /* rotation is best-effort */
      }
      size = 0;
    }
    state.logStream = fs.createWriteStream(file, { flags: 'a' });
    state.logBytes = size;
  } catch (err) {
    log.warn(`could not open ${role} log file:`, (err as Error).message);
    state.logStream = null;
  }
}

function writeLog(state: RoleState, chunk: string): void {
  if (!state.logStream) return;
  state.logBytes += chunk.length;
  if (state.logBytes > MAX_LOG_BYTES) {
    // Stop growing mid-session rather than filling the disk; the .1 rotation on the
    // next start keeps this session's tail.
    state.logStream.write('[log truncated — size limit reached]\n');
    state.logStream.end();
    state.logStream = null;
    return;
  }
  state.logStream.write(chunk);
}

function closeLog(state: RoleState): void {
  state.logStream?.end();
  state.logStream = null;
  state.logBytes = 0;
}

// --- Idle auto-stop ---------------------------------------------------------------------------

async function readIdleSetting(): Promise<number> {
  try {
    const db = getDb();
    const [row] = await db.select().from(settings).where(eq(settings.key, IDLE_SETTING_KEY));
    return row ? Number(row.value) : DEFAULT_IDLE_STOP_MINUTES;
  } catch {
    return DEFAULT_IDLE_STOP_MINUTES; // no DB yet (or read failed) — use the default, never block
  }
}

/** Idle window in ms. Setting-gated (`localAI.idleStopMinutes`, 0 = never stop). */
async function readIdleMs(): Promise<number> {
  const env = process.env.LIFEDASH_LLAMA_IDLE_MINUTES;
  const raw = env !== undefined ? Number(env) : await readIdleSetting();
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_IDLE_STOP_MINUTES;
  return minutes * 60_000;
}

function scheduleIdleStop(role: LlamaRole): void {
  const state = roles[role];
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;
  if (state.idleMs <= 0 || !state.child) return;
  state.idleTimer = setTimeout(() => {
    const idleFor = Date.now() - (state.lastUsedAt ?? 0);
    if (idleFor >= state.idleMs) {
      log.info(`${role} idle for ${Math.round(idleFor / 1000)}s — stopping to free memory`);
      void stop(role);
    } else {
      scheduleIdleStop(role);
    }
  }, state.idleMs);
  state.idleTimer.unref?.();
}

/** Mark the role as active. Called on every routed request (and every streamed chunk). */
export function touch(role: LlamaRole): void {
  const state = roles[role];
  if (!state.child) return;
  state.lastUsedAt = Date.now();
  scheduleIdleStop(role);
}

// --- Health ----------------------------------------------------------------------------------

function healthTimeoutMs(): number {
  const override = Number(process.env.LIFEDASH_LLAMA_HEALTH_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_HEALTH_TIMEOUT_MS;
}

/**
 * Poll GET /health until the model is loaded. Fails fast when the child exits
 * (llama-server answers 503 while loading, so a dead process is the only real
 * failure short of the timeout).
 */
async function waitForHealth(child: ChildProcess, port: number, apiKey: string): Promise<void> {
  const deadline = Date.now() + healthTimeoutMs();
  const url = `http://${LLAMA_HOST}:${port}/health`;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`llama-server exited during startup (code ${child.exitCode ?? child.signalCode})`);
    }
    try {
      const resp = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
      if (resp.ok) return;
      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await delay(HEALTH_POLL_MS);
  }
  throw new Error(`llama-server did not become healthy within ${healthTimeoutMs()}ms (last: ${lastError})`);
}

// --- Process lifecycle -------------------------------------------------------------------------

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, STOP_GRACE_MS);
    timer.unref?.();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function handleExit(role: LlamaRole, child: ChildProcess, code: number | null, signal: string | null): void {
  const state = roles[role];
  if (state.child !== child) return; // superseded by a newer process
  const requested = state.stopRequested;
  closeLog(state);
  if (state.idleTimer) clearTimeout(state.idleTimer);
  Object.assign(state, emptyRole(), {
    crashes: requested ? 0 : state.crashes + 1,
    lastCrashAt: requested ? 0 : Date.now(),
    backend: state.backend,
  });
  if (!requested) {
    log.error(`${role} sidecar exited unexpectedly (code ${code}, signal ${signal}) — crash ${state.crashes}`);
  }
  notifyChange(); // crashed, or finished shutting down
}

/** Gate a (re)start after a crash: exponential backoff, hard cap inside the window. */
async function applyCrashBackoff(role: LlamaRole): Promise<void> {
  const state = roles[role];
  if (state.crashes === 0) return;
  if (Date.now() - state.lastCrashAt > CRASH_WINDOW_MS) {
    state.crashes = 0;
    return;
  }
  if (state.crashes > MAX_CRASH_RESTARTS) {
    throw new Error(
      `The built-in AI runtime crashed ${state.crashes} times. See llama-${role}.log; try a smaller model or restart the app.`,
    );
  }
  await delay(CRASH_BACKOFF_MS[Math.min(state.crashes, CRASH_BACKOFF_MS.length) - 1]);
}

async function spawnRole(
  role: LlamaRole,
  candidate: { backend: LlamaBackend; binPath: string },
  model: { modelId: string; modelPath: string },
): Promise<LlamaEndpoint> {
  const state = roles[role];
  const port = await findFreePort();
  const apiKey = randomUUID();
  const args = buildArgs(role, model.modelPath, model.modelId, port, apiKey);

  log.info(`starting ${role} sidecar (${candidate.backend}) model=${model.modelId} port=${port}`);
  const child = spawn(candidate.binPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  Object.assign(state, {
    child,
    pid: child.pid ?? null,
    modelId: model.modelId,
    modelPath: model.modelPath,
    baseUrl: `http://${LLAMA_HOST}:${port}/v1`,
    apiKey,
    backend: candidate.backend,
    stopRequested: false,
    lastUsedAt: Date.now(),
  });
  openLog(role, state);
  child.stdout?.on('data', (d: Buffer) => writeLog(state, d.toString()));
  child.stderr?.on('data', (d: Buffer) => writeLog(state, d.toString()));
  child.on('error', (err) => log.error(`${role} sidecar spawn error:`, err.message));
  child.on('exit', (code, signal) => handleExit(role, child, code, signal));

  try {
    await waitForHealth(child, port, apiKey);
  } catch (err) {
    state.stopRequested = true; // a failed start is not a crash — don't burn a restart
    await killChild(child);
    if (state.child === child) Object.assign(state, emptyRole(), { backend: state.backend });
    throw err;
  }

  lastGoodBackend = candidate.backend;
  state.idleMs = await readIdleMs();
  touch(role);
  log.info(`${role} sidecar ready on ${state.baseUrl} (${candidate.backend})`);
  notifyChange(); // started (a model swap surfaces as the preceding stop + this start)
  return { baseUrl: state.baseUrl!, modelId: model.modelId, backend: candidate.backend, apiKey };
}

/** Try each installed backend in order (vulkan -> cpu), remembering what failed. */
async function startWithFallback(
  role: LlamaRole,
  model: { modelId: string; modelPath: string },
): Promise<LlamaEndpoint> {
  const candidates = binaryCandidates();
  if (candidates.length === 0) {
    throw new Error('The built-in AI runtime is not installed with this build. Use LM Studio/Ollama or reinstall.');
  }
  await applyCrashBackoff(role);
  const usable = candidates.filter((c) => !failedBackends.has(c.backend));
  let lastError: unknown = new Error('No usable llama-server backend');
  for (const candidate of usable.length > 0 ? usable : candidates) {
    try {
      return await spawnRole(role, candidate, model);
    } catch (err) {
      lastError = err;
      // Remember the failure only while a fallback remains, so a single transient
      // failure on the only available backend never pins the session.
      if (candidate.backend !== 'cpu' && candidates.length > 1) failedBackends.add(candidate.backend);
      log.warn(`${role} sidecar failed on ${candidate.backend}: ${(err as Error).message}`);
    }
  }
  throw lastError;
}

// --- Public surface ------------------------------------------------------------------------------

/**
 * Resolve a live endpoint for `role`, starting the sidecar if needed. THE ONLY
 * thing that ever spawns a process — never called at boot, only from a routed
 * request (see ai-provider.ts's `builtin` case).
 *
 * `modelId` selects a downloaded GGUF; omitted, the role's first suitable model is
 * used. Roles are independent: asking for chat never starts the embedding process.
 * Asking a role for a different model swaps it (one process per role — VRAM).
 */
export async function ensureRunning(role: LlamaRole, modelId?: string): Promise<LlamaEndpoint> {
  const state = roles[role];
  const model = resolveModel(role, modelId);

  if (state.starting) {
    const endpoint = await state.starting.catch(() => null);
    if (endpoint && state.modelPath === model.modelPath) {
      touch(role);
      return endpoint;
    }
  }
  if (state.child && state.modelPath === model.modelPath && state.baseUrl && state.apiKey && state.backend) {
    touch(role);
    return { baseUrl: state.baseUrl, modelId: state.modelId!, backend: state.backend, apiKey: state.apiKey };
  }
  if (state.child) {
    log.info(`${role} sidecar switching model ${state.modelId} -> ${model.modelId}`);
    await stop(role);
  }

  const pending = startWithFallback(role, model);
  state.starting = pending;
  try {
    return await pending;
  } finally {
    if (state.starting === pending) state.starting = null;
  }
}

/** Stop one role, or every role when omitted. Graceful, then SIGKILL. Safe to call twice. */
export async function stop(role?: LlamaRole): Promise<void> {
  const targets: LlamaRole[] = role ? [role] : ['chat', 'embedding'];
  await Promise.all(
    targets.map(async (r) => {
      const state = roles[r];
      const child = state.child;
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.idleTimer = null;
      if (!child) return;
      state.stopRequested = true;
      await killChild(child);
      if (state.child === child) {
        closeLog(state);
        Object.assign(state, emptyRole(), { backend: state.backend });
      }
    }),
  );
}

function roleStatus(state: RoleState): LlamaRoleStatus {
  return {
    running: !!state.child,
    starting: !!state.starting,
    modelId: state.modelId,
    baseUrl: state.baseUrl,
    pid: state.pid,
    lastUsedAt: state.lastUsedAt,
    crashes: state.crashes,
  };
}

/** Snapshot for Settings / detection IPC. Pure read — never starts anything. */
export function status(): LlamaRuntimeStatus {
  const chat = roleStatus(roles.chat);
  const embedding = roleStatus(roles.embedding);
  return {
    running: chat.running || embedding.running,
    backend: lastGoodBackend,
    binaryAvailable: isBinaryAvailable(),
    loadedModels: [chat.modelId, embedding.modelId].filter((m): m is string => !!m),
    chat,
    embedding,
    idleStopMinutes: Math.round((roles.chat.idleMs || roles.embedding.idleMs) / 60_000),
  };
}

/** Pick the busiest slot from a `/slots` body. Only `id`/`n_ctx`/`is_processing` are
 *  always present; `n_prompt_tokens` appears once the slot has served a request
 *  (verified against b10219 — see LlamaContextUsage). Unknown shapes yield null. */
function readSlots(role: LlamaRole, body: unknown): LlamaContextUsage | null {
  if (!Array.isArray(body)) return null;
  let best: LlamaContextUsage | null = null;
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') continue;
    const slot = raw as { n_ctx?: unknown; n_prompt_tokens?: unknown; is_processing?: unknown };
    if (typeof slot.n_ctx !== 'number' || slot.n_ctx <= 0) continue;
    const used = typeof slot.n_prompt_tokens === 'number' ? slot.n_prompt_tokens : 0;
    if (best && best.usedTokens >= used) continue;
    best = { role, usedTokens: used, contextTokens: slot.n_ctx, processing: slot.is_processing === true };
  }
  return best;
}

/**
 * Context (KV cache) utilisation of an ALREADY-RUNNING sidecar, from llama-server's
 * `/slots` endpoint (enabled by default in b10219; it requires the per-spawn bearer
 * token, verified — 401 without it, which is why this lives here and not in the
 * telemetry layer: the key never leaves this module).
 *
 * OPTIONALITY GUARD: returns null when the role is not running. It must never call
 * ensureRunning() — observing is not a reason to spawn a process.
 * Never throws: a failed read degrades to null.
 */
export async function readContextUsage(role: LlamaRole = 'chat'): Promise<LlamaContextUsage | null> {
  const state = roles[role];
  if (!state.child || !state.baseUrl || !state.apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLOTS_TIMEOUT_MS);
  timer.unref?.();
  try {
    const url = `${state.baseUrl.replace(/\/v1$/, '')}/slots`;
    const resp = await fetch(url, {
      headers: { authorization: `Bearer ${state.apiKey}` },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    return readSlots(role, await resp.json());
  } catch {
    return null; // sidecar shutting down, endpoint disabled, or timed out — not an error
  } finally {
    clearTimeout(timer);
  }
}
