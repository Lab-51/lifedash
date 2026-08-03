// === FILE PURPOSE ===
// Runtime status card for Settings → Local AI: whether the bundled llama.cpp
// sidecar is ready / starting / running / failed, on which backend, with which
// models loaded, last measured tok/s and context usage — plus a manual stop
// button and the idle auto-stop control. Fed by the SAME `useRuntimeStatus`
// push-driven hook as the StatusBar indicator (LOCAL-RT.2), so the two
// surfaces read one source of truth and can never disagree about the state.
//
// === DEPENDENCIES ===
// React, lucide-react, useRuntimeStatus (shared hook + pure state/label/stats
// derivation from Task 2), window.electronAPI (`stopBuiltinRuntime`,
// `getSetting`/`setSetting`), shared idle-setting constants.
//
// === LIMITATIONS ===
// - Observing is a PURE READ: `useRuntimeStatus` does one initial pull plus a
//   push listener, never a poll and never `ensureRunning`. There is no "start"
//   button on purpose — the runtime starts only when a real request needs it.
// - Unlike the status bar (which hides entirely while no `builtin` provider row
//   is enabled), this card is the always-visible detail surface rendered inside
//   the Local AI settings/wizard flow, so it reads the runtime's actual process
//   state regardless of that row — exactly what the pre-telemetry version did.
//   The STATE MAPPING itself still comes only from `deriveRuntimeIndicatorState`.

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Square } from 'lucide-react';
import type { LlamaBackend, LlamaContextUsage, RuntimeModelStats } from '../../../../shared/types/ai';
import {
  DEFAULT_IDLE_STOP_MINUTES,
  LOCAL_AI_IDLE_SETTING_KEY,
  MAX_IDLE_STOP_MINUTES,
} from '../../../../shared/types/ai';
import {
  useRuntimeStatus,
  deriveRuntimeIndicatorState,
  builtinChatStats,
  runtimeStateLabel,
  type RuntimeIndicatorState,
} from '../../../hooks/useRuntimeStatus';

/** Dot + text colour per state — purely presentational. The state itself and its
 *  wording both come from the shared hook; `ready` stays calm (never red/amber)
 *  since the idle-stopped sidecar is a designed resting state, not a fault. */
const STATE_STYLE: Record<RuntimeIndicatorState, { dot: string; text: string }> = {
  'not-set-up': { dot: 'bg-surface-500', text: 'text-[var(--color-text-secondary)]' },
  ready: { dot: 'bg-emerald-400/60', text: 'text-emerald-400/80' },
  starting: { dot: 'bg-amber-400', text: 'text-amber-400' },
  running: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  failed: { dot: 'bg-red-400', text: 'text-red-400' },
};

/** No snapshot yet — deliberately NOT one of the five states, because "unknown"
 *  is not a runtime condition. Neutral, so it reads as "waiting", not "broken". */
const UNKNOWN_STYLE = { dot: 'bg-surface-500 animate-pulse', text: 'text-[var(--color-text-muted)]' };

/** The badge word, cased for this card — same wording `runtimeStateLabel`
 *  returns (e.g. "Local AI · ready"), just the state word on its own with its
 *  first letter capitalised. Never a new literal: transforms the shared
 *  string's casing, does not restate its content. */
function badgeWord(label: string): string {
  const word = label.replace(/^Local AI · /, '');
  return word.charAt(0).toUpperCase() + word.slice(1);
}

interface RuntimeDetailsProps {
  running: boolean;
  loaded: string[];
  backend: LlamaBackend | null | undefined;
  context: LlamaContextUsage | null | undefined;
  stats: RuntimeModelStats | undefined;
  binaryMissing: boolean;
}

/** Everything below the phase badge: the explainer sentence, loaded models,
 *  backend/context/tok-s stats row, and the missing-binary warning. Split out
 *  purely to keep the card's own cyclomatic complexity down. */
