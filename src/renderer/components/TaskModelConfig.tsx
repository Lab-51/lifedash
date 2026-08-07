// === FILE PURPOSE ===
// Component for assigning an AI provider + model to each task type.
// Renders one row per AITaskType with provider and model selectors.
// Persists selections as JSON to the settings table (key: 'ai.taskModels').

import { useState, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Save, RotateCcw, Info, AlertTriangle } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type {
  AIProvider,
  AIProviderName,
  AITaskType,
  TaskModelConfig as TaskModelConfigType,
} from '../../shared/types';
import type { LocalModelsView, ModelRole } from '../../shared/types/localModels';
import { useLocalModels } from '../hooks/useLocalModels';
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
const LOCAL_PROVIDERS: Set<AIProviderName> = new Set(['ollama', 'lmstudio', 'builtin']);

/**
 * Task types that actually call tools (verified in src/main/ipc: card-agent,
 * meeting-agent and project-agent build a ToolSet; nothing else does). Routing one
 * of these to a model whose GGUF chat template has no tool section produces a model
 * that chats but silently cannot act, so the row warns instead of failing later.
 */
const TOOL_CALLING_TASKS: Set<AITaskType> = new Set(['live_assistant', 'card_agent', 'project_agent']);

/**
 * Tasks the local-chat resource guard (AI-RESIL.1) never counts. `embedding` is a
 * different, tiny model class that MUST coexist with a chat model — the built-in
 * runtime runs both roles by design. `transcription` is whisper, not an LLM, so it
 * can never contend for the same resident chat-model budget.
 */
const CONSOLIDATION_EXEMPT_TASKS: Set<AITaskType> = new Set(['embedding', 'transcription']);

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
  // Built-in has no static list on purpose: only a model you have actually
  // downloaded is routable, so its options come from getLocalModelsView() below.
  builtin: [],
};

// Recommended presets: which model to use per task type for each provider.
// Rationale:
//   - Brainstorming & Idea Analysis need creativity + deep reasoning → flagship
//   - Card Agent & Project Agent are user-facing conversations → flagship for quality
//   - Summarization, Meeting Prep, Standup, Card Description → structured output, efficient model is fine
//   - Task Structuring → structured planning, efficient models handle this well
//   - Background Agent → autonomous checks, no need for flagship
const FLAGSHIP_TASKS: Set<AITaskType> = new Set(['brainstorming', 'idea_analysis', 'card_agent', 'project_agent']);

type ModelPreset = { flagship: string; efficient: string };

// `builtin` is deliberately absent: there is no fixed id to recommend, because the
// only routable built-in models are the ones on this machine's disk. Its presets
// are derived from the downloaded list in builtinPresets() below.
const RECOMMENDED_MODELS: Record<Exclude<AIProviderName, 'builtin'>, ModelPreset> = {
  openai: { flagship: 'gpt-5.2', efficient: 'gpt-5-mini' },
  anthropic: { flagship: 'claude-opus-4-6', efficient: 'claude-sonnet-4-6' },
  // Auto-assign uses GA (non-preview) Gemini so it never routes to a preview
  // endpoint the user may not have access to.
  google: { flagship: 'gemini-2.5-pro', efficient: 'gemini-2.5-flash' },
  kimi: { flagship: 'kimi-k2.5', efficient: 'kimi-k2.5' },
  ollama: { flagship: 'llama3.2', efficient: 'llama3.2' },
  lmstudio: { flagship: 'default', efficient: 'default' },
};

/** One downloaded GGUF served by the built-in runtime — the only routable kind. */
interface BuiltinModelOption {
  /** Runtime id from the shared `runtimeModelIdForUrl` helper, never re-derived here. */
  id: string;
  label: string;
  role: ModelRole;
  toolCalling: boolean;
  sizeBytes: number;
}

/**
 * Downloaded built-in GGUFs from a local-models view, in catalog order.
 *
 * Only files flagged `downloaded` are offered: an id the runtime cannot serve is
 * not a routable choice. Ids and the tool-calling verdict come straight from the
 * view (main derives them with the shared `runtimeModelIdForUrl`), so nothing is
 * re-derived here. Pure and exported so auto-assign can run it against a freshly
 * re-read view without duplicating the mapping.
 */
