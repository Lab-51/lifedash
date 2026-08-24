// === FILE PURPOSE ===
// AI provider manager — creates/caches provider instances, tests connections,
// and wraps generateText with automatic usage logging to ai_usage table.
//
// === DEPENDENCIES ===
// ai (generateText), @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, ollama-ai-provider
//
// === LIMITATIONS ===
// - Provider cache must be manually cleared on config change
//
// === VERIFICATION STATUS ===
// - createOpenAI/createAnthropic API: verified from AI SDK docs + runtime check
// - createOllama API: verified — ollama-ai-provider exports createOllama and ollama
// - generateText API: verified — ai package exports generateText
// - Token usage fields: verified (result.usage.inputTokens, outputTokens, totalTokens)
// - ollama-ai-provider v1.2.0 returns LanguageModelV1 (not V3) — cast needed for generateText

import { generateText, streamText, embedMany, type LanguageModel, type EmbeddingModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiUsage, aiProviders, settings } from '../db/schema';
import { decryptString } from './secure-storage';
import { createLogger } from './logger';
import { acquireInFlight, ensureRunning, touch as touchBuiltinRuntime, type LlamaRole } from './llamaRuntimeService';
import { recordGeneration, type GenerationTiming } from './runtimeTelemetry';
import type { AIProviderName, AITaskType, TaskModelConfig } from '../../shared/types';

const log = createLogger('AI');

// Default models for connection testing (cheapest per provider)
const TEST_MODELS: Record<AIProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  // Cheapest current Gemini tier — verified id from @ai-sdk/google@3.0.90 GoogleGenerativeAIModelId.
  google: 'gemini-2.5-flash-lite',
  ollama: 'llama3.2',
  kimi: 'kimi-k2.5',
  lmstudio: 'default',
  builtin: 'default',
};

// Pricing per token (USD). Prices sourced from provider pricing pages (Feb 2026).
// Local models (Ollama) are free. Unknown models default to 0.
interface TokenPricing {
  input: number;
  output: number;
}
const MODEL_PRICING: Record<string, TokenPricing> = {
  // OpenAI — GPT-5 family
  'gpt-5.2': { input: 1.75 / 1e6, output: 14.0 / 1e6 },
  'gpt-5': { input: 1.25 / 1e6, output: 10.0 / 1e6 },
  'gpt-5-mini': { input: 0.25 / 1e6, output: 2.0 / 1e6 },
  // OpenAI — Reasoning
  'o4-mini': { input: 1.1 / 1e6, output: 4.4 / 1e6 },
  'o3-mini': { input: 1.1 / 1e6, output: 4.4 / 1e6 },
  // OpenAI — Legacy (still available in API)
  'gpt-4o': { input: 2.5 / 1e6, output: 10.0 / 1e6 },
  'gpt-4o-mini': { input: 0.15 / 1e6, output: 0.6 / 1e6 },
  // Anthropic
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1e6, output: 15.0 / 1e6 },
  'claude-haiku-4-5-20251001': { input: 0.8 / 1e6, output: 4.0 / 1e6 },
  // Google Gemini — published Google AI list prices (Feb 2026 tier). Preview
  // models omitted (pricing not final) — they fall back to 0 like other unknowns.
  'gemini-2.5-pro': { input: 1.25 / 1e6, output: 10.0 / 1e6 },
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
  'gemini-2.5-flash-lite': { input: 0.1 / 1e6, output: 0.4 / 1e6 },
  // Kimi (Moonshot)
  'kimi-k2.5': { input: 1.0 / 1e6, output: 4.0 / 1e6 },
  'kimi-k2.5-preview': { input: 1.0 / 1e6, output: 4.0 / 1e6 },
};

/** Recovery hint shown when a local runtime rejects an oversized request (HTTP 400). */
const LOCAL_CONTEXT_HINTS: Partial<Record<AIProviderName, string>> = {
  lmstudio:
    'Try increasing the context length in LM Studio (model settings → Context Length / n_ctx), or use fewer input items.',
  ollama:
    'Try increasing the context length in Ollama (model settings → Context Length / n_ctx), or use fewer input items.',
  builtin:
    'The built-in runtime caps context to leave GPU memory for transcription — use fewer input items, or pick a model with a larger context.',
};

/**
 * Record a tok/s measurement for one completed generation (LOCAL-RT.2). Fire-and-forget,
 * exactly like the logUsage() call below: telemetry must NEVER fail a generation, so the
 * call site catches too even though recordGeneration already swallows its own errors.
 *
 * The elapsed time is wall clock around the model call, so it includes queue and HTTP
 * transport overhead and reads slightly pessimistic versus llama.cpp's internal
 * `predicted_per_second` — deliberately, since it is what the user actually waited for.
 */
function safeRecordTelemetry(timing: GenerationTiming): void {
  try {
    recordGeneration(timing);
  } catch (telemetryError) {
    log.error('Failed to record runtime telemetry:', telemetryError);
  }
}

/** Estimate cost in USD from token counts and model ID. Returns 0 for unknown/local models. */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

// Provider factory type — callable provider instances that return a LanguageModel
// when called with a model ID string. ollama-ai-provider v1.2.0 returns
// LanguageModelV1 while @ai-sdk/openai and @ai-sdk/anthropic return LanguageModelV3.
// Both are accepted by generateText at runtime via the LanguageModel union type.
// We use a callable interface since providers are objects with a call signature.
interface ProviderFactory {
  (modelId: string): LanguageModel;
}

