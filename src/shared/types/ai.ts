// === AI provider, usage, and configuration types ===

export type AIProviderName = 'openai' | 'anthropic' | 'ollama';
export type AITaskType = 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis' | 'task_structuring' | 'transcription';

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
  apiKey?: string;       // Plain text — encrypted before storage in main process
  baseUrl?: string;
}

export interface UpdateAIProviderInput {
  displayName?: string;
  apiKey?: string;       // Plain text — encrypted before storage
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
}

/** Per-task model configuration (stored as JSON in settings table) */
export interface TaskModelConfig {
  providerId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}
