// === FILE PURPOSE ===
// useBrainLiveSync — subscribes ONCE to the main-process `data:changed` broadcast
// and schedules the shared debounced Brain-scope refresh (services/brainLiveSync)
// on every fire. This is trigger (a) of V3.2 Task 4's live growth: the mind map
// grows during a session as cards/columns/projects change. Registered at the
// SAME app-level site as useBoardLiveSync (App.tsx) so it fires even while the
// Brain tab isn't the one currently viewed (needed for the off-canvas badge) and
// never double-registers across the overlay-over-route topology.
//
// The payload (`{ scope, projectId? }`, see dataChangeNotifier) carries no entity
// identity, so unlike useBoardLiveSync this never filters by projectId — ANY
// change could affect the active Brain scope (workspace scope shows everything
// regardless of project; a session scope's own project isn't cheaply derivable
// from the payload alone). The shared debounce absorbs the extra refetches for
// free (an unrelated change reproduces an identical tree -> brainStore.refresh's
// own no-op path).

import { useEffect } from 'react';
import { useBrainStore } from '../stores/brainStore';
import { scheduleBrainRefresh, cancelScheduledBrainRefresh } from '../services/brainLiveSync';

export function useBrainLiveSync(): void {
  useEffect(() => {
    if (!window.electronAPI?.onDataChanged) return;
    const cleanup = window.electronAPI.onDataChanged(() => {
      if (!useBrainStore.getState().activeScopeKey) return; // no Brain load yet this session
      scheduleBrainRefresh();
    });
    return () => {
      cancelScheduledBrainRefresh();
      cleanup();
    };
  }, []);
}
