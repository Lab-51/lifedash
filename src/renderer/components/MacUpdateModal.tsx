// === FILE PURPOSE ===
// macOS-specific update modal. On macOS, LifeDash cannot auto-update like
// Windows (no silent Inno Setup installer). Instead we show this modal with
// two options: Homebrew upgrade command (with copy button) or direct DMG
// download from GitHub releases.

import { useState, useCallback } from 'react';
import { X, Download, Copy, Check, Terminal, ExternalLink } from 'lucide-react';
import FocusTrap from './FocusTrap';

interface MacUpdateModalProps {
  /** The new version available, e.g. "2.2.28" or "v2.2.28" */
  version: string;
  isOpen: boolean;
  onClose: () => void;
}

const RELEASES_URL = 'https://github.com/Lab-51/lifedash/releases/latest';
const BREW_COMMAND = 'brew upgrade --cask lifedash';

export default function MacUpdateModal({ version, isOpen, onClose }: MacUpdateModalProps) {
  const [copied, setCopied] = useState(false);

  const displayVersion = version.startsWith('v') ? version : `v${version}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(BREW_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select-and-copy via a temporary textarea
      const el = document.createElement('textarea');
      el.value = BREW_COMMAND;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const handleDownload = useCallback(() => {
    window.electronAPI.openExternal(RELEASES_URL);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <FocusTrap active={isOpen} onDeactivate={onClose}>
        <div
          className="w-full max-w-md mx-4 hud-panel-accent clip-corner-cut shadow-2xl relative overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Ambient glow */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse, rgba(62,232,228,0.08) 0%, transparent 70%)' }}
          />

          {/* Header bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-accent)] relative">
            <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
              Update Available
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 relative">
            {/* Title + version */}
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-accent-dim)] flex items-center justify-center mb-4">
                <Download size={28} className="text-[var(--color-accent)]" />
              </div>
              <h2 className="font-hud text-lg tracking-tight text-[var(--color-text-primary)] mb-1">
                Update Available
              </h2>
              <p className="text-[var(--color-text-secondary)] text-sm mb-1">
                LifeDash {displayVersion} is ready. Auto-update isn't available on macOS — use one of the options below.
              </p>
            </div>

            {/* Option A: Homebrew */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={14} className="text-[var(--color-accent)]" />
                <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
                  Homebrew (recommended)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-sm font-data text-[var(--color-accent)] bg-[var(--color-void)]/60 border border-[var(--color-border)] rounded-md select-all overflow-hidden whitespace-nowrap">
                  {BREW_COMMAND}
                </code>
                <button
                  onClick={handleCopy}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-all ${
                    copied
                      ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] hover:bg-[var(--color-accent-subtle)]'
                  }`}
                  title="Copy command to clipboard"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Option B: Direct download */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ExternalLink size={14} className="text-[var(--color-text-muted)]" />
                <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-text-muted)]">
                  Direct Download
                </span>
              </div>
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] hover:bg-[var(--color-accent-subtle)] rounded-md transition-all"
              >
                <Download size={14} />
                Download from GitHub Releases
              </button>
              <p className="text-xs text-[var(--color-text-muted)] mt-1.5 text-center">
                Download the latest .dmg and drag LifeDash to Applications
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--color-border)] flex justify-center relative">
            <button
              onClick={onClose}
              className="px-6 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              autoFocus
            >
              Close
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
