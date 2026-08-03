// === AI provider, usage, and configuration types ===

/**
 * `builtin` is LifeDash's own bundled llama.cpp sidecar (LOCAL-RT.1) — fully local,
 * no external runtime to install. It is opt-in: it only exists as a provider row
 * once the user explicitly adds it, and nothing spawns or downloads before that.
 */
export type AIProviderName = 'openai' | 'anthropic' | 'google' | 'ollama' | 'kimi' | 'lmstudio' | 'builtin';

/**
 * The SINGLE definition of "frontier / state-of-the-art" cloud providers (V3.3.5).
 * Every surface that needs to know whether a model is SOTA imports this — nobody
 * redefines it. Used by the Digital Twin deep-creation gate to decide whether to
 * warn that a deep path wants a frontier model.
 *
 * `'google'` (Gemini) is a fully wired frontier provider: its adapter lives in
 * ai-provider.ts and `'google'` is a member of `AIProviderName`, so a configured
 * Gemini model resolves as frontier through `twin:get-creation-model`.
 */
export const FRONTIER_PROVIDERS = ['openai', 'anthropic', 'google'] as const;

/** A frontier (state-of-the-art) cloud provider. See {@link FRONTIER_PROVIDERS}. */
export type FrontierProvider = (typeof FRONTIER_PROVIDERS)[number];

/** True when the given provider name is a frontier (SOTA) cloud provider. */
export function isFrontierProvider(name: string): boolean {
  return (FRONTIER_PROVIDERS as readonly string[]).includes(name);
}
export type AITaskType =
  | 'summarization'
  | 'brainstorming'
  | 'idea_analysis'
  | 'task_structuring'
  | 'transcription'
  | 'card_agent'
  | 'meeting_prep'
  | 'standup'
  | 'card-description'
  | 'background_agent'
  | 'project_agent'
  | 'live_assistant'
  | 'live_triage'
  | 'twin_interview'
  // V3.4 — Living memory / semantic layer:
  //  - 'embedding'      local vector generation (defaults to LM Studio; never a
  //                     silent cloud fallback — see resolveTaskModel).
  //  - 'twin_learning'  per-session fact extraction (inherits live_assistant).
  //  - 'knowledge_qa'   answer synthesis over semantic search (inherits live_assistant).
  | 'embedding'
  | 'twin_learning'
  | 'knowledge_qa';

