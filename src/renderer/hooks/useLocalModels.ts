// === FILE PURPOSE ===
// Shared renderer state for the built-in llama.cpp runtime's GGUF models: the
// catalog view (models + hardware tier + per-model status) and the live download
// progress map. One hook so Settings → Local AI and the setup wizard render the
// same truth instead of each polling the bridge their own way.
//
// === DEPENDENCIES ===
// React, window.electronAPI local-models bridge (LOCAL-RT.1 Task 3).
//
// === LIMITATIONS ===
// - Read-only by construction: it calls `local-models:view` (a pure read) and
//   subscribes to the progress push event. It NEVER starts the runtime and never
//   starts a download — mounting this hook costs nothing but one IPC round trip.
// - Progress is a push event, so a remount re-seeds from the view's `downloads`
//   snapshot and re-attaches the listener; in-flight transfers are never lost.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogModelStatus, LocalModelDownloadProgress, LocalModelsView } from '../../shared/types/localModels';

/** Terminal download states — anything else is still in flight. */
const FINISHED: ReadonlySet<LocalModelDownloadProgress['state']> = new Set(['ready', 'error']);

export interface UseLocalModelsResult {
  view: LocalModelsView | null;
  /** In-flight + recently-finished downloads, keyed by `${modelId}:${quant}`. */
  downloads: Record<string, LocalModelDownloadProgress>;
  loading: boolean;
  error: string | null;
  /** Re-read the view. `force` also re-fetches the remote catalog. */
  refresh: (force?: boolean) => Promise<void>;
  statusFor: (modelId: string) => CatalogModelStatus | undefined;
}

/**
 * Load the local-models view once and keep download progress live.
 *
 * `enabled: false` mounts the hook inert (no IPC at all) so a collapsed or
 * hidden host pays nothing.
 */
export function useLocalModels(enabled = true): UseLocalModelsResult {
  const [view, setView] = useState<LocalModelsView | null>(null);
  const [downloads, setDownloads] = useState<Record<string, LocalModelDownloadProgress>>({});
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Guards against setState after unmount and against a stale refresh landing
  // after a newer one (Settings tabs mount/unmount this freely).
  const aliveRef = useRef(true);
  const requestRef = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const api = window.electronAPI;
    if (!api?.getLocalModelsView) {
      setLoading(false);
      return;
    }
    const seq = ++requestRef.current;
    setLoading(true);
    try {
      const next = await api.getLocalModelsView(force);
      if (!aliveRef.current || seq !== requestRef.current) return;
      // A malformed/absent payload must degrade to an error banner, never take the
      // whole Settings page down with it.
      if (!next?.catalog?.models) throw new Error('The local model catalog could not be read.');
      setView(next);
      // Seed from the main process's own list so a remount re-attaches to
      // transfers already running rather than showing them as absent.
      setDownloads((prev) => {
        const merged = { ...prev };
        for (const d of next.downloads ?? []) merged[d.key] = d;
        return merged;
      });
      setError(null);
    } catch (err) {
      if (!aliveRef.current || seq !== requestRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load local models.');
    } finally {
      if (aliveRef.current && seq === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh(false);
  }, [enabled, refresh]);

  // Live progress. Subscribing is free and never triggers a transfer; a download
  // that finishes re-reads the view so `downloaded` flags flip without a manual
  // refresh (that is what makes a new model routable in Model Assignments).
  useEffect(() => {
    if (!enabled || !window.electronAPI?.onLocalModelProgress) return;
    return window.electronAPI.onLocalModelProgress((progress) => {
      if (!aliveRef.current) return;
      setDownloads((prev) => ({ ...prev, [progress.key]: progress }));
      if (FINISHED.has(progress.state)) void refresh(false);
    });
  }, [enabled, refresh]);

  const statusFor = useCallback((modelId: string) => view?.statuses.find((s) => s.modelId === modelId), [view]);

  return { view, downloads, loading, error, refresh, statusFor };
}
