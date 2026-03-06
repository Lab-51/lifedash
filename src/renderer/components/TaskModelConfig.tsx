// === FILE PURPOSE ===
// Component for assigning an AI provider + model to each task type.
// Renders one row per AITaskType with provider and model selectors.
// Persists selections as JSON to the settings table (key: 'ai.taskModels').

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AIProvider, AIProviderName, AITaskType, TaskModelConfig as TaskModelConfigType } from '../../shared/types';
import HudSelect from './HudSelect';

// Human-readable labels for task types
const TASK_TYPE_INFO: { type: AITaskType; label: string; description: string }[] = [
  { type: 'summarization', label: 'Summarization', description: 'Meeting briefs and transcript summaries' },
  { type: 'brainstorming', label: 'Brainstorming', description: 'AI-assisted ideation and exploration' },
  { type: 'idea_analysis', label: 'Idea Analysis', description: 'Evaluating feasibility and effort' },
  { type: 'card_agent', label: 'Card Agent', description: 'AI agent chat in card detail modals' },
  { type: 'meeting_prep', label: 'Meeting Prep', description: 'Pre-meeting briefing and context' },
  { type: 'standup', label: 'Daily Standup', description: 'Auto-generated standup reports' },
  { type: 'card-description', label: 'Card Description', description: 'AI-generated card descriptions' },
  { type: 'task_structuring', label: 'Task Structuring', description: 'AI project planning and breakdown' },
  { type: 'background_agent', label: 'Background Agent', description: 'Autonomous stale card detection and project insights' },
  { type: 'project_agent', label: 'Project Agent', description: 'AI agent for cross-board project analysis' },
];

// Known models per provider (v1 — hardcoded, expandable later)
const KNOWN_MODELS: Record<AIProviderName, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-5.2', label: 'GPT-5.2 (Flagship)' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'o4-mini', label: 'o4-mini (Reasoning)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Budget)' },
  ],
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (Flagship)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'codellama', label: 'Code Llama' },
  ],
  kimi: [
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'kimi-k2.5-preview', label: 'Kimi K2.5 Preview' },
  ],
};

// Recommended presets: which model to use per task type for each provider.
// Rationale:
//   - Brainstorming & Idea Analysis need creativity + deep reasoning → flagship
//   - Card Agent & Project Agent are user-facing conversations → flagship for quality
//   - Summarization, Meeting Prep, Standup, Card Description → structured output, efficient model is fine
//   - Task Structuring → structured planning, efficient models handle this well
//   - Background Agent → autonomous checks, no need for flagship
const FLAGSHIP_TASKS: Set<AITaskType> = new Set([
  'brainstorming', 'idea_analysis', 'card_agent', 'project_agent',
]);

const RECOMMENDED_MODELS: Record<AIProviderName, { flagship: string; efficient: string }> = {
  openai:    { flagship: 'gpt-5.2',          efficient: 'gpt-5-mini' },
  anthropic: { flagship: 'claude-opus-4-6',   efficient: 'claude-sonnet-4-6' },
  kimi:      { flagship: 'kimi-k2.5',        efficient: 'kimi-k2.5' },
  ollama:    { flagship: 'llama3.2',          efficient: 'llama3.2' },
};

export interface TaskModelConfigHandle {
  autoAssign: (provider: AIProvider) => void;
}

interface TaskModelConfigProps {
  providers: AIProvider[];
}

type DraftConfig = Record<AITaskType, { providerId: string; model: string }>;

