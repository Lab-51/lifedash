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
 *
 * MEASURED, not assumed (BRIEF-QUAL.1 Task 5 live eval, 2026-08-21):
 *   - synthetic Czech-heavy fixture, built-in Qwen3-4B-Q4_K_M via llama-server
 *     b10219: a 36,912-char part tokenized to 17,620 tokens => ~2.09 chars/token,
 *     and the server rejected it ("request (17620 tokens) exceeds the available
 *     context size (16384 tokens)");
 *   - the real 88-minute cs-mix meeting: ~2.6 chars/token on gpt-5-mini's tokenizer.
 *
 * The previous 3.5 was described as conservative and was NOT: at 3.5 the same
 * 36,912 chars estimate to ~10.5k tokens, a 1.7x under-count that put a request
 * 1,236 tokens past a 16,384-token window and turned a brief into a failure card.
 * 2.0 sits below BOTH measurements, which is the only direction that is safe:
 * over-estimating tokens merely chunks earlier (more, smaller passes — every one
 * of them still a full extraction, so nothing is lost), while under-estimating
 * overflows the window, which is precisely the field failure this module exists to
 * prevent (AI-CTX.1 (b)). English-only meetings pay a few extra passes for it;
 * that is the intended trade, not a regression.
 */
export const CHARS_PER_TOKEN = 2.0;

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

/** Default output-token reserve when a task has no configured `maxTokens`, and —
 *  since BRIEF-QUAL.1 — the CEILING on that reserve too (see outputReserveTokens). */
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4096;

/** Chat-template / message-framing overhead the char measurement can't see. */
const FRAMING_OVERHEAD_TOKENS = 1024;

/** Small positive floor so a starved window (tiny context, large maxTokens)
 *  never yields a zero or negative budget — chunkSegments must always be able
 *  to make progress. */
const MIN_PROMPT_CHAR_BUDGET = 2_000;

/** Headroom reserved inside a chunk's char budget for the "Part i of N" header
 *  and the `Transcript:` framing wrapped around the segments themselves.
 *  Moved here from meetingIntelligenceService.ts (BRIEF-QUAL.1) unchanged. */
const CHUNK_HEADROOM_CHARS = 512;

/** Floor for a chunk's char budget — a starved window must still make progress
 *  (same rationale as MIN_PROMPT_CHAR_BUDGET above). Moved here from
 *  meetingIntelligenceService.ts (BRIEF-QUAL.1) unchanged; deliberately a
 *  different, smaller number than MIN_PROMPT_CHAR_BUDGET — a chunk is one slice
 *  of the prompt, not the whole prompt. */
const MIN_CHUNK_CHAR_BUDGET = 1_000;

/**
 * How many output tokens the budget math carves out of the window, CAPPED at
 * DEFAULT_OUTPUT_RESERVE_TOKENS.
 *
 * The cap exists because a task's configured `maxTokens` is a permission, not a
 * prediction: BRIEF-QUAL.1 raises the summarization cap to 16384 on cloud providers
 * so a whole meeting's JSON can be emitted, and without this cap that number would
 * flow straight into the LOCAL chunk budget and shrink it by 12k tokens' worth of
 * chars — a cloud setting silently making local extraction chunk four times harder.
 * Reserving less than a caller MIGHT emit is safe here in a way under-estimating the
 * prompt never is: the output side is healed by the extraction service's bounded
 * split (a truncated or rejected reply is re-run in smaller parts), whereas an
 * over-long prompt is simply refused.
 */
function outputReserveTokens(maxTokens?: number): number {
  return Math.min(maxTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS, DEFAULT_OUTPUT_RESERVE_TOKENS);
}

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
  const reserveTokens = outputReserveTokens(provider.maxTokens) + FRAMING_OVERHEAD_TOKENS;
  const budgetChars = (windowTokens - reserveTokens) * CHARS_PER_TOKEN;
  return Math.max(MIN_PROMPT_CHAR_BUDGET, Math.floor(budgetChars));
}

/**
 * True when the system + user prompt, plus the task's output reserve and the
 * chat-template framing overhead, fit the provider's context window. The single
 * gate deciding single-pass vs chunked for every transcript-consuming task —
 * one estimate, one place to be wrong (AI-CTX.1).
 *
 * Moved here from meetingIntelligenceService.ts (BRIEF-QUAL.1) so the brief
 * pipeline and the structured-extraction pass cannot drift apart: the numbers
 * are byte-identical to the private helper it replaces, which is exactly what
 * the untouched contextBudget byte pins prove.
 */
export function fitsWindow(
  provider: Pick<ResolvedProvider, 'providerName' | 'maxTokens'>,
  systemPrompt: string,
  userPrompt: string,
): boolean {
  const needed =
    estimateTokens(systemPrompt + userPrompt) + outputReserveTokens(provider.maxTokens) + FRAMING_OVERHEAD_TOKENS;
  return needed <= contextWindowTokens(provider.providerName);
}

/**
 * Char budget for ONE chunk of transcript: the provider's prompt budget minus
 * the system prompt that rides along with every chunk, minus header headroom.
 * Moved here from meetingIntelligenceService.ts (BRIEF-QUAL.1); takes the
 * provider rather than a pre-computed budget so there is one call shape and no
 * second place to forget promptCharBudget().
 */
export function chunkBudget(
  provider: Pick<ResolvedProvider, 'providerName' | 'maxTokens'>,
  systemPrompt: string,
): number {
  return Math.max(MIN_CHUNK_CHAR_BUDGET, promptCharBudget(provider) - systemPrompt.length - CHUNK_HEADROOM_CHARS);
}

/** Mirrors formatTranscript's per-line shape in meetingIntelligenceService.ts
 *  (not exported there, so duplicated here) — the measure must match what is
 *  actually sent, not an approximation of it. Keep in sync manually if that
 *  shape ever changes. Exported (BRIEF-QUAL.1) so a new transcript-sending
 *  caller renders the line through the SAME function the budget is measured
 *  with, instead of adding a third copy of the shape. */
export function formatLine(segment: { startTime: number; content: string }): string {
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
