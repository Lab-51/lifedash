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
//   That swap is serialized and drain-aware (see "Swap discipline"), so two
//   configured chat models are SLOW (a cold reload per alternation) but never
//   fatal. One chat model for every chat task remains the correct configuration.
// - While a recording pins the chat role (see "Recording pin"), a chat request for
//   any OTHER model WAITS rather than swapping, so it can complete after the session
//   ends. That starvation is an accepted, logged trade-off — not a bug.
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
/** Longest a model swap waits for in-flight requests to finish before cutting them.
 *  A hung stream must never deadlock every future local call; a cut request surfaces
 *  as a network error, which classifyBriefFailure already renders readably. */
const DRAIN_CAP_MS = 120_000;
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

// --- Swap discipline ---------------------------------------------------------------
// A request for model Y used to kill model X's process out from under X's live
// generation: ensureRunning() stopped and cold-started with ZERO awareness of
// in-flight work, the AI SDK's retry re-requested X, and X's restart killed Y's cold
// load in turn — a ping-pong of mutual kills that produced repeating failures even
// where each individual load would have fit the health window. Three pieces fix it:
// an in-flight counter per role, a per-role async critical section so cross-model
// requests ORDER instead of interleaving stop()/spawn, and a drain wait before any
// swap. Same-model requests are unaffected: they take the fast path outside the
// section and llama-server serves them itself.
//
// The counters live OUTSIDE RoleState deliberately. RoleState is reset wholesale via
// emptyRole() on exit/stop, which would zero a counter whose releases are still
// outstanding and drive it negative — and a negative count reads as "idle", re-opening
// the exact kill window this discipline exists to close.

const inFlight: Record<LlamaRole, number> = { chat: 0, embedding: 0 };
const drainWaiters: Record<LlamaRole, (() => void)[]> = { chat: [], embedding: [] };
/** Tail of each role's critical section — serializes check / drain / stop / start. */
const swapChain: Record<LlamaRole, Promise<unknown>> = { chat: Promise.resolve(), embedding: Promise.resolve() };
/** Bumped by every explicit stop(). Swap work enqueued before the bump abandons rather
 *  than resurrecting a process the user (or app shutdown) just asked to go away. */
const stopEpoch: Record<LlamaRole, number> = { chat: 0, embedding: 0 };

/** Rejection handed to swap work cancelled by stop()/shutdown. Carries a stable `code`
 *  so callers and tests match it STRUCTURALLY, never on the user-facing prose. */
export class LlamaRuntimeStoppedError extends Error {
  readonly code = 'LLAMA_RUNTIME_STOPPED';
  constructor(role: LlamaRole) {
    super(`The built-in ${role} runtime was stopped before this request could start.`);
    this.name = 'LlamaRuntimeStoppedError';
  }
}

/** Requests currently being served by `role`. Read-only observability seam. */
export function inFlightCount(role: LlamaRole): number {
  return inFlight[role];
}

/**
 * Mark one request as in flight on `role` and get its release back. The release is
 * EXACTLY-ONCE: a second call is a no-op. That guard is load-bearing — a double
 * release would drop the count to zero under a live request and let a swap kill the
 * process serving it, which is precisely the bug this discipline exists to prevent.
 */
export function acquireInFlight(role: LlamaRole): () => void {
  inFlight[role] += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight[role] -= 1;
    if (inFlight[role] === 0) wakeDrainWaiters(role);
  };
}

function wakeDrainWaiters(role: LlamaRole): void {
  for (const wake of drainWaiters[role].splice(0)) wake();
}

/**
 * Block until `role` has no in-flight request, or until DRAIN_CAP_MS elapses. Resolves
 * either way — the caller re-checks whether it may still proceed. Both outcomes are
 * logged: a silent 2-minute wait would look identical to a hang.
 */
function waitForDrain(role: LlamaRole, targetModelId: string): Promise<void> {
  if (inFlight[role] === 0) return Promise.resolve();
  log.info(`${role} sidecar swap to ${targetModelId} queued behind ${inFlight[role]} in-flight request(s)`);
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (capped: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (capped) log.warn(`${role} sidecar drain cap reached — proceeding, ${inFlight[role]} request(s) will be cut`);
      resolve();
    };
    drainWaiters[role].push(() => finish(false));
    timer = setTimeout(() => finish(true), DRAIN_CAP_MS);
    timer.unref?.();
  });
}

/** Run `fn` in `role`'s critical section — exactly one swap per role at a time. A
 *  rejected predecessor never poisons the chain. */
function runExclusive<T>(role: LlamaRole, fn: () => Promise<T>): Promise<T> {
  const run = swapChain[role].then(fn, fn);
  swapChain[role] = run.catch(() => undefined);
  return run;
}

