// === FILE PURPOSE ===
// Settings page — Modern Design
// Configures AI providers, model assignments, app preferences, backups, and export.
// Features a cleaner layout with card-based sections and updated typography.

import { useEffect, useState } from 'react';
import { Plus, Bot, Info, Settings, Monitor, Mic, Save, Wifi, Bell, FileDown, Database, Cpu } from 'lucide-react';
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

export default function SettingsPageModern() {
    const providers = useSettingsStore(s => s.providers);
    const loading = useSettingsStore(s => s.loading);
    const error = useSettingsStore(s => s.error);
    const encryptionAvailable = useSettingsStore(s => s.encryptionAvailable);
    const loadProviders = useSettingsStore(s => s.loadProviders);
    const loadSettings = useSettingsStore(s => s.loadSettings);
    const checkEncryption = useSettingsStore(s => s.checkEncryption);
    const [showAddForm, setShowAddForm] = useState(false);
    const [activeTab, setActiveTab] = useState('general');

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

    const TABS = [
        { id: 'general', label: 'General', icon: <Settings size={18} /> },
        { id: 'ai', label: 'AI & Models', icon: <Cpu size={18} /> },
        { id: 'data', label: 'Data & Storage', icon: <Database size={18} /> },
        { id: 'about', label: 'About', icon: <Info size={18} /> },
    ];

    return (
        <div className="h-full flex flex-col bg-surface-50 dark:bg-surface-950 overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 shrink-0 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800">
                <h1 className="text-3xl font-light tracking-tight text-surface-900 dark:text-surface-50 mb-1">Settings</h1>
                <p className="text-surface-500 font-medium text-sm">Manage preferences and configurations.</p>

                {/* Tabs */}
                <div className="flex items-center gap-1 mt-6">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 ring-1 ring-primary-200 dark:ring-primary-800'
                                : 'text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-4xl mx-auto space-y-8">
                    {/* Error banner */}
                    {error && (
                        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 flex items-start gap-3 text-red-600 dark:text-red-400">
                            <Info size={20} className="shrink-0 mt-0.5" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    )}

                    {activeTab === 'general' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Appearance */}
                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-6 pb-4 border-b border-surface-100 dark:border-surface-800">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                        <Monitor size={20} className="text-primary-500" />
                                        Appearance
                                    </h2>
                                    <p className="text-sm text-surface-500 mt-1">Customize the visual experience.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div>
                                        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Theme Mode</h3>
                                        <ThemeSelector />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Themes</h3>
                                        <p className="text-sm text-surface-400">More themes coming soon.</p>
                                    </div>
                                </div>
                            </section>

                            {/* Audio & Transcription */}
                            <div className="grid grid-cols-1 gap-6">
                                <div className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                    <div className="mb-4">
                                        <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                            <Mic size={20} className="text-primary-500" />
                                            Audio
                                        </h2>
                                    </div>
                                    <div className="space-y-6">
                                        <AudioDeviceSection />
                                        <div className="h-px bg-surface-100 dark:bg-surface-800" />
                                        <TranscriptionProviderSection />
                                    </div>
                                </div>
                            </div>

                            {/* Network */}
                            <div className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                        <Wifi size={20} className="text-primary-500" />
                                        Network
                                    </h2>
                                </div>
                                <ProxySettingsSection />
                            </div>

                            {/* Notifications */}
                            <div className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                        <Bell size={20} className="text-primary-500" />
                                        Notifications
                                    </h2>
                                </div>
                                <NotificationSection />
                            </div>
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Providers */}
                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="flex items-center justify-between mb-6 pb-4 border-b border-surface-100 dark:border-surface-800">
                                    <div>
                                        <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                            <Bot size={20} className="text-primary-500" />
                                            AI Providers
                                        </h2>
                                        <p className="text-sm text-surface-500 mt-1">Configure models and API keys.</p>
                                    </div>
                                    {!showAddForm && (
                                        <button
                                            onClick={() => setShowAddForm(true)}
                                            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition-all hover:translate-y-px"
                                        >
                                            <Plus size={16} />
                                            Add Provider
                                        </button>
                                    )}
                                </div>

                                {showAddForm && (
                                    <div className="mb-6 bg-surface-50 dark:bg-surface-800/50 p-4 rounded-xl border border-surface-200 dark:border-surface-700">
                                        <AddProviderForm onClose={() => setShowAddForm(false)} />
                                    </div>
                                )}

                                {providers.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {providers.map(provider => (
                                            <ProviderCard key={provider.id} provider={provider} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center p-8 bg-surface-50 dark:bg-surface-800/30 rounded-xl border border-dashed border-surface-200 dark:border-surface-700">
                                        <Bot size={32} className="text-surface-400 mb-2" />
                                        <p className="text-sm font-medium text-surface-600 dark:text-surface-300">No providers configured</p>
                                        <button onClick={() => setShowAddForm(true)} className="mt-2 text-xs text-primary-600 hover:underline">Add one now</button>
                                    </div>
                                )}
                            </section>

                            {/* Model Assignments */}
                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-6">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">Model Assignments</h2>
                                    <p className="text-sm text-surface-500 mt-1">Route tasks to specific models.</p>
                                </div>
                                <TaskModelConfig providers={providers} />
                            </section>

                            {/* Usage */}
                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-6">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">Usage & Costs</h2>
                                    <p className="text-sm text-surface-500 mt-1">Track token consumption.</p>
                                </div>
                                <UsageSummary />
                            </section>
                        </div>
                    )}

                    {activeTab === 'data' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                        <Save size={20} className="text-primary-500" />
                                        Storage
                                    </h2>
                                </div>
                                <RecordingsSavePathSection />
                            </section>

                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                        <Database size={20} className="text-primary-500" />
                                        Backups
                                    </h2>
                                </div>
                                <BackupSection />
                            </section>

                            <section className="bg-white dark:bg-surface-900 p-6 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                        <FileDown size={20} className="text-primary-500" />
                                        Export
                                    </h2>
                                </div>
                                <ExportSection />
                            </section>
                        </div>
                    )}

                    {activeTab === 'about' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <section className="bg-white dark:bg-surface-900 p-8 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm text-center">
                                <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <Bot size={32} className="text-primary-600 dark:text-primary-400" />
                                </div>
                                <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">LifeDash</h2>
                                <p className="text-surface-500 mb-8 max-w-md mx-auto">
                                    A next-generation AI assistant workspace designed for productivity and seamless collaboration.
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                                    <div className="p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                        <p className="text-xs text-surface-400 uppercase font-bold tracking-wider mb-1">Version</p>
                                        <p className="text-surface-900 dark:text-surface-100 font-medium">0.1.0</p>
                                    </div>
                                    <div className="p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                        <p className="text-xs text-surface-400 uppercase font-bold tracking-wider mb-1">Encryption</p>
                                        <p className={`font-medium ${encryptionAvailable ? 'text-emerald-500' : 'text-surface-500'}`}>
                                            {encryptionAvailable === null ? 'Checking...' : encryptionAvailable ? 'Active' : 'Unavailable'}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                        <p className="text-xs text-surface-400 uppercase font-bold tracking-wider mb-1">Platform</p>
                                        <p className="text-surface-900 dark:text-surface-100 font-medium capitalize">{window.electronAPI.platform}</p>
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