// Providers that don't support custom temperature values
const FIXED_TEMPERATURE_PROVIDERS: Set<AIProviderName> = new Set(['kimi']);

// Thinking/reasoning models need a higher token budget because they consume
// tokens for internal reasoning before producing visible output. A low limit
// (e.g. 500) can be entirely consumed by thinking, leaving 0 tokens for text.
const REASONING_PROVIDERS: Set<AIProviderName> = new Set(['kimi']);
const REASONING_MIN_TOKENS = 4096;

/** Strip temperature for providers that only accept fixed values (e.g. Kimi K2.5).
 *  Exported for direct unit coverage (LOCAL-QUAL.1) — proves this stripping stays
 *  intact independent of the new local-extraction temperature default above, which
 *  never touches `kimi` (it isn't a LOCAL_TEMPERATURE_PROVIDERS member). */
export function sanitizeTemperature(providerName: AIProviderName, temperature?: number): number | undefined {
  if (FIXED_TEMPERATURE_PROVIDERS.has(providerName)) return undefined;
  return temperature;
}

/** Ensure reasoning models have enough token budget for thinking + output. */
function sanitizeMaxTokens(providerName: AIProviderName, maxTokens?: number): number | undefined {
  if (REASONING_PROVIDERS.has(providerName)) {
    return Math.max(maxTokens ?? REASONING_MIN_TOKENS, REASONING_MIN_TOKENS);
  }
  return maxTokens;
}

// Cache provider factories by DB id (invalidated on config change)
const providerCache = new Map<string, ProviderFactory>();

/**
 * Google Gemini factory via @ai-sdk/google. The provider is a callable that returns
 * a LanguageModelV3 (same shape as OpenAI/Anthropic). baseURL is optional (proxy
 * support); omitted, the SDK uses its default Gemini endpoint. Extracted so
 * createFactory stays under the complexity budget.
 */
function createGoogleFactory(apiKey?: string, baseUrl?: string): ProviderFactory {
  const key = apiKey || '';
  const options = baseUrl ? { apiKey: key, baseURL: baseUrl } : { apiKey: key };
  return createGoogleGenerativeAI(options) as unknown as ProviderFactory;
}

// ---------------------------------------------------------------------------
// Built-in provider (bundled llama.cpp sidecar)
// ---------------------------------------------------------------------------
// The `builtin` provider reuses the SAME OpenAI-compatible AI SDK client as
// LM Studio and Kimi. The only difference is that its base URL and bearer token
// cannot be known when the client is constructed — the sidecar uses a dynamically
// probed port and a per-spawn API key, and it must not be running at all until a
// request actually needs it. Both are therefore resolved inside a custom `fetch`
// (an option @ai-sdk/openai already supports), which also performs the lazy start.
// This keeps chat, streaming, tool calling, usage logging and embeddings on the
// single proven SDK path — there is no second HTTP client for llama-server.

/** Stand-in base URL. Replaced per request with the live sidecar origin; the
 *  `ai_providers.baseUrl` column is deliberately never used for `builtin`. */
const BUILTIN_PLACEHOLDER_BASE_URL = 'http://127.0.0.1:1/v1';
/** The SDK requires a key; the real per-spawn token is injected by builtinFetch. */
const BUILTIN_PLACEHOLDER_API_KEY = 'builtin';
/** "Whatever built-in model suits this role" — mirrors LM Studio's `default`. */
const BUILTIN_DEFAULT_MODEL = 'default';

/** Normalize the SDK's fetch arguments. `@ai-sdk/provider-utils` always calls
 *  `fetch(urlString, init)`; the Request form is accepted defensively (it would
 *  fail loudly at the server rather than silently mis-send). */
function splitFetchArgs(input: RequestInfo | URL, init?: RequestInit): { url: string; init: RequestInit } {
  if (typeof input === 'string') return { url: input, init: init ?? {} };
  if (input instanceof URL) return { url: input.href, init: init ?? {} };
  return { url: input.url, init: init ?? { method: input.method, headers: input.headers } };
}

/** Point the outgoing `model` field at the model actually loaded. Needed only for
 *  the `default` sentinel: llama-server echoes the REQUESTED id back verbatim
 *  (verified), so leaving `default` in place would record it as the embedding
 *  index's provenance instead of the real model. */
function retargetModelField(body: BodyInit | null | undefined, loadedModelId: string): BodyInit | null | undefined {
  if (typeof body !== 'string') return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.model !== 'string') return body;
    return JSON.stringify({ ...parsed, model: loadedModelId });
  } catch {
    return body;
  }
}

/**
 * Hold the sidecar's in-flight count for the WHOLE life of a response, and count every
 * streamed chunk as activity. Two guarantees, one wrapper:
 *
 *  - the idle auto-stop can never terminate a generation that is still producing
 *    tokens (the per-chunk touch — event streams only);
 *  - a model swap can never kill the process serving this request (the release
 *    deferred to body end). Releasing when fetch() resolves would be far too early:
 *    body consumption OUTLIVES the fetch promise, so an early release re-opens the
 *    kill window at the TAIL of every generation — the longest and most expensive
 *    moment to lose one.
 *
 * pipeTo's promise is the single settle point covering every terminal outcome — normal
 * end, source error, and consumer cancel (which errors the destination) — and `release`
 * is idempotent, so the count moves exactly once per request either way.
 */
