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

import { generateText, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider';
import { getDb } from '../db/connection';
import { aiUsage } from '../db/schema';
import { decryptString } from './secure-storage';
import type { AIProviderName } from '../../shared/types';

// Default models for connection testing (cheapest per provider)
const TEST_MODELS: Record<AIProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'llama3.2',
};

// Provider factory type — uses `any` because ollama-ai-provider v1.2.0 returns
// LanguageModelV1 while @ai-sdk/openai and @ai-sdk/anthropic return LanguageModelV3.
// The AI SDK generateText function handles both at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderFactory = (...args: any[]) => any;

// Cache provider factories by DB id (invalidated on config change)
const providerCache = new Map<string, ProviderFactory>();

function createFactory(
  name: AIProviderName,
  apiKey?: string,
  baseUrl?: string,
): ProviderFactory {
  switch (name) {
    case 'openai':
      return createOpenAI({ apiKey: apiKey || '' });
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey || '' });
    case 'ollama':
      return createOllama({ baseURL: baseUrl || 'http://localhost:11434/api' });
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
    console.error('[AI] Failed to log usage:', logError);
  }

  return {
    text: result.text,
    usage: result.usage,
  };
}