const TaskModelConfig = forwardRef<TaskModelConfigHandle, TaskModelConfigProps>(function TaskModelConfig({ providers }, ref) {
  const getTaskModels = useSettingsStore(s => s.getTaskModels);
  const setTaskModels = useSettingsStore(s => s.setTaskModels);
  // Subscribe to the actual setting value so we re-render when loadSettings() completes
  const taskModelsJson = useSettingsStore(s => s.settings['ai.taskModels']);
  const [draft, setDraft] = useState<DraftConfig>({} as DraftConfig);
  const [customModel, setCustomModel] = useState<Record<AITaskType, string>>({} as Record<AITaskType, string>);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const enabledProviders = providers.filter(p => p.enabled);

  // Load saved config when settings become available (after async loadSettings)
  useEffect(() => {
    const savedModels = getTaskModels();
    const initial: DraftConfig = {} as DraftConfig;
    for (const { type } of TASK_TYPE_INFO) {
      if (savedModels?.[type]) {
        initial[type] = {
          providerId: savedModels[type].providerId,
          model: savedModels[type].model,
        };
      } else {
        initial[type] = { providerId: '', model: '' };
      }
    }
    setDraft(initial);
    setDirty(false);
  }, [taskModelsJson, getTaskModels]);

  const updateDraft = (type: AITaskType, field: 'providerId' | 'model', value: string) => {
    setDraft(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value,
        // Reset model when provider changes
        ...(field === 'providerId' ? { model: '' } : {}),
      },
    }));
    setDirty(true);
    setSaved(false);
  };

  const getProviderName = (providerId: string): AIProviderName | null => {
    const p = providers.find(prov => prov.id === providerId);
    return p ? p.name : null;
  };

  const getModelsForProvider = (providerId: string) => {
    const name = getProviderName(providerId);
    if (!name) return [];
    return KNOWN_MODELS[name] || [];
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build TaskModelConfig record, only include entries with both provider and model set
      const config: Record<string, TaskModelConfigType> = {};
      for (const { type } of TASK_TYPE_INFO) {
        const entry = draft[type];
        const model = entry.model || customModel[type];
        if (entry.providerId && model) {
          config[type] = { providerId: entry.providerId, model };
        }
      }
      await setTaskModels(config as Record<AITaskType, TaskModelConfigType>);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save model config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const savedModels = getTaskModels();
    const initial: DraftConfig = {} as DraftConfig;
    for (const { type } of TASK_TYPE_INFO) {
      if (savedModels?.[type]) {
        initial[type] = {
          providerId: savedModels[type].providerId,
          model: savedModels[type].model,
        };
      } else {
        initial[type] = { providerId: '', model: '' };
      }
    }
    setDraft(initial);
    setDirty(false);
    setSaved(false);
  };

  const handleAutoAssign = (provider: AIProvider) => {
    const presets = RECOMMENDED_MODELS[provider.name];
    if (!presets) return;
    const auto: DraftConfig = {} as DraftConfig;
    for (const { type } of TASK_TYPE_INFO) {
      auto[type] = {
        providerId: provider.id,
        model: FLAGSHIP_TASKS.has(type) ? presets.flagship : presets.efficient,
      };
    }
    setDraft(auto);
    setDirty(true);
    setSaved(false);
  };

  useImperativeHandle(ref, () => ({
    autoAssign: handleAutoAssign,
  }));

  if (enabledProviders.length === 0) {
    return (
      <div className="text-sm text-[var(--color-text-muted)] py-4 font-data">
        Enable at least one AI provider above to configure model assignments.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {TASK_TYPE_INFO.map(({ type, label, description }) => {
        const entry = draft[type] || { providerId: '', model: '' };
        const models = getModelsForProvider(entry.providerId);
        const providerName = getProviderName(entry.providerId);
        const isOllama = providerName === 'ollama';

        return (
          <div key={type}
            className="p-3 hud-panel clip-corner-cut-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)]">{label}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">{description}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Provider selector */}
                <HudSelect
                  value={entry.providerId}
                  onChange={(v) => updateDraft(type, 'providerId', v)}
                  placeholder="Select provider"
                  compact
                  options={[
                    { value: '', label: 'Select provider' },
                    ...enabledProviders.map(p => ({ value: p.id, label: p.displayName || p.name })),
                  ]}
                />

                {/* Model selector (dropdown for known models, text input for Ollama/custom) */}
                {entry.providerId && (
                  isOllama || models.length === 0 ? (
                    <input type="text"
                      value={entry.model || customModel[type] || ''}
                      onChange={e => {
                        setCustomModel(prev => ({ ...prev, [type]: e.target.value }));
                        updateDraft(type, 'model', e.target.value);
                      }}
                      placeholder="Model name..."
                      className="text-xs bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] w-36 font-data" />
                  ) : (
                    <HudSelect
                      value={entry.model}
                      onChange={(v) => updateDraft(type, 'model', v)}
                      placeholder="Select model"
                      compact
                      options={[
                        { value: '', label: 'Select model' },
                        ...models.map(m => ({ value: m.id, label: m.label })),
                      ]}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Save / Reset buttons */}
      <div className="flex items-center gap-2 pt-2">
        <button onClick={handleSave} disabled={saving || !dirty}
          className="flex items-center gap-1.5 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 px-3 py-1.5 text-sm transition-all">
          <Save size={14} />
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Assignments'}
        </button>
        {dirty && (
          <button onClick={handleReset}
            className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] text-sm transition-colors">
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>
    </div>
  );
});

export default TaskModelConfig;
