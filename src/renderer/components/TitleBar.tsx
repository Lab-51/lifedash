// === FILE PURPOSE ===
// Custom frameless window title bar with drag region and window controls.
// Renders at the top of the app: app title on the left, min/max/close on the right.

// === DEPENDENCIES ===
// React, lucide-react (Minus, Square, Copy, X icons)

import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

/**
 * Custom title bar for the frameless Electron window.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Living Dashboard                           [─] [□/❐] [✕]   │
 * │ ←drag region→                              ←no-drag btns→   │
 * └──────────────────────────────────────────────────────────────┘
 */
function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Get initial maximize state
    window.electronAPI.windowIsMaximized().then(setIsMaximized);

    // Subscribe to maximize/unmaximize events (e.g. from Windows snap)
    const cleanup = window.electronAPI.onWindowMaximizeChange(setIsMaximized);
    return cleanup;
  }, []);

  return (
    <div
      className="h-9 flex items-center justify-between bg-surface-900 border-b border-surface-800 select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App title */}
      <span className="pl-3 text-sm font-medium text-surface-300">
        Living Dashboard
      </span>

      {/* Window control buttons */}
      <div
        className="flex"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          type="button"
          onClick={() => window.electronAPI.windowMinimize()}
          className="w-12 h-9 inline-flex items-center justify-center text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors"
          aria-label="Minimize"
        >
          <Minus size={16} />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={() => window.electronAPI.windowMaximize()}
          className="w-12 h-9 inline-flex items-center justify-center text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Copy size={14} /> : <Square size={14} />}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={() => window.electronAPI.windowClose()}
          className="w-12 h-9 inline-flex items-center justify-center text-surface-400 hover:bg-red-600 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
