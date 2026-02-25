// === FILE PURPOSE ===
// Settings page — Modern Design
// Configures AI providers, model assignments, app preferences, backups, and export.
// Features a cleaner layout with card-based sections and updated typography.

import { useEffect, useState } from 'react';
import { Plus, Bot, Info, Settings, Monitor, Mic, Save, Wifi, Bell, FileDown, Database, Cpu } from 'lucide-react';
import dashIcon from '../assets/icon.svg';
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
            <div className="px-8 pt-8 pb-6 shrink-0 bg-white dark:bg-[var(--color-chrome)] border-b border-surface-200 dark:border-[var(--color-border)]">
                <h1 className="font-hud text-2xl tracking-widest text-surface-900 dark:text-[var(--color-accent)] mb-1">Settings</h1>
                <p className="text-[var(--color-text-secondary)] font-data text-sm">Manage preferences and configurations.</p>

                {/* Tabs */}
                <div className="flex items-center gap-1 mt-6">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all ${activeTab === tab.id
                                ? 'hud-nav-active rounded-lg'
                                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] rounded-lg'
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
                        <div className="p-4 hud-panel clip-corner-cut-sm bg-red-500/10 border-red-500/30 flex items-start gap-3 text-red-400">
                            <Info size={20} className="shrink-0 mt-0.5" />
                            <p className="text-sm font-data">{error}</p>
                        </div>
                    )}

                    {activeTab === 'general' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Appearance */}
                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-6 pb-4 border-b border-[var(--color-border)]">
                                    <div className="flex items-center gap-3 mb-1">
                                        <Monitor size={16} className="text-[var(--color-accent)]" />
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Appearance</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">Customize the visual experience.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div>
                                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Theme Mode</h3>
                                        <ThemeSelector />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Themes</h3>
                                        <p className="text-sm text-[var(--color-text-muted)]">More themes coming soon.</p>
                                    </div>
                                </div>
                            </section>

                            {/* Audio & Transcription */}
                            <div className="grid grid-cols-1 gap-6">
                                <div className="hud-panel-accent clip-corner-cut-sm p-6">
                                    <div className="mb-4">
                                        <div className="flex items-center gap-3">
                                            <Mic size={16} className="text-[var(--color-accent)]" />
                                            <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Audio</span>
                                            <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                        </div>
                                    </div>
                                    <div className="space-y-6">
                                        <AudioDeviceSection />
                                        <div className="ruled-line-accent" />
                                        <TranscriptionProviderSection />
                                    </div>
                                </div>
                            </div>

                            {/* Network */}
                            <div className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-4">
                                    <div className="flex items-center gap-3">
                                        <Wifi size={16} className="text-[var(--color-accent)]" />
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Network</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                </div>
                                <ProxySettingsSection />
                            </div>

                            {/* Notifications */}
                            <div className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-4">
                                    <div className="flex items-center gap-3">
                                        <Bell size={16} className="text-[var(--color-accent)]" />
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Notifications</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                </div>
                                <NotificationSection />
                            </div>
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Providers */}
                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--color-border)]">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <Bot size={16} className="text-[var(--color-accent)]" />
                                            <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">AI Providers</span>
                                            <div className="h-px w-20 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                        </div>
                                        <p className="text-sm text-[var(--color-text-secondary)] mt-1">Configure models and API keys.</p>
                                    </div>
                                    {!showAddForm && (
                                        <button
                                            onClick={() => setShowAddForm(true)}
                                            className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] px-4 py-2 text-sm font-medium transition-all clip-corner-cut-sm"
                                        >
                                            <Plus size={16} />
                                            Add Provider
                                        </button>
                                    )}
                                </div>

                                {showAddForm && (
                                    <div className="mb-6">
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
                                    <div className="flex flex-col items-center justify-center p-8 border border-dashed border-[var(--color-border)] rounded-lg">
                                        <Bot size={32} className="text-[var(--color-text-muted)] mb-2" />
                                        <p className="text-sm font-medium text-[var(--color-text-secondary)]">No providers configured</p>
                                        <button onClick={() => setShowAddForm(true)} className="mt-2 text-xs text-[var(--color-accent)] hover:underline">Add one now</button>
                                    </div>
                                )}
                            </section>

                            {/* Model Assignments */}
                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-6">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Model Assignments</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">Route tasks to specific models.</p>
                                </div>
                                <TaskModelConfig providers={providers} />
                            </section>

                            {/* Usage */}
                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-6">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Usage & Costs</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">Track token consumption.</p>
                                </div>
                                <UsageSummary />
                            </section>
                        </div>
                    )}

                    {activeTab === 'data' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-4">
                                    <div className="flex items-center gap-3">
                                        <Save size={16} className="text-[var(--color-accent)]" />
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Storage</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                </div>
                                <RecordingsSavePathSection />
                            </section>

                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-4">
                                    <div className="flex items-center gap-3">
                                        <Database size={16} className="text-[var(--color-accent)]" />
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Backups</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                </div>
                                <BackupSection />
                            </section>

                            <section className="hud-panel-accent clip-corner-cut-sm p-6">
                                <div className="mb-4">
                                    <div className="flex items-center gap-3">
                                        <FileDown size={16} className="text-[var(--color-accent)]" />
                                        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Export</span>
                                        <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
                                    </div>
                                </div>
                                <ExportSection />
                            </section>
                        </div>
                    )}

                    {activeTab === 'about' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <section className="hud-panel-accent clip-corner-cut p-8 text-center">
                                <img src={dashIcon} alt="LifeDash" className="w-20 h-20 mx-auto mb-4 drop-shadow-lg" />
                                <h2 className="font-hud text-xl tracking-tight font-bold mb-2">
                                    <span className="text-[var(--color-text-primary)]">LIFE</span>
                                    <span className="text-[var(--color-accent)] text-glow">DASH</span>
                                </h2>
                                <p className="text-[var(--color-text-secondary)] mb-8 max-w-md mx-auto">
                                    AI-powered desktop dashboard for meeting intelligence, project management, brainstorming, and idea capture.
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                                    <div className="p-4 hud-panel clip-corner-cut-sm">
                                        <p className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-1">Version</p>
                                        <p className="font-[var(--font-display)] text-[var(--color-text-primary)] font-medium">{window.electronAPI.appVersion}</p>
                                    </div>
                                    <div className="p-4 hud-panel clip-corner-cut-sm">
                                        <p className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-1">Encryption</p>
                                        <p className={`font-medium ${encryptionAvailable ? 'text-emerald-500' : 'text-[var(--color-text-secondary)]'}`}>
                                            {encryptionAvailable === null ? 'Checking...' : encryptionAvailable ? 'Active' : 'Unavailable'}
                                        </p>
                                    </div>
                                    <div className="p-4 hud-panel clip-corner-cut-sm">
                                        <p className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-1">Platform</p>
                                        <p className="font-[var(--font-display)] text-[var(--color-text-primary)] font-medium capitalize">{window.electronAPI.platform}</p>
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
