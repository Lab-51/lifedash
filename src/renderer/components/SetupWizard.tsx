// === FILE PURPOSE ===
// Multi-step setup wizard modal for first-time AI provider configuration.
// Appears on first launch when no AI providers are configured.
// Guides the user through choosing a provider, configuring it, and testing the connection.
// Stores a "setupWizard.completed" flag in settings so it only shows once.

import { useEffect, useRef, useState } from 'react';
import {
  X,
  Bot,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Zap,
  Cpu,
  Globe,
  Sparkles,
  Key,
  HelpCircle,
} from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useNavigate } from 'react-router-dom';
import type { AIProviderName } from '../../shared/types';
import HelpTip from './HelpTip';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type WizardStep = 'welcome' | 'have-key' | 'pick-provider' | 'tutorial' | 'configure' | 'test' | 'done';

interface ProviderOption {
  value: AIProviderName;
  label: string;
  tagline: string;
  recommended?: boolean;
  icon: React.ReactNode;
}

interface SetupWizardProps {
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'ollama',
    label: 'Ollama',
    tagline: 'Local AI for advanced users — requires setup and capable hardware',
    icon: <Cpu size={22} />,
  },
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

// Cloud-only providers shown in StepPickProvider
const CLOUD_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(p => p.value !== 'ollama');

// ─────────────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────────────

function StepWelcome({ onSetup, onSkip }: { onSetup: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center text-center px-4 py-2">
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-accent-dim)] flex items-center justify-center mb-6">
        <Bot size={32} className="text-[var(--color-accent)]" />
      </div>

      <h2 className="font-hud text-xl tracking-tight text-[var(--color-text-primary)] mb-2">
        Welcome to{' '}
        <span className="text-[var(--color-accent)] text-glow">LifeDash</span>
      </h2>
      <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed mb-2 max-w-sm">
        LifeDash works great on its own. Want to supercharge it with AI?
      </p>
      <p className="text-[var(--color-text-muted)] text-xs leading-relaxed mb-8 max-w-sm">
        AI powers brainstorming, meeting summaries, smart suggestions, and more. You can always set it up later in Settings.
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

