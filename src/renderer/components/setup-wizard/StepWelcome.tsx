// Welcome screen — first step of the setup wizard.

import { Bot, ArrowRight } from 'lucide-react';

interface StepWelcomeProps {
  onSetup: () => void;
  onSkip: () => void;
}

export default function StepWelcome({ onSetup, onSkip }: StepWelcomeProps) {
  return (
    <div className="flex flex-col items-center text-center px-4 py-2">
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-accent-dim)] flex items-center justify-center mb-6">
        <Bot size={32} className="text-[var(--color-accent)]" />
      </div>

      <h2 className="font-hud text-xl tracking-tight text-[var(--color-text-primary)] mb-2">
        Welcome to <span className="text-[var(--color-accent)] text-glow">LifeDash</span>
      </h2>
      <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed mb-2 max-w-sm">
        LifeDash works great on its own. Want to supercharge it with AI?
      </p>
      <p className="text-[var(--color-text-muted)] text-xs leading-relaxed mb-8 max-w-sm">
        AI powers brainstorming, meeting summaries, smart suggestions, and more. You can always set it up later in
        Settings.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={onSetup}
          className="flex items-center justify-center gap-2 w-full py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium"
        >
          Set up AI now
          <ArrowRight size={16} />
        </button>
        <button
          onClick={onSkip}
          className="w-full py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Skip — I'll do it later
        </button>
      </div>
    </div>
  );
}
