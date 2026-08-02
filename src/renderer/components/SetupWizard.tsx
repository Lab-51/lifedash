// === FILE PURPOSE ===
// Multi-step setup wizard modal for first-time AI provider configuration.
// Appears on first launch when no AI providers are configured.
// Guides the user through choosing a provider, configuring it, and testing the connection.
// Stores a "setupWizard.completed" flag in settings so it only shows once.
// This file is the orchestrator — individual steps live in ./setup-wizard/.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useNavigate } from 'react-router-dom';
import type { AIProviderName, AITaskType, TaskModelConfig } from '../../shared/types';
import type { WizardStep, SetupWizardProps } from './setup-wizard/types';

import StepIndicator from './setup-wizard/StepIndicator';
import StepWelcome from './setup-wizard/StepWelcome';
import StepHaveKey from './setup-wizard/StepHaveKey';
import StepPickProvider from './setup-wizard/StepPickProvider';
import StepTutorial from './setup-wizard/StepTutorial';
import StepLocalBuiltin from './setup-wizard/StepLocalBuiltin';
import StepConfigure from './setup-wizard/StepConfigure';
import StepTest from './setup-wizard/StepTest';
import StepDone from './setup-wizard/StepDone';
import { builtinTaskModelPatch, type BuiltinAssignment } from './setup-wizard/localBuiltin';

