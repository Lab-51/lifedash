// Provider configuration step — enter API key or detect Ollama.

import { useState } from 'react';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, ArrowRight, ArrowLeft, ExternalLink, Globe } from 'lucide-react';
import HelpTip from '../HelpTip';
import type { AIProviderName } from '../../../shared/types';

const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

export interface StepConfigureProps {
  provider: AIProviderName;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  ollamaStatus: 'idle' | 'checking' | 'found' | 'not-found';
  ollamaModels: string[];
  onCheckOllama: () => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepConfigure({
  provider,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  ollamaStatus,
  ollamaModels,
  onCheckOllama,
  onNext,
  onBack,
}: StepConfigureProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const needsApiKey = provider !== 'ollama';

  const providerName = PROVIDER_LABELS[provider] ?? provider;

  const canContinue = provider === 'ollama' ? ollamaStatus === 'found' : apiKey.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1">
          Configure {providerName}
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {provider === 'ollama'
            ? 'LifeDash will connect to your local Ollama instance.'
            : `Enter your ${providerName} API key to get started.`}
        </p>
      </div>

      {provider === 'ollama' && (
        <div className="flex flex-col gap-3">
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] text-sm text-[var(--color-text-secondary)] space-y-2 leading-relaxed">
            <p className="font-medium text-[var(--color-text-primary)]">How to set up Ollama:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-[var(--color-text-secondary)]">
              <li>Download and install Ollama from ollama.com</li>
              <li>
                Run{' '}
                <code className="px-1 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] rounded text-xs">
                  ollama serve
                </code>{' '}
                in your terminal
              </li>
              <li>
                Pull a model:{' '}
                <code className="px-1 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] rounded text-xs">
                  ollama pull llama3.2
                </code>
              </li>
              <li>Click "Detect Ollama" below</li>
            </ol>
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                window.electronAPI.openExternal('https://ollama.com/download');
              }}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline mt-1"
            >
              Download Ollama
              <ExternalLink size={11} />
            </a>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCheckOllama}
              disabled={ollamaStatus === 'checking'}
              className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] px-4 py-2 text-sm transition-all clip-corner-cut-sm disabled:opacity-50"
            >
              {ollamaStatus === 'checking' ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
              {ollamaStatus === 'checking' ? 'Detecting...' : 'Detect Ollama'}
            </button>

            {ollamaStatus === 'found' && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-500">
                <CheckCircle size={16} />
                Ollama is running
              </div>
            )}
            {ollamaStatus === 'not-found' && (
              <div className="flex items-center gap-1.5 text-sm text-red-400">
                <XCircle size={16} />
                Not detected
              </div>
            )}
          </div>

          {/* Model list after successful detection */}
          {ollamaStatus === 'found' && (
            <div className="text-xs text-[var(--color-text-secondary)] font-data">
              {ollamaModels.length > 0 ? (
                <span>
                  Installed models: <span className="text-[var(--color-accent)]">{ollamaModels.join(', ')}</span>
                </span>
              ) : (
                <span className="text-amber-400">
                  No models installed — run{' '}
                  <code className="px-1 py-0.5 bg-[var(--color-accent-subtle)] rounded">ollama pull llama3.2</code> to
                  add one
                </span>
              )}
            </div>
          )}

          {/* Base URL for Ollama */}
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">
              Base URL <span className="text-[var(--color-text-muted)]">(default: localhost:11434)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => onBaseUrlChange(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full text-sm bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
            />
          </div>
        </div>
      )}

      {provider === 'openai' && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] text-xs text-[var(--color-text-secondary)] space-y-1.5 leading-relaxed">
          <p className="font-medium text-[var(--color-text-primary)] text-sm">How to get your OpenAI API key:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Go to platform.openai.com</li>
            <li>Sign in or create an account</li>
            <li>Navigate to API Keys in your account settings</li>
            <li>Create a new secret key and paste it below</li>
          </ol>
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openExternal('https://platform.openai.com/api-keys');
            }}
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline mt-1"
          >
            Open OpenAI API Keys
            <ExternalLink size={11} />
          </a>
        </div>
      )}

      {provider === 'anthropic' && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] text-xs text-[var(--color-text-secondary)] space-y-1.5 leading-relaxed">
          <p className="font-medium text-[var(--color-text-primary)] text-sm">How to get your Anthropic API key:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Go to console.anthropic.com</li>
            <li>Sign in or create an account</li>
            <li>Navigate to API Keys in your settings</li>
            <li>Create a new key and paste it below</li>
          </ol>
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openExternal('https://console.anthropic.com/settings/keys');
            }}
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline mt-1"
          >
            Open Anthropic Console
            <ExternalLink size={11} />
          </a>
        </div>
      )}

      {needsApiKey && (
        <div>
          <label className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">
            API Key
            <HelpTip text="A secret code from your AI provider. It's like a password — keep it private. LifeDash stores it securely on your computer." />
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              autoComplete="off"
              className="w-full text-sm bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-lg px-3 py-2 pr-10 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      )}

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
          disabled={!canContinue}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save & Test Connection
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
