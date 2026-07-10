// === FILE PURPOSE ===
// Component for assigning an AI provider + model to each task type.
// Renders one row per AITaskType with provider and model selectors.
// Persists selections as JSON to the settings table (key: 'ai.taskModels').

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Save, RotateCcw, Info } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type {
  AIProvider,
  AIProviderName,
  AITaskType,
  TaskModelConfig as TaskModelConfigType,
} from '../../shared/types';
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
  {
    type: 'background_agent',
    label: 'Background Agent',
    description: 'Autonomous stale card detection and project insights',
  },
  { type: 'project_agent', label: 'Project Agent', description: 'AI agent for cross-board project analysis' },
  {
    type: 'live_assistant',
    label: 'Live Assistant',
    description: 'In-meeting AI partner — answers questions and creates cards during recording',
  },
  {
    type: 'twin_interview',
    label: 'Twin Interview Assist',
    description:
      'Optional AI-drafted answers for the Digital Twin wizard\'s "Interview me" steps — defaults to the Live Assistant model',
  },
  {
    type: 'twin_learning',
    label: 'Twin Learning',
    description:
      'Background per-session fact extraction that grows the Digital Twin — defaults to the Live Assistant model',
  },
  {
    type: 'knowledge_qa',
    label: 'Knowledge Q&A',
    description: 'Answer synthesis over semantic search across your sessions — defaults to the Live Assistant model',
  },
  {
    type: 'embedding',
    label: 'Embedding',
    description: 'Local vector generation for semantic search and Twin memory — pick a local, multilingual model',
  },
];

/** Provider families that run entirely on the user's machine — no transcript leaves the device. */
const LOCAL_PROVIDERS: Set<AIProviderName> = new Set(['ollama', 'lmstudio']);

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
  google: [
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Flagship)' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Budget)' },
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
  lmstudio: [{ id: 'default', label: 'Loaded Model (default)' }],
};

// Recommended presets: which model to use per task type for each provider.
// Rationale:
//   - Brainstorming & Idea Analysis need creativity + deep reasoning → flagship
//   - Card Agent & Project Agent are user-facing conversations → flagship for quality
//   - Summarization, Meeting Prep, Standup, Card Description → structured output, efficient model is fine
//   - Task Structuring → structured planning, efficient models handle this well
//   - Background Agent → autonomous checks, no need for flagship
const FLAGSHIP_TASKS: Set<AITaskType> = new Set(['brainstorming', 'idea_analysis', 'card_agent', 'project_agent']);

const RECOMMENDED_MODELS: Record<AIProviderName, { flagship: string; efficient: string }> = {
  openai: { flagship: 'gpt-5.2', efficient: 'gpt-5-mini' },
  anthropic: { flagship: 'claude-opus-4-6', efficient: 'claude-sonnet-4-6' },
  // Auto-assign uses GA (non-preview) Gemini so it never routes to a preview
  // endpoint the user may not have access to.
  google: { flagship: 'gemini-2.5-pro', efficient: 'gemini-2.5-flash' },
  kimi: { flagship: 'kimi-k2.5', efficient: 'kimi-k2.5' },
  ollama: { flagship: 'llama3.2', efficient: 'llama3.2' },
  lmstudio: { flagship: 'default', efficient: 'default' },
};

/** Heuristic for spotting an embedding model id among a runtime's loaded models. */
const EMBEDDING_MODEL_PATTERN = /text-embedding|embed|bge|nomic/i;

/** Fallback embedding model id per local provider when none can be detected live. */
const DEFAULT_EMBEDDING_MODEL: Record<'lmstudio' | 'ollama', string> = {
  lmstudio: 'text-embedding-embeddinggemma-300m',
  ollama: 'nomic-embed-text',
};

/**
 * Narrow a provider's live-loaded model ids to embedding candidates. Falls back to
 * ALL loaded ids when the heuristic matches none, so the dropdown is never empty
 * (the user may have loaded an unconventionally-named embedding model).
 */
function getEmbeddingModelIds(loaded: string[]): string[] {
  const matches = loaded.filter((id) => EMBEDDING_MODEL_PATTERN.test(id));
  return matches.length > 0 ? matches : loaded;
}

type LiveModels = { lmstudio?: string[]; ollama?: string[] };

/**
 * Derive the Embedding row's selector state: the dropdown options (live-loaded
 * ids, or [] for cloud / unreachable runtimes) and whether to show the dropdown vs
 * the free-text input. Custom mode wins — either an explicit "Custom…" pick or a
 * saved id that isn't currently loaded — so no id is ever lost. Kept out of the
 * render map to hold that callback under the complexity budget.
 */
