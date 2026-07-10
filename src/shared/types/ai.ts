// === AI provider, usage, and configuration types ===

export type AIProviderName = 'openai' | 'anthropic' | 'google' | 'ollama' | 'kimi' | 'lmstudio';

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

/** Per-task model configuration (stored as JSON in settings table) */
export interface TaskModelConfig {
  providerId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}