/** AI provider as seen by renderer (no decrypted keys — only hasApiKey boolean) */
export interface AIProvider {
  id: string;
  name: AIProviderName;
  displayName: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  baseUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIProviderInput {
  name: AIProviderName;
  displayName?: string;
  apiKey?: string; // Plain text — encrypted before storage in main process
  baseUrl?: string;
}

export interface UpdateAIProviderInput {
  displayName?: string;
  apiKey?: string; // Plain text — encrypted before storage
  baseUrl?: string;
  enabled?: boolean;
}

export interface AIConnectionTestResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface AIUsageEntry {
  id: string;
  providerId: string | null;
  model: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  createdAt: string;
}

export interface AIUsageSummary {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
  byTaskType: Record<string, { tokens: number; cost: number }>;
  byModel: Record<string, { tokens: number; cost: number }>;
}

/** Aggregated daily usage for the usage dashboard chart */
export interface AIUsageDaily {
  date: string; // YYYY-MM-DD
  tokens: number;
  cost: number;
  count: number; // number of API calls
}

// --- Built-in (bundled llama.cpp) runtime ---------------------------------
// Shared because the runtime's state crosses the IPC boundary (`ai:check-builtin`);
// the supervisor in src/main/services/llamaRuntimeService.ts re-exports these.

/** Which sidecar process a request is for. Chat and embeddings cannot share one
 *  process — llama-server gates /v1/embeddings behind a startup flag. */
export type LlamaRole = 'chat' | 'embedding';
/** Compute backend of the running sidecar binary. */
export type LlamaBackend = 'vulkan' | 'cpu' | 'metal';

export interface LlamaRoleStatus {
  running: boolean;
  starting: boolean;
  modelId: string | null;
  baseUrl: string | null;
  pid: number | null;
  lastUsedAt: number | null;
  crashes: number;
}

export interface LlamaRuntimeStatus {
  /** True when at least one role process is up. */
  running: boolean;
  /** Backend of the last successful start, or null before the first one. */
  backend: LlamaBackend | null;
  binaryAvailable: boolean;
  /** Model ids currently resident, across both roles. */
  loadedModels: string[];
  chat: LlamaRoleStatus;
  embedding: LlamaRoleStatus;
  idleStopMinutes: number;
}

// --- Runtime telemetry (LOCAL-RT.2) ---------------------------------------
// Measured at the single provider seam in ai-provider.ts, so ONE measurement point
// covers builtin, LM Studio, Ollama and cloud alike and cannot drift from what ran.

/**
 * Context (KV cache) utilisation of a running built-in sidecar, read from
 * llama-server's `/slots` endpoint.
 *
 * Field provenance — VERIFIED against llama.cpp b10219 by running the binary and
 * curling `/slots` (LOCAL-RT.2 Task 1); the shape is NOT assumed:
 *   `[{ "id":0, "n_ctx":16384, "speculative":false, "is_processing":false,
 *       "n_prompt_tokens":43, "n_prompt_tokens_processed":17, ... }]`
 * `n_prompt_tokens` is the slot's resident token count (prompt + generated) after a
 * request; it read 43 where the same request reported total_tokens 44, i.e. it
 * tracks the KV cache, not the request. It is ABSENT until the slot has served one
 * request, which is reported here as 0 used.
 */
export interface LlamaContextUsage {
  role: LlamaRole;
  /** `slot.n_prompt_tokens` — tokens resident in the slot's KV cache. */
  usedTokens: number;
  /** `slot.n_ctx` — the slot's context window. */
  contextTokens: number;
  /** `slot.is_processing` — true while the slot is serving a request. */
  processing: boolean;
}

/** Rolling stats for one `provider:model` pair, over the last N samples. */
export interface RuntimeModelStats {
  providerName: AIProviderName;
  model: string;
  /** Samples currently held for this key (capped — see RUNTIME_TELEMETRY_WINDOW). */
  samples: number;
  averageTokensPerSecond: number;
  lastTokensPerSecond: number;
  /** Mean time-to-first-token across the streaming samples, or null when none. */
  averageTtftMs: number | null;
  /** Epoch ms of the newest sample. */
  lastAt: number;
}

/** One measured generation. Wall-clock around the model call — see recordGeneration. */
export interface RuntimeGenerationSample {
  providerName: AIProviderName;
  model: string;
  outputTokens: number;
  elapsedMs: number;
  tokensPerSecond: number;
  /** Time to first streamed token, or null for non-streaming calls. */
  ttftMs: number | null;
  streaming: boolean;
  at: number;
}

export interface RuntimeTelemetrySnapshot {
  /** Newest sample across all providers, or null before the first generation. */
  latest: RuntimeGenerationSample | null;
  /** Rolling stats keyed by `${providerName}:${model}`. */
  byModel: Record<string, RuntimeModelStats>;
  /** Built-in chat sidecar context use, or null when it is not running. */
  context: LlamaContextUsage | null;
}

/**
 * Everything a renderer needs for initial runtime state in ONE call, and the exact
 * payload pushed on `ai:runtime-status`.
 */
export interface LlamaRuntimeSnapshot {
  /**
   * An ENABLED `builtin` provider row exists. This — not `binaryPresent` — is the
   * visibility signal for the status indicator: the binaries ship with every
   * install, so keying off them would show the dot to deliberate cloud-only users.
   */
  configured: boolean;
  /** At least one sidecar binary is installed (the runtime card's missing-binary warning). */
  binaryPresent: boolean;
  runtime: LlamaRuntimeStatus;
  telemetry: RuntimeTelemetrySnapshot;
}

/** Measurements retained per `provider:model`. In memory only — no table, by design. */
export const RUNTIME_TELEMETRY_WINDOW = 10;

/** Settings key holding the built-in runtime's idle auto-stop window. 0 = never stop. */
export const LOCAL_AI_IDLE_SETTING_KEY = 'localAI.idleStopMinutes';
/** Idle window used when the key was never written. */
export const DEFAULT_IDLE_STOP_MINUTES = 15;
/** Upper bound offered in Settings — beyond this "never stop" (0) is the honest choice. */
export const MAX_IDLE_STOP_MINUTES = 240;

/** Per-task model configuration (stored as JSON in settings table) */
export interface TaskModelConfig {
  providerId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}
