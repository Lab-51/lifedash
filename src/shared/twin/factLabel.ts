// === FILE PURPOSE ===
// The ONE accessor every surface reads a twin fact's display label through
// (TWIN-READ.1 Task 1). Labels are LLM-written and stored on twin_facts.label at
// extraction time — deriving them in code was explicitly rejected on quality
// (see DECISIONS.md): "The Q3 pricing decision was deferred to the board meeting"
// would derive to "The Q3 pricing decision", losing the point. The derived
// fallback below exists ONLY as a never-blank safety net for a fact that has no
// stored label yet — a pre-migration row, a model that ignored the label field,
// or a row the backfill pass hasn't reached — never as the primary mechanism.
//
// Pure, no I/O — safe to import from both main and renderer code.

/** Max words kept by the derived fallback — mirrors the 2-4 word label asked of
 *  the model at extraction time. */
const FALLBACK_WORD_CAP = 4;

/** Hard character ceiling so a single abnormally long "word" (no spaces) still
 *  yields a short, renderable label. */
const FALLBACK_CHAR_CAP = 40;

/** The minimal shape labelFor needs — satisfied by TwinFact and any fact-like row
 *  that carries both the stored label and the full fact sentence. */
export interface LabelableFact {
  fact: string;
  label?: string | null;
}

/**
 * The derived, never-blank (for non-empty input) fallback: the first clause (up
 * to the first clause-ending punctuation) capped at ~4 words, then hard-capped by
 * character count. A trailing "…" marks whenever content was actually dropped —
 * losing only a trailing period/question mark does NOT count as truncation.
 */
function deriveFallback(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Trailing sentence punctuation is never "content" for the truncation check.
  const withoutTrailingPunctuation = trimmed.replace(/[.!?]+$/, '').trim();

  // First clause: never march past the first clause-ending punctuation, then cap
  // at ~4 words.
  const clauseMatch = trimmed.match(/^[^,.;:!?]+/);
  const clause = (clauseMatch ? clauseMatch[0] : trimmed).trim();
  const words = clause.split(/\s+/).filter(Boolean);
  const wordCapped = words.length > 0 ? words.slice(0, FALLBACK_WORD_CAP).join(' ') : withoutTrailingPunctuation;

  const truncated = wordCapped !== withoutTrailingPunctuation;
  if (wordCapped.length <= FALLBACK_CHAR_CAP) {
    return truncated ? `${wordCapped}…` : wordCapped;
  }
  return `${wordCapped.slice(0, FALLBACK_CHAR_CAP).trimEnd()}…`;
}

/**
 * The single label accessor every surface (graph nodes, fact list rows, the
 * inspector) reads through. Prefers the stored label (trimmed); falls back to a
 * derived short label when the fact has no usable stored label — null OR an
 * empty/whitespace-only string both count as "no label".
 */
export function labelFor(fact: LabelableFact): string {
  const stored = fact.label?.trim();
  if (stored) return stored;
  return deriveFallback(fact.fact);
}