export function builtinOptionsFromView(view: LocalModelsView | null): BuiltinModelOption[] {
  const options: BuiltinModelOption[] = [];
  for (const status of view?.statuses ?? []) {
    const model = view?.catalog?.models?.find((m) => m.id === status.modelId);
    if (!model) continue;
    for (const file of status.files) {
      if (!file.downloaded) continue;
      options.push({
        id: file.runtimeModelId,
        label:
          model.role === 'chat'
            ? `${model.displayName} — ${model.toolCalling ? 'tool calling' : 'no tool calling'}`
            : model.displayName,
        role: model.role,
        toolCalling: model.toolCalling,
        sizeBytes: file.sizeBytes,
      });
    }
  }
  return options;
}

/**
 * Auto-assign presets for the built-in runtime, from what is actually downloaded.
 * Tool-callers win regardless of size (the agents need them); within that group the
 * largest is the flagship and the smallest the efficient pick. Returns null when
 * nothing is downloaded — auto-assign then leaves the rows alone rather than
 * writing an id that cannot be served.
 */
function builtinPresets(models: BuiltinModelOption[]): ModelPreset | null {
  const chat = models.filter((m) => m.role === 'chat');
  if (chat.length === 0) return null;
  const pool = chat.some((m) => m.toolCalling) ? chat.filter((m) => m.toolCalling) : chat;
  const bySize = [...pool].sort((a, b) => b.sizeBytes - a.sizeBytes);
  return { flagship: bySize[0].id, efficient: bySize[bySize.length - 1].id };
}

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

type LiveModels = { lmstudio?: string[]; ollama?: string[]; builtin?: string[] };

/** Local runtimes whose embedding options come from a live model list. */
const LIVE_LIST_PROVIDERS = new Set<AIProviderName>(['lmstudio', 'ollama', 'builtin']);

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
  const loaded =
    providerName && LIVE_LIST_PROVIDERS.has(providerName)
      ? (liveModels[providerName as 'lmstudio' | 'ollama' | 'builtin'] ?? [])
      : [];
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
          semantic search. For fully-private semantic search, assign a local embedding model (the built-in runtime, LM
          Studio or Ollama).
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

interface ModelSelectorProps {
  model: string;
  /** Dropdown entries for the row's provider (built-in: downloaded files only). */
  models: { id: string; label: string }[];
  /** Live-loaded ids for the Embedding row, when its provider offers a list. */
  embeddingOptions: string[];
  showEmbeddingDropdown: boolean;
  isOllama: boolean;
  isEmbedding: boolean;
  isBuiltin: boolean;
  freeTextValue: string;
  onModelChange: (value: string) => void;
  onFreeTextChange: (value: string) => void;
  onCustomMode: (on: boolean) => void;
}

/**
 * The row's model control. Embedding + a live list → dropdown of loaded ids with a
 * Custom… escape; Ollama / cloud-with-no-catalog → free text; built-in → a dropdown
 * of downloaded files ONLY (no free-text escape: the runtime can serve nothing else,
 * so a typed id would be a dead end); everything else → the KNOWN_MODELS dropdown.
 */
function ModelSelector({
  model,
  models,
  embeddingOptions,
  showEmbeddingDropdown,
  isOllama,
  isEmbedding,
  isBuiltin,
  freeTextValue,
  onModelChange,
  onFreeTextChange,
  onCustomMode,
}: ModelSelectorProps) {
  if (showEmbeddingDropdown) {
    return (
      <HudSelect
        value={model}
        onChange={(v) => {
          if (v === '__custom__') {
            // Enter free-text mode; keep the current id as an editable seed.
            onCustomMode(true);
            return;
          }
          onCustomMode(false);
          onModelChange(v);
        }}
        placeholder="Select model"
        compact
        options={[
          { value: '', label: 'Select model' },
          ...embeddingOptions.map((id) => ({ value: id, label: id })),
          { value: '__custom__', label: 'Custom…' },
        ]}
      />
    );
  }
  if (isBuiltin) {
    return models.length === 0 ? (
      <span className="text-xs text-[var(--color-text-muted)] w-36 break-words">No models downloaded yet</span>
    ) : (
      <HudSelect
        value={model}
        onChange={onModelChange}
        placeholder="Select model"
        compact
        options={[{ value: '', label: 'Select model' }, ...models.map((m) => ({ value: m.id, label: m.label }))]}
      />
    );
  }
  if (isOllama || isEmbedding || models.length === 0) {
    return (
      <input
        type="text"
        value={freeTextValue}
        onChange={(e) => onFreeTextChange(e.target.value)}
        placeholder="Model name..."
        className="text-xs bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] w-36 font-data"
      />
    );
  }
  return (
    <HudSelect
      value={model}
      onChange={onModelChange}
      placeholder="Select model"
      compact
      options={[{ value: '', label: 'Select model' }, ...models.map((m) => ({ value: m.id, label: m.label }))]}
    />
  );
}

