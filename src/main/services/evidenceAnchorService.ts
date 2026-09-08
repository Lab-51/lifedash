// === FILE PURPOSE ===
// Evidence anchoring (BRIEF-EVID.1 Task 2): CODE decides whether the verbatim
// `quote` a model attached to a decision or a commitment is really supported by
// the transcript, and — when it is — which segment it came from.
//
// WHY THIS EXISTS: a quote the MODEL supplies is the model vouching for itself,
// the same failure family ownerVerificationService was written to close for owner
// names. A paraphrase presented in quotation marks reads as proof and is not one.
// So the model's quote is only ever a CLAIM; this module is the mechanical check,
// and its two outcomes are "here is the transcript segment that supports it"
// (`evidence`) and "nothing in this transcript supports it" (`evidence: null`).
//
// Three properties that are contract, not implementation detail:
//   - The model's `quote` is NEVER rewritten, corrected or dropped. It stays on
//     the item verbatim for the record, anchored or not.
//   - The `excerpt` in `evidence` is the SEGMENT's own stored text, never the
//     model's quote. That is what makes the renderer's deep-link (Task 5) a
//     substring search that always hits — it is searching stored text FOR stored
//     text. A model's quote can differ from the transcript by a comma and miss.
//   - Items are never dropped and never reordered. An unsupported item is still
//     an item; the brief just cannot claim the transcript backs it.
//
// Pure: no I/O, no model call, no database. One info line per structure.
//
// === DEPENDENCIES ===
// logger, and `foldWords` from ownerVerificationService (whose OWN dependency
// list is that same logger, so this adds nothing to the import graph — the point
// of importing it rather than copying the fold a third time). The two type
// imports are `import type`, erased at compile time, so neither promptBudget's
// electron-touching module graph nor zod is pulled in at runtime.

import { createLogger } from './logger';
import { foldWords } from './ownerVerificationService';
import type { PromptLineSegment } from './promptBudget';
import type { Evidence, MeetingStructureDraft } from '../../shared/types/briefStructure';

const log = createLogger('EvidenceAnchor');

// ---------------------------------------------------------------------------
// The two tuning constants
// ---------------------------------------------------------------------------
// BOTH ARE REASONED, NOT MEASURED. They are here, together, named, so the first
// real BRIEF_EVAL run (which reports anchoredRate / quotedRate /
// unsupportedCount) can retune them against a record instead of a hunch. If a
// local model paraphrases so freely that anchoredRate is low, the fix is these
// two numbers — never loosening the contract that an anchor must be a real
// segment.

/** A quote shorter than this many DISTINCT folded tokens is not eligible for the
 *  overlap pass at all. Rationale: at three tokens or fewer, "all of the quote's
 *  words appear in this segment" is something a filler line can satisfy by
 *  chance ("we can do that"), and a wrong anchor is worse than none — it points
 *  the reader at a line that does not support the claim. Short quotes can still
 *  anchor, but only through the EXACT pass, where being contained verbatim is
 *  itself the evidence. Same guard, same reasoning and the same value as
 *  briefStructureMerge's MIN_CONTAINMENT_TOKENS. */
const MIN_OVERLAP_TOKENS = 4;

/** Fraction of the quote's distinct tokens that must occur in a segment (or an
 *  adjacent pair) for it to count as the source. Rationale: 0.6 tolerates a
 *  model dropping filler words, fixing a whisper mis-transcription or trimming a
 *  clause — the ordinary ways a "verbatim" quote drifts — while still requiring
 *  the clear majority of the wording to be in one place. Below it, the overlap is
 *  as likely to be shared vocabulary as shared provenance. */
const MIN_OVERLAP_SCORE = 0.6;

/** Distinct quote tokens that EACH HALF of an adjacent pair must contribute
 *  before that pair is allowed to anchor anything. A pair is the claim "this
 *  quote spans the window boundary", and a side that lends one word — nearly
 *  always a function word, and Czech puts "na", "je", "to", "se" in nearly every
 *  window — is not spanning anything, it is coincidence. Two is the smallest
 *  value that means "more than a particle" while still admitting the genuine
 *  case of a short tail cut across the boundary. */
const MIN_PAIR_MEMBER_TOKENS = 2;

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** The two fields of a Decision/Commitment this service reads and writes.
 *  Structural on purpose: both item types satisfy it, and neither has to be
 *  imported for its own sake. */
