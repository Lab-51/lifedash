// API key tutorial step — guided walkthrough for getting an API key.

import { Zap, Sparkles, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import type { AIProviderName } from '../../../shared/types';

interface StepTutorialProps {
  onSelectProvider: (provider: AIProviderName) => void;
  onBack: () => void;
}

export default function StepTutorial({ onSelectProvider, onBack }: StepTutorialProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1">Get an API key</h2>
        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
          Choose a provider below. Both offer state-of-the-art models that power LifeDash's brainstorming, summaries,
          and planning.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* OpenAI card */}
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-[var(--color-text-secondary)]" />
            <span className="font-medium text-sm text-[var(--color-text-primary)]">OpenAI</span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">GPT-4o, o3-mini — fast and versatile</p>
          <ol className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">1.</span>
              <span>
                Open platform.openai.com{' '}
                <a
                  href="https://platform.openai.com"
                  onClick={(e) => {
                    e.preventDefault();
                    window.electronAPI.openExternal('https://platform.openai.com');
                  }}
                  className="inline-flex items-center gap-0.5 text-[var(--color-accent)] hover:underline"
                >
                  <ExternalLink size={11} />
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">2.</span>
              <span>Create a free account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">3.</span>
              <span>Add credit to your account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">4.</span>
              <span>Go to API Keys — create a new key</span>
            </li>
          </ol>
          <button
            type="button"
            onClick={() => onSelectProvider('openai')}
            className="w-full flex items-center justify-center gap-2 py-2 btn-primary clip-corner-cut-sm text-xs font-medium"
          >
            Choose OpenAI
            <ArrowRight size={13} />
          </button>
        </div>

        {/* Anthropic card */}
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-[var(--color-text-secondary)]" />
            <span className="font-medium text-sm text-[var(--color-text-primary)]">Anthropic</span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Claude models — strong reasoning and safety</p>
          <ol className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">1.</span>
              <span>
                Open console.anthropic.com{' '}
                <a
                  href="https://console.anthropic.com"
                  onClick={(e) => {
                    e.preventDefault();
                    window.electronAPI.openExternal('https://console.anthropic.com');
                  }}
                  className="inline-flex items-center gap-0.5 text-[var(--color-accent)] hover:underline"
                >
                  <ExternalLink size={11} />
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">2.</span>
              <span>Create an account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">3.</span>
              <span>Add credit to your account</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-data text-[var(--color-accent)] shrink-0">4.</span>
              <span>Go to API Keys — create a new key</span>
            </li>
          </ol>
          <button
            type="button"
            onClick={() => onSelectProvider('anthropic')}
            className="w-full flex items-center justify-center gap-2 py-2 btn-primary clip-corner-cut-sm text-xs font-medium"
          >
            Choose Anthropic
            <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed px-0.5">
        AI providers charge small amounts per request. A few dollars in credit can power hundreds of brainstorming
        sessions and meeting summaries. Pricing varies as models improve — check your provider's page for current rates.
      </p>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
      </div>
    </div>
  );
}
