// === FILE PURPOSE ===
// Fixed bottom status bar showing database connection status (left)
// and dynamic context-aware content (right): sync indicator, pending action items,
// level badge, command hint.
// Hidden during focus/break modes when the full-screen FocusOverlay is active.

// === DEPENDENCIES ===
// useDatabaseStatus hook, useSyncStatus hook, meetingStore, focusStore, gamificationStore,
// react, react-router-dom, lucide-react

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, Cloud, CloudOff, AlertCircle } from 'lucide-react';
import useDatabaseStatus from '../hooks/useDatabaseStatus';
import useSyncStatus, { formatRelativeTime } from '../hooks/useSyncStatus';
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

/** Sync status indicator for the status bar */
function SyncIndicator() {
  const sync = useSyncStatus();
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  // Don't show sync indicator if user has never authenticated
  if (!sync.isAuthenticated && !sync.isEnabled) return null;

  const handleClick = () => {
    navigate('/settings?tab=data');
  };

  let icon: React.ReactNode;
  let tooltip: string;

  switch (sync.status) {
    case 'syncing':
      icon = <Cloud size={14} className="animate-pulse text-blue-400" />;
      tooltip = 'Syncing...';
      break;
    case 'synced':
      icon = <Cloud size={14} className="text-emerald-400/70" />;
      tooltip = sync.lastSyncedAt ? `Synced ${formatRelativeTime(sync.lastSyncedAt)}` : 'Synced';
      break;
    case 'error':
      icon = <AlertCircle size={14} className="text-red-400" />;
      tooltip = 'Sync error \u2014 click to view';
      break;
    case 'offline':
      icon = <CloudOff size={14} className="text-amber-400/70" />;
      tooltip = 'Offline';
      break;
    default:
      icon = <CloudOff size={14} className="text-[var(--color-text-muted)]" />;
      tooltip = 'Cloud sync disabled';
      break;
  }

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex items-center gap-1 text-xs transition-colors hover:text-[var(--color-text-primary)]"
      aria-label={tooltip}
    >
      {icon}
      {hovered && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[0.625rem] whitespace-nowrap bg-[var(--color-chrome)] border border-[var(--color-border)] text-[var(--color-text-secondary)] rounded shadow-lg pointer-events-none z-50">
          {tooltip}
        </span>
      )}
    </button>
  );
}

function StatusBar() {
  const { connected, checking } = useDatabaseStatus();
  const pendingActionCount = useMeetingStore((s) => s.pendingActionCount);
  const focusMode = useFocusStore((s) => s.mode);
  const stats = useGamificationStore((s) => s.stats);

  useEffect(() => {
    const load = useMeetingStore.getState().loadPendingActionCount;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Hide StatusBar when full-screen FocusOverlay is active
  if (focusMode === 'focus' || focusMode === 'break') return null;

  return (
    <div className="shrink-0">
      {/* Top accent divider */}
      <div className="ruled-line-accent" />

      <div className="h-6 flex items-center justify-between bg-[var(--color-chrome)] border-t border-[var(--color-border)] px-3 font-data">
        {/* Left: database connection status */}
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${getIndicatorClass(connected, checking)}`} aria-hidden="true" />
          <span className="text-xs text-[var(--color-text-secondary)] animate-data-flicker">
            {getStatusLabel(connected, checking)}
          </span>
        </div>

        {/* Right: dynamic content */}
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <SyncIndicator />

          {pendingActionCount > 0 && (
            <span className="text-amber-400/80">
              {pendingActionCount} pending action{pendingActionCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Completed state: brief "Done!" indicator before FocusCompleteModal opens */}
          {focusMode === 'completed' && (
            <div className="flex items-center gap-1.5">
              <Timer size={14} className="text-emerald-400" />
              <span className="text-emerald-400">Done!</span>
            </div>
          )}

          {/* Level indicator when idle */}
          {focusMode === 'idle' && stats && <LevelBadge level={stats.level} size="sm" />}

          <span className="text-[var(--color-text-muted)]">Ctrl+K: Commands</span>
        </div>
      </div>
    </div>
  );
}

export default StatusBar;
