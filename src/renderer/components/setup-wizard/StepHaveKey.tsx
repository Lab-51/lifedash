// "Set up AI" branching step — user chooses how to connect AI.

import { Key, HelpCircle, Cpu, ArrowRight } from 'lucide-react';
import HelpTip from '../HelpTip';

interface StepHaveKeyProps {
  onHaveKey: () => void;
  onGetHelp: () => void;
  onUseLocal: () => void;
  onSkip: () => void;
}

export default function StepHaveKey({ onHaveKey, onGetHelp, onUseLocal, onSkip }: StepHaveKeyProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1">Set up AI</h2>
        <p className="text-xs text-[var(--color-text-secondary)]">Choose how you'd like to connect AI to LifeDash.</p>
      </div>

      <div className="flex flex-col gap-3">
        {/* Option A: I have an API key */}
        <button
          type="button"
          onClick={onHaveKey}
          className="w-full text-left p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] hover:border-[var(--color-border-accent)] transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-[var(--color-text-secondary)]">
              <Key size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-[var(--color-text-primary)] flex items-center gap-1">
                I have an API key
                <HelpTip text="A secret code that lets LifeDash talk to AI services like OpenAI or Anthropic. You get one by creating a free account on their website." />
              </div>
            </div>
            <ArrowRight size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
          </div>
        </button>

        {/* Option B: Help me get one */}
        <button
          type="button"
          onClick={onGetHelp}
          className="w-full text-left p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] hover:border-[var(--color-border-accent)] transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-[var(--color-text-secondary)]">
              <HelpCircle size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-[var(--color-text-primary)]">Help me get one</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                Takes about 2 minutes. We'll walk you through it.
              </div>
            </div>
            <ArrowRight size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
          </div>
        </button>

        {/* Option C: Run AI locally (advanced) */}
        <button
          type="button"
          onClick={onUseLocal}
          className="w-full text-left p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] hover:border-[var(--color-border-accent)] transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-[var(--color-text-secondary)]">
              <Cpu size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-[var(--color-text-primary)] flex items-center gap-1">
                Run AI locally <span className="text-[var(--color-text-muted)] font-normal">(advanced)</span>
                <HelpTip text="Free software called Ollama that runs AI on your own computer. More private, but requires a powerful machine (16 GB+ RAM) and some technical setup." />
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                Requires Ollama setup, terminal usage, and a powerful computer (16 GB+ RAM). Best for technical users
                who want full privacy.
              </div>
            </div>
            <ArrowRight size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
          </div>
        </button>
      </div>

      {/* Option D: Skip */}
      <button
        type="button"
        onClick={onSkip}
        className="w-full py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-center"
      >
        Skip for now
      </button>
    </div>
  );
}
