// === FILE PURPOSE ===
// Form component for adding a new AI provider configuration.
// Shown inline on the Settings page when the user clicks "Add Provider".

import { useState, useEffect } from 'react';
import { Bot, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AIProviderName } from '../../shared/types';

const PROVIDER_OPTIONS: { value: AIProviderName; label: string; description: string }[] = [
  { value: 'openai', label: 'OpenAI', description: 'GPT-5.2, GPT-5 Mini, o4-mini' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude Sonnet, Claude Haiku' },
  { value: 'ollama', label: 'Ollama', description: 'Local models (Llama, Mistral, etc.)' },
  { value: 'kimi', label: 'Kimi', description: 'Kimi K2.5 by Moonshot AI' },
];

interface AddProviderFormProps {
  onClose: () => void;
}

export default function AddProviderForm({ onClose }: AddProviderFormProps) {
  const createProvider = useSettingsStore((s) => s.createProvider);
  const [name, setName] = useState<AIProviderName>('openai');
  const [displayName, setDisplayName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsApiKey = name !== 'ollama';
  const [ollamaDetected, setOllamaDetected] = useState<boolean | null>(null);

  // Auto-detect Ollama when Ollama is selected as the provider
  useEffect(() => {
    if (name !== 'ollama') {
      setOllamaDetected(null);
      return;
    }
    setOllamaDetected(null);
    window.electronAPI
      .checkOllama()
      .then((result) => {
        setOllamaDetected(result.running);
      })
      .catch(() => {
        setOllamaDetected(false);
      });
  }, [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsApiKey && !apiKey.trim()) {
      setError('API key is required for this provider');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createProvider({
        name,
        displayName: displayName.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="hud-panel clip-corner-cut-sm p-4">
      <h3 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)] mb-4">
        Add AI Provider
      </h3>

      {error && (
        <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-data">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Provider type selection -- button group */}
        <div>
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">Provider</label>
          <div className="flex gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setName(opt.value);
                  if (opt.value === 'ollama' && !baseUrl) {
                    setBaseUrl('http://localhost:11434');
                  } else if (opt.value === 'kimi' && !baseUrl) {
                    setBaseUrl('https://api.moonshot.ai/v1');
                  }
                }}
                className={`flex-1 p-2.5 rounded-lg border text-left text-sm transition-all ${
                  name === opt.value
                    ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)]'
                }`}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Ollama detection hint */}
        {name === 'ollama' && ollamaDetected !== null && (
          <div
            className={`flex items-center gap-1.5 text-xs font-data px-1 ${ollamaDetected ? 'text-emerald-500' : 'text-amber-400'}`}
          >
            {ollamaDetected ? (
              <>
                <CheckCircle size={13} />
                Ollama detected
              </>
            ) : (
              <>
                <AlertCircle size={13} />
                Not detected — download at{' '}
                <button
                  type="button"
                  onClick={() => window.electronAPI.openExternal('https://ollama.com/download')}
                  className="underline hover:no-underline"
                >
                  ollama.com
                </button>
              </>
            )}
          </div>
        )}

        {/* Display name (optional) */}
        <div>
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">
            Display Name <span className="text-[var(--color-text-muted)]">(optional)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={`My ${PROVIDER_OPTIONS.find((o) => o.value === name)?.label}`}
            className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
          />
        </div>

        {/* API Key (not shown for Ollama) */}
        {needsApiKey && (
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 pr-10 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* Base URL (always shown, pre-filled for Ollama) */}
        <div>
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">
            Base URL{' '}
            <span className="text-[var(--color-text-muted)]">
              (optional{name === 'ollama' ? ', default: localhost:11434' : ''})
            </span>
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={name === 'ollama' ? 'http://localhost:11434' : 'Leave blank for default'}
            className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
          />
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 px-4 py-2 text-sm transition-all"
          >
            <Bot size={16} />
            {submitting ? 'Adding...' : 'Add Provider'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-4 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
