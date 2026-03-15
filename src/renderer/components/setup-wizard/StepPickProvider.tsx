// Provider selection step — choose between cloud AI providers.

import { ArrowRight, ArrowLeft, Zap, Sparkles } from 'lucide-react';
import HelpTip from '../HelpTip';
import type { AIProviderName } from '../../../shared/types';
import type { ProviderOption } from './types';

const CLOUD_PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    tagline: 'GPT-4o, o3-mini — fast and versatile',
    icon: <Zap size={22} />,
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    tagline: 'Claude models — strong reasoning and safety',
    icon: <Sparkles size={22} />,
  },
];

interface StepPickProviderProps {
  selected: AIProviderName | null;
  onSelect: (v: AIProviderName) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepPickProvider({ selected, onSelect, onNext, onBack }: StepPickProviderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1 flex items-center gap-1">
          Choose a provider
          <HelpTip text="An AI provider is a company that offers AI services. Think of it like choosing a phone carrier — they all provide AI, just from different companies." />
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">Select the AI service you'd like to connect.</p>
      </div>

      <div className="flex flex-col gap-3">
        {CLOUD_PROVIDER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`relative w-full text-left p-4 rounded-lg border transition-all ${
              selected === opt.value
                ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)]'
                : 'border-[var(--color-border)] bg-[var(--color-chrome)] hover:border-[var(--color-border-accent)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 ${selected === opt.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}
              >
                {opt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`font-medium text-sm ${selected === opt.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
                >
                  {opt.label}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{opt.tagline}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!selected}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