function RuntimeDetails({ running, loaded, backend, context, stats, binaryMissing }: RuntimeDetailsProps) {
  return (
    <>
      <p className="mt-1 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
        {running
          ? `${loaded.length} model${loaded.length === 1 ? '' : 's'} loaded`
          : 'Starts by itself the first time a task needs a local model, then stops when idle.'}
      </p>
      {loaded.length > 0 && (
        <p className="mt-0.5 text-[0.6875rem] text-[var(--color-text-secondary)] font-data break-words overflow-hidden">
          {loaded.join(', ')}
        </p>
      )}
      {(backend || context || stats) && (
        <p className="mt-1 flex flex-wrap gap-x-3 text-[0.6875rem] text-[var(--color-text-secondary)] font-data">
          {backend && <span>Backend: {backend}</span>}
          {context && (
            <span>
              Context: {context.usedTokens} / {context.contextTokens} tokens
            </span>
          )}
          {stats && <span>Last: {Math.round(stats.lastTokensPerSecond)} tok/s</span>}
        </p>
      )}
      {binaryMissing && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[0.6875rem] text-amber-400 break-words">
          <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
          <span className="break-words">
            The bundled runtime binary is missing from this install, so downloaded models can’t be run yet.
          </span>
        </p>
      )}
    </>
  );
}

/** The idle auto-stop minutes control at the bottom of the card. */
function IdleStopControl({ idleMinutes, onChange }: { idleMinutes: number; onChange: (raw: string) => void }) {
  return (
    <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
      <label htmlFor="local-ai-idle-minutes">Stop the runtime after</label>
      <input
        id="local-ai-idle-minutes"
        type="number"
        min={0}
        max={MAX_IDLE_STOP_MINUTES}
        value={idleMinutes}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Minutes idle before the built-in runtime stops"
        className="w-16 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)]"
      />
      <span>minutes idle</span>
      <span className="text-[var(--color-text-muted)] break-words">
        {idleMinutes === 0 ? '— set to 0: it stays loaded until you stop it' : '— frees memory for transcription'}
      </span>
    </div>
  );
}

export default function LocalRuntimeCard() {
  const { snapshot } = useRuntimeStatus();
  const [stopping, setStopping] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState<number>(DEFAULT_IDLE_STOP_MINUTES);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await window.electronAPI?.getSetting?.(LOCAL_AI_IDLE_SETTING_KEY);
        const parsed = Number(raw);
        if (!cancelled && raw != null && Number.isFinite(parsed) && parsed >= 0) setIdleMinutes(parsed);
      } catch {
        // Never written / unreadable — the default already matches the runtime's.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStop = async () => {
    setStopping(true);
    try {
      await window.electronAPI?.stopBuiltinRuntime?.();
      // No local write-back on purpose: the sidecar's exit fires the same
      // `ai:runtime-status` push `useRuntimeStatus` already listens on, so the
      // shared snapshot updates this card without a second source of truth.
    } finally {
      setStopping(false);
    }
  };

  const handleIdleChange = async (raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > MAX_IDLE_STOP_MINUTES) return;
    const previous = idleMinutes;
    setIdleMinutes(value);
    try {
      await window.electronAPI?.setSetting?.(LOCAL_AI_IDLE_SETTING_KEY, String(value));
    } catch {
      setIdleMinutes(previous);
    }
  };

  // Force `configured: true` before delegating — this card ignores the
  // provider-row visibility gate (see file header) but the resulting
  // ready/starting/running/failed mapping is still 100% `deriveRuntimeIndicatorState`.
  //
  // A NULL snapshot is "we don't know yet", NOT "ready": the pull is in flight,
  // or the `getRuntimeSnapshot` bridge is missing (a stale preload after an
  // update). Rendering the healthy resting state on zero data would be a
  // confident claim about a runtime we have not heard from — the exact failure
  // this phase's vocabulary exists to prevent.
  const state: RuntimeIndicatorState | null = snapshot
    ? deriveRuntimeIndicatorState({ ...snapshot, configured: true })
    : null;
  const style = state ? STATE_STYLE[state] : UNKNOWN_STYLE;
  const label = state ? badgeWord(runtimeStateLabel(state, snapshot)) : 'Checking…';
  const canStop = state === 'running' || state === 'starting';

  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">Built-in runtime</span>
            <span className={`text-xs font-medium ${style.text}`}>{label}</span>
          </div>
          <RuntimeDetails
            running={state === 'running'}
            loaded={snapshot?.runtime.loadedModels ?? []}
            backend={snapshot?.runtime.backend}
            context={snapshot?.telemetry.context}
            stats={builtinChatStats(snapshot)}
            binaryMissing={snapshot?.binaryPresent === false}
          />
        </div>

        <button
          onClick={handleStop}
          disabled={stopping || !canStop}
          aria-label="Stop the built-in runtime"
          className="shrink-0 flex items-center gap-1.5 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg text-xs transition-colors"
        >
          {stopping ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Square size={12} aria-hidden="true" />
          )}
          Stop
        </button>
      </div>

      <IdleStopControl idleMinutes={idleMinutes} onChange={handleIdleChange} />
    </div>
  );
}