interface Quotable {
  quote: string | null;
  evidence: Evidence | null;
}

/** One transcript segment, pre-folded once per part: the whole transcript is the
 *  haystack for every quote in that part, so folding per lookup would be
 *  quadratic for no benefit. */
interface FoldedSegment {
  startTime: number;
  /** The segment's OWN stored content, trimmed — what `evidence.excerpt` becomes. */
  excerpt: string;
  /** Space-wrapped fold, so `includes` is a WHOLE-WORD containment test. */
  folded: string;
  tokens: Set<string>;
}

/** `foldWords`' output as a token list. It is already space-delimited and
 *  space-wrapped, so this is a split, not a second normalizer. */
function tokensOf(folded: string): string[] {
  const trimmed = folded.trim();
  return trimmed.length > 0 ? trimmed.split(' ') : [];
}

function foldSegments(segments: PromptLineSegment[]): FoldedSegment[] {
  return segments.map((segment) => {
    const folded = foldWords(segment.content);
    return {
      startTime: segment.startTime,
      excerpt: segment.content.trim(),
      folded,
      tokens: new Set(tokensOf(folded)),
    };
  });
}

// ---------------------------------------------------------------------------
// Anchoring one quote
// ---------------------------------------------------------------------------

/** How many of `quoteTokens` occur in ANY of the given segments' token sets —
 *  one set for a single segment, two for an adjacent pair. A COUNT rather than a
 *  fraction, because the pair pass needs each member's own contribution as well
 *  as the combined score. */
function overlapHits(quoteTokens: Set<string>, ...segmentTokens: Set<string>[]): number {
  let hits = 0;
  for (const token of quoteTokens) {
    if (segmentTokens.some((set) => set.has(token))) hits += 1;
  }
  return hits;
}

/**
 * Find the segment a quote came from, or null.
 *
 * Pass 1, EXACT: the first segment whose folded content contains the folded
 * quote. Whole-word and diacritic-blind (both sides go through the same fold),
 * so "Ondrej" matches a segment spelling it "Ondřej" and the reverse — which is
 * the everyday case, because whisper and the model disagree about accents far
 * more often than about words.
 *
 * Pass 2, OVERLAP: only when pass 1 found nothing, and only for a quote of at
 * least MIN_OVERLAP_TOKENS distinct tokens. Each segment scores by the fraction
 * of the quote's tokens it contains, and the best score >= MIN_OVERLAP_SCORE
 * wins. Only if NO single segment clears the bar are ADJACENT PAIRS scored the
 * same way over the union, because a real quote can straddle a 10-second window
 * boundary and then no single segment holds it; for a pair the anchor is the
 * FIRST of the two — that is where the quote starts.
 *
 * TIES GO TO THE EARLIEST — a strict `>` keeps the first candidate found, and
 * candidates are visited in array order. The caller passes segments in transcript
 * order (briefExtractionService sorts by startTime before it plans parts, and
 * promptBudget.chunkSegments sorts again), so "first found" IS "earliest
 * startTime". Two SPEAKER.1 channels can share a startTime; the excerpt is what
 * disambiguates them for the deep-link.
 *
 * WHY SINGLES ARE SETTLED BEFORE A PAIR IS CONSULTED AT ALL. Scoring singles and
 * pairs together is systematically off by one window, and merely requiring a pair
 * to BEAT both of its own members does not close it: the pair (i-1, i) beats both
 * as soon as i-1 contributes ONE token, and it is visited before single i, so
 * earliest-wins credits i-1 — a line whose whole contribution was a particle. One
 * shared function word is all it takes, and in Czech "na", "je", "to", "se" sit
 * in nearly every window, so this fires on the ordinary "the quote drifted by a
 * word" case the 0.6 bar exists to tolerate. Hence: if any single clears the bar
 * then the quote did not span a boundary and the pair pass has nothing to say;
 * only when none does is the pair pass — the case it was written for — allowed to
 * speak, and then only for pairs where BOTH halves carry at least
 * MIN_PAIR_MEMBER_TOKENS of the quote.
 */
