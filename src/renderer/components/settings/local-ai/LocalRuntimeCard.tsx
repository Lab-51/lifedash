// === FILE PURPOSE ===
// Runtime status card for Settings → Local AI: whether the bundled llama.cpp
// sidecar is stopped / starting / running, on which backend, with which models
// loaded — plus a manual stop button and the idle auto-stop control.
//
// === DEPENDENCIES ===
// React, lucide-react, window.electronAPI (`checkBuiltinRuntime`, `stopBuiltinRuntime`,
// `getSetting`/`setSetting`), shared LlamaRuntimeStatus + idle-setting constants.
//
// === LIMITATIONS ===
// - `checkBuiltinRuntime` is a PURE READ (main-process `status()` plus a models-dir
//   listing). Mounting or polling this card never spawns the runtime. There is no
//   "start" button on purpose — the runtime starts only when a real request needs it.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Square } from 'lucide-react';
import {
  DEFAULT_IDLE_STOP_MINUTES,
  LOCAL_AI_IDLE_SETTING_KEY,
  MAX_IDLE_STOP_MINUTES,
  type LlamaRuntimeStatus,
} from '../../../../shared/types/ai';

const POLL_MS = 6_000;

type Phase = 'stopped' | 'starting' | 'running';

function phaseOf(runtime: LlamaRuntimeStatus | null): Phase {
  if (!runtime) return 'stopped';
  if (runtime.chat.starting || runtime.embedding.starting) return 'starting';
  return runtime.running ? 'running' : 'stopped';
}

const PHASE_COPY: Record<Phase, { label: string; dot: string; text: string }> = {
  stopped: { label: 'Stopped', dot: 'bg-surface-500', text: 'text-[var(--color-text-secondary)]' },
  starting: { label: 'Starting…', dot: 'bg-amber-400', text: 'text-amber-400' },
  running: { label: 'Running', dot: 'bg-emerald-400', text: 'text-emerald-400' },
};

export default function LocalRuntimeCard() {
  const [runtime, setRuntime] = useState<LlamaRuntimeStatus | null>(null);
  const [binaryPresent, setBinaryPresent] = useState<boolean | null>(null);
  const [stopping, setStopping] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState<number>(DEFAULT_IDLE_STOP_MINUTES);

  const poll = useCallback(async () => {
    try {
      const res = await window.electronAPI?.checkBuiltinRuntime?.();
      if (!res) return;
      setRuntime(res.runtime);
      setBinaryPresent(res.binaryPresent);
    } catch {
      // Bridge missing (tests) or main busy — leave the last known state visible.
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

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
      const next = await window.electronAPI?.stopBuiltinRuntime?.();
      if (next) setRuntime(next);
    } catch {
      void poll();
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

  const phase = phaseOf(runtime);
  const copy = PHASE_COPY[phase];
  const loaded = runtime?.loadedModels ?? [];

  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${copy.dot}`} aria-hidden="true" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">Built-in runtime</span>
            <span className={`text-xs font-medium ${copy.text}`}>{copy.label}</span>
          </div>
          <p className="mt-1 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
            {phase === 'running'
              ? `Backend: ${runtime?.backend ?? 'unknown'} · ${loaded.length} model${loaded.length === 1 ? '' : 's'} loaded`
              : 'Starts by itself the first time a task needs a local model, then stops when idle.'}
          </p>
          {loaded.length > 0 && (
            <p className="mt-0.5 text-[0.6875rem] text-[var(--color-text-secondary)] font-data break-words overflow-hidden">
              {loaded.join(', ')}
            </p>
          )}
          {binaryPresent === false && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[0.6875rem] text-amber-400 break-words">
              <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
              <span className="break-words">
                The bundled runtime binary is missing from this install, so downloaded models can’t be run yet.
              </span>
            </p>
          )}
        </div>

        <button
          onClick={handleStop}
          disabled={stopping || phase === 'stopped'}
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

      <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <label htmlFor="local-ai-idle-minutes">Stop the runtime after</label>
        <input
          id="local-ai-idle-minutes"
          type="number"
          min={0}
          max={MAX_IDLE_STOP_MINUTES}
          value={idleMinutes}
          onChange={(e) => handleIdleChange(e.target.value)}
          aria-label="Minutes idle before the built-in runtime stops"
          className="w-16 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)]"
        />
        <span>minutes idle</span>
        <span className="text-[var(--color-text-muted)] break-words">
          {idleMinutes === 0 ? '— set to 0: it stays loaded until you stop it' : '— frees memory for transcription'}
        </span>
      </div>
    </div>
  );
}