function trackResponseLifetime(role: LlamaRole, response: Response, release: () => void): Response {
  if (!response.body) {
    release(); // nothing to consume (204, HEAD, a bodiless error) — already done
    return response;
  }
  const isEventStream = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
  const tap = new TransformStream({
    transform(chunk, controller) {
      if (isEventStream) touchBuiltinRuntime(role);
      controller.enqueue(chunk);
    },
  });
  void response.body.pipeTo(tap.writable).then(release, release);
  return new Response(tap.readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Custom fetch for the built-in sidecar: lazily starts the right process, rewrites
 * the placeholder origin to the live one, injects the per-spawn bearer token, and
 * registers the request as in-flight so no model swap can kill it mid-generation.
 */
function builtinFetch(role: LlamaRole, modelId: string): typeof globalThis.fetch {
  const requestedModel = modelId === BUILTIN_DEFAULT_MODEL ? undefined : modelId;
  return async (input: RequestInfo | URL, rawInit?: RequestInit): Promise<Response> => {
    // Acquire AFTER ensureRunning, never before: ensureRunning may itself have to drain
    // this very role before swapping, and holding the count across it would deadlock
    // that swap against the request waiting for it.
    const endpoint = await ensureRunning(role, requestedModel);
    const release = acquireInFlight(role);
    try {
      const { url, init } = splitFetchArgs(input, rawInit);
      const requested = new URL(url);
      const target = new URL(requested.pathname + requested.search, new URL(endpoint.baseUrl).origin);
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${endpoint.apiKey}`);
      const body = requestedModel ? init.body : retargetModelField(init.body, endpoint.modelId);
      const response = await fetch(target, { ...init, headers, body });
      return trackResponseLifetime(role, response, release);
    } catch (err) {
      // Deliberately catch-and-rethrow rather than finally: a finally would also fire on
      // the SUCCESS path, releasing before the body has been read — the early release
      // this whole wrapper exists to avoid.
      release();
      throw err;
    }
  };
}

/** OpenAI-compatible client bound to the built-in sidecar for one model id. */
function createBuiltinClient(role: LlamaRole, modelId: string) {
  return createOpenAI({
    apiKey: BUILTIN_PLACEHOLDER_API_KEY,
    baseURL: BUILTIN_PLACEHOLDER_BASE_URL,
    fetch: builtinFetch(role, modelId),
  });
}

function createFactory(name: AIProviderName, apiKey?: string, baseUrl?: string): ProviderFactory {
  // Each SDK provider is a callable object that returns its own LanguageModel version.
  // OpenAI/Anthropic return LanguageModelV3, Ollama returns LanguageModelV1.
  // generateText accepts all versions at runtime, so the cast is safe.
  switch (name) {
    case 'openai':
      return createOpenAI({ apiKey: apiKey || '' }) as unknown as ProviderFactory;
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey || '' }) as unknown as ProviderFactory;
    case 'google':
      return createGoogleFactory(apiKey, baseUrl);
    case 'ollama':
      return createOllama({ baseURL: baseUrl || 'http://localhost:11434/api' }) as unknown as ProviderFactory;
    case 'kimi': {
      // Moonshot API is OpenAI-compatible but only supports /chat/completions,
      // not /responses (which @ai-sdk/openai v3 defaults to). Use .chat() explicitly.
      const kimi = createOpenAI({
        apiKey: apiKey || '',
        baseURL: baseUrl || 'https://api.moonshot.ai/v1',
      });
      return ((modelId: string) => kimi.chat(modelId)) as unknown as ProviderFactory;
    }
    case 'lmstudio': {
      // LM Studio is OpenAI-compatible but only supports /chat/completions.
      // API key is ignored by LM Studio but required by the SDK.
      // Normalize base URL: ensure it ends with /v1 (users often paste without it).
      let lmsUrl = baseUrl || 'http://localhost:1234/v1';
      if (!lmsUrl.endsWith('/v1')) lmsUrl = lmsUrl.replace(/\/+$/, '') + '/v1';
      const lms = createOpenAI({
        apiKey: 'lm-studio',
        baseURL: lmsUrl,
      });
      return ((modelId: string) => lms.chat(modelId)) as unknown as ProviderFactory;
    }
    case 'builtin':
      // Bundled llama.cpp sidecar — same .chat() shape as LM Studio/Kimi. The DB
      // row's baseUrl is ignored on purpose: the sidecar's port is dynamic.
      return ((modelId: string) => createBuiltinClient('chat', modelId).chat(modelId)) as unknown as ProviderFactory;
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}

/**
 * Get or create a cached provider factory for the given DB provider row.
 * Call clearProviderCache(id) when provider config changes.
 */
export function getProvider(id: string, name: AIProviderName, apiKeyEncrypted: string | null, baseUrl: string | null) {
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

/** Map raw SDK error messages to short, user-friendly strings. */
function friendlyConnectionError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('incorrect api key') ||
    lower.includes('invalid.*api.key') ||
    lower.includes('authentication')
  )
    return 'Invalid API key. Please check and try again.';
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('permission'))
    return 'Access denied. Your API key may lack permissions.';
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many'))
    return 'Rate limited. Wait a moment and retry.';
  if (lower.includes('404') || lower.includes('not found')) return 'Model or endpoint not found. Check your Base URL.';
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnaborted'))
    return 'Connection timed out. Check your network or Base URL.';
  if (lower.includes('econnrefused') || lower.includes('connection refused'))
    return 'Connection refused. Is the server running?';
  if (lower.includes('enotfound') || lower.includes('getaddrinfo'))
    return 'Server not found. Check your Base URL or network.';
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnreset'))
    return 'Network error. Check your internet connection.';
  if (lower.includes('insufficient_quota') || lower.includes('billing') || lower.includes('exceeded'))
    return 'Billing issue. Check your account balance or plan.';
  // Fallback: truncate raw message to keep it readable
  if (raw.length > 120) return raw.slice(0, 117) + '...';
  return raw;
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

    // LM Studio: resolve actual model ID from the running instance.
    // The static TEST_MODELS entry ('default') isn't a real model — we need to
    // query /v1/models to find what's loaded.
    let testModelId = TEST_MODELS[name];
    if (name === 'builtin') {
      // Start the sidecar up front so a missing binary or an empty model folder
      // surfaces as its own actionable message instead of a generic connection
      // failure, and so the test request carries the real model id.
      const endpoint = await ensureRunning('chat');
      testModelId = endpoint.modelId;
    }
    if (name === 'lmstudio') {
      let lmsUrl = baseUrl || 'http://localhost:1234/v1';
      if (!lmsUrl.endsWith('/v1')) lmsUrl = lmsUrl.replace(/\/+$/, '') + '/v1';
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const resp = await fetch(`${lmsUrl}/models`, { signal: ctrl.signal });
        clearTimeout(t);
        if (resp.ok) {
          const data = (await resp.json()) as { data?: { id: string }[] };
          const models = (data.data || []).filter((m) => !m.id.includes('embed')).map((m) => m.id);
          if (models.length > 0) testModelId = models[0];
        }
      } catch {
        // If model list fails, fall through with 'default' — the generate call will give a clearer error
      }
    }

    const factory = createFactory(name, apiKey, baseUrl ?? undefined);
    const model = factory(testModelId) as LanguageModel;

    await generateText({
      model,
      prompt: 'Say "ok".',
      maxOutputTokens: 16,
    });

    return { success: true, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : 'Connection failed';
    return {
      success: false,
      error: friendlyConnectionError(raw),
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
  const factory = getProvider(options.providerId, options.providerName, options.apiKeyEncrypted, options.baseUrl);

  let result;
  const startedAt = Date.now();
  let elapsedMs: number; // always assigned below; the catch path only ever rethrows
  try {
    result = await generateText({
      model: factory(options.model) as LanguageModel,
      prompt: options.prompt,
      system: options.system,
      temperature: sanitizeTemperature(options.providerName, options.temperature),
      maxOutputTokens: sanitizeMaxTokens(options.providerName, options.maxTokens),
    });
    elapsedMs = Date.now() - startedAt; // before any post-processing, so only the model call counts
  } catch (err: unknown) {
    // Re-throw with user-friendly message for local model context overflow
    const contextHint = LOCAL_CONTEXT_HINTS[options.providerName];
    if (contextHint) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('400') || msg.toLowerCase().includes('bad request')) {
        throw new Error(`Request too large for the local model. ${contextHint}`, { cause: err });
      }
    }
    throw err;
  }

  // Reasoning model fallback: some models (e.g. Kimi k2.5) put content in
  // reasoning instead of text. Use reasoning as fallback when text is empty.
  let text = result.text;
  if (!text && result.reasoning && result.reasoning.length > 0) {
    const reasoningText = result.reasoning.map((r) => r.text).join('\n');
    log.info(`[AI] text empty but reasoning has ${reasoningText.length} chars — using reasoning as text`);
    text = reasoningText;
  }
  if (!text) {
    // Log raw response fields for debugging
    const diag = {
      textLen: result.text?.length ?? 0,
      reasoningLen: result.reasoning?.length ?? 0,
      finishReason: result.finishReason,
      usage: result.usage,
    };
    log.error(`[AI] Empty response from ${options.providerName}/${options.model}: ${JSON.stringify(diag)}`);
  }

  // Log usage (fire-and-forget — don't fail generation if logging fails)
  try {
    const inputTok = result.usage?.inputTokens ?? 0;
    const outputTok = result.usage?.outputTokens ?? 0;
    const db = getDb();
    await db.insert(aiUsage).values({
      providerId: options.providerId,
      model: options.model,
      taskType: options.taskType,
      promptTokens: inputTok,
      completionTokens: outputTok,
      totalTokens: result.usage?.totalTokens ?? 0,
      estimatedCost: estimateCost(options.model, inputTok, outputTok),
    });
  } catch (logError) {
    log.error('Failed to log usage:', logError);
  }

  // Speed telemetry (in memory only; no ai_usage row, no table).
  safeRecordTelemetry({
    providerName: options.providerName,
    model: options.model,
    outputTokens: result.usage?.outputTokens ?? 0,
    elapsedMs,
    ttftMs: null, // non-streaming: the whole call IS the wait
    streaming: false,
  });

  return {
    text,
    usage: result.usage,
    // BRIEF-QUAL.1: surfaced so a caller can tell "the model stopped" from "the model
    // was CUT OFF at its output limit" — a truncated JSON document is unparseable and
    // must be answered by sending less, never by retrying the identical request. The
    // empty-response diagnostic above already read this field; it is now returned
    // instead of only being logged. Additive: no existing field changed.
    finishReason: result.finishReason,
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
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  google: 'gemini-2.5-flash',
  ollama: 'llama3.2',
  kimi: 'kimi-k2.5',
  lmstudio: 'default',
  builtin: 'default',
};

/**
 * Runtime enumeration of every `AITaskType` member, kept in sync with the union
 * by construction: TypeScript errors on this object literal if a member is ever
 * added to or removed from the union in `src/shared/types/ai.ts` without a
 * matching update here, so `TASK_MODEL_FALLBACKS` below can never silently drift
 * out of step with the type it is derived from (types themselves erase at
 * runtime, so this Record is the closest a TS program gets to "reading" one).
 */
const ALL_TASK_TYPES: Record<AITaskType, true> = {
  summarization: true,
  brainstorming: true,
  idea_analysis: true,
  task_structuring: true,
  transcription: true,
  card_agent: true,
  meeting_prep: true,
  standup: true,
  'card-description': true,
  background_agent: true,
  project_agent: true,
  live_assistant: true,
  live_triage: true,
  twin_interview: true,
  embedding: true,
  twin_learning: true,
  knowledge_qa: true,
};

/**
 * Task types that never inherit `live_assistant`'s config: `live_assistant`
 * itself (the anchor — nothing to inherit from), `embedding` (a different,
 * tiny model class with its own unconfigured⇒null privacy guard a few lines
 * below in resolveTaskModel — it must never resolve to a chat model), and
 * `transcription` (whisper, not an LLM chat task).
 */
const CHAT_INHERITANCE_EXCLUDED: ReadonlySet<AITaskType> = new Set(['live_assistant', 'embedding', 'transcription']);

/**
 * Every chat-class `AITaskType` inherits `live_assistant`'s config when its own
 * is unset, so ONE local model download (or Settings assignment) routes every
 * chat task — `live_triage`, `twin_interview`, `twin_learning`, `knowledge_qa`,
 * `summarization` (the brief), and the rest. Derived from `ALL_TASK_TYPES`
 * (minus `CHAT_INHERITANCE_EXCLUDED`) rather than hand-listed, so a task type
 * added to the union inherits by default instead of silently falling through to
 * first-enabled-provider. See resolveTaskModel step 1, and the AI-CTX.1 /
 * 2026-08-07 "one local chat model for all chat tasks" decisions in
 * DECISIONS.md.
 */
const TASK_MODEL_FALLBACKS: Record<string, string> = Object.fromEntries(
  (Object.keys(ALL_TASK_TYPES) as AITaskType[])
    .filter((task) => !CHAT_INHERITANCE_EXCLUDED.has(task))
    .map((task) => [task, 'live_assistant']),
);

/**
 * Per-task MINIMUM output-token budget (a floor, never a cap). The V3.3.5 lesson:
 * reasoning models (OpenAI o-series, Gemini/Claude thinking) burn the budget on
 * hidden reasoning tokens and return EMPTY text at low caps — and unlike `kimi`
 * they are NOT in REASONING_PROVIDERS, so sanitizeMaxTokens can't rescue them.
 * These one-shot JSON extraction/synthesis tasks therefore floor at 4096 so a
 * user's low (or absent) maxTokens never starves them. Applied in resolveTaskModel.
 */
const TASK_MIN_OUTPUT_TOKENS: Partial<Record<AITaskType, number>> = {
  twin_learning: 4096,
  knowledge_qa: 4096,
};

/**
 * Output-token floor for `summarization` — RAISE-ONLY, and deliberately NOT part of
 * TASK_MIN_OUTPUT_TOKENS above.
 *
 * The field failure that produced this rule (2026-08-22): an earlier version of this
 * change put `summarization: 4096` in the table above, whose `withFloor` turns an
 * ABSENT cap into an explicit one. A user with no configured maxTokens therefore
 * started sending `max_output_tokens: 4096` to gpt-5.2, where hidden reasoning is
 * charged against that cap — an 88-minute meeting's extraction hit exactly 4,096
 * completion tokens twice and came back as truncated JSON, i.e. a failure card on the
 * tier the user actually uses. Fabricating a cap from nothing is never safe: the
 * provider's own default is always better informed than a number we invented.
 *
 * So: an absent value stays absent wherever the adapter can omit the field, an
 * explicitly configured value is only ever RAISED, and 16384 is high enough that a
 * 90-minute meeting's JSON fits with reasoning overhead.
 */
const SUMMARIZATION_OUTPUT_FLOOR = 16_384;

/**
 * Providers where leaving the cap ABSENT does NOT reach the model as absent, so the
 * floor must be supplied here instead:
 *   - 'anthropic' — its adapter always sends a max_tokens and falls back to 4096 for
 *     an unrecognised model id (see the adapter notes below);
 *   - 'kimi' — OUR OWN sanitizeMaxTokens raises an absent value to REASONING_MIN_TOKENS
 *     (4096) further down this file, which is exactly the fabricated small cap that
 *     truncated the extraction. Returning undefined here would be ineffective, not
 *     safe. sanitizeMaxTokens itself is deliberately untouched: it protects every
 *     other kimi task, and 16384 passes through its Math.max unchanged.
 */
const ABSENT_IS_UNSAFE: Set<AIProviderName> = new Set(['anthropic', 'kimi']);

/** Providers whose output cap must never be fabricated OR raised by us: their
 *  ceiling is the local context window, which the user sized themselves, and
 *  llama-server/Ollama treat an absent value as "as much as the context allows". */
const LOCAL_OUTPUT_PROVIDERS: Set<AIProviderName> = new Set(['builtin', 'lmstudio', 'ollama']);

/**
 * What `maxOutputTokens: undefined` means for each adapter, READ FROM THE INSTALLED
 * SDK (not assumed), because the whole rule below depends on it:
 *   - @ai-sdk/openai 3.0.28 (also lmstudio/builtin/kimi, which reuse createOpenAI):
 *     `max_tokens: maxOutputTokens` (index.mjs:697) — undefined is dropped by JSON
 *     serialization, so nothing is sent and the model's own default applies;
 *   - @ai-sdk/google 3.0.90: `generationConfig.maxOutputTokens` (index.mjs:1569) —
 *     same, dropped when undefined;
 *   - ollama-ai-provider 1.2.0: `num_predict: maxTokens` (index.mjs:406) — same;
 *   - @ai-sdk/anthropic 3.0.43 is the EXCEPTION: `max_tokens` is required by the
 *     Anthropic API, so the adapter always sends one — the model's own ceiling for a
 *     recognised id (index.mjs:2652 + getModelCapabilities:4105; 64k for
 *     claude-*-4-5, 8192 for 3-5-haiku) but **4096 for an unrecognised id** (the
 *     `else` branch). An absent value on anthropic is therefore NOT safe, and is the
 *     one case where we supply the floor ourselves.
 */
function summarizationOutputTokens(providerName: AIProviderName, configured?: number): number | undefined {
  if (LOCAL_OUTPUT_PROVIDERS.has(providerName)) return configured; // never fabricate, never raise
  if (configured === undefined) return ABSENT_IS_UNSAFE.has(providerName) ? SUMMARIZATION_OUTPUT_FLOOR : undefined;
  return Math.max(configured, SUMMARIZATION_OUTPUT_FLOOR);
}

/**
 * The per-task output-token policy applied at resolution. `summarization` takes the
 * raise-only rule above; every other task keeps TASK_MIN_OUTPUT_TOKENS' original
 * behaviour byte-for-byte (a floor that DOES materialise from an absent value —
 * correct there, because those tasks are short one-shot JSON calls whose failure mode
 * at a low cap is an empty reply, not a truncated document).
 */
function applyOutputPolicy(taskType: string, providerName: AIProviderName, configured?: number): number | undefined {
  if (taskType === 'summarization') return summarizationOutputTokens(providerName, configured);
  const minTokens = TASK_MIN_OUTPUT_TOKENS[taskType as AITaskType];
  return minTokens ? Math.max(configured ?? minTokens, minTokens) : configured;
}

/**
 * Sampling temperature for strict local extraction (LOCAL-QUAL.1) — set-when-absent,
 * never an override. Local models run brief extraction, and the writer that shares
 * its `summarization` task (BRIEF-QUAL.1 — deliberate: briefs want fidelity, not
 * creativity), at their chat-default sampling unless a lower value is configured.
 * Strict JSON extraction wants low temperature, and small local models showed
 * sampling-sensitive name drift and owner wobble at chat-default sampling — the
 * observed failure class on the built-in tier was a product name drifting under
 * Czech declension and one wrong owner. Cloud is untouched: several cloud models
 * reject or ignore `temperature`, and their observed output is the accepted
 * benchmark.
 *
 * This is the mirror image of SUMMARIZATION_OUTPUT_FLOOR's safety rule above: that
 * policy never fabricates a value out of an absent one (a floor that did caused a
 * real production failure — see its comment). This one deliberately does fabricate a
 * value where none existed, which is exactly why it stays scoped this tightly — one
 * task type, three local provider classes — rather than applied broadly.
 */
const LOCAL_EXTRACTION_TEMPERATURE = 0.2;

/**
 * Provider classes LOCAL_EXTRACTION_TEMPERATURE applies to. Deliberately its own
 * constant even though membership currently matches LOCAL_OUTPUT_PROVIDERS above:
 * that one governs the output-token ceiling, a different policy — compare
 * FIXED_TEMPERATURE_PROVIDERS vs REASONING_PROVIDERS further up this file, which
 * both list only `kimi` for the same reason (coincidence of membership is not
 * identity of policy).
 */
const LOCAL_TEMPERATURE_PROVIDERS: Set<AIProviderName> = new Set(['builtin', 'lmstudio', 'ollama']);

/**
 * Explicit config always wins — this is a default, never an override. Absent only
 * becomes LOCAL_EXTRACTION_TEMPERATURE when the task is `summarization` and the
 * provider is a local class; every other absent case passes undefined through
 * unchanged, so cloud stays byte-identical and every other task type is unaffected.
 */
function withLocalExtractionTemperature(
  providerName: AIProviderName,
  taskType: string,
  temperature?: number,
): number | undefined {
  if (temperature !== undefined) return temperature;
  if (taskType === 'summarization' && LOCAL_TEMPERATURE_PROVIDERS.has(providerName)) {
    return LOCAL_EXTRACTION_TEMPERATURE;
  }
  return undefined;
}

/** Max texts per embedMany call (LM Studio / OpenAI-compatible batch ceiling). */
const EMBED_BATCH_SIZE = 64;

/**
 * Resolve which AI provider + model to use for a given task type.
 * 1. Check the `ai.taskModels` setting (JSON map of taskType -> TaskModelConfig),
 *    falling back to an inherited task's config (see TASK_MODEL_FALLBACKS).
 * 2. If config exists, look up the provider row.
 * 3. If no config (or provider is gone/disabled), fall back to first enabled provider.
 * 4. Returns null if no provider is available.
 */
export async function resolveTaskModel(taskType: string): Promise<ResolvedProvider | null> {
  const db = getDb();

  // Per-task output-token policy (see applyOutputPolicy): a floor, never a cap, and
  // for `summarization` never a value fabricated out of an absent one.
  const withFloor = (providerName: AIProviderName, t?: number) => applyOutputPolicy(taskType, providerName, t);

  // Per-task sampling-temperature default (see withLocalExtractionTemperature):
  // set-when-absent, and only for `summarization` on a local provider class.
  const withTemperature = (providerName: AIProviderName, t?: number) =>
    withLocalExtractionTemperature(providerName, taskType, t);

  // 1. Try ai.taskModels setting (matches the key used by the renderer settingsStore)
  const [settingRow] = await db.select().from(settings).where(eq(settings.key, 'ai.taskModels'));

  if (settingRow) {
    try {
      const taskModels: Record<string, TaskModelConfig> = JSON.parse(settingRow.value);
      const fallbackType = TASK_MODEL_FALLBACKS[taskType];
      const config = taskModels[taskType] ?? (fallbackType ? taskModels[fallbackType] : undefined);
      if (config) {
        const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, config.providerId));
        if (provider && provider.enabled) {
          return {
            providerId: provider.id,
            providerName: provider.name as AIProviderName,
            apiKeyEncrypted: provider.apiKeyEncrypted,
            baseUrl: provider.baseUrl,
            model: config.model,
            temperature: withTemperature(provider.name as AIProviderName, config.temperature),
            maxTokens: withFloor(provider.name as AIProviderName, config.maxTokens),
          };
        }
      }
    } catch {
      // Malformed JSON — fall through to default
    }
  }

  // The embedding task has no sensible cross-provider default model and must NEVER
  // silently fall back to a cloud chat model — that would push bulk, private content
  // off-device. Unconfigured ⇒ unavailable (null); the user routes it to a local
  // embedding model in Settings (see the embedding Settings hint). Task 4 layers the
  // explicit no-silent-cloud guard for a user-chosen cloud embedding model.
  if (taskType === 'embedding') return null;

  // 2. Fallback: first enabled provider
  const [fallbackProvider] = await db.select().from(aiProviders).where(eq(aiProviders.enabled, true)).limit(1);

  if (!fallbackProvider) return null;

  return {
    providerId: fallbackProvider.id,
    providerName: fallbackProvider.name as AIProviderName,
    apiKeyEncrypted: fallbackProvider.apiKeyEncrypted,
    baseUrl: fallbackProvider.baseUrl,
    model: DEFAULT_MODELS[fallbackProvider.name as AIProviderName] ?? 'gpt-5-mini',
    temperature: withTemperature(fallbackProvider.name as AIProviderName, undefined),
    maxTokens: withFloor(fallbackProvider.name as AIProviderName, undefined),
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
    const inputTok = usage?.inputTokens ?? 0;
    const outputTok = usage?.outputTokens ?? 0;
    const db = getDb();
    await db.insert(aiUsage).values({
      providerId,
      model,
      taskType,
      promptTokens: inputTok,
      completionTokens: outputTok,
      totalTokens: usage?.totalTokens ?? 0,
      estimatedCost: estimateCost(model, inputTok, outputTok),
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
  abortSignal?: AbortSignal;
}) {
  const factory = getProvider(options.providerId, options.providerName, options.apiKeyEncrypted, options.baseUrl);

  // Speed telemetry ONLY (LOCAL-RT.2). This path deliberately does NOT call logUsage:
  // all four streaming callers log usage themselves, so doing it here would write a
  // duplicate ai_usage row for every streamed reply.
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;

  return streamText({
    model: factory(options.model) as LanguageModel,
    messages: options.messages,
    system: options.system,
    temperature: sanitizeTemperature(options.providerName, options.temperature),
    maxOutputTokens: options.maxTokens,
    abortSignal: options.abortSignal,
    onChunk() {
      // Time-to-first-token — what a user actually feels as responsiveness. Measured
      // separately from the generation rate below, which runs to the LAST token.
      firstTokenAt ??= Date.now();
    },
    onFinish({ usage }) {
      safeRecordTelemetry({
        providerName: options.providerName,
        model: options.model,
        outputTokens: usage?.outputTokens ?? 0,
        elapsedMs: Date.now() - startedAt,
        ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        streaming: true,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Embeddings (V3.4) — local-first vector generation via AI SDK embedMany
// ---------------------------------------------------------------------------

/** Result of {@link embed}. `model` is the provider-ECHOED model id — real
 *  provenance for the index-meta rebuild guard (LM Studio silently routes an
 *  invalid embedding id to the loaded model and echoes the real one). */
export interface EmbedResult {
  embeddings: number[][];
  /** The model the provider actually used (response.model), NOT necessarily the
   *  requested id. Falls back to the requested id when the provider doesn't echo. */
  model: string;
  /** Total embedding token usage across all batches, or null when unreported. */
  usage: { tokens: number } | null;
}

/** Build an embedding model from an OpenAI-compatible endpoint (openai / kimi /
 *  lmstudio all share createOpenAI). Extracted so createEmbeddingModel stays
 *  within the complexity budget. */
function openAICompatEmbeddingModel(modelId: string, apiKey: string, baseURL?: string): EmbeddingModel {
  const client = baseURL ? createOpenAI({ apiKey, baseURL }) : createOpenAI({ apiKey });
  return client.textEmbeddingModel(modelId) as unknown as EmbeddingModel;
}

/** Normalize an LM Studio base URL to end with /v1 (mirrors createFactory). */
function normalizeLmStudioUrl(baseUrl?: string): string {
  let url = baseUrl || 'http://localhost:1234/v1';
  if (!url.endsWith('/v1')) url = url.replace(/\/+$/, '') + '/v1';
  return url;
}

/**
 * Build an embedding model for a resolved provider. Mirrors createFactory but
 * returns an EmbeddingModel via each SDK's textEmbeddingModel(). Anthropic has no
 * embedding models (its textEmbeddingModel() is `never`), so reject early with a
 * clear message rather than fail deep inside embedMany.
 */
function createEmbeddingModel(
  name: AIProviderName,
  modelId: string,
  apiKey?: string,
  baseUrl?: string,
): EmbeddingModel {
  const key = apiKey ?? '';
  switch (name) {
    case 'openai':
      return openAICompatEmbeddingModel(modelId, key);
    case 'google': {
      const options = baseUrl ? { apiKey: key, baseURL: baseUrl } : { apiKey: key };
      return createGoogleGenerativeAI(options).textEmbeddingModel(modelId) as unknown as EmbeddingModel;
    }
    case 'ollama':
      return createOllama({ baseURL: baseUrl ?? 'http://localhost:11434/api' }).textEmbeddingModel(
        modelId,
      ) as unknown as EmbeddingModel;
    case 'kimi':
      return openAICompatEmbeddingModel(modelId, key, baseUrl ?? 'https://api.moonshot.ai/v1');
    case 'lmstudio':
      return openAICompatEmbeddingModel(modelId, 'lm-studio', normalizeLmStudioUrl(baseUrl));
    case 'builtin':
      // Separate sidecar process from chat: llama-server gates /v1/embeddings behind
      // its --embeddings startup flag, so the two roles cannot share one process.
      return createBuiltinClient('embedding', modelId).textEmbeddingModel(modelId) as unknown as EmbeddingModel;
    case 'anthropic':
      throw new Error(
        'Anthropic does not provide embedding models. Route the Embedding task to LM Studio (local) or another embedding-capable provider.',
      );
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}

/**
 * Read the provider-echoed model id from an embedMany raw response body. LM Studio
 * (and other OpenAI-compatible endpoints) return `{ model, data, usage }`; the AI
 * SDK surfaces the raw body in `responses[i].body`. Falls back to the requested id
 * when the body carries no usable `model` (defensive — never throws).
 */
function echoedEmbeddingModel(
  responses: ReadonlyArray<{ body?: unknown } | undefined> | undefined,
  requested: string,
): string {
  for (const resp of responses ?? []) {
    const body = resp?.body;
    if (body && typeof body === 'object' && 'model' in body) {
      const m = (body as { model?: unknown }).model;
      if (typeof m === 'string' && m.length > 0) return m;
    }
  }
  return requested;
}

/**
 * Generate embeddings for a set of texts via AI SDK embedMany. Resolves the
 * provider for `taskType` (`'embedding'` by default — local/LM Studio; never a
 * silent cloud fallback, see resolveTaskModel), batches at EMBED_BATCH_SIZE, logs
 * usage like generate(), and returns the vectors plus the provider-ECHOED model id
 * for index provenance. Throws when no embedding provider is configured or the
 * resolved provider cannot embed.
 */
export async function embed(texts: string[], taskType: string = 'embedding'): Promise<EmbedResult> {
  if (texts.length === 0) return { embeddings: [], model: '', usage: { tokens: 0 } };

  const provider = await resolveTaskModel(taskType);
  if (!provider) {
    throw new Error(
      'No embedding provider configured. Assign a local embedding model to the Embedding task in Settings.',
    );
  }

  const apiKey = provider.apiKeyEncrypted ? decryptString(provider.apiKeyEncrypted) : undefined;
  const model = createEmbeddingModel(provider.providerName, provider.model, apiKey, provider.baseUrl ?? undefined);

  const embeddings: number[][] = [];
  let totalTokens = 0;
  let echoedModel = provider.model;

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embedMany({ model, values: batch });
    for (const vec of result.embeddings as number[][]) embeddings.push(vec);
    totalTokens += result.usage?.tokens ?? 0;
    echoedModel = echoedEmbeddingModel(result.responses, provider.model);
  }

  // Log usage under the ECHOED model (real provenance). logUsage never throws.
  await logUsage(provider.providerId, echoedModel, taskType, { inputTokens: totalTokens, totalTokens });

  return { embeddings, model: echoedModel, usage: { tokens: totalTokens } };
}
