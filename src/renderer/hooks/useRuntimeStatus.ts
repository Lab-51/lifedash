// === FILE PURPOSE ===
// useRuntimeStatus — shared renderer state for the built-in llama.cpp sidecar's
// user-facing status: one initial pull of LlamaRuntimeSnapshot, then push-driven
// updates on `ai:runtime-status` (LOCAL-RT.2 Task 1). Shared by the StatusBar
// indicator (Task 2) and Settings -> Local AI's LocalRuntimeCard (Task 3) so
// both surfaces read the same five-state vocabulary and can never drift.
//
// === DEPENDENCIES ===
// React, window.electronAPI (`getRuntimeSnapshot`, `onRuntimeStatus`).
//
// === LIMITATIONS ===
// - Read-only by construction: `getRuntimeSnapshot` is a pure read and the push
//   listener never calls back into main. Mounting this hook — even with no
//   `builtin` provider configured — costs one round trip and never spawns the
//   sidecar (LOCAL-RT.1's optionality contract).
// - NO polling interval anywhere in this hook. The push listener is attached
//   unconditionally (even before `configured` is known, and even once it comes
//   back false) so a later provider-CRUD push can reveal the indicator without
//   a remount.

import { useEffect, useRef, useState } from 'react';
import type { LlamaRuntimeSnapshot, RuntimeModelStats } from '../../shared/types/ai';

/** The five-state vocabulary shared by the status-bar indicator and the Settings
 *  card. NEVER "disconnected" — the idle-stopped resting state is healthy. */
export type RuntimeIndicatorState = 'not-set-up' | 'ready' | 'starting' | 'running' | 'failed';

/**
 * Maps the raw snapshot facts to ONE of the five states. This is the SINGLE
 * source of truth for the mapping — every surface that shows a runtime state
 * must call this rather than re-deriving it, so "ready" cannot read healthy on
 * one surface and dead on another.
 *
 * - `not-set-up`: no enabled `builtin` provider row (`configured` false).
 * - `starting`: the chat sidecar is mid-launch.
 * - `running`: the chat sidecar process is up (serving or idle-between-requests
 *   — see `builtinChatStats` for why the tok/s figure never blanks).
 * - `failed`: EITHER the binary that would run it is missing from this install,
 *   OR the chat role stopped with an unresolved crash (`crashes > 0` while not
 *   running/starting). A graceful stop — including idle auto-stop — always
 *   resets `crashes` to 0 on the way out (llamaRuntimeService's `handleExit`),
 *   so this combination can only mean a crash, never a designed idle rest.
 * - `ready`: configured, binary present, not running/starting, no unresolved
 *   crash — the DESIGNED resting state after idle auto-stop frees VRAM for
 *   whisper. Must never be styled as an error.
 */
export function deriveRuntimeIndicatorState(snapshot: LlamaRuntimeSnapshot | null): RuntimeIndicatorState {
  if (!snapshot?.configured) return 'not-set-up';
  const { chat } = snapshot.runtime;
  if (chat.starting) return 'starting';
  if (chat.running) return 'running';
  if (!snapshot.runtime.binaryAvailable || chat.crashes > 0) return 'failed';
  return 'ready';
}

/**
 * The most recent rolling tok/s stats recorded for the `builtin` provider, or
 * undefined before its first generation. Deliberately filters `byModel` by
 * `providerName === 'builtin'` rather than keying off `runtime.chat.modelId`:
 * task-model config can store the model as the literal `'default'` sentinel
 * (see ai-provider.ts's `BUILTIN_DEFAULT_MODEL`), which would not match the
 * real resolved id the runtime reports — filtering by provider avoids that
 * mismatch entirely. Because `byModel` entries are never cleared, the last
 * figure survives after generation ends instead of blanking.
 */
export function builtinChatStats(snapshot: LlamaRuntimeSnapshot | null): RuntimeModelStats | undefined {
  if (!snapshot) return undefined;
  let newest: RuntimeModelStats | undefined;
  for (const stats of Object.values(snapshot.telemetry.byModel)) {
    if (stats.providerName !== 'builtin') continue;
    if (!newest || stats.lastAt > newest.lastAt) newest = stats;
  }
  return newest;
}

/**
 * The exact label text for a state — the second half of the "cannot drift"
 * contract: Task 3's Settings card must render byte-identical wording to the
 * status bar for the same state (precedent: local-ai/format.ts's
 * `bestMatchRationale`, asserted identical by test).
 */
export function runtimeStateLabel(state: RuntimeIndicatorState, snapshot: LlamaRuntimeSnapshot | null): string {
  switch (state) {
    case 'ready':
      return 'Local AI · ready';
    case 'starting':
      return 'Local AI · starting…';
    case 'running': {
      const stats = builtinChatStats(snapshot);
      return stats ? `Local AI · ${Math.round(stats.lastTokensPerSecond)} tok/s` : 'Local AI · running';
    }
    case 'failed':
      return 'Local AI · failed';
    case 'not-set-up':
      return '';
  }
}

export interface UseRuntimeStatusResult {
  snapshot: LlamaRuntimeSnapshot | null;
  state: RuntimeIndicatorState;
}

/**
 * ONE initial pull of the runtime snapshot, then push-driven via
 * `ai:runtime-status`. Never polls, never reaches `ensureRunning` — see file
 * header.
 */
export function useRuntimeStatus(): UseRuntimeStatusResult {
  const [snapshot, setSnapshot] = useState<LlamaRuntimeSnapshot | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // ONE initial pull — a pure read, never a spawn.
  useEffect(() => {
    if (!window.electronAPI?.getRuntimeSnapshot) return;
    void (async () => {
      try {
        const initial = await window.electronAPI.getRuntimeSnapshot();
        if (aliveRef.current) setSnapshot(initial);
      } catch {
        // Bridge missing (tests) or main busy — stay unconfigured until a push arrives.
      }
    })();
  }, []);

  // Push-driven from here on. Registered unconditionally so a provider-CRUD
  // push can reveal the indicator mid-session without a remount.
  useEffect(() => {
    if (!window.electronAPI?.onRuntimeStatus) return;
    return window.electronAPI.onRuntimeStatus((next) => {
      if (aliveRef.current) setSnapshot(next);
    });
  }, []);

  return { snapshot, state: deriveRuntimeIndicatorState(snapshot) };
}
