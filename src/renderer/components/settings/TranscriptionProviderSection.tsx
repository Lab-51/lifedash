// === FILE PURPOSE ===
// Transcription provider selection section for the Settings page.
// Allows users to choose between Local Whisper, Deepgram, or AssemblyAI
// for meeting transcription, configure API keys, and test connectivity.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge)

import { useEffect, useState, useCallback, useRef } from 'react';
import { Mic, Loader2, Check, Eye, EyeOff } from 'lucide-react';
import type { TranscriptionProviderStatus, TranscriptionProviderType } from '../../../shared/types';
import { TRANSCRIPTION_LANGUAGES } from '../../../shared/types';

/** Provider option metadata for rendering */
const PROVIDERS: Array<{
  type: TranscriptionProviderType;
  label: string;
  description: string;
}> = [
  {
    type: 'local',
    label: 'Local (Whisper)',
    description: 'Uses locally downloaded Whisper model. Free, private, works offline.',
  },
  {
    type: 'deepgram',
    label: 'Deepgram',
    description: 'Cloud-based transcription with high accuracy and speed.',
  },
  {
    type: 'assemblyai',
    label: 'AssemblyAI',
    description: 'Cloud-based transcription with advanced features.',
  },
];

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

  const testResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Load saved language and active model on mount
  useEffect(() => {
    (async () => {
      try {
        const [savedLang, model] = await Promise.all([
          window.electronAPI.getSetting('transcription:language'),
          window.electronAPI.whisperGetActiveModel(),
        ]);
        if (savedLang) setSelectedLanguage(savedLang);
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

  const handleLanguageChange = async (value: string) => {
    setSelectedLanguage(value);
    try {
      await window.electronAPI.setSetting('transcription:language', value);
    } catch {
      // Settings save failed — non-critical
    }
  };

  const isEnglishOnlyModel = activeModelName?.includes('.en') ?? false;
  const showModelWarning = config?.type === 'local' && isEnglishOnlyModel && selectedLanguage !== 'en';

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (testResultTimer.current) clearTimeout(testResultTimer.current);
    };
  }, []);

  const handleProviderChange = async (type: TranscriptionProviderType) => {
    if (!config) return;
    try {
      await window.electronAPI.transcriptionSetProvider(type);
      setTestResult(null);
      await loadConfig();
    } catch (err) {
      console.error('Failed to set transcription provider:', err);
    }
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
            className="w-full text-sm bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 pr-10 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
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
          className="flex items-center gap-1 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-lg text-xs transition-colors"
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
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Transcription Provider</h2>
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
          <Mic size={18} className="text-primary-400" />
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Transcription Provider</h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Select how meeting audio is transcribed.
        </p>
      </div>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Provider radio options */}
        {PROVIDERS.map((provider) => (
          <div key={provider.type}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="transcription-provider"
                value={provider.type}
                checked={config.type === provider.type}
                onChange={() => handleProviderChange(provider.type)}
                className="w-4 h-4 mt-0.5 text-primary-600 border-surface-600 bg-surface-700 focus:ring-primary-500 focus:ring-offset-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    {provider.label}
                  </span>
                  {renderStatus(provider.type)}
                </div>
                <p className="text-xs text-surface-500 mt-0.5">
                  {provider.description}
                </p>
              </div>
            </label>

            {/* API key input for cloud providers */}
            {provider.type === 'deepgram' && (
              config.type === 'deepgram' || config.hasDeepgramKey
            ) && renderApiKeyInput('deepgram')}

            {provider.type === 'assemblyai' && (
              config.type === 'assemblyai' || config.hasAssemblyaiKey
            ) && renderApiKeyInput('assemblyai')}
          </div>
        ))}

        {/* Transcription Language */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
            Transcription Language
          </label>
          <select
            value={selectedLanguage}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="w-full max-w-xs"
          >
            {TRANSCRIPTION_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
          {showModelWarning && (
            <p className="mt-1.5 text-xs text-amber-400">
              {'\u26A0'} Current Whisper model ({activeModelName}) is English-only. Download a multilingual model above for {TRANSCRIPTION_LANGUAGES.find(l => l.code === selectedLanguage)?.label ?? selectedLanguage} transcription.
            </p>
          )}
          <p className="mt-1 text-xs text-surface-500">
            For mixed Czech/English meetings, use &ldquo;Auto-detect&rdquo; with a multilingual Whisper model.
          </p>
        </div>

        {/* Test connection button */}
        <div className="pt-2 border-t border-[var(--color-border)]">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-all"
          >
            {testing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Mic size={16} />
            )}
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
                    <span className="text-xs text-surface-400 ml-1">
                      ({testResult.latencyMs}ms)
                    </span>
                  )}
                </span>
              ) : (
                <span>{testResult.error || 'Connection failed'}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
