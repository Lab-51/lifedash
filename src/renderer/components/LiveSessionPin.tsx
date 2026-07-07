// === FILE PURPOSE ===
// Pinned live-session card shown atop Sessions Home while recording — elapsed
// time, project, and a "Return to Live" button that un-minimizes LiveModeOverlay.

import { Sparkles } from 'lucide-react';

/** Format elapsed seconds as mm:ss (mirrors LiveModeOverlay's formatter). */
function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

interface LiveSessionPinProps {
  title: string;
  projectName?: string;
  elapsed: number;
  onReturnToLive: () => void;
}

export default function LiveSessionPin({ title, projectName, elapsed, onReturnToLive }: LiveSessionPinProps) {
  return (
    <div
      data-testid="live-session-pin"
      className="mb-6 hud-panel-accent clip-corner-cut-sm p-5 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{title}</p>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            {projectName && <span className="truncate">{projectName}</span>}
            <span className="font-data tabular-nums" aria-label="Elapsed time">
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={onReturnToLive}
        className="shrink-0 flex items-center gap-1.5 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      >
        <Sparkles size={14} />
        Return to Live
      </button>
    </div>
  );
}