/**
 * Warning for a tool-dependent task pointed at a built-in model whose GGUF chat
 * template has no tool section. Task 3 verified this per shipped file, not from the
 * upstream model card — Mistral-7B advertises function calling its GGUF cannot do —
 * so the check is a lookup, never an inference from the model's name.
 */
function BuiltinToolCallingWarning({
  taskType,
  providerName,
  model,
  builtinModels,
}: {
  taskType: AITaskType;
  providerName: AIProviderName | null;
  model: string;
  builtinModels: BuiltinModelOption[];
}) {
  if (providerName !== 'builtin' || !TOOL_CALLING_TASKS.has(taskType) || !model) return null;
  const chosen = builtinModels.find((m) => m.id === model);
  if (!chosen || chosen.toolCalling) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="break-words">
        This model cannot call tools, so it will chat here but never create, move or update cards. Pick one of the
        built-in models badged “Tool calling” in Settings → Local AI if you want it to act.
      </span>
    </p>
  );
}

/** One task's local chat-model assignment, as counted by the resource guard below. */
interface LocalChatAssignment {
  type: AITaskType;
  providerId: string;
  /** `provider.displayName || provider.name` — display only, not part of the pair identity. */
  providerLabel: string;
  /** The provider FAMILY (not the label): the two local families overcommit differently. */
  providerName: AIProviderName;
  model: string;
}

/** A distinct `(providerId, model)` pair among the detected local-chat assignments. */
interface LocalChatPair {
  providerId: string;
  providerLabel: string;
  providerName: AIProviderName;
  model: string;
}

/**
 * Every EXPLICITLY configured task (excluding embedding/transcription — see
 * CONSOLIDATION_EXEMPT_TASKS) whose provider is LOCAL (lmstudio | ollama |
 * builtin), in TASK_TYPE_INFO order.
 *
 * Unset tasks are deliberately excluded: they inherit a model via
 * TASK_MODEL_FALLBACKS / first-enabled-provider (see resolveTaskModel in
 * ai-provider.ts) rather than adding a NEW resident model, so counting them would
 * produce false warnings for a task the user never touched.
 */
function getLocalChatAssignments(draft: DraftConfig, providers: AIProvider[]): LocalChatAssignment[] {
  const assignments: LocalChatAssignment[] = [];
  for (const { type } of TASK_TYPE_INFO) {
    if (CONSOLIDATION_EXEMPT_TASKS.has(type)) continue;
    const entry = draft[type];
    if (!entry?.providerId || !entry.model) continue;
    // A disabled provider's config never resolves at runtime (resolveTaskModel
    // skips it and falls through to the default), so it cannot actually hold a
    // model resident — it must not count toward the warning.
    const provider = providers.find((p) => p.id === entry.providerId && p.enabled);
    if (!provider || !LOCAL_PROVIDERS.has(provider.name)) continue;
    assignments.push({
      type,
      providerId: entry.providerId,
      providerLabel: provider.displayName || provider.name,
      providerName: provider.name,
      model: entry.model,
    });
  }
  return assignments;
}

