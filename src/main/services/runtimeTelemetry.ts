// === FILE PURPOSE ===
// Runtime telemetry for LOCAL-RT.2: how fast is the model the user picked actually
// going, and how much of its context is in use. Holds a small in-memory ring buffer
// of tok/s measurements recorded at the SINGLE provider seam (ai-provider.ts), builds
// the combined status snapshot the renderer pulls, and pushes 'ai:runtime-status' so
// no consumer has to poll.
//
// === WHY THE SEAM ===
// Every provider funnels through one factory path in ai-provider.ts, so one
// measurement point covers builtin, LM Studio, Ollama AND cloud — and it cannot drift
// from what actually ran. The AI SDK strips llama.cpp's own `timings` block (verified:
// only `usage` + `usage.raw` token counts survive), so tok/s is computed from
// wall-clock elapsed / usage.outputTokens instead of read from the server.
//
// === HARD RULES ===
// - OBSERVING MUST NEVER SPAWN. Nothing here calls ensureRunning(); status() and
//   readContextUsage() are pure reads that return "not running" rather than start
//   anything. This is LOCAL-RT.1's optionality guarantee and it is asserted by test.
// - Telemetry is fire-and-forget: recordGeneration() never throws, and the push is
//   best-effort. A telemetry failure must never fail a generation.
// - No table, no migration: samples live in memory for the session, by design.
//
// === DEPENDENCIES ===
// electron (BrowserWindow), drizzle-orm, ../db/connection, ./llamaRuntimeService

import type { BrowserWindow } from 'electron';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiProviders } from '../db/schema';
import { createLogger } from './logger';
import { readContextUsage, setRuntimeChangeListener, status } from './llamaRuntimeService';
import { RUNTIME_TELEMETRY_WINDOW } from '../../shared/types/ai';
import type {
  AIProviderName,
  LlamaRuntimeSnapshot,
  RuntimeGenerationSample,
  RuntimeModelStats,
  RuntimeTelemetrySnapshot,
} from '../../shared/types/ai';

const log = createLogger('AI');

/** Push channel carrying a full {@link LlamaRuntimeSnapshot}. Same payload as the
 *  `ai:get-runtime-snapshot` pull, so a consumer handles exactly one shape. */
export const RUNTIME_STATUS_CHANNEL = 'ai:runtime-status';

/** What the seam hands us for one completed generation. */
export interface GenerationTiming {
  providerName: AIProviderName;
  model: string;
  outputTokens: number;
  /** Wall clock around the model call. */
  elapsedMs: number;
  /** Time to first streamed token, or null for non-streaming calls. */
  ttftMs?: number | null;
  streaming: boolean;
}

// --- Ring buffer -------------------------------------------------------------------
// Keyed by `${providerName}:${model}` so a user comparing two local models sees each
// one's own rate. Bounded at RUNTIME_TELEMETRY_WINDOW per key.

const samples = new Map<string, RuntimeGenerationSample[]>();
let latest: RuntimeGenerationSample | null = null;

