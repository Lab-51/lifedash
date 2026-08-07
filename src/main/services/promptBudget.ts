// === FILE PURPOSE ===
// Pure derivation module (AI-CTX.1 Task 1): one authoritative answer to "how many
// prompt characters fit this provider's context window?" No IPC, no side effects —
// same testability discipline as llamaRuntimeConfig.ts. The brief pipeline (Task 3)
// uses this to chunk long transcripts instead of silently overflowing the window.
//
// === DEPENDENCIES ===
// llamaRuntimeConfig.ts (chatCtxSize — the REAL builtin spawn value), shared AI types.

import { chatCtxSize } from './llamaRuntimeConfig';
import type { AIProviderName } from '../../shared/types/ai';
import type { ResolvedProvider } from './ai-provider';

/**
 * Chars-per-token used for all char <-> token estimates in this module.
 * Deliberately BELOW the codebase's existing ~4 chars/token convention (see
 * THREADING_TOTAL_CHAR_BUDGET in meetingIntelligenceService.ts): the user's
 * meetings are frequently Czech, which tokenizes denser than English.
 * Under-estimating tokens overflows the context window (the field failure this
 * module exists to prevent); over-estimating only triggers chunking earlier —
 * the safe direction.
 */
export const CHARS_PER_TOKEN = 3.5;

/** Cloud providers' budgeted context window — deliberately below every current
 *  frontier model's true max; a conservative BUDGET, not a capability claim. */
const CLOUD_CONTEXT_WINDOW_TOKENS = 100_000;

/**
 * LM Studio and Ollama's context is configured on the user's server, not
 * discoverable from LifeDash. These are documented heuristic floors, not
 * measurements: they bound the damage a wildly wrong guess could do, while the
 * classified overflow error (Task 3) remains the fallback if the user actually
 * configured less than the floor.
 */
const LMSTUDIO_CONTEXT_WINDOW_TOKENS = 8_192;
const OLLAMA_CONTEXT_WINDOW_TOKENS = 4_096;

/** Default output-token reserve when a task has no configured `maxTokens`.
 *  Mirrors TASK_MIN_OUTPUT_TOKENS' floor scale in ai-provider.ts. */
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4096;

/** Chat-template / message-framing overhead the char measurement can't see. */
const FRAMING_OVERHEAD_TOKENS = 1024;

/** Small positive floor so a starved window (tiny context, large maxTokens)
 *  never yields a zero or negative budget — chunkSegments must always be able
 *  to make progress. */
const MIN_PROMPT_CHAR_BUDGET = 2_000;

/** Token estimate for `text`, rounded up (never under-count, per CHARS_PER_TOKEN's
 *  safe-direction rationale above). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Context window budget, in tokens, for a provider. `builtin` reads the REAL
 * spawn value (including the `LIFEDASH_LLAMA_CTX` override) so this can never
 * drift from what the sidecar was actually started with.
 */
export function contextWindowTokens(providerName: AIProviderName): number {
  if (providerName === 'builtin') return chatCtxSize();
  if (providerName === 'lmstudio') return LMSTUDIO_CONTEXT_WINDOW_TOKENS;
  if (providerName === 'ollama') return OLLAMA_CONTEXT_WINDOW_TOKENS;
  return CLOUD_CONTEXT_WINDOW_TOKENS; // openai | anthropic | google | kimi
}

/**
 * How many prompt characters fit this provider's window, after reserving room
 * for the task's output tokens and message-framing overhead. Floored at
 * MIN_PROMPT_CHAR_BUDGET so a starved window never yields zero.
 */
export function promptCharBudget(provider: Pick<ResolvedProvider, 'providerName' | 'maxTokens'>): number {
  const windowTokens = contextWindowTokens(provider.providerName);
  const reserveTokens = (provider.maxTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS) + FRAMING_OVERHEAD_TOKENS;
  const budgetChars = (windowTokens - reserveTokens) * CHARS_PER_TOKEN;
  return Math.max(MIN_PROMPT_CHAR_BUDGET, Math.floor(budgetChars));
}

/** Mirrors formatTranscript's per-line shape in meetingIntelligenceService.ts
 *  (not exported there, so duplicated here) — the measure must match what is
 *  actually sent, not an approximation of it. Keep in sync manually if that
 *  shape ever changes. */
function formatLine(segment: { startTime: number; content: string }): string {
  const minutes = Math.floor(segment.startTime / 60000);
  const seconds = Math.floor((segment.startTime % 60000) / 1000);
  const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `[${timestamp}] ${segment.content}`;
}

/**
 * Greedily groups sorted segments into chunks whose formatted length (the same
 * `[MM:SS] content` shape formatTranscript joins with `\n`) never exceeds
 * `charBudget`, without ever splitting inside a segment. A single segment that
 * alone exceeds the budget still gets its own chunk — pathological, but content
 * is never dropped silently.
 *
 * Contract: flattening the result in order reproduces the sorted input exactly;
 * every chunk is <= charBudget except the single-oversized-segment case; exactly
 * one chunk is returned when the total fits.
 */
export function chunkSegments(
  segments: { startTime: number; content: string }[],
  charBudget: number,
): { startTime: number; content: string }[][] {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const chunks: { startTime: number; content: string }[][] = [];
  let current: { startTime: number; content: string }[] = [];
  let currentLength = 0;

  for (const segment of sorted) {
    const lineLength = formatLine(segment).length;
    const separator = current.length > 0 ? 1 : 0; // the '\n' formatTranscript joins with
    const projected = currentLength + separator + lineLength;
    if (current.length > 0 && projected > charBudget) {
      chunks.push(current);
      current = [segment];
      currentLength = lineLength;
    } else {
      current.push(segment);
      currentLength = projected;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