/** Distinct `(providerId, model)` pairs among `assignments`, in first-seen (TASK_TYPE_INFO) order. */
function dedupeLocalChatPairs(assignments: LocalChatAssignment[]): LocalChatPair[] {
  const seen = new Set<string>();
  const pairs: LocalChatPair[] = [];
  for (const { providerId, providerLabel, providerName, model } of assignments) {
    const key = `${providerId}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ providerId, providerLabel, providerName, model });
  }
  return pairs;
}

/**
 * The pair every detected local-chat task is rewritten to on one-click
 * consolidation: `live_assistant`'s pair when it is among the detected assignments
 * (i.e. already local — see the 2026-07-06 "chat priority" decision, DECISIONS.md),
 * else the pair assigned to the MOST tasks. Ties break on task-list order:
 * `assignments` already walks TASK_TYPE_INFO in order, and only a strictly-higher
 * count replaces the running winner, so the first pair to reach the max count keeps
 * it — a tie-break on object/Map iteration order would be untestable and could
 * flake.
 */
function pickConsolidationAnchor(assignments: LocalChatAssignment[]): { providerId: string; model: string } | null {
  const liveAssistant = assignments.find((a) => a.type === 'live_assistant');
  if (liveAssistant) return { providerId: liveAssistant.providerId, model: liveAssistant.model };

  const counts = new Map<string, number>();
  for (const { providerId, model } of assignments) {
    const key = `${providerId}:${model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let winner: LocalChatAssignment | null = null;
  let winnerCount = 0;
  for (const a of assignments) {
    const count = counts.get(`${a.providerId}:${a.model}`)!;
    if (count > winnerCount) {
      winner = a;
      winnerCount = count;
    }
  }
  return winner ? { providerId: winner.providerId, model: winner.model } : null;
}

/**
 * Copy for the guardrail below. The two local provider families overcommit this
 * machine in DIFFERENT ways, and saying the wrong one is worse than saying nothing:
 *
 * - `lmstudio` / `ollama`: requesting different model ids JIT-loads EACH one and
 *   keeps it RESIDENT. Nothing in the app serializes or unloads them, so N models
 *   occupy memory simultaneously.
 * - `builtin`: there is no co-residency to warn about — `LlamaRole` is only
 *   `chat | embedding`, so every chat task shares ONE process. Asking that role for
 *   a different model STOPS the running sidecar and cold-starts the other
 *   (llamaRuntimeService `ensureRunning`). Two chat tasks on different models
 *   therefore THRASH: each alternation pays a multi-GB unload+reload behind
 *   /health gating, which is long enough to time out the request that triggered it.
 *
 * Corrected 2026-08-07 after the original copy asserted co-residency for every
 * local provider — false for `builtin`, which is the family the reporting user
 * actually runs. See DECISIONS.md.
 */
function buildLocalChatWarningMessage(pairs: LocalChatPair[], modelList: string): string {
  const hasBuiltin = pairs.some((p) => p.providerName === 'builtin');
  const hasExternal = pairs.some((p) => p.providerName !== 'builtin');
  const head = `${pairs.length} different local chat models are configured`;
  const tail = `One local chat model at a time is recommended on this hardware. Configured: ${modelList}.`;

  if (hasBuiltin && hasExternal) {
    return `${head}. The external ones each stay loaded in memory at the same time, while the built-in runtime unloads and reloads a multi-GB model on every switch between its tasks. ${tail}`;
  }
  if (hasBuiltin) {
    return `${head}. The built-in runtime runs one chat model at a time, so switching between these tasks unloads one model and reloads the other every time — a multi-GB reload that can time out the request that triggered it. ${tail}`;
  }
  return `${head}, and each one stays loaded in memory at the same time. ${tail}`;
}

/**
 * Resource guardrail for local per-task model routing (AI-RESIL.1). This class of
 * machine budgets roughly ONE resident 14B-class chat model, with whisper sharing
 * the same GPU — and BOTH local provider families break that budget when several
 * chat tasks name different models, just by different mechanisms (see
 * buildLocalChatWarningMessage). A warning with an escape hatch, never a
 * restriction — cloud mixing and the embedding model are untouched (see
 * CONSOLIDATION_EXEMPT_TASKS; the built-in runtime runs chat and embedding as two
 * independent processes by design, so an embedding model never competes here).
 */
function LocalChatConsolidationWarning({
  pairs,
  onConsolidate,
}: {
  pairs: LocalChatPair[];
  onConsolidate: () => void;
}) {
  if (pairs.length < 2) return null;
  const modelList = pairs.map((p) => `${p.providerLabel}: ${p.model}`).join(', ');
  const message = buildLocalChatWarningMessage(pairs, modelList);
  return (
    <div className="p-3 hud-panel clip-corner-cut-sm">
      <p className="flex items-start gap-1.5 text-xs text-amber-400 overflow-hidden break-words">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="break-words">{message}</span>
      </p>
      <button
        type="button"
        onClick={onConsolidate}
        className="mt-2 flex items-center gap-1.5 border border-amber-400/40 hover:border-amber-400 text-amber-300 hover:text-amber-200 px-3 py-1.5 text-xs transition-all"
      >
        Use one model for all local chat tasks
      </button>
    </div>
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
  // Explains an auto-assign that intentionally wrote nothing. Silence would read
  // as a broken button.
  const [autoAssignNote, setAutoAssignNote] = useState<string | null>(null);

  const enabledProviders = providers.filter((p) => p.enabled);

  // Stable key of the enabled LOCAL provider families, so the fetch effect below
  // only re-runs when that set actually changes (not on every parent re-render).
  const enabledLocalKey = Array.from(
    new Set(enabledProviders.filter((p) => LOCAL_PROVIDERS.has(p.name)).map((p) => p.name)),
  )
    .sort()
    .join(',');

  // Downloaded built-in GGUFs — the only routable ones. Shared hook rather than a
  // one-shot read: it re-reads the view whenever a download finishes, so a model
  // pulled from the Local AI section (same Settings tab) becomes assignable here
  // without a remount. `enabled: false` keeps it inert — zero IPC — when the
  // built-in provider isn't switched on.
  const builtinEnabled = enabledLocalKey.split(',').includes('builtin');
  const { view: localModelsView, refresh: refreshLocalModels } = useLocalModels(builtinEnabled);
  const builtinModels = useMemo(
    () => (builtinEnabled ? builtinOptionsFromView(localModelsView) : []),
    [builtinEnabled, localModelsView],
  );

  // Local-chat resource guard (AI-RESIL.1): pure derivation from draft + providers,
  // re-evaluated every render so the banner tracks the draft live, at the point of
  // configuration — it does not wait for a Save click to appear or disappear.
  const localChatAssignments = getLocalChatAssignments(draft, providers);
  const localChatPairs = dedupeLocalChatPairs(localChatAssignments);
  const consolidationAnchor = pickConsolidationAnchor(localChatAssignments);

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

  /**
   * One-click consolidation (AI-RESIL.1): rewrite every detected local-chat task to
   * the anchor pair through the SAME per-task path each row's own dropdown already
   * uses — `updateDraft` — so there is no parallel write path, no new IPC and no
   * new store API. This only stages the change into `draft`, exactly like
   * Auto-assign; the user still confirms with the existing "Save Assignments"
   * button.
   */
  const handleConsolidateLocalChat = () => {
    if (!consolidationAnchor) return;
    for (const { type } of localChatAssignments) {
      updateDraft(type, 'providerId', consolidationAnchor.providerId);
      updateDraft(type, 'model', consolidationAnchor.model);
    }
  };

  const getProviderName = (providerId: string): AIProviderName | null => {
    const p = providers.find((prov) => prov.id === providerId);
    return p ? p.name : null;
  };

  const getModelsForProvider = (providerId: string, type: AITaskType) => {
    const name = getProviderName(providerId);
    if (!name) return [];
    if (name === 'builtin') {
      const role: ModelRole = type === 'embedding' ? 'embedding' : 'chat';
      return builtinModels.filter((m) => m.role === role).map((m) => ({ id: m.id, label: m.label }));
    }
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

  /**
   * Assign every task to `provider` using its presets.
   *
   * `available` is the built-in model list to assign from — passed in rather than
   * read from state so the built-in path can act on a view re-read moments earlier
   * (a model deleted since mount must not be assigned).
   */
  const applyAutoAssign = (provider: AIProvider, available: BuiltinModelOption[]) => {
    // Built-in has no static preset: it can only recommend a model already on disk,
    // and if none is downloaded there is nothing honest to assign.
    const presets = provider.name === 'builtin' ? builtinPresets(available) : RECOMMENDED_MODELS[provider.name];
    if (!presets) {
      // Writing nothing is correct here, but silence reads as a dead button.
      setAutoAssignNote(
        'No built-in models are downloaded yet, so there was nothing to assign. Download one in Local AI above, then try again.',
      );
      return;
    }
    setAutoAssignNote(null);
    const auto: DraftConfig = {} as DraftConfig;
    for (const { type } of TASK_TYPE_INFO) {
      if (type === 'embedding') {
        // Only auto-assign embedding to a LOCAL runtime — pick a loaded embedding
        // model (or a sane default). For a CLOUD provider we deliberately leave the
        // user's existing choice untouched so bulk content is never silently routed
        // off-device (mirrors EmbeddingPrivacyHint's no-silent-cloud guarantee).
        if (provider.name === 'builtin') {
          const downloaded = available.find((m) => m.role === 'embedding');
          // No embedding GGUF downloaded → leave the row alone rather than writing
          // an id the runtime cannot serve.
          auto[type] = downloaded
            ? { providerId: provider.id, model: downloaded.id }
            : (draft[type] ?? { providerId: '', model: '' });
        } else if (provider.name === 'lmstudio' || provider.name === 'ollama') {
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

  const handleAutoAssign = (provider: AIProvider) => {
    if (provider.name !== 'builtin') {
      applyAutoAssign(provider, builtinModels);
      return;
    }
    // Read the view fresh before assigning. Finished downloads already refresh it,
    // but a model DELETED since mount would otherwise still be assignable — and the
    // runtime cannot serve a file that is gone. `local-models:view` is a pure read:
    // it never starts the runtime or a transfer.
    void (async () => {
      const fresh = await window.electronAPI?.getLocalModelsView?.().catch(() => null);
      // Fall back to the hook's list if the read fails, so the button still works.
      applyAutoAssign(provider, fresh ? builtinOptionsFromView(fresh) : builtinModels);
      // Keep the row dropdowns in step with what was just assigned.
      void refreshLocalModels();
    })();
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
      <LocalChatConsolidationWarning pairs={localChatPairs} onConsolidate={handleConsolidateLocalChat} />

      {TASK_TYPE_INFO.map(({ type, label, description }) => {
        const entry = draft[type] || { providerId: '', model: '' };
        const models = getModelsForProvider(entry.providerId, type);
        const providerName = getProviderName(entry.providerId);
        const isOllama = providerName === 'ollama';
        const isEmbedding = type === 'embedding';
        const isLocalProvider = !!providerName && LOCAL_PROVIDERS.has(providerName);
        const isBuiltin = providerName === 'builtin';

        // Embedding row only: offer a dropdown of the runtime's live-loaded models
        // when the provider is local and any are reachable; otherwise (or in Custom…
        // mode / for a saved-but-unloaded id) fall back to the free-text input.
        const { options: embeddingOptions, showDropdown: showEmbeddingDropdown } = deriveEmbeddingRow(
          isEmbedding,
          providerName,
          entry.model,
          { ...liveModels, builtin: builtinModels.filter((m) => m.role === 'embedding').map((m) => m.id) },
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

                {entry.providerId && (
                  <ModelSelector
                    model={entry.model}
                    models={models}
                    embeddingOptions={embeddingOptions}
                    showEmbeddingDropdown={showEmbeddingDropdown}
                    isOllama={isOllama}
                    isEmbedding={isEmbedding}
                    isBuiltin={isBuiltin}
                    freeTextValue={entry.model || customModel[type] || ''}
                    onModelChange={(v) => updateDraft(type, 'model', v)}
                    onFreeTextChange={(v) => {
                      setCustomModel((prev) => ({ ...prev, [type]: v }));
                      updateDraft(type, 'model', v);
                    }}
                    onCustomMode={(on) => setCustomMode((prev) => ({ ...prev, [type]: on }))}
                  />
                )}
              </div>
            </div>

            {/* Privacy hint: only for Live Assistant, only while no local provider is configured for it */}
            {type === 'live_assistant' && !isLocalProvider && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Transcripts go to whichever provider you pick. For fully-private meetings use the built-in runtime, LM
                  Studio or Ollama — recommended: Qwen3 14B (or a 4B/8B model for faster replies).
                </span>
              </p>
            )}

            {/* Built-in models differ in whether their GGUF can call tools at all —
                surface that where the routing decision is actually made. */}
            <BuiltinToolCallingWarning
              taskType={type}
              providerName={providerName}
              model={entry.model}
              builtinModels={builtinModels}
            />

            {/* Embedding privacy hint — provider-aware (mirrors the live_assistant
                gate). Extracted so the on-device reassurance never renders for a
                cloud provider, which receives bulk content. */}
            {isEmbedding && <EmbeddingPrivacyHint isLocalProvider={isLocalProvider} providerName={providerName} />}
          </div>
        );
      })}

      {/* Why an auto-assign wrote nothing. Without this the button looks broken. */}
      {autoAssignNote && (
        <p
          role="status"
          className="flex items-start gap-1.5 pt-2 text-[0.6875rem] text-amber-400 overflow-hidden break-words"
        >
          <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" />
          <span className="break-words">{autoAssignNote}</span>
        </p>
      )}

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
