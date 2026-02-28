// === FILE PURPOSE ===
// Custom frameless window title bar with drag region and window controls.
// HUD styled: void-dark gradient, teal accent line, Orbitron app name.

import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, Pin, PinOff, Download, CheckCircle, Loader2 } from 'lucide-react';
import dashIcon from '../assets/icon.svg';

type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'ready' | 'error';

function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [releaseName, setReleaseName] = useState<string>('');

  useEffect(() => {
    window.electronAPI.windowIsMaximized().then(setIsMaximized);
    window.electronAPI.windowIsAlwaysOnTop().then(setIsAlwaysOnTop);
    return window.electronAPI.onWindowMaximizeChange(setIsMaximized);
  }, []);

  // Listen for auto-update status lifecycle events.
  // In dev mode the auto-updater doesn't run, so default to "up-to-date".
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) {
      setUpdateStatus('up-to-date');
      return;
    }
    return window.electronAPI.onUpdateStatus((data) => {
      setUpdateStatus(data.status as UpdateStatus);
      if (data.releaseName) setReleaseName(data.releaseName);
    });
  }, []);

  const toggleAlwaysOnTop = async () => {
    const result = await window.electronAPI.windowSetAlwaysOnTop(!isAlwaysOnTop);
    setIsAlwaysOnTop(result);
  };

  return (
    <div className="relative shrink-0 select-none">
      {/* Top accent line */}
      <div className="ruled-line-accent" />

      <div
        className="h-9 flex items-center justify-between transition-colors duration-300 hud-chrome-bg border-b border-[var(--color-border)] text-[var(--color-text-primary)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 pl-3">
          <img src={dashIcon} alt="LifeDash" className="w-5 h-5" />
          <span className="font-hud text-xs tracking-tight font-bold">
            <span className="text-[var(--color-text-primary)]">LIFE</span>
            <span className="text-[var(--color-accent)] text-glow">DASH</span>
          </span>
        </div>

        <div
          className="flex h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Update status indicator */}
          {updateStatus === 'checking' && (
            <div className="h-full inline-flex items-center gap-1.5 px-3 text-xs text-[var(--color-text-muted)]" title="Checking for updates...">
              <Loader2 size={12} className="animate-spin" />
              <span>Checking</span>
            </div>
          )}
          {updateStatus === 'up-to-date' && (
            <div className="h-full inline-flex items-center gap-1.5 px-3 text-xs text-emerald-500/70" title="You're on the latest version">
              <CheckCircle size={12} />
              <span>Up to date</span>
            </div>
          )}
          {updateStatus === 'ready' && (
            <button
              type="button"
              onClick={() => window.electronAPI.installUpdate()}
              className="h-full inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/15 transition-colors"
              title={`Update ${releaseName} ready — click to restart and install`}
            >
              <Download size={13} />
              <span>Update</span>
            </button>
          )}

          {/* Pin on top */}
          <button
            type="button"
            onClick={toggleAlwaysOnTop}
            className={`w-10 h-full inline-flex items-center justify-center transition-colors ${isAlwaysOnTop
              ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]'
              }`}
            title={isAlwaysOnTop ? 'Unpin' : 'Pin on top'}
          >
            {isAlwaysOnTop ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
          </button>

          {/* Minimize */}
          <button
            type="button"
            onClick={() => window.electronAPI.windowMinimize()}
            className="w-12 h-full inline-flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            aria-label="Minimize"
          >
            <Minus size={16} />
          </button>

          {/* Maximize / Restore */}
          <button
            type="button"
            onClick={() => window.electronAPI.windowMaximize()}
            className="w-12 h-full inline-flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Copy size={14} /> : <Square size={14} />}
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={() => window.electronAPI.windowClose()}
            className="w-12 h-full inline-flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-red-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default TitleBar;
