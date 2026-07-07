// === FILE PURPOSE ===
// Shared debounced "refresh the active Brain scope" scheduler (V3.2 Task 4 live
// growth). BOTH triggers funnel into this ONE function so a burst from either or
// both collapses into a single 300ms-debounced refetch:
//   - the data:changed broadcast (useBrainLiveSync, registered once in App.tsx —
//     mirrors useBoardLiveSync's own debounce), and
//   - the liveSuggestionsStore accept() success path (decision/question accepts
//     flip live_suggestions without emitting data:changed).
// The scope refreshed is re-read from brainStore.activeScopeKey at TIMER FIRE
// time, not call time, so a mid-debounce scope switch (This-session/Everything
// toggle) refreshes whatever is active NOW — mirrors useBoardLiveSync's own
// re-read-at-fire-time fix for the analogous board staleness bug. activeScopeKey
// starts null and is only ever set once BrainTabPanel has mounted, so this is a
// no-op until the Brain tab has loaded at least once this session.
//
// === DEPENDENCIES ===
// brainStore (activeScopeKey + refresh), shared BrainScope type

import { useBrainStore } from '../stores/brainStore';
import type { BrainScope } from '../../shared/types';

/** Trailing-edge debounce window — matches useBoardLiveSync's own. */
export const BRAIN_LIVE_SYNC_DEBOUNCE_MS = 300;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Parse a brainStore scopeKey (`'workspace'` or `'session:<meetingId>'`) back
 *  into a BrainScope for `refresh()`. Inverse of brainStore's scopeKeyFor. */
function scopeFromKey(scopeKey: string): BrainScope {
  return scopeKey === 'workspace' ? 'workspace' : { meetingId: scopeKey.slice('session:'.length) };
}

/** Arm (or re-arm) the shared debounce. Safe to call from anywhere — both live
 *  triggers share this single timer, so an overlapping burst still yields one
 *  refetch. No-op at fire time if the Brain tab was never opened this session. */
export function scheduleBrainRefresh(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const activeScopeKey = useBrainStore.getState().activeScopeKey;
    if (!activeScopeKey) return; // Brain never loaded this session — nothing to refresh
    void useBrainStore.getState().refresh(scopeFromKey(activeScopeKey));
  }, BRAIN_LIVE_SYNC_DEBOUNCE_MS);
}

/** Cancel any pending debounce — called on useBrainLiveSync's unmount so a
 *  scheduled refresh never fires after the owning hook is gone (test hygiene;
 *  in practice App.tsx, where it's registered, never unmounts). */
export function cancelScheduledBrainRefresh(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