function deriveEmbeddingRow(
  isEmbedding: boolean,
  providerName: AIProviderName | null,
  model: string,
  liveModels: LiveModels,
  customOverride: boolean | undefined,
): { options: string[]; showDropdown: boolean } {
  if (!isEmbedding) return { options: [], showDropdown: false };
  const loaded = providerName === 'lmstudio' || providerName === 'ollama' ? (liveModels[providerName] ?? []) : [];
  const options = getEmbeddingModelIds(loaded);
  const custom = customOverride ?? (!!model && !options.includes(model));
  return { options, showDropdown: options.length > 0 && !custom };
}

/**
 * Provider-aware privacy hint for the Embedding row. A LOCAL provider embeds
 * on-device; a CLOUD provider ships bulk content (briefs, transcripts, cards) to
 * that provider, so the reassuring "stays on your device" copy must NEVER render
 * for it. The embedding schema dimension is measured, so it is not promised here.
 */
function EmbeddingPrivacyHint({
  isLocalProvider,
  providerName,
}: {
  isLocalProvider: boolean;
  providerName: AIProviderName | null;
}) {
  const isCloud = !!providerName && !isLocalProvider;
  if (isCloud) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
        <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          {providerName} is a cloud provider — your briefs, transcripts, and cards will be sent to it to be embedded for
          semantic search. For fully-private semantic search, assign a local embedding model (LM Studio or Ollama).
        </span>
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]">
      <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {isLocalProvider ? 'Embeddings stay on your device.' : 'Pick a local model to keep embeddings on your device.'}{' '}
        Recommended: a multilingual EmbeddingGemma-300M-class model (e.g. text-embedding-embeddinggemma-300m) for
        German/mixed meetings. Alternatives: bge-m3 (larger, higher quality) or nomic-embed-text-v1.5 (English-only).
        Enter the exact model id loaded in LM Studio.
      </span>
    </p>
  );
}

export interface TaskModelConfigHandle {
  autoAssign: (provider: AIProvider) => void;
}

interface TaskModelConfigProps {
  providers: AIProvider[];
}

type DraftConfig = Record<AITaskType, { providerId: string; model: string }>;