function assertNotStopped(role: LlamaRole, epoch: number): void {
  if (stopEpoch[role] !== epoch) throw new LlamaRuntimeStoppedError(role);
}

// --- Recording pin ------------------------------------------------------------------
// `live_triage` / `live_assistant` fire on CADENCE during a recording, so BETWEEN two
// calls the chat role is momentarily idle — and the drain above only protects requests
// that are currently IN FLIGHT. A different-model request landing in that gap swaps the
// session's model out and makes the next cadence call pay a multi-GB cold reload. The
// pin closes that gap: while it is set, only the pinned model may take the chat role.
//
// QUEUE, not fail-fast (user decision 2026-08-07): a mid-meeting regenerate finishing
// AFTER the session is the accepted trade-off. The job here is to make the wait VISIBLE
// in the log, not to make it shorter.
//
// The pin lives at module scope for exactly the reason the in-flight counters do:
// emptyRole() wipes RoleState on a crash, and a crash-restart mid-recording must come
// back on the SAME model.
//
// This module stays TASK-IGNORANT — it knows nothing about recordings, tasks or
// providers. Who sets and clears the pin is recordingModelPin.ts, and the import
// direction is strictly one-way into here.

interface PinWaiter {
  modelId: string;
  resolve: () => void;
  reject: (err: unknown) => void;
  /** Detach the abort listener, if any. Safe to call more than once. */
  dispose: () => void;
}

let pinnedChatModel: string | null = null;
let pinWaiters: PinWaiter[] = [];

/** True when `modelId` may NOT take the chat role right now. */
function pinBlocks(modelId: string): boolean {
  return pinnedChatModel !== null && pinnedChatModel.toLowerCase() !== modelId.toLowerCase();
}

/**
 * Hold the chat role on `modelId` until cleared with null. IDEMPOTENT — re-setting the
 * same pin does nothing, so a double recording-start changes nothing.
 *
 * The pinned model itself is never held back: ensureRunning('chat', pinned) runs the
 * normal drain-aware discipline and may displace a model that was already squatting the
 * role when the pin was set. Every OTHER chat model waits (see pinGate).
 */
export function setChatModelPin(modelId: string | null): void {
  if (pinnedChatModel === modelId) return;
  pinnedChatModel = modelId;
  log.info(modelId ? `chat role pinned to ${modelId} for this recording` : 'chat role pin released');
  releaseAllowedWaiters();
}

/** The model the chat role is pinned to, or null. Read-only observability seam. */
export function getChatModelPin(): string | null {
  return pinnedChatModel;
}

/** Wake every waiter the current pin now allows, in FIFO order; the rest stay queued.
 *  Resolving in arrival order is what makes them enter runExclusive in arrival order. */
function releaseAllowedWaiters(): void {
  const blocked: PinWaiter[] = [];
  const allowed: PinWaiter[] = [];
  for (const waiter of pinWaiters) (pinBlocks(waiter.modelId) ? blocked : allowed).push(waiter);
  pinWaiters = blocked;
  for (const waiter of allowed) {
    waiter.dispose();
    waiter.resolve();
  }
}

function dequeuePinWaiter(waiter: PinWaiter): void {
  const at = pinWaiters.indexOf(waiter);
  if (at >= 0) pinWaiters.splice(at, 1);
  waiter.dispose();
}

/**
 * Park a chat request for a non-pinned model until the pin clears. Returns null — no
 * promise and no extra microtask — whenever the request may proceed: every embedding
 * request, every request while unpinned, and the pinned model's own requests.
 *
 * `signal` is consulted ONLY here, because this queue is the only place a request can
 * wait unboundedly; the swap path itself is deliberately left unchanged.
 */
