// === FILE PURPOSE ===
// Fixed bottom status bar showing database connection status (left)
// and keyboard shortcut hints (right). Uses the useDatabaseStatus hook
// to poll and display real-time connection state.

// === DEPENDENCIES ===
// useDatabaseStatus hook

import useDatabaseStatus from '../hooks/useDatabaseStatus';

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

      {/* Right: keyboard shortcut hints */}
      <span className="text-xs text-surface-600">Ctrl+1-5: Navigate</span>
    </div>
  );
}

export default StatusBar;