const TaskModelConfig = forwardRef<TaskModelConfigHandle, TaskModelConfigProps>(function TaskModelConfig(
  { providers },
  ref,
) {
  const getTaskModels = useSettingsStore((s) => s.getTaskModels);
  const setTaskModels = useSettingsStore((s) => s.setTaskModels);
  // Subscribe to the actual setting value so we re-render when loadSettings() completes
  const taskModelsJson = useSettingsStore((s) => s.settings['ai.taskModels']);
  const [draft, setDraft] = useState<DraftConfig>({} as DraftConfig);
  const [customModel, setCustomModel] = useState<Record<AITaskType, string>>({} as Record<AITaskType, string>);
  // Live loaded model ids per local runtime (populated best-effort from the bridge).
  const [liveModels, setLiveModels] = useState<LiveModels>({});
  // Per-task override forcing the free-text input (the Embedding "Custom…" mode).
  const [customMode, setCustomMode] = useState<Record<AITaskType, boolean>>({} as Record<AITaskType, boolean>);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const enabledProviders = providers.filter((p) => p.enabled);

  // Stable key of the enabled LOCAL provider families, so the fetch effect below
  // only re-runs when that set actually changes (not on every parent re-render).
  const enabledLocalKey = Array.from(
    new Set(enabledProviders.filter((p) => LOCAL_PROVIDERS.has(p.name)).map((p) => p.name)),
  )
    .sort()
    .join(',');

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

  // Fetch the live loaded model ids from any enabled local runtime (LM Studio /
  // Ollama) so the Embedding row can offer a real dropdown instead of free text.
  // Fully defensive: the bridge may be absent (tests) or the runtime unreachable —
  // any failure just leaves liveModels empty and the row falls back to free text.
  useEffect(() => {
    let cancelled = false;
    const names = enabledLocalKey ? enabledLocalKey.split(',') : [];
    async function loadLiveModels() {
      const next: { lmstudio?: string[]; ollama?: string[] } = {};
      for (const name of names) {
        try {
          if (name === 'lmstudio') {
            const res = await window.electronAPI?.checkLmStudio?.();
            if (res?.models) next.lmstudio = res.models;
          } else if (name === 'ollama') {
            const res = await window.electronAPI?.checkOllama?.();
            if (res?.models) next.ollama = res.models;
          }
        } catch {
          // Runtime unreachable — leave this provider's live models empty.
        }
      }
      if (!cancelled) setLiveModels(next);
    }
    void loadLiveModels();
    return () => {
      cancelled = true;
    };
  }, [enabledLocalKey]);

  const updateDraft = (type: AITaskType, field: 'providerId' | 'model', value: string) => {
    setDraft((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value,
        // Reset model when provider changes
        ...(field === 'providerId' ? { model: '' } : {}),
      },
    }));
    // Changing provider re-derives the Embedding custom/dropdown mode from scratch,
    // so a stale "Custom…" override can't trap the new provider in a free-text box.
    if (field === 'providerId') {
      setCustomMode((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
    }
    setDirty(true);
    setSaved(false);
  };

  const getProviderName = (providerId: string): AIProviderName | null => {
    const p = providers.find((prov) => prov.id === providerId);
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
      if (type === 'embedding') {
        // Only auto-assign embedding to a LOCAL runtime — pick a loaded embedding
        // model (or a sane default). For a CLOUD provider we deliberately leave the
        // user's existing choice untouched so bulk content is never silently routed
        // off-device (mirrors EmbeddingPrivacyHint's no-silent-cloud guarantee).
        if (provider.name === 'lmstudio' || provider.name === 'ollama') {
          const loaded = liveModels[provider.name] ?? [];
          const model = loaded.find((id) => EMBEDDING_MODEL_PATTERN.test(id)) ?? DEFAULT_EMBEDDING_MODEL[provider.name];
          auto[type] = { providerId: provider.id, model };
        } else {
          auto[type] = draft[type] ?? { providerId: '', model: '' };
        }
        continue;
      }
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
        const isEmbedding = type === 'embedding';
        const isLocalProvider = !!providerName && LOCAL_PROVIDERS.has(providerName);

        // Embedding row only: offer a dropdown of the runtime's live-loaded models
        // when the provider is local and any are reachable; otherwise (or in Custom…
        // mode / for a saved-but-unloaded id) fall back to the free-text input.
        const { options: embeddingOptions, showDropdown: showEmbeddingDropdown } = deriveEmbeddingRow(
          isEmbedding,
          providerName,
          entry.model,
          liveModels,
          customMode[type],
        );

        return (
          <div key={type} className="p-3 hud-panel clip-corner-cut-sm">
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
                    ...enabledProviders.map((p) => ({ value: p.id, label: p.displayName || p.name })),
                  ]}
                />

                {/* Model selector. Embedding + local + live models → dropdown of loaded
                    ids (with a Custom… escape); Ollama/custom/embedding-fallback →
                    free text; everything else → the KNOWN_MODELS dropdown. */}
                {entry.providerId &&
                  (showEmbeddingDropdown ? (
                    <HudSelect
                      value={entry.model}
                      onChange={(v) => {
                        if (v === '__custom__') {
                          // Enter free-text mode; keep the current id as an editable seed.
                          setCustomMode((prev) => ({ ...prev, [type]: true }));
                          return;
                        }
                        setCustomMode((prev) => ({ ...prev, [type]: false }));
                        updateDraft(type, 'model', v);
                      }}
                      placeholder="Select model"
                      compact
                      options={[
                        { value: '', label: 'Select model' },
                        ...embeddingOptions.map((id) => ({ value: id, label: id })),
                        { value: '__custom__', label: 'Custom…' },
                      ]}
                    />
                  ) : isOllama || isEmbedding || models.length === 0 ? (
                    <input
                      type="text"
                      value={entry.model || customModel[type] || ''}
                      onChange={(e) => {
                        setCustomModel((prev) => ({ ...prev, [type]: e.target.value }));
                        updateDraft(type, 'model', e.target.value);
                      }}
                      placeholder="Model name..."
                      className="text-xs bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] w-36 font-data"
                    />
                  ) : (
                    <HudSelect
                      value={entry.model}
                      onChange={(v) => updateDraft(type, 'model', v)}
                      placeholder="Select model"
                      compact
                      options={[
                        { value: '', label: 'Select model' },
                        ...models.map((m) => ({ value: m.id, label: m.label })),
                      ]}
                    />
                  ))}
              </div>
            </div>

            {/* Privacy hint: only for Live Assistant, only while no local provider is configured for it */}
            {type === 'live_assistant' && !isLocalProvider && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Transcripts go to whichever provider you pick. For fully-private meetings use LM Studio or Ollama —
                  recommended: Qwen3 14B (or 8B for faster replies).
                </span>
              </p>
            )}

            {/* Embedding privacy hint — provider-aware (mirrors the live_assistant
                gate). Extracted so the on-device reassurance never renders for a
                cloud provider, which receives bulk content. */}
            {isEmbedding && <EmbeddingPrivacyHint isLocalProvider={isLocalProvider} providerName={providerName} />}
          </div>
        );
      })}

      {/* Save / Reset buttons */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 px-3 py-1.5 text-sm transition-all"
        >
          <Save size={14} />
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Assignments'}
        </button>
        {dirty && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] text-sm transition-colors"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>
    </div>
  );
});

export default TaskModelConfig;
