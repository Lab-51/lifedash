// === FILE PURPOSE ===
// Custom frameless window title bar with drag region and window controls.

import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, Pin, PinOff } from 'lucide-react';
import dashIcon from '../assets/icon.svg';

function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);

  useEffect(() => {
    window.electronAPI.windowIsMaximized().then(setIsMaximized);
    window.electronAPI.windowIsAlwaysOnTop().then(setIsAlwaysOnTop);
    return window.electronAPI.onWindowMaximizeChange(setIsMaximized);
  }, []);

  const toggleAlwaysOnTop = async () => {
    const result = await window.electronAPI.windowSetAlwaysOnTop(!isAlwaysOnTop);
    setIsAlwaysOnTop(result);
  };

  return (
    <div
      className="h-9 flex items-center justify-between select-none shrink-0 transition-colors duration-300 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 text-surface-900 dark:text-surface-100"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 pl-3">
        <img src={dashIcon} alt="LifeDash" className="w-5 h-5" />
        <span className="text-sm font-medium opacity-80">
          LifeDash
        </span>
      </div>

      <div
        className="flex h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Pin on top */}
        <button
          type="button"
          onClick={toggleAlwaysOnTop}
          className={`w-10 h-full inline-flex items-center justify-center transition-colors ${isAlwaysOnTop
            ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/20'
            : 'opacity-60 hover:opacity-100 hover:bg-surface-200/50 dark:hover:bg-surface-800'
            }`}
          title={isAlwaysOnTop ? 'Unpin' : 'Pin on top'}
        >
          {isAlwaysOnTop ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
        </button>

        {/* Minimize */}
        <button
          type="button"
          onClick={() => window.electronAPI.windowMinimize()}
          className="w-12 h-full inline-flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-surface-200/50 dark:hover:bg-surface-800 transition-colors"
          aria-label="Minimize"
        >
          <Minus size={16} />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={() => window.electronAPI.windowMaximize()}
          className="w-12 h-full inline-flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-surface-200/50 dark:hover:bg-surface-800 transition-colors"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Copy size={14} /> : <Square size={14} />}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={() => window.electronAPI.windowClose()}
          className="w-12 h-full inline-flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-red-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