function keyFor(providerName: string, model: string): string {
  return `${providerName}:${model}`;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function statsFor(list: RuntimeGenerationSample[]): RuntimeModelStats {
  const newest = list[list.length - 1];
  const ttfts = list.map((s) => s.ttftMs).filter((t): t is number => typeof t === 'number');
  return {
    providerName: newest.providerName,
    model: newest.model,
    samples: list.length,
    averageTokensPerSecond: mean(list.map((s) => s.tokensPerSecond)),
    lastTokensPerSecond: newest.tokensPerSecond,
    averageTtftMs: ttfts.length > 0 ? mean(ttfts) : null,
    lastAt: newest.at,
  };
}

/**
 * Record one completed generation and refresh every subscriber.
 *
 * The rate is wall-clock based and therefore INCLUDES queue and HTTP transport
 * overhead, so it reads slightly pessimistic versus llama.cpp's own internal
 * `predicted_per_second`. That is deliberate: it is what the user actually waited.
 *
 * Never throws — callers treat it exactly like logUsage().
 */
export function recordGeneration(timing: GenerationTiming): void {
  try {
    if (timing.outputTokens <= 0 || timing.elapsedMs <= 0) return; // nothing measurable
    const sample: RuntimeGenerationSample = {
      providerName: timing.providerName,
      model: timing.model,
      outputTokens: timing.outputTokens,
      elapsedMs: timing.elapsedMs,
      tokensPerSecond: (timing.outputTokens * 1000) / timing.elapsedMs,
      ttftMs: timing.ttftMs ?? null,
      streaming: timing.streaming,
      at: Date.now(),
    };
    const key = keyFor(sample.providerName, sample.model);
    const list = samples.get(key) ?? [];
    list.push(sample);
    if (list.length > RUNTIME_TELEMETRY_WINDOW) list.splice(0, list.length - RUNTIME_TELEMETRY_WINDOW);
    samples.set(key, list);
    latest = sample;
    // Fresh tok/s the moment a generation ends — the whole point of the push channel.
    void emitRuntimeStatus();
  } catch (err) {
    log.error('Failed to record runtime telemetry:', err);
  }
}

/** Drop every measurement. Test/reset seam; also used when providers are reconfigured. */
export function resetTelemetry(): void {
  samples.clear();
  latest = null;
}

/** Telemetry half of the snapshot. Reads `/slots` ONLY when the sidecar already runs. */
export async function getTelemetrySnapshot(): Promise<RuntimeTelemetrySnapshot> {
  const byModel: Record<string, RuntimeModelStats> = {};
  for (const [key, list] of samples) {
    if (list.length > 0) byModel[key] = statsFor(list);
  }
  return { latest, byModel, context: await readContextUsage('chat') };
}

// --- Combined snapshot ---------------------------------------------------------------

/**
 * True when an ENABLED `builtin` provider row exists. The visibility signal for the
 * status indicator: `binaryPresent` would be wrong, because the binaries ship with
 * every install and would show the indicator to deliberate cloud-only users.
 */
async function isBuiltinConfigured(): Promise<boolean> {
  try {
    const db = getDb();
    const rows = await db
      .select({ id: aiProviders.id })
      .from(aiProviders)
      .where(and(eq(aiProviders.name, 'builtin'), eq(aiProviders.enabled, true)))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false; // no database yet — treat as not configured rather than block the read
  }
}

/** Everything a renderer needs for initial runtime state, in one round trip. */
export async function getRuntimeSnapshot(): Promise<LlamaRuntimeSnapshot> {
  const runtime = status(); // pure read — never starts anything
  const [configured, telemetry] = await Promise.all([isBuiltinConfigured(), getTelemetrySnapshot()]);
  return { configured, binaryPresent: runtime.binaryAvailable, runtime, telemetry };
}

// --- Push channel ----------------------------------------------------------------------

let targetWindow: BrowserWindow | null = null;

/**
 * Wire the push channel to the main window and subscribe to sidecar lifecycle
 * transitions (start / stop / crash / model swap). Called once from
 * registerAIProviderHandlers. Registering an observer starts nothing.
 */
export function initRuntimeTelemetry(win: BrowserWindow): void {
  targetWindow = win;
  setRuntimeChangeListener(() => void emitRuntimeStatus());
}

/** Detach the observer and the window (app shutdown / tests). */
export function stopRuntimeTelemetry(): void {
  setRuntimeChangeListener(null);
  targetWindow = null;
}

/** Push the current snapshot. Best-effort: never throws, never blocks a caller. */
export async function emitRuntimeStatus(): Promise<void> {
  const win = targetWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(RUNTIME_STATUS_CHANNEL, await getRuntimeSnapshot());
  } catch (err) {
    // Window may be gone mid-shutdown, or the DB may be closing — non-fatal.
    log.warn(`Failed to send ${RUNTIME_STATUS_CHANNEL}:`, (err as Error).message);
  }
}
