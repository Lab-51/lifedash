// === FILE PURPOSE ===
// Settings page — configures AI providers, model assignments, app preferences,
// database backups, and data export.
// Sections: Appearance, AI Providers, Model Assignments, AI Usage, Backups, Export, About.

import { useEffect, useState } from 'react';
import { Plus, Bot, Info } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useBackupStore } from '../stores/backupStore';
import LoadingSpinner from '../components/LoadingSpinner';
import ProviderCard from '../components/ProviderCard';
import AddProviderForm from '../components/AddProviderForm';
import TaskModelConfig from '../components/TaskModelConfig';
import ThemeSelector from '../components/ThemeSelector';
import UsageSummary from '../components/UsageSummary';
import BackupSection from '../components/settings/BackupSection';
import ExportSection from '../components/settings/ExportSection';
import NotificationSection from '../components/settings/NotificationSection';
import TranscriptionProviderSection from '../components/settings/TranscriptionProviderSection';
import AudioDeviceSection from '../components/settings/AudioDeviceSection';
import RecordingsSavePathSection from '../components/settings/RecordingsSavePathSection';
import ProxySettingsSection from '../components/settings/ProxySettingsSection';

function SettingsPage() {
  const providers = useSettingsStore(s => s.providers);
  const loading = useSettingsStore(s => s.loading);
  const error = useSettingsStore(s => s.error);
  const encryptionAvailable = useSettingsStore(s => s.encryptionAvailable);
  const loadProviders = useSettingsStore(s => s.loadProviders);
  const loadSettings = useSettingsStore(s => s.loadSettings);
  const checkEncryption = useSettingsStore(s => s.checkEncryption);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadProviders();
    loadSettings();
    checkEncryption();
  }, [loadProviders, loadSettings, checkEncryption]);

  // Listen for backup progress events from the main process
  useEffect(() => {
    const cleanup = window.electronAPI.onBackupProgress((progress) => {
      useBackupStore.getState().setProgress(progress);
    });
    return cleanup;
  }, []);

  if (loading && providers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
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

      {/* === Section: Appearance === */}
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-surface-100">Appearance</h2>
          <p className="text-sm text-surface-500">
            Choose your preferred theme.
          </p>
        </div>
        <ThemeSelector />
      </section>

      {/* === Section: Audio Devices === */}
      <AudioDeviceSection />

      {/* === Section: Recordings Folder === */}
      <RecordingsSavePathSection />

      {/* === Section: Transcription Provider === */}
      <TranscriptionProviderSection />

      {/* === Section: Network / Proxy === */}
      <ProxySettingsSection />

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

      {/* === Section: AI Usage === */}
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-surface-100">AI Usage</h2>
          <p className="text-sm text-surface-500">
            Token usage and estimated costs across all providers.
          </p>
        </div>
        <UsageSummary />
      </section>

      {/* === Section: Database Backups === */}
      <BackupSection />

      {/* === Section: Notifications === */}
      <NotificationSection />

      {/* === Section: Export Data === */}
      <ExportSection />

      {/* === Section: About === */}
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-surface-100">About</h2>
        </div>
        <div className="p-4 bg-surface-800 border border-surface-700 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Info size={16} className="text-primary-400" />
            <span className="text-sm font-medium text-surface-200">Living Dashboard</span>
          </div>
          <div className="space-y-1.5 text-xs text-surface-400">
            <div className="flex justify-between">
              <span>Version</span>
              <span className="text-surface-300">0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span>Encryption</span>
              <span className={encryptionAvailable ? 'text-emerald-400' : 'text-surface-500'}>
                {encryptionAvailable === null ? 'Checking...' : encryptionAvailable ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Platform</span>
              <span className="text-surface-300">{window.electronAPI.platform}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
