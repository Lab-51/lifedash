// === FILE PURPOSE ===
// AI provider manager — creates/caches provider instances, tests connections,
// and wraps generateText with automatic usage logging to ai_usage table.
//
// === DEPENDENCIES ===
// ai (generateText), @ai-sdk/openai, @ai-sdk/anthropic, ollama-ai-provider
//
// === LIMITATIONS ===
// - Cost estimation not yet implemented (planned for Plan 3.3)
// - Provider cache must be manually cleared on config change
//
// === VERIFICATION STATUS ===
// - createOpenAI/createAnthropic API: verified from AI SDK docs + runtime check
// - createOllama API: verified — ollama-ai-provider exports createOllama and ollama
// - generateText API: verified — ai package exports generateText
// - Token usage fields: verified (result.usage.inputTokens, outputTokens, totalTokens)
// - ollama-ai-provider v1.2.0 returns LanguageModelV1 (not V3) — cast needed for generateText

import { generateText, streamText, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiUsage, aiProviders, settings } from '../db/schema';
import { decryptString } from './secure-storage';
import { createLogger } from './logger';
import type { AIProviderName, TaskModelConfig } from '../../shared/types';

const log = createLogger('AI');

// Default models for connection testing (cheapest per provider)
const TEST_MODELS: Record<AIProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'llama3.2',
};

// Provider factory type — callable provider instances that return a LanguageModel
// when called with a model ID string. ollama-ai-provider v1.2.0 returns
// LanguageModelV1 while @ai-sdk/openai and @ai-sdk/anthropic return LanguageModelV3.
// Both are accepted by generateText at runtime via the LanguageModel union type.
// We use a callable interface since providers are objects with a call signature.
interface ProviderFactory {
  (modelId: string): LanguageModel;
}

// Cache provider factories by DB id (invalidated on config change)
const providerCache = new Map<string, ProviderFactory>();

function createFactory(
  name: AIProviderName,
  apiKey?: string,
  baseUrl?: string,
): ProviderFactory {
  // Each SDK provider is a callable object that returns its own LanguageModel version.
  // OpenAI/Anthropic return LanguageModelV3, Ollama returns LanguageModelV1.
  // generateText accepts all versions at runtime, so the cast is safe.
  switch (name) {
    case 'openai':
      return createOpenAI({ apiKey: apiKey || '' }) as unknown as ProviderFactory;
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey || '' }) as unknown as ProviderFactory;
    case 'ollama':
      return createOllama({ baseURL: baseUrl || 'http://localhost:11434/api' }) as unknown as ProviderFactory;
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}

/**
 * Get or create a cached provider factory for the given DB provider row.
 * Call clearProviderCache(id) when provider config changes.
 */
export function getProvider(
  id: string,
  name: AIProviderName,
  apiKeyEncrypted: string | null,
  baseUrl: string | null,
) {
  if (providerCache.has(id)) return providerCache.get(id)!;
  const apiKey = apiKeyEncrypted ? decryptString(apiKeyEncrypted) : undefined;
  const factory = createFactory(name, apiKey, baseUrl ?? undefined);
  providerCache.set(id, factory);
  return factory;
}

/** Clear cached provider instance(s). Call when config changes. */
export function clearProviderCache(id?: string): void {
  if (id) {
    providerCache.delete(id);
  } else {
    providerCache.clear();
  }
}

/**
 * Test provider connectivity by generating a minimal completion.
 * Uses the cheapest model per provider to minimize cost.
 */
