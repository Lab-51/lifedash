// === FILE PURPOSE ===
// Settings page — configures AI providers, model assignments, and app preferences.
// Sections: AI Providers (CRUD + test), Model Assignments (Task 3).
// Plan 3.3 will add: Appearance (theme), Usage tracking, DB connection.

import { useEffect, useState } from 'react';
import { Plus, Bot } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import LoadingSpinner from '../components/LoadingSpinner';
import ProviderCard from '../components/ProviderCard';
import AddProviderForm from '../components/AddProviderForm';
import TaskModelConfig from '../components/TaskModelConfig';

function SettingsPage() {
  const { providers, loading, error, loadProviders, loadSettings, checkEncryption } =
    useSettingsStore();
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadProviders();
    loadSettings();
    checkEncryption();
  }, [loadProviders, loadSettings, checkEncryption]);

  if (loading && providers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-surface-100">Settings</h1>
        <p className="mt-1 text-surface-400">
          Configure AI providers and app preferences.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* === Section: AI Providers === */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-surface-100">AI Providers</h2>
            <p className="text-sm text-surface-500">
              Configure API keys for AI features.
            </p>
          </div>
          {!showAddForm && (
            <button onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
              <Plus size={16} />
              Add Provider
            </button>
          )}
        </div>

        {/* Add provider form (inline, toggleable) */}
        {showAddForm && (
          <AddProviderForm onClose={() => setShowAddForm(false)} />
        )}

        {/* Provider cards grid */}
        {providers.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map(provider => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center justify-center text-surface-500 py-8">
            <Bot size={40} className="mb-3 text-surface-600" />
            <p className="text-sm">No AI providers configured yet</p>
            <p className="text-xs text-surface-600 mt-1">
              Add a provider to enable AI features
            </p>
          </div>
        )}
      </section>

      {/* === Section: Model Assignments (placeholder for Task 3) === */}
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-surface-100">Model Assignments</h2>
          <p className="text-sm text-surface-500">
            Choose which AI model to use for each task type.
          </p>
        </div>
        <TaskModelConfig providers={providers} />
      </section>
    </div>
  );
}

export default SettingsPage;
