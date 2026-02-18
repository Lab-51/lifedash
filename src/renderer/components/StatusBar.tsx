// === FILE PURPOSE ===
// Fixed bottom status bar showing database connection status (left)
// and dynamic context-aware content (right): pending action items, level badge, command hint.
// Hidden during focus/break modes when the full-screen FocusOverlay is active.

// === DEPENDENCIES ===
// useDatabaseStatus hook, meetingStore, focusStore, gamificationStore, react, lucide-react

import { useEffect } from 'react';
import { Timer } from 'lucide-react';
import useDatabaseStatus from '../hooks/useDatabaseStatus';
import { useMeetingStore } from '../stores/meetingStore';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import LevelBadge from './LevelBadge';

/** Resolves status indicator color class based on connection state */
function getIndicatorClass(connected: boolean, checking: boolean): string {
  if (checking) return 'bg-warning';
  return connected ? 'bg-success' : 'bg-error';
}

/** Resolves human-readable status label */
function getStatusLabel(connected: boolean, checking: boolean): string {
  if (checking) return 'Checking...';
  return connected ? 'Connected' : 'Disconnected';
}

function StatusBar() {
  const { connected, checking } = useDatabaseStatus();
  const pendingActionCount = useMeetingStore(s => s.pendingActionCount);
  const focusMode = useFocusStore(s => s.mode);
  const stats = useGamificationStore(s => s.stats);

  useEffect(() => {
    const load = useMeetingStore.getState().loadPendingActionCount;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Hide StatusBar when full-screen FocusOverlay is active
  if (focusMode === 'focus' || focusMode === 'break') return null;

  return (
    <div className="h-6 flex items-center justify-between bg-surface-900 border-t border-surface-800 px-3 shrink-0">
      {/* Left: database connection status */}
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${getIndicatorClass(connected, checking)}`}
          aria-hidden="true"
        />
        <span className="text-xs text-surface-500">
          {getStatusLabel(connected, checking)}
        </span>
      </div>

      {/* Right: dynamic content */}
      <div className="flex items-center gap-3 text-xs text-surface-600">
        {pendingActionCount > 0 && (
          <span className="text-amber-400/80">
            {pendingActionCount} pending action{pendingActionCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Completed state: brief "Done!" indicator before FocusCompleteModal opens */}
        {focusMode === 'completed' && (
          <div className="flex items-center gap-1.5">
            <Timer size={14} className="text-emerald-400" />
            <span className="text-emerald-400 font-mono">Done!</span>
          </div>
        )}

        {/* Level indicator when idle */}
        {focusMode === 'idle' && stats && (
          <LevelBadge level={stats.level} size="sm" />
        )}

        <span>Ctrl+K: Commands</span>
      </div>
    </div>
  );
}

export default StatusBar;
