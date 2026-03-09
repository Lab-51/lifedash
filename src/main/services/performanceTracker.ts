// === FILE PURPOSE ===
// Lightweight performance instrumentation for main process boundaries.
// Wraps async/sync functions with timing, logs duration, and keeps
// aggregate stats (count, avg, p95) per label in memory.

import { createLogger } from './logger';

const log = createLogger('Perf');

// ---------------------------------------------------------------------------
// Aggregate Stats
// ---------------------------------------------------------------------------

interface TimingEntry {
  count: number;
  totalMs: number;
  durations: number[]; // kept for p95 calculation
}

const stats = new Map<string, TimingEntry>();

function recordDuration(label: string, durationMs: number): void {
  let entry = stats.get(label);
  if (!entry) {
    entry = { count: 0, totalMs: 0, durations: [] };
    stats.set(label, entry);
  }
  entry.count++;
  entry.totalMs += durationMs;
  entry.durations.push(durationMs);

  // Cap stored durations to prevent unbounded memory growth.
  // Keep the most recent 500 samples — enough for accurate p95.
  if (entry.durations.length > 500) {
    entry.durations = entry.durations.slice(-500);
  }
}

// ---------------------------------------------------------------------------
// Timing Wrappers
// ---------------------------------------------------------------------------

/** Minimum duration (ms) before a timing entry is logged. Set to 0 to log everything. */
const LOG_THRESHOLD_MS = 50;

/** Duration (ms) above which a warning is logged instead of info. */
const WARN_THRESHOLD_MS = 1000;

/**
 * Wrap an async function with timing instrumentation.
 * Logs `[label] completed in Xms` and records aggregate stats.
 */
export async function trackTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    recordDuration(label, durationMs);

    if (durationMs >= LOG_THRESHOLD_MS) {
      if (durationMs >= WARN_THRESHOLD_MS) {
        log.warn(`[${label}] completed in ${durationMs}ms`);
      } else {
        log.info(`[${label}] completed in ${durationMs}ms`);
      }
    }
  }
}

/**
 * Wrap a synchronous function with timing instrumentation.
 * Logs `[label] completed in Xms` and records aggregate stats.
 */
export function trackTimingSync<T>(label: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    recordDuration(label, durationMs);

    if (durationMs >= LOG_THRESHOLD_MS) {
      if (durationMs >= WARN_THRESHOLD_MS) {
        log.warn(`[${label}] completed in ${durationMs}ms`);
      } else {
        log.info(`[${label}] completed in ${durationMs}ms`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stats Query
// ---------------------------------------------------------------------------

export interface TimingStats {
  label: string;
  count: number;
  avgMs: number;
  p95Ms: number;
}

/**
 * Returns aggregate timing stats for all tracked labels.
 * Useful for diagnostics — call from a dev-tools IPC handler or log on shutdown.
 */
export function getTimingStats(): TimingStats[] {
  const result: TimingStats[] = [];
  for (const [label, entry] of stats) {
    const avgMs = entry.count > 0 ? Math.round(entry.totalMs / entry.count) : 0;
    const sorted = [...entry.durations].sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    const p95Ms = sorted[p95Index] ?? 0;
    result.push({ label, count: entry.count, avgMs, p95Ms });
  }
  return result;
}

/**
 * Reset all stored timing stats. Useful for testing.
 */
export function resetTimingStats(): void {
  stats.clear();
}
