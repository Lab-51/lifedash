// === FILE PURPOSE ===
// Flags transcript spans a reader should double-check, by RULE, over text
// already persisted — no model call, no persistence of its own (TRANS-COV.1
// Task 3). Coverage (transcriptionCoverage.ts) records what the pipeline
// KNOWS it dropped; this module catches what slipped through anyway: a
// stuck retranscription loop, an echo from the live path's 1-second window
// overlap that grew past a plausible repeat, garbled output, or a
// hallucination phrase that survived an unfiltering preset or older data.
//
// Pure — no zod, no node/main-process imports — so it is importable from the
// renderer as well as main. Its only dependency is hallucinationFilter.ts,
// itself pure for the same reason.

import { findMatchedHallucinationPhrase, foldText } from './hallucinationFilter';

/** The subset of a transcript row this detector needs. Field names mirror
 *  `TranscriptSegment` (shared/types/meetings.ts) so a caller can pass
 *  segments straight through with no conversion, but the type is defined
 *  locally — rather than imported — so this module keeps exactly one
 *  dependency (hallucinationFilter.ts). `speaker` is accepted for shape
 *  compatibility with the caller's rows; no current rule reads it. */
export interface SuspectSegmentInput {
  id: string;
  startTime: number;
  endTime: number;
  content: string;
  speaker: string | null;
}

export type SuspectReason = 'repetition' | 'duplicate' | 'garbled' | 'hallucination';

export interface SuspectSpan {
  startMs: number;
  endMs: number;
  segmentIds: string[];
  reasons: SuspectReason[];
}

/** Fixed output order for a span's unioned reasons, so callers get a
 *  deterministic array regardless of which rule fired first. */
const REASON_ORDER: readonly SuspectReason[] = ['repetition', 'duplicate', 'garbled', 'hallucination'];

// ---------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------

/** Anything that is not a letter or digit becomes a token gap — Unicode-aware
 *  so Czech/Slovak letters (\p{L}) are never treated as punctuation. */
const NON_WORD_RE = /[^\p{L}\p{N}]+/u;

/** Fold, then split into words, dropping empty tokens produced by leading,
 *  trailing, or repeated punctuation (e.g. "Konec." -> ["konec"]). */
function tokenize(content: string): string[] {
  return foldText(content)
    .split(NON_WORD_RE)
    .filter((token) => token.length > 0);
}

// ---------------------------------------------------------------------------
// Rule: repetition
// ---------------------------------------------------------------------------

/** A ≤3-token phrase repeated back-to-back this many times or more, either
 *  inside one segment or across consecutive segments, marks a stuck
 *  transcription loop rather than emphasis or a stutter — a genuine "no, no"
 *  is two repeats, never three. */
const REPETITION_MIN_RUN = 3;

/** Longest phrase (in tokens) considered for the in-segment run check. A
 *  short phrase like "we agreed" repeating three times in a row is exactly
 *  the loop this rule targets; a longer window risks matching two genuinely
 *  different sentences that merely share a shape. */
const REPETITION_MAX_PHRASE_TOKENS = 3;

/** True iff some phrase of 1..REPETITION_MAX_PHRASE_TOKENS tokens repeats,
 *  back-to-back with no gap, REPETITION_MIN_RUN times or more within `tokens`. */
function hasRepeatedPhrase(tokens: string[]): boolean {
  for (let phraseLen = 1; phraseLen <= REPETITION_MAX_PHRASE_TOKENS; phraseLen++) {
    const span = phraseLen * REPETITION_MIN_RUN;
    if (tokens.length < span) continue;
    for (let start = 0; start + span <= tokens.length; start++) {
      const phrase = tokens.slice(start, start + phraseLen).join(' ');
      let run = 1;
      for (let next = start + phraseLen; next + phraseLen <= tokens.length; next += phraseLen) {
        if (tokens.slice(next, next + phraseLen).join(' ') !== phrase) break;
        run++;
      }
      if (run >= REPETITION_MIN_RUN) return true;
    }
  }
  return false;
}

/** Indices of segments that belong to a run of REPETITION_MIN_RUN or more
 *  consecutive segments sharing the same folded (token-joined) content. Every
 *  segment in a qualifying run is flagged, not just the one that completes
 *  it, so the merged span covers the whole run. Empty-content segments never
 *  start or extend a run. */
function repeatedSegmentRunIndices(segmentKeys: string[]): Set<number> {
  const flagged = new Set<number>();
  let runStart = 0;
  for (let i = 1; i <= segmentKeys.length; i++) {
    const continuesRun = i < segmentKeys.length && segmentKeys[i] !== '' && segmentKeys[i] === segmentKeys[runStart];
    if (!continuesRun) {
      if (i - runStart >= REPETITION_MIN_RUN) {
        for (let j = runStart; j < i; j++) flagged.add(j);
      }
      runStart = i;
    }
  }
  return flagged;
}

// ---------------------------------------------------------------------------
// Rule: duplicate
// ---------------------------------------------------------------------------

/** The live path overlaps consecutive windows by 1 second, so two adjacent
 *  segments legitimately repeat a word or two — that overlap echo is NOT a
 *  duplicate. 6 tokens is the floor above which a shared/contained span is
 *  more plausibly a stuck retranscription than the window overlap. */
const DUPLICATE_MIN_TOKENS = 6;

/** True iff two ADJACENT segments' token sequences are identical, or one
 *  contains the other as a substring of tokens, and the shorter of the two
 *  meets DUPLICATE_MIN_TOKENS. */
