// === FILE PURPOSE ===
// Fixed bottom status bar showing database connection status (left)
// and dynamic context-aware content (right): focus timer, pending action items + command hint.
// Uses the useDatabaseStatus hook for connection state, meetingStore for action counts,
// and focusStore for Pomodoro timer display.

// === DEPENDENCIES ===
// useDatabaseStatus hook, meetingStore, focusStore, react, lucide-react

import { useEffect } from 'react';
import { Timer, Coffee, Pause, Play, Square } from 'lucide-react';
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

/** Formats seconds as MM:SS */
function formatTime(s: number): string {
  return Math.floor(s / 60).toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0');
}

function StatusBar() {
  const { connected, checking } = useDatabaseStatus();
  const pendingActionCount = useMeetingStore(s => s.pendingActionCount);
  const focusMode = useFocusStore(s => s.mode);
  const timeRemaining = useFocusStore(s => s.timeRemaining);
  const isPaused = useFocusStore(s => s.isPaused);
  const focusedCardTitle = useFocusStore(s => s.focusedCardTitle);
  const stats = useGamificationStore(s => s.stats);

  useEffect(() => {
    const load = useMeetingStore.getState().loadPendingActionCount;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

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

      {/* Right: pending actions + command hint */}
      <div className="flex items-center gap-3 text-xs text-surface-600">
        {pendingActionCount > 0 && (
          <span className="text-amber-400/80">
            {pendingActionCount} pending action{pendingActionCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Level indicator when idle */}
        {focusMode === 'idle' && stats && (
          <button
            onClick={() => useFocusStore.getState().setShowStartModal(true)}
            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
            title="Start focus session"
          >
            <LevelBadge level={stats.level} size="sm" />
          </button>
        )}

        {/* Focus / break timer */}
        {(focusMode === 'focus' || focusMode === 'break' || focusMode === 'completed') && (
          <div className="flex items-center gap-1.5">
            {focusMode === 'focus' && <Timer size={14} className="text-emerald-400" />}
            {focusMode === 'break' && <Coffee size={14} className="text-amber-400" />}
            {focusMode === 'completed' && <Timer size={14} className="text-emerald-400" />}

            {focusedCardTitle && (
              <span className="max-w-[120px] truncate text-surface-300">{focusedCardTitle}</span>
            )}

            <span className={focusMode === 'break' ? 'text-amber-400 font-mono' : 'text-emerald-400 font-mono'}>
              {focusMode === 'completed' ? 'Done!' : formatTime(timeRemaining)}
            </span>

            {(focusMode === 'focus' || focusMode === 'break') && (
              <>
                <button
                  onClick={() => isPaused ? useFocusStore.getState().resume() : useFocusStore.getState().pause()}
                  className="p-0.5 text-surface-400 hover:text-surface-200 transition-colors"
                  aria-label={isPaused ? 'Resume' : 'Pause'}
                >
                  {isPaused ? <Play size={14} /> : <Pause size={14} />}
                </button>
                <button
                  onClick={() => useFocusStore.getState().stop()}
                  className="p-0.5 text-surface-500 hover:text-red-400 transition-colors"
                  aria-label="Stop focus session"
                >
                  <Square size={14} />
                </button>
              </>
            )}
          </div>
        )}

        <span>Ctrl+K: Commands</span>
      </div>
    </div>
  );
}

export default StatusBar;
