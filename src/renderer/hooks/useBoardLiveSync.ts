// === FILE PURPOSE ===
// useBoardLiveSync — subscribes ONCE to the main-process `data:changed` broadcast
// and debounce-refetches the currently-visible board when a change targets it.
// This is the renderer half of the "watch the assistant work" mechanism: any
// card/project mutation (from this window, another window, the auto-push rail, or
// the assistant) makes the visible board update without a manual refresh.

import { useEffect } from 'react';
import { useBoardStore } from '../stores/boardStore';

/** Trailing-edge debounce window — collapses mutation bursts, never drops the final event. */
export const BOARD_LIVE_SYNC_DEBOUNCE_MS = 300;

export function useBoardLiveSync(): void {
  useEffect(() => {
    if (!window.electronAPI?.onDataChanged) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = window.electronAPI.onDataChanged(({ projectId }) => {
      const loaded = useBoardStore.getState().project?.id;
      if (!loaded) return; // no board visible — nothing to refetch
      if (projectId && projectId !== loaded) return; // change targets a different board
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Re-read the currently-loaded board at FIRE time, not the id captured when
        // the event arrived: if the user navigated to a different board within the
        // debounce window, refetch whatever is visible now — never reload the old
        // board into the shared store (which would also poison the arming guard).
        const current = useBoardStore.getState().project?.id;
        if (current) void useBoardStore.getState().loadBoard(current);
      }, BOARD_LIVE_SYNC_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      cleanup();
    };
  }, []);
}
