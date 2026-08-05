// === FILE PURPOSE ===
// Shared debounced "refresh the twin memory graph" scheduler (TWIN-GRAPH.2
// Task 4 live growth) — the twin-side SIBLING to services/brainLiveSync.ts,
// not a modification of it. The Brain tree's live-sync (brainLiveSync.ts /
// useBrainLiveSync.ts) drives brainStore for the retained session Brain
// canvas ONLY; this file exists because that mechanism does not, and must
// not, know about the twin's memory graph.
//
// >>> THE GAP THIS CLOSES <<<
// twinMemoryGraphStore's refresh triggers were, before this task, limited to
// mount / tab activation / post-undo (see that store's own header) — a fact
// learned while the user is already sitting on Twin -> Memory never appeared
// until they left and returned. main's twinMemoryService now broadcasts
// data:changed({scope:'twin-memory'}) exactly once per successful extraction
// (a genuine write, never a skip/no-op); useTwinMemoryLiveSync (registered
// once, in App.tsx, mirroring useBrainLiveSync's placement) forwards that
// broadcast here, and this module debounce-collapses a burst into one
// refetch — same 300ms window and same "no-op until something has loaded
// this session" discipline as brainLiveSync, so the two files read as one
// convention without sharing code that would couple them.
//
// === DEPENDENCIES ===
// twinMemoryGraphStore (refresh)

import { useTwinMemoryGraphStore } from '../stores/twinMemoryGraphStore';

/** Trailing-edge debounce window — matches brainLiveSync's own. */
export const TWIN_MEMORY_LIVE_SYNC_DEBOUNCE_MS = 300;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Arm (or re-arm) the shared debounce. No-op at fire time if the Memory tab
 *  was never opened this session (graph still null) — nothing to refresh. */
export function scheduleTwinMemoryRefresh(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!useTwinMemoryGraphStore.getState().graph) return; // never loaded this session
    void useTwinMemoryGraphStore.getState().refresh();
  }, TWIN_MEMORY_LIVE_SYNC_DEBOUNCE_MS);
}

/** Cancel any pending debounce — called on useTwinMemoryLiveSync's unmount so
 *  a scheduled refresh never fires after the owning hook is gone (test
 *  hygiene; in practice App.tsx, where it's registered, never unmounts). */
export function cancelScheduledTwinMemoryRefresh(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
