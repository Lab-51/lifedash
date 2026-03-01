// === FILE PURPOSE ===
// Settings page — Modern Design
// Configures AI providers, model assignments, app preferences, backups, and export.
// Features a cleaner layout with card-based sections and updated typography.

import { useEffect, useState } from 'react';
import { Plus, Bot, Info, Settings, Monitor, Mic, Save, Wifi, Bell, FileDown, Database, Cpu, Key, Wand2, RefreshCw, CheckCircle, Download, Loader2 } from 'lucide-react';
import dashIcon from '../assets/icon.svg';
import { useSettingsStore } from '../stores/settingsStore';
import { useBackupStore } from '../stores/backupStore';
import LoadingSpinner from '../components/LoadingSpinner';
import ProviderCard from '../components/ProviderCard';
import AddProviderForm from '../components/AddProviderForm';
import SetupWizard from '../components/SetupWizard';
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
import LicenseSection from '../components/settings/LicenseSection';
import BackgroundAgentSettings from '../components/settings/BackgroundAgentSettings';
import HudBackground from './HudBackground';

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
    const [showWizard, setShowWizard] = useState(false);
    const setSetting = useSettingsStore(s => s.setSetting);

    // Update status for the About tab
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'>('idle');
    const [updateRelease, setUpdateRelease] = useState('');
    const [updateProgress, setUpdateProgress] = useState(0);
    const [updateError, setUpdateError] = useState('');

    useEffect(() => {
        loadProviders();
        loadSettings();
        checkEncryption();
    }, [loadProviders, loadSettings, checkEncryption]);

    // Listen for update status events
    useEffect(() => {
        if (!window.electronAPI?.onUpdateStatus) return;
        return window.electronAPI.onUpdateStatus((data) => {
            const d = data as { status: string; releaseName?: string; progress?: number; errorMessage?: string };
            setUpdateStatus(d.status as typeof updateStatus);
            if (d.releaseName) setUpdateRelease(d.releaseName);
            if (d.progress != null) setUpdateProgress(d.progress);
            if (d.errorMessage) setUpdateError(d.errorMessage);
            else setUpdateError('');
        });
    }, []);

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
        { id: 'license', label: 'License', icon: <Key size={18} /> },
        { id: 'about', label: 'About', icon: <Info size={18} /> },
    ];

    return (
        <div className="h-full flex flex-col bg-surface-50 dark:bg-surface-950 overflow-hidden relative">
            <HudBackground />
            {/* Header */}
            <div className="px-8 pt-8 pb-6 shrink-0 bg-white dark:bg-[var(--color-chrome)] border-b border-surface-200 dark:border-[var(--color-border)]">
                <div className="flex items-center gap-4 mb-1">
                    <span className="font-data text-[11px] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.SETTINGS</span>
                    <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
                </div>
                <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Settings</h1>
                <p className="text-[var(--color-text-secondary)] text-sm mt-1">Manage preferences and configurations.</p>

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
                            {/* Re-run wizard banner */}
                            <div className="flex items-center justify-between p-4 hud-panel clip-corner-cut-sm border-[var(--color-border)]">
                                <div>
                                    <p className="text-sm font-medium text-[var(--color-text-primary)]">Setup Wizard</p>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Re-run the guided AI provider setup.</p>
                                </div>
                                <button
                                    onClick={async () => {
                                        await setSetting('setupWizard.completed', 'false');
                                        setShowWizard(true);
                                    }}
                                    className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] px-4 py-2 text-sm font-medium transition-all clip-corner-cut-sm"
                                >
                                    <Wand2 size={15} />
                                    Re-run setup wizard
                                </button>
                            </div>

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

                            {/* Background Agents */}
                            <BackgroundAgentSettings />
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

                    {activeTab === 'license' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <LicenseSection />
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

                                {/* Update check section */}
                                <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
                                    <div className="flex flex-col items-center gap-3">
                                        {updateStatus === 'downloading' && (
                                            <div className="flex flex-col items-center gap-2">
                                                <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                                                    <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                                                    <span>Downloading {updateRelease}... {updateProgress > 0 ? `${updateProgress}%` : ''}</span>
                                                </div>
                                                {updateProgress > 0 && (
                                                    <div className="w-48 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                                                        <div className="h-full bg-[var(--color-accent)] rounded-full transition-all" style={{ width: `${updateProgress}%` }} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {updateStatus === 'ready' && (
                                            <div className="flex flex-col items-center gap-2">
                                                <p className="text-sm text-emerald-500 font-medium">{updateRelease} is ready to install</p>
                                                <button
                                                    onClick={() => window.electronAPI.installUpdate()}
                                                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 text-sm font-medium rounded-lg transition-colors"
                                                >
                                                    <Download size={15} />
                                                    Restart & Install
                                                </button>
                                            </div>
                                        )}
                                        {updateStatus === 'up-to-date' && (
                                            <div className="flex items-center gap-2 text-sm text-emerald-500/70">
                                                <CheckCircle size={16} />
                                                <span>You're on the latest version</span>
                                            </div>
                                        )}
                                        {updateStatus === 'error' && (
                                            <p className="text-sm text-red-400">{updateError || 'Update check failed'}</p>
                                        )}
                                        {updateStatus !== 'downloading' && updateStatus !== 'ready' && (
                                            <button
                                                disabled={updateStatus === 'checking'}
                                                onClick={() => window.electronAPI.checkForUpdates()}
                                                className={`flex items-center gap-2 border px-4 py-2 text-sm font-medium transition-all clip-corner-cut-sm ${
                                                    updateStatus === 'checking'
                                                        ? 'border-[var(--color-accent)] text-[var(--color-accent)] opacity-80 cursor-wait'
                                                        : 'border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)]'
                                                }`}
                                            >
                                                {updateStatus === 'checking'
                                                    ? <Loader2 size={15} className="animate-spin" />
                                                    : <RefreshCw size={15} />
                                                }
                                                {updateStatus === 'checking' ? 'Checking...' : 'Check for Updates'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}
                </div>
            </div>

            {showWizard && (
                <SetupWizard onClose={() => setShowWizard(false)} />
            )}
        </div>
    );
}
