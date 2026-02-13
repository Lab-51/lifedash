// === FILE PURPOSE ===
// Component for assigning an AI provider + model to each task type.
// Renders one row per AITaskType with provider and model selectors.
// Persists selections as JSON to the settings table (key: 'ai.taskModels').

import { useState, useEffect } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AIProvider, AIProviderName, AITaskType, TaskModelConfig as TaskModelConfigType } from '../../shared/types';

// Human-readable labels for task types
const TASK_TYPE_INFO: { type: AITaskType; label: string; description: string }[] = [
  { type: 'summarization', label: 'Summarization', description: 'Meeting briefs and transcript summaries' },
  { type: 'brainstorming', label: 'Brainstorming', description: 'AI-assisted ideation and exploration' },
  { type: 'task_generation', label: 'Task Generation', description: 'Breaking projects into actionable tasks' },
  { type: 'idea_analysis', label: 'Idea Analysis', description: 'Evaluating feasibility and effort' },
];

// Known models per provider (v1 — hardcoded, expandable later)
const KNOWN_MODELS: Record<AIProviderName, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o1-mini', label: 'o1 Mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'codellama', label: 'Code Llama' },
  ],
};

interface TaskModelConfigProps {
  providers: AIProvider[];
}

type DraftConfig = Record<AITaskType, { providerId: string; model: string }>;

export default function TaskModelConfig({ providers }: TaskModelConfigProps) {
  const { getTaskModels, setTaskModels } = useSettingsStore();
  const [draft, setDraft] = useState<DraftConfig>({} as DraftConfig);
  const [customModel, setCustomModel] = useState<Record<AITaskType, string>>({} as Record<AITaskType, string>);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const enabledProviders = providers.filter(p => p.enabled);

  // Load saved config on mount
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
  }, [getTaskModels]);

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

  if (enabledProviders.length === 0) {
    return (
      <div className="text-sm text-surface-500 py-4">
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
            className="p-3 bg-surface-800 border border-surface-700 rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-surface-200">{label}</div>
                <div className="text-xs text-surface-500">{description}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Provider selector */}
                <select value={entry.providerId}
                  onChange={e => updateDraft(type, 'providerId', e.target.value)}
                  className="text-xs bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-surface-100 focus:outline-none focus:border-primary-500">
                  <option value="">Select provider</option>
                  {enabledProviders.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.displayName || p.name}
                    </option>
                  ))}
                </select>

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
                      className="text-xs bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500 w-36" />
                  ) : (
                    <select value={entry.model}
                      onChange={e => updateDraft(type, 'model', e.target.value)}
                      className="text-xs bg-surface-900 border border-surface-700 rounded px-2 py-1.5 text-surface-100 focus:outline-none focus:border-primary-500">
                      <option value="">Select model</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
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
          className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
          <Save size={14} />
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Assignments'}
        </button>
        {dirty && (
          <button onClick={handleReset}
            className="flex items-center gap-1.5 text-surface-400 hover:text-surface-200 text-sm transition-colors">
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
