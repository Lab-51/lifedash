// === FILE PURPOSE ===
// useTwinMemoryLiveSync — subscribes ONCE to the main-process `data:changed`
// broadcast and schedules the shared debounced twin-memory refresh
// (services/twinMemoryLiveSync) whenever the payload's scope is
// 'twin-memory'. This is the twin-side SIBLING to useBrainLiveSync — a
// separate hook, not an edit to it — registered at the SAME app-level site
// (App.tsx) so a fact learned by a recording on one tab appears on the
// Memory tab without the user leaving and returning.
//
// Filtered by scope (unlike useBrainLiveSync, which reacts to every
// data:changed regardless of scope because ANY change could affect the
// Brain tree): a twin fact is learned only via twinMemoryService.extractFacts,
// which broadcasts exactly 'twin-memory' and nothing else, so a card/column/
// project edit elsewhere in the app correctly causes no twin-memory refetch.

import { useEffect } from 'react';
import { scheduleTwinMemoryRefresh, cancelScheduledTwinMemoryRefresh } from '../services/twinMemoryLiveSync';

export function useTwinMemoryLiveSync(): void {
  useEffect(() => {
    if (!window.electronAPI?.onDataChanged) return;
    const cleanup = window.electronAPI.onDataChanged(({ scope }) => {
      if (scope !== 'twin-memory') return;
      scheduleTwinMemoryRefresh();
    });
    return () => {
      cancelScheduledTwinMemoryRefresh();
      cleanup();
    };
  }, []);
}