export async function testConnection(
  name: AIProviderName,
  apiKeyEncrypted: string | null,
  baseUrl: string | null,
): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
  const start = Date.now();
  try {
    const apiKey = apiKeyEncrypted ? decryptString(apiKeyEncrypted) : undefined;
    const factory = createFactory(name, apiKey, baseUrl ?? undefined);
    const model = factory(TEST_MODELS[name]) as LanguageModel;

    await generateText({
      model,
      prompt: 'Say "ok".',
      maxOutputTokens: 5,
    });

    return { success: true, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return {
      success: false,
      error: message,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Generate text using a configured provider + model.
 * Automatically logs token usage to the ai_usage table.
 */
export async function generate(options: {
  providerId: string;
  providerName: AIProviderName;
  apiKeyEncrypted: string | null;
  baseUrl: string | null;
  model: string;
  taskType: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const factory = getProvider(
    options.providerId,
    options.providerName,
    options.apiKeyEncrypted,
    options.baseUrl,
  );

  const result = await generateText({
    model: factory(options.model) as LanguageModel,
    prompt: options.prompt,
    system: options.system,
    temperature: options.temperature,
    maxOutputTokens: options.maxTokens,
  });

  // Log usage (fire-and-forget — don't fail generation if logging fails)
  try {
    const db = getDb();
    await db.insert(aiUsage).values({
      providerId: options.providerId,
      model: options.model,
      taskType: options.taskType,
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      // Cost estimation added in Plan 3.3 (requires pricing table)
    });
  } catch (logError) {
    log.error('Failed to log usage:', logError);
  }

  return {
    text: result.text,
    usage: result.usage,
  };
}

// ---------------------------------------------------------------------------
// Provider Resolution (shared by all AI features)
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  providerId: string;
  providerName: AIProviderName;
  apiKeyEncrypted: string | null;
  baseUrl: string | null;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MODELS: Record<AIProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'llama3.2',
};

/**
 * Resolve which AI provider + model to use for a given task type.
 * 1. Check the `task_models` setting (JSON map of taskType -> TaskModelConfig).
 * 2. If config exists, look up the provider row.
 * 3. If no config (or provider is gone/disabled), fall back to first enabled provider.
 * 4. Returns null if no provider is available.
 */
export async function resolveTaskModel(taskType: string): Promise<ResolvedProvider | null> {
  const db = getDb();

  // 1. Try task_models setting
  const [settingRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'task_models'));

  if (settingRow) {
    try {
      const taskModels: Record<string, TaskModelConfig> = JSON.parse(settingRow.value);
      const config = taskModels[taskType];
      if (config) {
        const [provider] = await db
          .select()
          .from(aiProviders)
          .where(eq(aiProviders.id, config.providerId));
        if (provider && provider.enabled) {
          return {
            providerId: provider.id,
            providerName: provider.name as AIProviderName,
            apiKeyEncrypted: provider.apiKeyEncrypted,
            baseUrl: provider.baseUrl,
            model: config.model,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
          };
        }
      }
    } catch {
      // Malformed JSON — fall through to default
    }
  }

  // 2. Fallback: first enabled provider
  const [fallbackProvider] = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.enabled, true))
    .limit(1);

  if (!fallbackProvider) return null;

  return {
    providerId: fallbackProvider.id,
    providerName: fallbackProvider.name as AIProviderName,
    apiKeyEncrypted: fallbackProvider.apiKeyEncrypted,
    baseUrl: fallbackProvider.baseUrl,
    model: DEFAULT_MODELS[fallbackProvider.name as AIProviderName] ?? 'gpt-4o-mini',
  };
}

/**
 * Log AI token usage to the ai_usage table. Fire-and-forget — never throws.
 */
export async function logUsage(
  providerId: string,
  model: string,
  taskType: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(aiUsage).values({
      providerId,
      model,
      taskType,
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    });
  } catch (error) {
    log.error('Failed to log usage:', error);
  }
}

/**
 * Stream text generation using a configured provider + model.
 * Returns a StreamTextResult — caller iterates textStream and logs usage after.
 *
 * Usage pattern:
 *   const result = streamGenerate({ ... });
 *   for await (const chunk of result.textStream) { // send to renderer }
 *   const usage = await result.usage;
 *   await logUsage(providerId, model, taskType, usage);
 */
export function streamGenerate(options: {
  providerId: string;
  providerName: AIProviderName;
  apiKeyEncrypted: string | null;
  baseUrl: string | null;
  model: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const factory = getProvider(
    options.providerId,
    options.providerName,
    options.apiKeyEncrypted,
    options.baseUrl,
  );

  return streamText({
    model: factory(options.model) as LanguageModel,
    messages: options.messages,
    system: options.system,
    temperature: options.temperature,
    maxOutputTokens: options.maxTokens,
  });
}
