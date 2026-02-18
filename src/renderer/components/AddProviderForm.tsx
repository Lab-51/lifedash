// === FILE PURPOSE ===
// Form component for adding a new AI provider configuration.
// Shown inline on the Settings page when the user clicks "Add Provider".

import { useState } from 'react';
import { Bot, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AIProviderName } from '../../shared/types';

const PROVIDER_OPTIONS: { value: AIProviderName; label: string; description: string }[] = [
  { value: 'openai', label: 'OpenAI', description: 'GPT-4o, GPT-4o Mini, o1' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude Sonnet, Claude Haiku' },
  { value: 'ollama', label: 'Ollama', description: 'Local models (Llama, Mistral, etc.)' },
  { value: 'kimi', label: 'Kimi', description: 'Kimi K2.5 by Moonshot AI' },
];

interface AddProviderFormProps {
  onClose: () => void;
}

export default function AddProviderForm({ onClose }: AddProviderFormProps) {
  const createProvider = useSettingsStore(s => s.createProvider);
  const [name, setName] = useState<AIProviderName>('openai');
  const [displayName, setDisplayName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsApiKey = name !== 'ollama';

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
    <form onSubmit={handleSubmit}
      className="mb-6 p-4 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg">
      <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Add AI Provider</h3>

      {error && (
        <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Provider type selection — button group */}
        <div>
          <label className="block text-xs text-surface-400 mb-1.5">Provider</label>
          <div className="flex gap-2">
            {PROVIDER_OPTIONS.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => {
                  setName(opt.value);
                  if (opt.value === 'ollama' && !baseUrl) {
                    setBaseUrl('http://localhost:11434');
                  } else if (opt.value === 'kimi' && !baseUrl) {
                    setBaseUrl('https://api.moonshot.ai/v1');
                  }
                }}
                className={`flex-1 p-2.5 rounded-lg border text-left text-sm transition-colors ${
                  name === opt.value
                    ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                    : 'border-surface-700 bg-surface-900 text-surface-700 dark:text-surface-300 hover:border-surface-600'
                }`}>
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-surface-500 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Display name (optional) */}
        <div>
          <label className="block text-xs text-surface-400 mb-1.5">
            Display Name <span className="text-surface-600">(optional)</span>
          </label>
          <input type="text" value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={`My ${PROVIDER_OPTIONS.find(o => o.value === name)?.label}`}
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500" />
        </div>

        {/* API Key (not shown for Ollama) */}
        {needsApiKey && (
          <div>
            <label className="block text-xs text-surface-400 mb-1.5">API Key</label>
            <div className="relative">
              <input type={showApiKey ? 'text' : 'password'} value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 pr-10 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500" />
              <button type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-700 dark:text-surface-300">
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* Base URL (always shown, pre-filled for Ollama) */}
        <div>
          <label className="block text-xs text-surface-400 mb-1.5">
            Base URL <span className="text-surface-600">(optional{name === 'ollama' ? ', default: localhost:11434' : ''})</span>
          </label>
          <input type="text" value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={name === 'ollama' ? 'http://localhost:11434' : 'Leave blank for default'}
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500" />
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={submitting}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition-colors">
            <Bot size={16} />
            {submitting ? 'Adding...' : 'Add Provider'}
          </button>
          <button type="button" onClick={onClose}
            className="text-surface-400 hover:text-surface-800 dark:text-surface-200 px-4 py-2 text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