function isDuplicatePair(tokensA: string[], tokensB: string[]): boolean {
  const shorter = Math.min(tokensA.length, tokensB.length);
  if (shorter < DUPLICATE_MIN_TOKENS) return false;
  const textA = tokensA.join(' ');
  const textB = tokensB.join(' ');
  return textA === textB || textA.includes(textB) || textB.includes(textA);
}

// ---------------------------------------------------------------------------
// Rule: garbled
// ---------------------------------------------------------------------------

/** Below this many characters, a low letters-to-characters ratio is not
 *  meaningful (a short segment like "12:30" or "OK." is legitimately mostly
 *  non-letters). */
const GARBLED_MIN_LENGTH = 20;

/** Letters-to-characters ratio under this, on a segment at or above
 *  GARBLED_MIN_LENGTH, marks noise output (whisper garbling silence/static
 *  into punctuation and digit runs). */
const GARBLED_LETTER_RATIO = 0.5;

/** A single token longer than this many characters has no plausible spoken
 *  origin — whisper occasionally glues a run of noise into one "word". */
const GARBLED_MAX_TOKEN_LENGTH = 30;

/** Above this fraction of a segment's words having no vowel (see `hasVowel`),
 *  the segment reads as consonant noise rather than speech. */
const GARBLED_NO_VOWEL_RATIO = 0.4;

/** Conventional vowels, including Czech/Slovak diacritic forms, PLUS y/ý —
 *  which behave as vowels in Czech/Slovak orthography ("prosty", "starý"). */
const VOWEL_RE = /[aeiouyáéěíóúůýàâäåæ]/i;

/** l and r, Czech/Slovak's syllabic consonants ("strč", "vlk", "krk" carry no
 *  conventional vowel at all and are still real words). */
const SYLLABIC_RE = /[lr]/i;

/**
 * Whether `word` has a vowel, for the purpose of the garbled check. This is a
 * HEURISTIC approximation of Czech/Slovak phonotactics, not a linguistic
 * model of syllable nuclei: y/ý always count as vowels; l/r count ONLY as a
 * fallback when the word has no conventional vowel at all, matching syllabic
 * l/r words ("strč", "prst", "vlk"). It will occasionally accept a genuinely
 * garbled word that happens to contain an l or r, and it does not attempt any
 * language other than Czech/Slovak's syllabic-consonant pattern.
 */
function hasVowel(word: string): boolean {
  if (VOWEL_RE.test(word)) return true;
  return SYLLABIC_RE.test(word);
}

function isGarbled(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const letterCount = (trimmed.match(/\p{L}/gu) ?? []).length;
  if (trimmed.length >= GARBLED_MIN_LENGTH && letterCount / trimmed.length < GARBLED_LETTER_RATIO) {
    return true;
  }

  const words = trimmed.split(NON_WORD_RE).filter((word) => word.length > 0);
  if (words.some((word) => word.length > GARBLED_MAX_TOKEN_LENGTH)) return true;

  if (words.length > 0) {
    const noVowelCount = words.filter((word) => !hasVowel(word)).length;
    if (noVowelCount / words.length > GARBLED_NO_VOWEL_RATIO) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Merge runs of index-adjacent flagged segments into spans, unioning their
 *  reasons in REASON_ORDER. Non-adjacent flagged segments (separated by at
 *  least one clean segment) become separate spans. */
function mergeIntoSpans(
  segments: readonly SuspectSegmentInput[],
  reasonsBySegment: readonly ReadonlySet<SuspectReason>[],
): SuspectSpan[] {
  const spans: SuspectSpan[] = [];
  let i = 0;
  while (i < segments.length) {
    if (reasonsBySegment[i].size === 0) {
      i++;
      continue;
    }
    const startIndex = i;
    const unioned = new Set<SuspectReason>();
    while (i < segments.length && reasonsBySegment[i].size > 0) {
      for (const reason of reasonsBySegment[i]) unioned.add(reason);
      i++;
    }
    const endIndex = i - 1;
    spans.push({
      startMs: segments[startIndex].startTime,
      endMs: segments[endIndex].endTime,
      segmentIds: segments.slice(startIndex, endIndex + 1).map((segment) => segment.id),
      reasons: REASON_ORDER.filter((reason) => unioned.has(reason)),
    });
  }
  return spans;
}

/**
 * Detect suspect spans across a meeting's transcript segments, in order.
 * Every rule is computed independently per segment (or adjacent pair); the
 * results are then merged wherever flagged segments sit next to each other.
 */
export function detectSuspectSpans(segments: readonly SuspectSegmentInput[]): SuspectSpan[] {
  if (segments.length === 0) return [];

  const tokens = segments.map((segment) => tokenize(segment.content));
  const segmentKeys = tokens.map((t) => t.join(' '));
  const repeatedRuns = repeatedSegmentRunIndices(segmentKeys);

  const reasonsBySegment: Set<SuspectReason>[] = segments.map(() => new Set<SuspectReason>());

  segments.forEach((segment, i) => {
    if (repeatedRuns.has(i) || hasRepeatedPhrase(tokens[i])) {
      reasonsBySegment[i].add('repetition');
    }
    if (isGarbled(segment.content)) {
      reasonsBySegment[i].add('garbled');
    }
    if (findMatchedHallucinationPhrase(segment.content) !== null) {
      reasonsBySegment[i].add('hallucination');
    }
  });

  for (let i = 1; i < segments.length; i++) {
    if (isDuplicatePair(tokens[i - 1], tokens[i])) {
      reasonsBySegment[i - 1].add('duplicate');
      reasonsBySegment[i].add('duplicate');
    }
  }

  return mergeIntoSpans(segments, reasonsBySegment);
}
