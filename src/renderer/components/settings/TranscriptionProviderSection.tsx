// === FILE PURPOSE ===
// Transcription provider selection section for the Settings page.
// Allows users to choose between Local Whisper, Deepgram, or AssemblyAI
// for meeting transcription, configure API keys, and test connectivity.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge)

import { useEffect, useState, useCallback, useRef } from 'react';
import { Mic, Loader2, Check, Eye, EyeOff, Globe, Download, HardDrive, ShieldCheck } from 'lucide-react';
import type { TranscriptionProviderStatus, TranscriptionProviderType, WhisperModel } from '../../../shared/types';
import { TRANSCRIPTION_LANGUAGES, DEFAULT_MIXED_PROMPTS } from '../../../shared/types';
import HudSelect from '../HudSelect';
import CloudTranscriptionConsentDialog from './CloudTranscriptionConsentDialog';

// Settings key for the local-only transcription privacy control (GUARD.1 Task 4).
// Matches the key read by the main-process enforcement in transcriptionProviderService.
const SETTINGS_KEY_LOCAL_ONLY = 'transcription:localOnly';

/** Provider option metadata for rendering */
const PROVIDERS: Array<{
  type: TranscriptionProviderType;
  label: string;
  description: string;
  privacy: 'local' | 'cloud';
}> = [
  {
    type: 'local',
    label: 'Local (Whisper)',
    description: 'Uses locally downloaded Whisper model. Free, private, works offline.',
    privacy: 'local',
  },
  {
    type: 'deepgram',
    label: 'Deepgram',
    description: 'Cloud-based transcription with high accuracy and speed.',
    privacy: 'cloud',
  },
  {
    type: 'assemblyai',
    label: 'AssemblyAI',
    description: 'Cloud-based transcription with advanced features.',
    privacy: 'cloud',
  },
];

/**
 * Small badge signaling whether a transcription provider processes audio locally
 * or in the cloud. Uses low-alpha backgrounds so it stays legible if a parent row
 * is later dimmed (e.g. a disabled cloud row under consent gating).
 */
function PrivacyPill({ privacy }: { privacy: 'local' | 'cloud' }) {
  return privacy === 'local' ? (
    <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium">
      Local
    </span>
  ) : (
    <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">Cloud</span>
  );
}