function pinGate(role: LlamaRole, modelId: string, signal?: AbortSignal): Promise<void> | null {
  if (role !== 'chat' || !pinBlocks(modelId)) return null;
  log.info(`chat request for ${modelId} queued behind recording pin (${pinnedChatModel})`);
  return new Promise<void>((resolve, reject) => {
    const waiter: PinWaiter = { modelId, resolve, reject, dispose: () => undefined };
    if (signal) {
      const onAbort = (): void => {
        dequeuePinWaiter(waiter);
        reject(signal.reason ?? new Error(`chat request for ${modelId} was aborted while queued`));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      waiter.dispose = () => signal.removeEventListener('abort', onAbort);
    }
    pinWaiters.push(waiter);
  });
}

/**
 * stop()/shutdown: drop the pin and fail everything parked behind it with the same typed
 * error cancelled swap work gets. REJECTING is deliberate — resolving the waiters would
 * let them re-enter the swap path after the epoch bump and cold-start a process the app
 * just asked to go away. An idle reclaim goes through stopRole() and never comes here,
 * so the pin survives one.
 */
function clearPinOnStop(): void {
  if (pinnedChatModel !== null) log.info('chat role pin released (runtime stopped)');
  pinnedChatModel = null;
  for (const waiter of pinWaiters.splice(0)) {
    waiter.dispose();
    waiter.reject(new LlamaRuntimeStoppedError('chat'));
  }
}

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
    // Never reclaim a role that is still serving requests. touch() already keeps a busy
    // process alive, but the in-flight count is the GUARANTEE — not a side effect of a
    // caller remembering to touch.
    if (idleFor < state.idleMs || inFlight[role] > 0) {
      scheduleIdleStop(role);
      return;
    }
    log.info(`${role} idle for ${Math.round(idleFor / 1000)}s — stopping to free memory`);
    void stopRole(role); // not stop(): an idle reclaim must not reject queued swap work
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
 *
 * `opts.abortSignal` is additive and optional: it cancels a wait behind the recording
 * pin (the only unbounded wait here), never a swap already under way.
 */
export async function ensureRunning(
  role: LlamaRole,
  modelId?: string,
  opts?: { abortSignal?: AbortSignal },
): Promise<LlamaEndpoint> {
  const model = resolveModel(role, modelId);
  // Recording pin: a non-pinned chat model waits HERE, before and outside the critical
  // section, so a queued request can never hold the section against the pinned model's
  // own swap. Null (the overwhelmingly common case) costs nothing.
  const gate = pinGate(role, model.modelId, opts?.abortSignal);
  if (gate) await gate;
  // Same-model fast path, deliberately OUTSIDE the critical section: requests for the
  // model already loaded must stay concurrent and must never queue behind someone
  // else's swap. llama-server serves them itself (see --parallel in llamaRuntimeConfig).
  const running = runningEndpoint(role, model.modelPath);
  if (running) {
    touch(role);
    return running;
  }
  const epoch = stopEpoch[role];
  return runExclusive(role, () => swapInto(role, model, epoch));
}

/** Live endpoint for `role` IF its process already serves `modelPath`, else null. */
function runningEndpoint(role: LlamaRole, modelPath: string): LlamaEndpoint | null {
  const s = roles[role];
  if (!s.child || s.modelPath !== modelPath) return null;
  if (!s.baseUrl || !s.apiKey || !s.backend || !s.modelId) return null;
  return { baseUrl: s.baseUrl, modelId: s.modelId, backend: s.backend, apiKey: s.apiKey };
}

/**
 * The serialized half of ensureRunning: re-check, drain, stop, start. Exactly one of
 * these runs per role at a time, which is what makes two concurrent different-model
 * requests ORDER instead of interleaving stop()/spawn into a mutual kill.
 */
async function swapInto(
  role: LlamaRole,
  model: { modelId: string; modelPath: string },
  epoch: number,
): Promise<LlamaEndpoint> {
  assertNotStopped(role, epoch);
  const state = roles[role];
  // A request that queued ahead of us may already have loaded exactly this model.
  const running = runningEndpoint(role, model.modelPath);
  if (running) {
    touch(role);
    return running;
  }
  if (state.child) {
    log.info(`${role} sidecar switching model ${state.modelId} -> ${model.modelId}`);
    await waitForDrain(role, model.modelId);
    assertNotStopped(role, epoch); // stopped while we waited — do not resurrect it
    await stopRole(role);
  }
  const pending = startWithFallback(role, model);
  state.starting = pending;
  try {
    return await pending;
  } finally {
    if (state.starting === pending) state.starting = null;
  }
}

/** Terminate one role's process. Internal: does NOT cancel queued swap work, so the
 *  swap path and the idle reclaim can use it without cancelling themselves. */
async function stopRole(role: LlamaRole): Promise<void> {
  const state = roles[role];
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
}

/**
 * Stop one role, or every role when omitted. Graceful, then SIGKILL. Safe to call twice.
 * NEVER waits on the swap discipline: it cancels queued and draining swap work up front
 * (typed LlamaRuntimeStoppedError) so app shutdown can never hang behind a 120s drain —
 * and for the same reason it drops the recording pin and rejects everything queued
 * behind it.
 */
export async function stop(role?: LlamaRole): Promise<void> {
  const targets: LlamaRole[] = role ? [role] : ['chat', 'embedding'];
  for (const r of targets) {
    stopEpoch[r] += 1;
    wakeDrainWaiters(r); // a swap parked on a drain re-checks the epoch and abandons
  }
  if (targets.includes('chat')) clearPinOnStop();
  await Promise.all(targets.map(stopRole));
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
