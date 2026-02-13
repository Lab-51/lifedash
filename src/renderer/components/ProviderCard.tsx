// === FILE PURPOSE ===
// Card component for a configured AI provider on the Settings page.
// Shows provider status and provides actions: test, enable/disable, edit, delete.

import { useState } from 'react';
import {
  CheckCircle, XCircle, Loader2, Trash2, Eye, EyeOff,
  Power, Zap, Key, Globe,
} from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AIProvider } from '../../shared/types';

// Provider display metadata
const PROVIDER_META: Record<string, { label: string; color: string }> = {
  openai: { label: 'OpenAI', color: '#10a37f' },
  anthropic: { label: 'Anthropic', color: '#d4a574' },
  ollama: { label: 'Ollama', color: '#ffffff' },
  kimi: { label: 'Kimi', color: '#6366f1' },
};

interface ProviderCardProps {
  provider: AIProvider;
}

export default function ProviderCard({ provider }: ProviderCardProps) {
  const { updateProvider, deleteProvider, testConnection, connectionTests } =
    useSettingsStore();
  const [editingKey, setEditingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const testState = connectionTests[provider.id];
  const meta = PROVIDER_META[provider.name] || { label: provider.name, color: '#888' };

  const handleToggleEnabled = async () => {
    await updateProvider(provider.id, { enabled: !provider.enabled });
  };

  const handleSaveApiKey = async () => {
    if (!newApiKey.trim()) return;
    await updateProvider(provider.id, { apiKey: newApiKey.trim() });
    setNewApiKey('');
    setEditingKey(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await deleteProvider(provider.id);
  };

  return (
    <div className={`p-4 bg-surface-800 border rounded-lg transition-colors ${
      provider.enabled ? 'border-surface-700' : 'border-surface-700/50 opacity-60'
    }`}>
      {/* Header row: provider name + enabled toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="font-semibold text-surface-100 text-sm">{meta.label}</span>
          {provider.displayName && (
            <span className="text-xs text-surface-500">({provider.displayName})</span>
          )}
        </div>
        <button onClick={handleToggleEnabled}
          className={`p-1.5 rounded transition-colors ${
            provider.enabled
              ? 'text-emerald-400 hover:bg-emerald-500/10'
              : 'text-surface-500 hover:bg-surface-700'
          }`}
          title={provider.enabled ? 'Disable provider' : 'Enable provider'}>
          <Power size={16} />
        </button>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-3 mb-3 text-xs">
        <span className={`flex items-center gap-1 ${
          provider.hasApiKey ? 'text-emerald-400' : 'text-surface-500'
        }`}>
          <Key size={12} />
          {provider.hasApiKey ? 'API key set' : 'No API key'}
        </span>
        {provider.baseUrl && (
          <span className="flex items-center gap-1 text-surface-400">
            <Globe size={12} />
            {provider.baseUrl}
          </span>
        )}
      </div>

      {/* API Key edit section (inline, toggleable) */}
      {editingKey && (
        <div className="mb-3 p-2 bg-surface-900 rounded-lg">
          <div className="relative">
            <input type={showKey ? 'text' : 'password'} value={newApiKey}
              onChange={e => setNewApiKey(e.target.value)}
              placeholder="Enter new API key..."
              className="w-full text-xs bg-surface-950 border border-surface-700 rounded px-2.5 py-1.5 pr-8 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500" />
            <button type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300">
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={handleSaveApiKey}
              className="text-xs bg-primary-600 hover:bg-primary-500 text-white px-2.5 py-1 rounded transition-colors">
              Save
            </button>
            <button onClick={() => { setEditingKey(false); setNewApiKey(''); }}
              className="text-xs text-surface-400 hover:text-surface-200 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connection test result */}
      {testState?.result && (
        <div className={`mb-3 p-2 rounded text-xs flex items-center gap-1.5 ${
          testState.result.success
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-red-500/10 text-red-400'
        }`}>
          {testState.result.success
            ? <><CheckCircle size={14} /> Connected ({testState.result.latencyMs}ms)</>
            : <><XCircle size={14} /> {testState.result.error}</>
          }
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <button onClick={() => testConnection(provider.id)}
          disabled={testState?.loading}
          className="flex items-center gap-1.5 text-xs text-surface-300 hover:text-primary-400 transition-colors disabled:opacity-50">
          {testState?.loading
            ? <Loader2 size={14} className="animate-spin" />
            : <Zap size={14} />
          }
          {testState?.loading ? 'Testing...' : 'Test'}
        </button>
        <button onClick={() => setEditingKey(!editingKey)}
          className="flex items-center gap-1.5 text-xs text-surface-300 hover:text-primary-400 transition-colors">
          <Key size={14} />
          {editingKey ? 'Close' : 'Edit Key'}
        </button>
        <button onClick={handleDelete}
          className={`flex items-center gap-1.5 text-xs ml-auto transition-colors ${
            confirmDelete
              ? 'text-red-400 hover:text-red-300'
              : 'text-surface-500 hover:text-red-400'
          }`}>
          <Trash2 size={14} />
          {confirmDelete ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
