// === FILE PURPOSE ===
// Card component for a configured AI provider on the Settings page.
// Shows provider status and provides actions: test, enable/disable, edit, delete.

import { memo, useState } from 'react';
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

const ProviderCard = memo(function ProviderCard({ provider }: ProviderCardProps) {
  const updateProvider = useSettingsStore(s => s.updateProvider);
  const deleteProvider = useSettingsStore(s => s.deleteProvider);
  const testConnection = useSettingsStore(s => s.testConnection);
  const connectionTests = useSettingsStore(s => s.connectionTests);
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
    <div className={`hud-panel clip-corner-cut-sm p-4 transition-colors flex flex-col ${
      provider.enabled ? '' : 'opacity-60'
    }`}>
      {/* Header row: provider name + enabled toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="node-point-sm" style={{ backgroundColor: meta.color, boxShadow: `0 0 4px ${meta.color}40` }} />
          <span className="font-semibold text-[var(--color-text-primary)] text-sm">{meta.label}</span>
          {provider.displayName && (
            <span className="text-xs text-[var(--color-text-muted)] font-data">({provider.displayName})</span>
          )}
        </div>
        <button onClick={handleToggleEnabled}
          className={`p-1.5 rounded transition-colors ${
            provider.enabled
              ? 'text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]'
              : 'text-[var(--color-text-muted)] hover:bg-[var(--color-accent-subtle)]'
          }`}
          title={provider.enabled ? 'Disable provider' : 'Enable provider'}>
          <Power size={16} />
        </button>
      </div>

      {/* Status indicators */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-xs font-data">
        <span className={`flex items-center gap-1.5 ${
          provider.hasApiKey ? 'text-emerald-400' : 'text-[var(--color-text-muted)]'
        }`}>
          <Key size={12} />
          {provider.hasApiKey ? 'API key set' : 'No API key'}
        </span>
        {provider.baseUrl && (
          <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)] truncate min-w-0">
            <Globe size={12} className="shrink-0" />
            <span className="truncate">{provider.baseUrl}</span>
          </span>
        )}
      </div>

      {/* API Key edit section (inline, toggleable) */}
      {editingKey && (
        <div className="mb-3 p-2 bg-surface-50 dark:bg-surface-950 rounded-lg border border-[var(--color-border)]">
          <div className="relative">
            <input type={showKey ? 'text' : 'password'} value={newApiKey}
              onChange={e => setNewApiKey(e.target.value)}
              placeholder="Enter new API key..."
              className="w-full text-xs bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2.5 py-1.5 pr-8 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]" />
            <button type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={handleSaveApiKey}
              className="text-xs border border-[var(--color-accent-dim)] text-[var(--color-accent)] hover:border-[var(--color-accent)] px-2.5 py-1 rounded transition-colors">
              Save
            </button>
            <button onClick={() => { setEditingKey(false); setNewApiKey(''); }}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connection test result */}
      {testState?.result && (
        <div className={`mb-3 p-2 rounded text-xs font-data flex items-center gap-1.5 ${
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
      <div className="flex items-center gap-2 mt-auto pt-3 border-t border-[var(--color-border)]">
        <button onClick={() => testConnection(provider.id)}
          disabled={testState?.loading}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 font-data">
          {testState?.loading
            ? <Loader2 size={14} className="animate-spin" />
            : <Zap size={14} />
          }
          {testState?.loading ? 'Testing...' : 'Test'}
        </button>
        <button onClick={() => setEditingKey(!editingKey)}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors font-data">
          <Key size={14} />
          {editingKey ? 'Close' : 'Edit Key'}
        </button>
        <button onClick={handleDelete}
          className={`flex items-center gap-1.5 text-xs ml-auto transition-colors font-data ${
            confirmDelete
              ? 'text-red-400 hover:text-red-300'
              : 'text-[var(--color-text-muted)] hover:text-red-400'
          }`}>
          <Trash2 size={14} />
          {confirmDelete ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </div>
  );
});

export default ProviderCard;