function anchorQuote(quote: string, segments: FoldedSegment[]): Evidence | null {
  const needle = foldWords(quote);
  // A quote that folds to nothing (punctuation or emoji only) is not a quote.
  if (!needle) return null;

  const exact = segments.find((segment) => segment.folded.includes(needle));
  if (exact) return { startTime: exact.startTime, excerpt: exact.excerpt };

  const quoteTokens = new Set(tokensOf(needle));
  if (quoteTokens.size < MIN_OVERLAP_TOKENS) return null;

  const hits = segments.map((segment) => overlapHits(quoteTokens, segment.tokens));
  const qualifies = (count: number): boolean => count / quoteTokens.size >= MIN_OVERLAP_SCORE;

  // Singles first, and if one qualifies the pair pass is never consulted.
  let best: FoldedSegment | null = null;
  let bestHits = 0;
  for (let i = 0; i < segments.length; i++) {
    if (qualifies(hits[i]) && hits[i] > bestHits) {
      bestHits = hits[i];
      best = segments[i];
    }
  }
  if (best) return { startTime: best.startTime, excerpt: best.excerpt };

  // No single segment holds enough of the quote — so, and only so, does the
  // boundary-straddle case arise.
  for (let i = 0; i + 1 < segments.length; i++) {
    if (hits[i] < MIN_PAIR_MEMBER_TOKENS || hits[i + 1] < MIN_PAIR_MEMBER_TOKENS) continue;
    const pairHits = overlapHits(quoteTokens, segments[i].tokens, segments[i + 1].tokens);
    if (qualifies(pairHits) && pairHits > bestHits) {
      bestHits = pairHits;
      best = segments[i];
    }
  }

  return best ? { startTime: best.startTime, excerpt: best.excerpt } : null;
}

// ---------------------------------------------------------------------------
// Anchoring a structure
// ---------------------------------------------------------------------------

/** Running counts for the one log line. */
interface AnchorTally {
  quoted: number;
  anchored: number;
}

/**
 * Map one list. Returns the INPUT ARRAY unchanged when nothing moved (the
 * `applySpeakerNames` idiom) — which is what makes a structure carrying no quotes
 * pass through this service identically, allocation for allocation.
 *
 * `evidence` IS CODE-OWNED ON EVERY ITEM, INCLUDING ONE WITH NO QUOTE. The draft
 * schema has to parse `evidence` (a persisted v2 structure is re-parsed through
 * it), so a model that emits its own `{ startTime, excerpt }` reaches this
 * service — and passing it through would persist model-judged evidence as though
 * code had checked it, the exact failure this module exists to close. An item
 * with `quote: null` gives code nothing to verify, so its only honest evidence is
 * none. The reference pass-through survives for the genuine case, where the field
 * is already null.
 */
function anchorItems<T extends Quotable>(items: T[], segments: FoldedSegment[], tally: AnchorTally): T[] {
  let changed = false;
  const mapped = items.map((item) => {
    if (item.quote === null) {
      if (item.evidence === null) return item;
      changed = true;
      return { ...item, evidence: null };
    }
    tally.quoted += 1;
    const evidence = anchorQuote(item.quote, segments);
    if (evidence !== null) tally.anchored += 1;
    // Reference-equal only when both are null: nothing to write, nothing to copy.
    if (evidence === item.evidence) return item;
    changed = true;
    return { ...item, evidence };
  });
  return changed ? mapped : items;
}

/**
 * Stamp `evidence` on every decision and commitment whose `quote` the transcript
 * actually supports, and `null` on every one it does not.
 *
 * Call it with ONE PART's segments and that part's draft: the quote came out of
 * that part's prompt, so anchoring locally is both cheaper (a shorter haystack)
 * and stricter (a quote cannot anchor to a passage the model never saw).
 */
export function anchorEvidence(draft: MeetingStructureDraft, segments: PromptLineSegment[]): MeetingStructureDraft {
  const folded = foldSegments(segments);
  const tally: AnchorTally = { quoted: 0, anchored: 0 };

  const decisions = anchorItems(draft.decisions, folded, tally);
  const commitments = anchorItems(draft.commitments, folded, tally);

  log.info(
    `Evidence anchoring: ${tally.anchored}/${tally.quoted} quoted items anchored to a transcript segment, ` +
      `${tally.quoted - tally.anchored} unsupported`,
  );

  if (decisions === draft.decisions && commitments === draft.commitments) return draft;
  return { ...draft, decisions, commitments };
}
