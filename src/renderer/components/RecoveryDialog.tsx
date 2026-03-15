// === FILE PURPOSE ===
// Full-screen modal shown on startup when a crash marker is detected.
// Lists recoverable items and lets the user restore or discard them.

import FocusTrap from './FocusTrap';
import { AlertTriangle } from 'lucide-react';
import type { RecoveryState } from '../../shared/types/electron-api';

interface RecoveryDialogProps {
  state: RecoveryState;
  onRestore: () => void;
  onDiscard: () => void;
}

export default function RecoveryDialog({ state, onRestore, onDiscard }: RecoveryDialogProps) {
  const hasRecording = !!state.activeRecording;
  const draftCount = state.cardDrafts?.length ?? 0;
  const aiOpCount = state.pendingAiOps?.length ?? 0;
  const hasRecoverable = hasRecording || draftCount > 0 || aiOpCount > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onDiscard}
    >
      <FocusTrap active={true} onDeactivate={onDiscard}>
        <div
          className="w-full max-w-md mx-4 hud-panel-accent clip-corner-cut shadow-2xl relative overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--color-border-accent)]">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <AlertTriangle size={20} className="text-amber-400" />
            </div>
            <div>
              <h2 className="font-hud text-base tracking-tight text-[var(--color-text-primary)]">Session Recovery</h2>
              <p className="text-xs text-[var(--color-text-muted)]">The app closed unexpectedly</p>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-3">
            {hasRecording && (
              <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />A recording was in progress when
                the app closed unexpectedly.
              </div>
            )}
            {draftCount > 0 && (
              <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mt-1.5 shrink-0" />
                {draftCount} unsaved card edit{draftCount !== 1 ? 's' : ''} can be restored.
              </div>
            )}
            {aiOpCount > 0 && (
              <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mt-1.5 shrink-0" />
                {aiOpCount} AI operation{aiOpCount !== 1 ? 's' : ''} {aiOpCount !== 1 ? 'were' : 'was'} interrupted.
              </div>
            )}
            {!hasRecoverable && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                The app closed unexpectedly but no data was lost.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
            <button
              onClick={onDiscard}
              className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-accent-subtle)] transition-colors clip-corner-cut-sm"
            >
              Discard
            </button>
            <button
              onClick={onRestore}
              className="px-4 py-2 text-sm font-medium btn-primary clip-corner-cut-sm"
              autoFocus
            >
              {hasRecoverable ? 'Restore' : 'Dismiss'}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
