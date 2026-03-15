// Completion step — quick-start actions after successful setup.

import { CheckCircle, Newspaper, Mic, Sparkles } from 'lucide-react';

export interface StepDoneProps {
  onClose: () => void;
  onNavigateIntel: () => void;
  onNavigateBrainstorm: () => void;
  onNavigateMeetings: () => void;
  onNavigateSettings: () => void;
}

export default function StepDone({
  onClose,
  onNavigateIntel,
  onNavigateBrainstorm,
  onNavigateMeetings,
  onNavigateSettings,
}: StepDoneProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-2">
      <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
        <CheckCircle size={32} className="text-emerald-500" />
      </div>

      <div>
        <h2 className="font-hud text-xl tracking-tight text-[var(--color-text-primary)] mb-1">You're ready to go!</h2>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm leading-relaxed">
          AI features are active. Pick something to try right now:
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-xs pt-2">
        <button
          onClick={onNavigateIntel}
          className="cursor-pointer flex items-center gap-3 w-full py-3 px-4 btn-primary clip-corner-cut-sm text-sm font-medium text-left"
        >
          <Newspaper size={18} className="shrink-0" />
          <div>
            <div>Fetch your AI news</div>
            <div className="text-xs opacity-70 font-normal">Get today's top stories from 8 curated sources</div>
          </div>
        </button>
        <button
          onClick={onNavigateMeetings}
          className="cursor-pointer flex items-center gap-3 w-full py-3 px-4 text-sm text-left rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          <Mic size={18} className="shrink-0" />
          <div>
            <div>Record a meeting</div>
            <div className="text-xs opacity-50 font-normal">Capture audio, get AI transcripts and briefs</div>
          </div>
        </button>
        <button
          onClick={onNavigateBrainstorm}
          className="cursor-pointer flex items-center gap-3 w-full py-3 px-4 text-sm text-left rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          <Sparkles size={18} className="shrink-0" />
          <div>
            <div>Start a brainstorm</div>
            <div className="text-xs opacity-50 font-normal">Explore ideas with AI assistance</div>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-4 pt-1">
        <button
          onClick={onNavigateSettings}
          className="cursor-pointer text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          AI settings
        </button>
        <button
          onClick={onClose}
          className="cursor-pointer text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          Just explore
        </button>
      </div>
    </div>
  );
}