export default function SetupWizard({ onClose }: SetupWizardProps) {
  const navigate = useNavigate();
  const providers = useSettingsStore((s) => s.providers);
  const createProvider = useSettingsStore((s) => s.createProvider);
  const deleteProvider = useSettingsStore((s) => s.deleteProvider);
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const getTaskModels = useSettingsStore((s) => s.getTaskModels);
  const setTaskModels = useSettingsStore((s) => s.setTaskModels);

  const [step, setStep] = useState<WizardStep>('welcome');
  const [prevStep, setPrevStep] = useState<WizardStep>('have-key');
  const [createdProviderId, setCreatedProviderId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderName | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [lmStudioStatus, setLmStudioStatus] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'running' | 'success' | 'failure'>('running');
  const [testError, setTestError] = useState<string | null>(null);
  const [testLatency, setTestLatency] = useState<number | undefined>(undefined);

  // Pre-fill base URL when provider changes and reset local provider state
  useEffect(() => {
    if (selectedProvider === 'ollama') {
      setBaseUrl('http://localhost:11434');
    } else if (selectedProvider === 'lmstudio') {
      setBaseUrl('http://localhost:1234/v1');
    } else {
      setBaseUrl('');
    }
    setApiKey('');
    setOllamaStatus('idle');
    setOllamaModels([]);
    setLmStudioStatus('idle');
    setLmStudioModels([]);
  }, [selectedProvider]);

  // Auto-detect Ollama when entering the configure step for Ollama
  useEffect(() => {
    if (step === 'configure' && selectedProvider === 'ollama' && ollamaStatus === 'idle') {
      handleCheckOllama();
    }
    if (step === 'configure' && selectedProvider === 'lmstudio' && lmStudioStatus === 'idle') {
      handleCheckLmStudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedProvider]);

  const handleClose = useCallback(async () => {
    await setSetting('setupWizard.completed', 'true');
    onClose();
  }, [setSetting, onClose]);

  // Escape key closes the wizard (marks it as completed).
  // Use a ref to always call the latest handleClose without listing it as a dep,
  // avoiding both the stale-closure problem and infinite-effect loops.
  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseRef.current();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function handleSkip() {
    handleClose();
  }

  async function handleCheckOllama() {
    setOllamaStatus('checking');
    try {
      const result = await window.electronAPI.checkOllama();
      if (result.running) {
        setOllamaStatus('found');
        setOllamaModels(result.models);
      } else {
        setOllamaStatus('not-found');
        setOllamaModels([]);
      }
    } catch {
      setOllamaStatus('not-found');
      setOllamaModels([]);
    }
  }

  async function handleCheckLmStudio() {
    setLmStudioStatus('checking');
    try {
      const result = await window.electronAPI.checkLmStudio();
      if (result.running) {
        setLmStudioStatus('found');
        setLmStudioModels(result.models);
      } else {
        setLmStudioStatus('not-found');
        setLmStudioModels([]);
      }
    } catch {
      setLmStudioStatus('not-found');
      setLmStudioModels([]);
    }
  }

  async function handleSaveAndTest() {
    if (!selectedProvider) return;

    setStep('test');
    setTestStatus('running');
    setTestError(null);
    setTestLatency(undefined);

    try {
      const provider = await createProvider({
        name: selectedProvider,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      setCreatedProviderId(provider.id);

      const result = await window.electronAPI.testAIConnection(provider.id);
      if (result.success) {
        setTestStatus('success');
        setTestLatency(result.latencyMs);
      } else {
        setTestStatus('failure');
        setTestError(result.error ?? 'Connection test failed');
      }

      // Refresh providers in the store
      await loadProviders();
    } catch (err) {
      setTestStatus('failure');
      setTestError(err instanceof Error ? err.message : 'Failed to create provider');
    }
  }

  function handleConfigureNext() {
    handleSaveAndTest();
  }

  /**
   * Built-in path completion. Runs only after the chosen model's file is on disk
   * (StepLocalBuiltin gates the button on that), because an undownloaded model is
   * not routable. Writes `ai.taskModels` through the same store action Settings →
   * Model Assignments uses, MERGED over whatever is stored so a returning user's
   * other assignments survive. Then the existing StepTest proves the runtime by
   * lazy-starting the sidecar.
   */
  async function handleBuiltinFinish(pick: BuiltinAssignment) {
    setSelectedProvider('builtin');
    setPrevStep('local-builtin');
    setStep('test');
    setTestStatus('running');
    setTestError(null);
    setTestLatency(undefined);

    try {
      // Reuse a built-in provider the user may already have rather than adding a
      // duplicate row — and so going Back can never delete something pre-existing.
      const existing = providers.find((p) => p.name === 'builtin');
      const provider = existing ?? (await createProvider({ name: 'builtin' }));
      setCreatedProviderId(provider.id);

      const merged = { ...(getTaskModels() ?? {}), ...builtinTaskModelPatch(provider.id, pick) };
      await setTaskModels(merged as Record<AITaskType, TaskModelConfig>);

      const result = await window.electronAPI.testAIConnection(provider.id);
      if (result.success) {
        setTestStatus('success');
        setTestLatency(result.latencyMs);
      } else {
        setTestStatus('failure');
        setTestError(result.error ?? 'Connection test failed');
      }

      await loadProviders();
    } catch (err) {
      setTestStatus('failure');
      setTestError(err instanceof Error ? err.message : 'Failed to set up the built-in runtime');
    }
  }

  async function handleTestBack() {
    // The built-in path has no credentials to re-enter — going back means picking
    // a different model. Its provider row is reused, so deleting it here could
    // destroy one the user configured before ever opening the wizard.
    if (selectedProvider === 'builtin') {
      setStep('local-builtin');
      return;
    }
    if (createdProviderId) {
      await deleteProvider(createdProviderId);
      setCreatedProviderId(null);
      await loadProviders();
    }
    setStep('configure');
  }

  async function handleDone() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
  }

  async function handleNavigateIntel() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
    navigate('/intel');
  }

  async function handleNavigateBrainstorm() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
    navigate('/brainstorm');
  }

  async function handleNavigateMeetings() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
    navigate('/meetings');
  }

  async function handleNavigateSettings() {
    await setSetting('setupWizard.completed', 'true');
    onClose();
    navigate('/settings');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleSkip}
    >
      {/* Capped and column-flexed so a tall step (the built-in model list) scrolls
          its body instead of pushing Back / Skip outside the window, where they
          become unclickable — the wizard has to stay leaveable at every step. */}
      <div
        className="w-full max-w-[560px] max-h-[92vh] mx-4 flex flex-col hud-panel-accent clip-corner-cut shadow-2xl relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] bg-[radial-gradient(ellipse,rgba(62,232,228,0.06)_0%,transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-accent)]">
          <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
            Setup Wizard
          </span>
          <button
            onClick={handleSkip}
            className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto">
          <StepIndicator current={step} />

          {step === 'welcome' && <StepWelcome onSetup={() => setStep('have-key')} onSkip={handleSkip} />}

          {step === 'have-key' && (
            <StepHaveKey
              onUseBuiltin={() => setStep('local-builtin')}
              onUseExistingLocal={(provider) => {
                setSelectedProvider(provider);
                setPrevStep('have-key');
                setStep('configure');
              }}
              onHaveKey={() => setStep('pick-provider')}
              onGetHelp={() => setStep('tutorial')}
              onSkip={handleClose}
            />
          )}

          {step === 'local-builtin' && (
            <StepLocalBuiltin
              onFinish={(pick) => void handleBuiltinFinish(pick)}
              onUseCloud={() => {
                setSelectedProvider(null);
                setStep('pick-provider');
              }}
              onBack={() => setStep('have-key')}
              onSkip={handleClose}
            />
          )}

          {step === 'pick-provider' && (
            <StepPickProvider
              selected={selectedProvider}
              onSelect={setSelectedProvider}
              onNext={() => {
                setPrevStep('pick-provider');
                setStep('configure');
              }}
              onBack={() => setStep('have-key')}
            />
          )}

          {step === 'tutorial' && (
            <StepTutorial
              onSelectProvider={(provider) => {
                setSelectedProvider(provider);
                setPrevStep('tutorial');
                setStep('configure');
              }}
              onBack={() => setStep('have-key')}
            />
          )}

          {step === 'configure' && selectedProvider && (
            <StepConfigure
              provider={selectedProvider}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              baseUrl={baseUrl}
              onBaseUrlChange={setBaseUrl}
              ollamaStatus={ollamaStatus}
              ollamaModels={ollamaModels}
              onCheckOllama={handleCheckOllama}
              lmStudioStatus={lmStudioStatus}
              lmStudioModels={lmStudioModels}
              onCheckLmStudio={handleCheckLmStudio}
              onNext={handleConfigureNext}
              onBack={() => setStep(prevStep)}
            />
          )}

          {step === 'test' && (
            <StepTest
              status={testStatus}
              error={testError}
              latencyMs={testLatency}
              onNext={() => setStep('done')}
              onBack={handleTestBack}
            />
          )}

          {step === 'done' && (
            <StepDone
              onClose={handleDone}
              onNavigateIntel={handleNavigateIntel}
              onNavigateBrainstorm={handleNavigateBrainstorm}
              onNavigateMeetings={handleNavigateMeetings}
              onNavigateSettings={handleNavigateSettings}
            />
          )}
        </div>
      </div>
    </div>
  );
}
