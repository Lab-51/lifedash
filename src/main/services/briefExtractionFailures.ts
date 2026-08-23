// === FILE PURPOSE ===
// How to read a provider FAILURE (BRIEF-QUAL.1). Split out of
// briefExtractionService.ts to keep that file under the 500-line ceiling, and
// because these are pure string predicates with no I/O: given whatever a provider
// threw or returned, decide whether sending LESS would help, and say why in one
// short human sentence.
//
// Two split-worthy classes live here, and telling them apart is the whole point:
//   - INPUT overflow   the request did not fit the context window;
//   - OUTPUT truncation the reply was cut off at the model's output limit.
// Everything else is a plain failure that a smaller request cannot fix.
//
// === DEPENDENCIES ===
// None (pure functions over strings and unknown errors).

/** Cap for a provider error message in the catch-all bucket. Mirrors
 *  meetingIntelligenceService's FAILURE_REASON_CHAR_CAP. */
const ERROR_CHAR_CAP = 200;

/** Truncate with an ellipsis, never mid-report. Shared with the service's own
 *  issue capping. */
export function capped(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap - 3)}...` : text;
}

/**
 * Every string a thrown provider error carries: its own message, the `responseBody`
 * an AI SDK APICallError attaches (where llama-server's raw rejection text actually
 * lives), and the same for its `cause` chain. ai-provider.ts wraps a local 400 into
 * "Request too large for the local model." and keeps the original as `cause`, so
 * BOTH the wrapper and the raw server text can reach us — this collects the lot and
 * the predicate below matches on whichever one is present. Depth-bounded and
 * cycle-safe.
 */
export function collectErrorText(err: unknown): string {
  const seen = new Set<unknown>();
  const found: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === 'string') {
      found.push(current);
      break;
    }
    if (current instanceof Error) found.push(current.message);
    const body = (current as { responseBody?: unknown }).responseBody;
    if (typeof body === 'string') found.push(body);
    current = (current as { cause?: unknown }).cause;
  }
  return found.length > 0 ? found.join(' | ') : String(err);
}

/** The context-overflow markers, in ONE place. The first is ai-provider.ts's own
 *  wrapper for a local-provider 400 (ai-provider.ts:470); the second is llama.cpp
 *  b10219's raw text ("request (17620 tokens) exceeds the available context size
 *  (16384 tokens)"); the last two cover OpenAI-compatible servers that phrase it
 *  their own way. */
const OVERFLOW_MARKERS = [
  'request too large for the local model',
  'exceeds the available context size',
  'maximum context length',
  'context length exceeded',
];

/** True when the provider is telling us the REQUEST did not fit — the one error
 *  class that a smaller request can fix, and the only one this service splits on. */
export function isContextOverflow(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return OVERFLOW_MARKERS.some((marker) => lower.includes(marker));
}

/** The server's own prompt-token count, when it reported one. Paired with the
 *  prompt's char length in the split log line, this is the measured chars/token
 *  ratio for that model — the number promptBudget.CHARS_PER_TOKEN is tuned from. */
export function reportedTokenCount(errorText: string): number | null {
  const match = /\((\d+) tokens\)/.exec(errorText);
  return match ? Number(match[1]) : null;
}

/**
 * Short reason for a thrown provider error, in the same wording family as
 * meetingIntelligenceService's `classifyBriefFailure`. Echoed rather than imported
 * because that helper is private to its module and this task must not widen its
 * exports; Task 3 re-classifies the returned reason for the failure card anyway.
 */
export function describeProviderError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes('econnrefused') || lower.includes('connection refused') || lower.includes('fetch failed')) {
    return 'the local AI server is not reachable';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort')) {
    return 'the model did not respond in time';
  }
  if (lower.includes('did not become healthy')) {
    return 'the built-in model did not finish loading in time';
  }
  return capped(message, ERROR_CHAR_CAP);
}

/**
 * True when the reply was CUT OFF rather than finished.
 *
 * Two signals, because not every provider reports the first one honestly:
 *   - `finishReason === 'length'` — the model hit its output cap. Checked BEFORE
 *     parsing: even a reply that happens to parse is missing whatever the model
 *     still wanted to write, and this phase exists to stop losing content silently.
 *   - a failed parse whose text STARTED a JSON document but does not END in a
 *     closing brace/bracket — it simply stops mid-object, which is exactly what the
 *     field report showed. Trailing code-fence markers are stripped first so a
 *     fenced-but-complete reply is not mistaken for a truncated one.
 *
 * The "started a document" half matters: a model that answers with prose (a refusal,
 * an apology) also fails to end in a brace, but it is NOT cut off — sending it less
 * transcript would not help, while re-prompting it with the validation error might.
 * Those keep the retry; only a half-written document is split.
 *
 * Only ever consulted for a NON-empty reply; an empty reply is its own failure.
 */
export function isTruncatedText(text: string): boolean {
  const trimmed = text
    .trimEnd()
    .replace(/```\s*$/, '')
    .trimEnd();
  if (!trimmed.includes('{') && !trimmed.includes('[')) return false;
  return !trimmed.endsWith('}') && !trimmed.endsWith(']');
}