function StepHaveKey({
  onHaveKey,
  onGetHelp,
  onUseLocal,
  onSkip,
}: {
  onHaveKey: () => void;
  onGetHelp: () => void;
  onUseLocal: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1">
          Set up AI
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Choose how you'd like to connect AI to LifeDash.
        </p>
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
              <div className="font-medium text-sm text-[var(--color-text-primary)]">
                Help me get one
              </div>
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
                Requires Ollama setup, terminal usage, and a powerful computer (16 GB+ RAM). Best for technical users who want full privacy.
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

function StepPickProvider({
  selected,
  onSelect,
  onNext,
  onBack,
}: {
  selected: AIProviderName | null;
  onSelect: (v: AIProviderName) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1 flex items-center gap-1">
          Choose a provider
          <HelpTip text="An AI provider is a company that offers AI services. Think of it like choosing a phone carrier — they all provide AI, just from different companies." />
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Select the AI service you'd like to connect.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {CLOUD_PROVIDER_OPTIONS.map(opt => (
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
              <div className={`mt-0.5 ${selected === opt.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}>
                {opt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`font-medium text-sm ${selected === opt.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                  {opt.tagline}
                </div>
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

interface ConfigureStepProps {
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

function StepConfigure({
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
}: ConfigureStepProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const needsApiKey = provider !== 'ollama';

  const providerName = PROVIDER_OPTIONS.find(p => p.value === provider)?.label ?? provider;

  const canContinue = provider === 'ollama'
    ? ollamaStatus === 'found'
    : apiKey.trim().length > 0;

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
              <li>Run <code className="px-1 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] rounded text-xs">ollama serve</code> in your terminal</li>
              <li>Pull a model: <code className="px-1 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] rounded text-xs">ollama pull llama3.2</code></li>
              <li>Click "Detect Ollama" below</li>
            </ol>
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              onClick={e => { e.preventDefault(); window.electronAPI.openExternal('https://ollama.com/download'); }}
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
              {ollamaStatus === 'checking' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Globe size={14} />
              )}
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
                  Installed models:{' '}
                  <span className="text-[var(--color-accent)]">
                    {ollamaModels.join(', ')}
                  </span>
                </span>
              ) : (
                <span className="text-amber-400">
                  No models installed — run{' '}
                  <code className="px-1 py-0.5 bg-[var(--color-accent-subtle)] rounded">ollama pull llama3.2</code>
                  {' '}to add one
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
              onChange={e => onBaseUrlChange(e.target.value)}
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
            onClick={e => { e.preventDefault(); window.electronAPI.openExternal('https://platform.openai.com/api-keys'); }}
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
            onClick={e => { e.preventDefault(); window.electronAPI.openExternal('https://console.anthropic.com/settings/keys'); }}
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
              onChange={e => onApiKeyChange(e.target.value)}
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

interface TestStepProps {
  status: 'running' | 'success' | 'failure';
  error: string | null;
  latencyMs?: number;
  onNext: () => void;
  onBack: () => void;
}

function StepTest({ status, error, latencyMs, onNext, onBack }: TestStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)]">
        Testing connection
      </h2>

      <div className="w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-500">
        {status === 'running' && (
          <div className="w-20 h-20 rounded-full border-2 border-[var(--color-accent-dim)] flex items-center justify-center">
            <Loader2 size={36} className="animate-spin text-[var(--color-accent)]" />
          </div>
        )}
        {status === 'success' && (
          <div className="w-20 h-20 rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle size={40} className="text-emerald-500" />
          </div>
        )}
        {status === 'failure' && (
          <div className="w-20 h-20 rounded-full border-2 border-red-500/50 bg-red-500/10 flex items-center justify-center">
            <XCircle size={40} className="text-red-400" />
          </div>
        )}
      </div>

      {status === 'running' && (
        <p className="text-sm text-[var(--color-text-secondary)]">Connecting to your AI provider...</p>
      )}

      {status === 'success' && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-emerald-500">Connection successful!</p>
          {latencyMs != null && (
            <p className="text-xs text-[var(--color-text-muted)]">Response time: {latencyMs}ms</p>
          )}
        </div>
      )}

      {status === 'failure' && (
        <div className="space-y-2 max-w-xs">
          <p className="text-sm font-medium text-red-400">Connection failed</p>
          {error && (
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{error}</p>
          )}
        </div>
      )}

      <div className="flex gap-2 w-full pt-2">
        {status === 'failure' && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ArrowLeft size={14} />
            Fix configuration
          </button>
        )}
        {status === 'success' && (
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium"
          >
            Continue
            <ArrowRight size={16} />
          </button>
        )}
        {status === 'failure' && (
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Skip and finish anyway
          </button>
        )}
      </div>
    </div>
  );
}

function StepDone({
  onClose,
  onNavigateBrainstorm,
  onNavigateSettings,
}: {
  onClose: () => void;
  onNavigateBrainstorm: () => void;
  onNavigateSettings: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-2">
      <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
        <CheckCircle size={32} className="text-emerald-500" />
      </div>

      <div>
        <h2 className="font-hud text-xl tracking-tight text-[var(--color-text-primary)] mb-1">
          You're all set!
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm leading-relaxed">
          AI features are now active. LifeDash can help you brainstorm ideas, summarize meetings, and more.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-xs pt-2">
        <button
          onClick={onNavigateBrainstorm}
          className="flex items-center justify-center gap-2 w-full py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium"
        >
          <Sparkles size={16} />
          Try brainstorming
        </button>
        <button
          onClick={onNavigateSettings}
          className="flex items-center justify-center gap-2 w-full py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
        >
          Go to AI settings
          <ArrowRight size={14} />
        </button>
        <button
          onClick={onClose}
          className="w-full py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

interface StepTutorialProps {
  onSelectProvider: (provider: AIProviderName) => void;
  onBack: () => void;
}

function StepTutorial({ onSelectProvider, onBack }: StepTutorialProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1">
          Get an API key
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
          Choose a provider below. Both offer state-of-the-art models that power LifeDash's brainstorming, summaries, and planning.
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
                Open platform.openai.com
                {' '}
                <a
                  href="https://platform.openai.com"
                  onClick={e => { e.preventDefault(); window.electronAPI.openExternal('https://platform.openai.com'); }}
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
                Open console.anthropic.com
                {' '}
                <a
                  href="https://console.anthropic.com"
                  onClick={e => { e.preventDefault(); window.electronAPI.openExternal('https://console.anthropic.com'); }}
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
        AI providers charge small amounts per request. A few dollars in credit can power hundreds of brainstorming sessions and meeting summaries. Pricing varies as models improve — check your provider's page for current rates.
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

// ─────────────────────────────────────────────────────────────────────────────
// Progress indicator
// ─────────────────────────────────────────────────────────────────────────────

// Visible steps in the progress indicator (sub-steps collapse into 'have-key' position)
const ORDERED_STEPS: WizardStep[] = ['have-key', 'configure', 'test', 'done'];

const STEP_LABELS: Record<WizardStep, string> = {
  welcome: 'Welcome',
  'have-key': 'Provider',
  'pick-provider': 'Provider',
  tutorial: 'Provider',
  configure: 'Configure',
  test: 'Test',
  done: 'Done',
};

// Maps any step to its indicator position in ORDERED_STEPS
function getIndicatorStep(step: WizardStep): WizardStep {
  if (step === 'pick-provider' || step === 'tutorial') return 'have-key';
  return step;
}

function StepIndicator({ current }: { current: WizardStep }) {
  // Don't show indicator on welcome or have-key entry screen
  if (current === 'welcome') return null;

  const indicatorStep = getIndicatorStep(current);
  const currentIdx = ORDERED_STEPS.indexOf(indicatorStep);

  return (
    <div className="flex items-center gap-1 justify-center mb-5">
      {ORDERED_STEPS.map((step, idx) => {
        const isActive = step === indicatorStep;
        const isDone = idx < currentIdx;

        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-hud tracking-wider border transition-all ${
                isActive
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                  : isDone
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {isDone ? <CheckCircle size={12} /> : idx + 1}
            </div>
            <span
              className={`text-[10px] font-data tracking-wider uppercase transition-colors ${
                isActive ? 'text-[var(--color-accent)]' : isDone ? 'text-emerald-500' : 'text-[var(--color-text-muted)]'
              }`}
            >
              {STEP_LABELS[step]}
            </span>
            {idx < ORDERED_STEPS.length - 1 && (
              <div className={`w-4 h-px mx-1 ${isDone ? 'bg-emerald-500/40' : 'bg-[var(--color-border)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard component
// ─────────────────────────────────────────────────────────────────────────────

export default function SetupWizard({ onClose }: SetupWizardProps) {
  const navigate = useNavigate();
  const createProvider = useSettingsStore(s => s.createProvider);
  const deleteProvider = useSettingsStore(s => s.deleteProvider);
  const loadProviders = useSettingsStore(s => s.loadProviders);
  const setSetting = useSettingsStore(s => s.setSetting);

  const [step, setStep] = useState<WizardStep>('welcome');
  const [prevStep, setPrevStep] = useState<WizardStep>('have-key');
  const [createdProviderId, setCreatedProviderId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderName | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'running' | 'success' | 'failure'>('running');
  const [testError, setTestError] = useState<string | null>(null);
  const [testLatency, setTestLatency] = useState<number | undefined>(undefined);

  // Escape key closes the wizard (marks it as completed).
  // Use a ref to always call the latest handleClose without listing it as a dep,
  // avoiding both the stale-closure problem and infinite-effect loops.
  const handleCloseRef = useRef(handleClose);
  useEffect(() => { handleCloseRef.current = handleClose; }, [handleClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseRef.current();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Pre-fill base URL when provider changes and reset Ollama state
  useEffect(() => {
    if (selectedProvider === 'ollama') {
      setBaseUrl('http://localhost:11434');
    } else {
      setBaseUrl('');
    }
    setApiKey('');
    setOllamaStatus('idle');
    setOllamaModels([]);
  }, [selectedProvider]);

  // Auto-detect Ollama when entering the configure step for Ollama
  useEffect(() => {
    if (step === 'configure' && selectedProvider === 'ollama' && ollamaStatus === 'idle') {
      handleCheckOllama();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedProvider]);

  async function handleClose() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
  }

  function handleSkip() {
    handleClose();
  }

  async function handleCheckOllama() {
    setOllamaStatus('checking');
    try {
      const result = await window.electronAPI.checkOllama();
      if (result.running) {
        setOllamaStatus('found');
        setOllamaModels(result.models);
      } else {
        setOllamaStatus('not-found');
        setOllamaModels([]);
      }
    } catch {
      setOllamaStatus('not-found');
      setOllamaModels([]);
    }
  }

  async function handleSaveAndTest() {
    if (!selectedProvider) return;

    setStep('test');
    setTestStatus('running');
    setTestError(null);
    setTestLatency(undefined);

    try {
      const provider = await createProvider({
        name: selectedProvider,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      setCreatedProviderId(provider.id);

      const result = await window.electronAPI.testAIConnection(provider.id);
      if (result.success) {
        setTestStatus('success');
        setTestLatency(result.latencyMs);
      } else {
        setTestStatus('failure');
        setTestError(result.error ?? 'Connection test failed');
      }

      // Refresh providers in the store
      await loadProviders();
    } catch (err) {
      setTestStatus('failure');
      setTestError(err instanceof Error ? err.message : 'Failed to create provider');
    }
  }

  function handleConfigureNext() {
    handleSaveAndTest();
  }

  async function handleTestBack() {
    if (createdProviderId) {
      await deleteProvider(createdProviderId);
      setCreatedProviderId(null);
      await loadProviders();
    }
    setStep('configure');
  }

  async function handleDone() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
  }

  async function handleNavigateBrainstorm() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
    navigate('/brainstorm');
  }

  async function handleNavigateSettings() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
    navigate('/settings');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleSkip}
    >
      <div
        className="w-full max-w-[560px] mx-4 hud-panel-accent clip-corner-cut shadow-2xl relative overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] bg-[radial-gradient(ellipse,rgba(62,232,228,0.06)_0%,transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-accent)]">
          <span className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)]">
            Setup Wizard
          </span>
          <button
            onClick={handleSkip}
            className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <StepIndicator current={step} />

          {step === 'welcome' && (
            <StepWelcome
              onSetup={() => setStep('have-key')}
              onSkip={handleSkip}
            />
          )}

          {step === 'have-key' && (
            <StepHaveKey
              onHaveKey={() => setStep('pick-provider')}
              onGetHelp={() => setStep('tutorial')}
              onUseLocal={() => {
                setSelectedProvider('ollama');
                setPrevStep('have-key');
                setStep('configure');
              }}
              onSkip={handleClose}
            />
          )}

          {step === 'pick-provider' && (
            <StepPickProvider
              selected={selectedProvider}
              onSelect={setSelectedProvider}
              onNext={() => {
                setPrevStep('pick-provider');
                setStep('configure');
              }}
              onBack={() => setStep('have-key')}
            />
          )}

          {step === 'tutorial' && (
            <StepTutorial
              onSelectProvider={(provider) => {
                setSelectedProvider(provider);
                setPrevStep('tutorial');
                setStep('configure');
              }}
              onBack={() => setStep('have-key')}
            />
          )}

          {step === 'configure' && selectedProvider && (
            <StepConfigure
              provider={selectedProvider}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              baseUrl={baseUrl}
              onBaseUrlChange={setBaseUrl}
              ollamaStatus={ollamaStatus}
              ollamaModels={ollamaModels}
              onCheckOllama={handleCheckOllama}
              onNext={handleConfigureNext}
              onBack={() => setStep(prevStep)}
            />
          )}

          {step === 'test' && (
            <StepTest
              status={testStatus}
              error={testError}
              latencyMs={testLatency}
              onNext={() => setStep('done')}
              onBack={handleTestBack}
            />
          )}

          {step === 'done' && (
            <StepDone
              onClose={handleDone}
              onNavigateBrainstorm={handleNavigateBrainstorm}
              onNavigateSettings={handleNavigateSettings}
            />
          )}
        </div>
      </div>
    </div>
  );
}