export default function TranscriptionProviderSection() {
  const [config, setConfig] = useState<TranscriptionProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [deepgramKey, setDeepgramKey] = useState('');
  const [assemblyaiKey, setAssemblyaiKey] = useState('');
  const [showDeepgramKey, setShowDeepgramKey] = useState(false);
  const [showAssemblyaiKey, setShowAssemblyaiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
    latencyMs?: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const [whisperModels, setWhisperModels] = useState<WhisperModel[]>([]);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [whisperBackend, setWhisperBackend] = useState<string>('unknown');
  const [speedPreset, setSpeedPreset] = useState<string>('balanced');
  const [mixedPrompt, setMixedPrompt] = useState<string>('');
  // Local-only privacy control (GUARD.1 Task 4). null while loading; the main
  // process is the real enforcer — this is the UI mirror + consent gate.
  const [localOnly, setLocalOnly] = useState<boolean | null>(null);
  // Cloud provider awaiting explicit consent before a local -> cloud switch persists.
  const [pendingCloudProvider, setPendingCloudProvider] = useState<'deepgram' | 'assemblyai' | null>(null);
  // Message shown when the main process rejects a cloud switch (defensive backstop).
  const [providerError, setProviderError] = useState<string | null>(null);

  const testResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const status = await window.electronAPI.transcriptionGetConfig();
      setConfig(status);
    } catch (err) {
      console.error('Failed to load transcription config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Load the local-only privacy setting on mount (default off when never written).
  useEffect(() => {
    void (async () => {
      try {
        const raw = await window.electronAPI.getSetting(SETTINGS_KEY_LOCAL_ONLY);
        setLocalOnly(raw === 'true');
      } catch (err) {
        console.error('Failed to load local-only setting:', err);
        setLocalOnly(false);
      }
    })();
  }, []);

  const loadWhisperModels = useCallback(async () => {
    try {
      const [models, activeModel] = await Promise.all([
        window.electronAPI.getWhisperModels(),
        window.electronAPI.whisperGetActiveModel(),
      ]);
      setWhisperModels(models);
      setActiveModelName(activeModel);
    } catch {
      // Non-critical
    }
  }, []);

  // Load whisper models on mount and listen for download progress
  useEffect(() => {
    loadWhisperModels();
    const unsub = window.electronAPI.onWhisperDownloadProgress((progress) => {
      if (progress.fileName === downloadingModel || downloadingModel) {
        setDownloadPercent(progress.percent);
      }
    });
    return unsub;
  }, [loadWhisperModels, downloadingModel]);

  // Fetch whisper backend when local provider is active
  useEffect(() => {
    if (config?.type !== 'local') return;
    (async () => {
      try {
        const backend = await window.electronAPI.getWhisperBackend();
        setWhisperBackend(backend);
      } catch {
        // Non-critical
      }
    })();
  }, [config?.type]);

  // Load saved language, speed preset, and active model on mount
  useEffect(() => {
    (async () => {
      try {
        const [savedLang, savedPreset, model] = await Promise.all([
          window.electronAPI.getSetting('transcription:language'),
          window.electronAPI.getSetting('transcription:speed-preset'),
          window.electronAPI.whisperGetActiveModel(),
        ]);
        if (savedLang) setSelectedLanguage(savedLang);
        if (savedPreset && ['fast', 'balanced', 'accurate'].includes(savedPreset)) {
          setSpeedPreset(savedPreset);
        }
        setActiveModelName(model);
      } catch {
        // Non-critical — keep defaults
      }
    })();
  }, []);

  // Re-check model when language changes
  useEffect(() => {
    (async () => {
      try {
        const model = await window.electronAPI.whisperGetActiveModel();
        setActiveModelName(model);
      } catch {
        // ignore
      }
    })();
  }, [selectedLanguage]);

  // Load persisted mixed prompt when a mix variant is selected
  useEffect(() => {
    const isMix = selectedLanguage === 'cs-mix' || selectedLanguage === 'sk-mix' || selectedLanguage === 'en-mix';
    if (!isMix) return;
    (async () => {
      try {
        const stored = await window.electronAPI.getSetting(`transcription:initial-prompt:${selectedLanguage}`);
        const code = selectedLanguage as 'cs-mix' | 'sk-mix' | 'en-mix';
        setMixedPrompt(stored || DEFAULT_MIXED_PROMPTS[code]);
      } catch {
        const code = selectedLanguage as 'cs-mix' | 'sk-mix' | 'en-mix';
        setMixedPrompt(DEFAULT_MIXED_PROMPTS[code]);
      }
    })();
  }, [selectedLanguage]);

  const handleLanguageChange = async (value: string) => {
    setSelectedLanguage(value);
    try {
      await window.electronAPI.setSetting('transcription:language', value);
    } catch {
      // Settings save failed — non-critical
    }
  };

  const handleMixedPromptChange = (value: string) => {
    setMixedPrompt(value);
    // Debounced save — 600ms after user stops typing
    if (promptDebounceTimer.current) clearTimeout(promptDebounceTimer.current);
    promptDebounceTimer.current = setTimeout(async () => {
      try {
        await window.electronAPI.setSetting(`transcription:initial-prompt:${selectedLanguage}`, value);
      } catch {
        // Non-critical
      }
    }, 600);
  };

  const handleMixedPromptBlur = async () => {
    // Ensure save on blur even if debounce hasn't fired yet
    if (promptDebounceTimer.current) {
      clearTimeout(promptDebounceTimer.current);
      promptDebounceTimer.current = null;
    }
    try {
      await window.electronAPI.setSetting(`transcription:initial-prompt:${selectedLanguage}`, mixedPrompt);
    } catch {
      // Non-critical
    }
  };

  const handleResetMixedPrompt = async () => {
    const code = selectedLanguage as 'cs-mix' | 'sk-mix' | 'en-mix';
    const defaultPrompt = DEFAULT_MIXED_PROMPTS[code];
    setMixedPrompt(defaultPrompt);
    try {
      await window.electronAPI.setSetting(`transcription:initial-prompt:${selectedLanguage}`, defaultPrompt);
    } catch {
      // Non-critical
    }
  };

  const handleSpeedPresetChange = async (value: string) => {
    setSpeedPreset(value);
    try {
      await window.electronAPI.setSetting('transcription:speed-preset', value);
    } catch {
      // Settings save failed — non-critical
    }
  };

  const handleDownloadModel = async (fileName: string) => {
    setDownloadingModel(fileName);
    setDownloadPercent(0);
    try {
      await window.electronAPI.downloadWhisperModel(fileName);
      await loadWhisperModels();
      await loadConfig();
    } catch (err) {
      console.error('Failed to download Whisper model:', err);
    } finally {
      setDownloadingModel(null);
      setDownloadPercent(0);
    }
  };

  const handleSetActiveModel = async (fileName: string) => {
    try {
      await window.electronAPI.whisperSetActiveModel(fileName);
      setActiveModelName(fileName);
    } catch (err) {
      console.error('Failed to set active Whisper model:', err);
    }
  };

  const isEnglishOnlyModel = activeModelName?.includes('.en') ?? false;
  const showModelWarning = config?.type === 'local' && isEnglishOnlyModel && selectedLanguage !== 'en';

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (testResultTimer.current) clearTimeout(testResultTimer.current);
      if (promptDebounceTimer.current) clearTimeout(promptDebounceTimer.current);
    };
  }, []);

  // Persist a provider selection (after any required consent). Resyncs from the
  // main process on completion; on a main-side rejection (e.g. the local-only
  // enforcement backstop) it resyncs to the actually-persisted provider and
  // surfaces a message rather than leaving the radio in a lying state.
  const applyProviderChange = async (type: TranscriptionProviderType) => {
    try {
      await window.electronAPI.transcriptionSetProvider(type);
      setTestResult(null);
      setProviderError(null);
      await loadConfig();
    } catch (err) {
      console.error('Failed to set transcription provider:', err);
      setProviderError('Local-only transcription is on. Turn it off to use a cloud provider.');
      await loadConfig();
    }
  };

  const handleProviderChange = (type: TranscriptionProviderType) => {
    if (!config) return;
    // CONSENT GATE: switching FROM local TO a cloud provider requires explicit
    // consent — meeting audio would start leaving the machine. (Under local-only
    // mode the cloud rows are disabled, so this only fires when cloud is
    // genuinely selectable.)
    if (config.type === 'local' && (type === 'deepgram' || type === 'assemblyai')) {
      setPendingCloudProvider(type);
      return;
    }
    void applyProviderChange(type);
  };

  const handleToggleLocalOnly = async (checked: boolean) => {
    // Optimistic write (mirrors MeetingsSection); the main process is the real
    // enforcer, this just mirrors + persists the preference.
    setLocalOnly(checked);
    setProviderError(null);
    try {
      await window.electronAPI.setSetting(SETTINGS_KEY_LOCAL_ONLY, checked ? 'true' : 'false');
    } catch (err) {
      console.error('Failed to save local-only setting:', err);
      setLocalOnly(!checked); // revert on failure
    }
  };

  const confirmCloudSwitch = () => {
    const target = pendingCloudProvider;
    setPendingCloudProvider(null);
    if (target) void applyProviderChange(target);
  };

  const cancelCloudSwitch = () => {
    // Declined — selection stays local; nothing is persisted.
    setPendingCloudProvider(null);
  };

  const handleSaveKey = async (provider: 'deepgram' | 'assemblyai') => {
    const key = provider === 'deepgram' ? deepgramKey : assemblyaiKey;
    if (!key.trim()) return;

    setSaving(true);
    try {
      await window.electronAPI.transcriptionSetApiKey(provider, key.trim());
      if (provider === 'deepgram') {
        setDeepgramKey('');
        setShowDeepgramKey(false);
      } else {
        setAssemblyaiKey('');
        setShowAssemblyaiKey(false);
      }
      await loadConfig();
    } catch (err) {
      console.error(`Failed to save ${provider} API key:`, err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (provider: 'deepgram' | 'assemblyai') => {
    setSaving(true);
    try {
      await window.electronAPI.transcriptionSetApiKey(provider, '');
      if (provider === 'deepgram') {
        setDeepgramKey('');
        setShowDeepgramKey(false);
      } else {
        setAssemblyaiKey('');
        setShowAssemblyaiKey(false);
      }
      await loadConfig();
    } catch (err) {
      console.error(`Failed to clear ${provider} API key:`, err);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config) return;
    setTesting(true);
    setTestResult(null);

    try {
      const result = await window.electronAPI.transcriptionTestProvider(config.type);
      setTestResult(result);

      // Clear result after 5 seconds
      if (testResultTimer.current) clearTimeout(testResultTimer.current);
      testResultTimer.current = setTimeout(() => {
        setTestResult(null);
      }, 5000);
    } catch (err) {
      setTestResult({ success: false, error: String(err) });
      if (testResultTimer.current) clearTimeout(testResultTimer.current);
      testResultTimer.current = setTimeout(() => {
        setTestResult(null);
      }, 5000);
    } finally {
      setTesting(false);
    }
  };

  /** Render status badge for a provider */
  const renderStatus = (type: TranscriptionProviderType) => {
    if (!config) return null;

    if (type === 'local') {
      return config.localModelAvailable ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <Check size={12} />
          Model available
        </span>
      ) : (
        <span className="text-xs text-amber-400">No model downloaded</span>
      );
    }

    if (type === 'deepgram') {
      return config.hasDeepgramKey ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <Check size={12} />
          API key configured
        </span>
      ) : (
        <span className="text-xs text-surface-500">Not configured</span>
      );
    }

    if (type === 'assemblyai') {
      return config.hasAssemblyaiKey ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <Check size={12} />
          API key configured
        </span>
      ) : (
        <span className="text-xs text-surface-500">Not configured</span>
      );
    }

    return null;
  };

  /** Render API key input for a cloud provider */
  const renderApiKeyInput = (provider: 'deepgram' | 'assemblyai') => {
    const isDeepgram = provider === 'deepgram';
    const key = isDeepgram ? deepgramKey : assemblyaiKey;
    const setKey = isDeepgram ? setDeepgramKey : setAssemblyaiKey;
    const showKey = isDeepgram ? showDeepgramKey : showAssemblyaiKey;
    const setShowKey = isDeepgram ? setShowDeepgramKey : setShowAssemblyaiKey;
    const hasKey = isDeepgram ? config?.hasDeepgramKey : config?.hasAssemblyaiKey;

    return (
      <div className="flex items-center gap-2 mt-2 ml-6">
        <label className="text-xs text-surface-400 shrink-0">API Key:</label>
        <div className="relative flex-1 max-w-xs">
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Enter API key...'}
            className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 pr-10 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-800 dark:text-surface-200 transition-colors"
            title={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          onClick={() => handleSaveKey(provider)}
          disabled={saving || !key.trim()}
          className="flex items-center gap-1 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg text-xs transition-colors"
        >
          Save
        </button>
        {hasKey && (
          <button
            onClick={() => handleClearKey(provider)}
            disabled={saving}
            className="flex items-center gap-1 border border-red-500/30 hover:border-red-500/50 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 px-2.5 py-1 rounded-lg text-xs transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    );
  };

  // Loading state
  if (loading || !config) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">
            Transcription Provider
          </h2>
        </div>
        <div className="flex items-center justify-center py-6 text-surface-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Mic size={18} className="text-[var(--color-accent-dim)]" />
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">
            Transcription Provider
          </h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">Select how meeting audio is transcribed.</p>
      </div>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Local-only privacy toggle (GUARD.1 Task 4) */}
        {localOnly !== null && (
          <div className="pb-3 border-b border-[var(--color-border)]">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={localOnly}
                onChange={(e) => handleToggleLocalOnly(e.target.checked)}
                aria-label="Local-only transcription"
                className="mt-0.5 w-4 h-4 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-primary)]">
                  <ShieldCheck size={14} className="text-[var(--color-accent-dim)]" />
                  Local-only transcription
                </span>
                <p className="text-xs text-surface-500 mt-0.5">
                  Blocks cloud providers. Meeting audio is transcribed entirely on-device with Whisper and never leaves
                  your machine — even if a cloud provider was previously selected.
                </p>
              </div>
            </label>
            {localOnly && config.type !== 'local' && (
              <p className="text-xs text-amber-400/80 mt-2 ml-6">
                A cloud provider is selected, but local-only is on — recordings will use local Whisper instead.
              </p>
            )}
          </div>
        )}

        {/* Provider radio options */}
        {PROVIDERS.map((provider) => (
          <div key={provider.type}>
            <label
              className={`flex items-start gap-2 ${
                provider.type !== 'local' && localOnly === true ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              }`}
            >
              <input
                type="radio"
                name="transcription-provider"
                value={provider.type}
                checked={config.type === provider.type}
                onChange={() => handleProviderChange(provider.type)}
                disabled={provider.type !== 'local' && localOnly === true}
                aria-label={provider.label}
                className="w-4 h-4 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{provider.label}</span>
                  <PrivacyPill privacy={provider.privacy} />
                  {renderStatus(provider.type)}
                </div>
                <p className="text-xs text-surface-500 mt-0.5">{provider.description}</p>
                {provider.type !== 'local' && localOnly === true && (
                  <p className="text-[0.6875rem] text-amber-400/80 mt-1">
                    Disabled while local-only transcription is on.
                  </p>
                )}
              </div>
            </label>

            {/* Whisper model picker for local provider */}
            {provider.type === 'local' &&
              config.type === 'local' &&
              whisperModels.length > 0 &&
              (() => {
                // Show only recommended models, filtered by language context
                const needsMultilingual = selectedLanguage !== 'en';
                const visibleModels = whisperModels.filter((m) => {
                  if (!m.recommended) return false;
                  const isEnOnly = m.name.endsWith('.en');
                  return needsMultilingual ? !isEnOnly : isEnOnly;
                });

                // Pick the "best" model to badge as Recommended in the current language context.
                // Multilingual: large-v3-turbo-q5 is the strongest choice (best Czech/Slovak).
                // English-only: small.en is the strongest available.
                const recommendedName = needsMultilingual ? 'large-v3-turbo-q5' : 'small.en';

                // Tier label per model name. Keeps each row distinguishable instead of three "Standard"s.
                const tierLabel = (name: string): string => {
                  if (name.startsWith('tiny')) return 'Basic';
                  if (name.startsWith('base')) return 'Standard';
                  if (name.startsWith('small')) return 'High Quality';
                  if (name.startsWith('medium')) return 'Enhanced';
                  if (name.startsWith('large')) return 'Best';
                  return 'Standard';
                };

                return (
                  <div className="mt-2 ml-6 space-y-1.5">
                    <p className="text-xs text-surface-400 mb-1">
                      Choose a model {needsMultilingual ? '(multilingual)' : '(English)'}:
                    </p>
                    {visibleModels.map((model) => {
                      const isActive = activeModelName === model.fileName;
                      const isDownloading = downloadingModel === model.fileName;
                      const isRecommended = model.name === recommendedName;

                      return (
                        <div
                          key={model.fileName}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                            isActive
                              ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-border-accent)]'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-[var(--color-text-primary)]">
                                {tierLabel(model.name)}
                              </span>
                              {isRecommended && (
                                <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium">
                                  Recommended
                                </span>
                              )}
                              {isActive && (
                                <span className="inline-flex items-center gap-0.5 text-[0.625rem] text-emerald-400 font-medium">
                                  <Check size={10} />
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[0.6875rem] text-surface-500">{model.description}</span>
                              <span className="inline-flex items-center gap-0.5 text-[0.6875rem] text-surface-500">
                                <HardDrive size={10} />
                                {model.size}
                              </span>
                            </div>
                          </div>

                          {model.available ? (
                            !isActive && (
                              <button
                                onClick={() => handleSetActiveModel(model.fileName)}
                                className="flex items-center gap-1 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] px-2.5 py-1 rounded-lg text-xs transition-colors shrink-0"
                              >
                                Use
                              </button>
                            )
                          ) : isDownloading ? (
                            <div className="flex items-center gap-1.5 text-xs text-[var(--color-accent-dim)] shrink-0">
                              <Loader2 size={12} className="animate-spin" />
                              {downloadPercent}%
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDownloadModel(model.fileName)}
                              disabled={!!downloadingModel}
                              className="flex items-center gap-1 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg text-xs transition-colors shrink-0"
                            >
                              <Download size={12} />
                              Download
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            {/* Whisper backend status */}
            {provider.type === 'local' && config.type === 'local' && (
              <div className="mt-2 ml-6 flex items-center gap-1.5 text-xs">
                {whisperBackend === 'vulkan' || whisperBackend === 'cuda' ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-surface-400">
                      Running on: <span className="text-emerald-400 font-medium">GPU ({whisperBackend})</span>
                    </span>
                  </>
                ) : whisperBackend === 'cpu' ? (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-surface-400">
                        Running on: <span className="text-amber-400 font-medium">CPU</span>
                      </span>
                    </div>
                    <span className="text-surface-500 ml-3">GPU acceleration (Vulkan/CUDA) is 3-5x faster</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-surface-500 shrink-0" />
                      <span className="text-surface-500">Backend: not yet detected</span>
                    </div>
                    <span className="text-surface-500 ml-3">Start a recording to detect GPU support</span>
                  </div>
                )}
              </div>
            )}

            {/* Speed preset for local provider */}
            {provider.type === 'local' && config.type === 'local' && (
              <div className="mt-3 ml-6">
                <p className="text-xs font-medium text-[var(--color-text-primary)] mb-1.5">Transcription Speed</p>
                <div className="space-y-1.5">
                  {(
                    [
                      { value: 'fast', label: 'Fast', description: 'Fastest transcription, slightly lower accuracy' },
                      {
                        value: 'balanced',
                        label: 'Balanced',
                        description: 'Good balance of speed and accuracy',
                        recommended: true,
                      },
                      { value: 'accurate', label: 'Accurate', description: 'Best accuracy, slower processing' },
                    ] as const
                  ).map((preset) => (
                    <label key={preset.value} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="speed-preset"
                        value={preset.value}
                        checked={speedPreset === preset.value}
                        onChange={() => handleSpeedPresetChange(preset.value)}
                        className="w-3.5 h-3.5 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">{preset.label}</span>
                        {'recommended' in preset && preset.recommended && (
                          <span className="ml-1.5 text-[0.625rem] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium">
                            Default
                          </span>
                        )}
                        <p className="text-[0.6875rem] text-surface-500 mt-0">{preset.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-[0.6875rem] text-surface-500 mt-1.5">
                  Takes effect on next recording. Fast uses greedy decoding; Accurate uses full beam search.
                </p>
              </div>
            )}

            {/* API key input for cloud providers */}
            {provider.type === 'deepgram' &&
              (config.type === 'deepgram' || config.hasDeepgramKey) &&
              renderApiKeyInput('deepgram')}

            {provider.type === 'assemblyai' &&
              (config.type === 'assemblyai' || config.hasAssemblyaiKey) &&
              renderApiKeyInput('assemblyai')}
          </div>
        ))}

        {providerError && (
          <p className="text-xs text-red-400" role="alert">
            {providerError}
          </p>
        )}

        {/* Transcription Language */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
            Transcription Language
          </label>
          <HudSelect
            value={selectedLanguage}
            onChange={(v) => handleLanguageChange(v)}
            icon={Globe}
            options={TRANSCRIPTION_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
          />
          {showModelWarning && (
            <p className="mt-1.5 text-xs text-amber-400">
              {'\u26A0'} Current model is English-only. Download a multilingual model above to transcribe other
              languages.
            </p>
          )}
          <p className="mt-1 text-xs text-surface-500">
            For non-English or mixed-language meetings, select &ldquo;Multilingual&rdquo; and use a multilingual Whisper
            model.
          </p>

          {/* Mixed-language initial prompt editor */}
          {(selectedLanguage === 'cs-mix' || selectedLanguage === 'sk-mix' || selectedLanguage === 'en-mix') && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--color-text-primary)]">
                  Initial prompt (helps Whisper recognize mixed terms)
                </label>
                <button
                  type="button"
                  onClick={handleResetMixedPrompt}
                  className="text-[0.6875rem] text-[var(--color-accent-dim)] hover:text-[var(--color-accent)] transition-colors"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={mixedPrompt}
                onChange={(e) => handleMixedPromptChange(e.target.value)}
                onBlur={handleMixedPromptBlur}
                rows={3}
                className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-y"
              />
              <p className="text-[0.6875rem] text-surface-500">
                Mention project names, people, and technical terms in all three languages to improve accuracy.
              </p>
            </div>
          )}
        </div>

        {/* Test connection button */}
        <div className="pt-2 border-t border-[var(--color-border)]">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-all"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>

          {/* Test result */}
          {testResult && (
            <div className={`mt-2 text-sm ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.success ? (
                <span className="inline-flex items-center gap-1">
                  <Check size={14} />
                  Connected successfully
                  {testResult.latencyMs != null && (
                    <span className="text-xs text-surface-400 ml-1">({testResult.latencyMs}ms)</span>
                  )}
                </span>
              ) : (
                <span>{testResult.error || 'Connection failed'}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {pendingCloudProvider && (
        <CloudTranscriptionConsentDialog
          provider={pendingCloudProvider}
          onConfirm={confirmCloudSwitch}
          onCancel={cancelCloudSwitch}
        />
      )}
    </section>
  );
}
