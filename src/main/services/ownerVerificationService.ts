// === FILE PURPOSE ===
// Verifies that an owner name attributed to a commitment is a name the meeting
// ACTUALLY contains, before that name reaches an action item or a pushed card.
//
// WHY THIS EXISTS: the extraction prompt already says "never invent an owner"
// and the pipeline already drops an owner the model did not mark `explicit`
// (see commitmentsToDrafts). Both of those are the MODEL judging its own output
// — an invented name marked explicit passes straight through to the card badge,
// which is exactly the wrong-name symptom users report. This module is the
// mechanical second gate: an owner survives only if the name occurs in the
// evidence (transcript text, speaker labels, or the participant roster).
//
// It never corrects a name and never guesses one. The only two outcomes are
// "the meeting contains this name, keep it" and "it does not, so no owner" —
// an unowned item is the honest state, not a degraded one.
//
// === DEPENDENCIES ===
// logger only. The diacritic fold is deliberately LOCAL rather than imported
// from entityService: that module pulls the AI provider, the twin memory and the
// post-session dispatcher into the import graph, and a name comparison needs
// none of them. Same semantics as normalizeEntityName (and as
// briefStructureMerge's own local copy, the existing precedent here).

import { createLogger } from './logger';

const log = createLogger('OwnerVerify');

/** Anything that is not a letter or a digit becomes a word gap, so "Marta," and
 *  "(Marta)" both fold to the bare word. Unicode-aware: Czech/Slovak letters are
 *  \p{L} and must NOT be treated as punctuation. */
const NON_WORD_RE = /[^\p{L}\p{N}]+/gu;

/** One line of evidence. Field names match promptBudget's PromptLineSegment (and
 *  the transcript rows themselves), so callers pass their segments straight in
 *  with no conversion. */
export interface OwnerEvidenceSegment {
  content: string;
  speaker?: string | null;
}

export interface OwnerEvidence {
  /** The meeting's transcript lines — after speaker-name substitution, so a
   *  resolved label counts as the meeting naming that person. */
  segments: OwnerEvidenceSegment[];
  /** Known participants (calendar/participants/known). A roster name is evidence
   *  in its own right: whisper may spell a name phonetically while the roster
   *  holds the correct spelling, and attributing to the roster spelling is a
   *  correction, not a guess. */
  rosterNames: string[];
  /** The recording user's own name, when the transcript is speaker-labelled. */
  selfName: string | null;
}

/** Combining marks (U+0300-U+036F): what NFD splits an accented letter into. */
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/** Fold to a space-delimited word bag: lowercased, diacritics stripped,
 *  punctuation turned into gaps, wrapped in spaces so a lookup can require whole
 *  words on both sides (" ana " never matches "banana"). */
function foldWords(value: string): string {
  const folded = value
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .replace(NON_WORD_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return folded.length > 0 ? ` ${folded} ` : '';
}

/**
 * Build a verifier for ONE meeting. The evidence is folded once, then reused for
 * every commitment — an extraction can produce dozens and the haystack is the
 * whole transcript.
 *
 * The returned function takes the owner the extraction proposed and returns
 * either that owner unchanged (evidence found) or null (no evidence).
 */
export function buildOwnerVerifier(evidence: OwnerEvidence): (owner: string | null) => string | null {
  const parts: string[] = [];
  for (const segment of evidence.segments) {
    if (segment.speaker) parts.push(segment.speaker);
    parts.push(segment.content);
  }
  parts.push(...evidence.rosterNames);
  if (evidence.selfName) parts.push(evidence.selfName);

  const haystack = foldWords(parts.join(' '));

  return (owner: string | null): string | null => {
    const trimmed = owner?.trim();
    if (!trimmed) return null;

    const needle = foldWords(trimmed);
    // A name that folds to nothing (punctuation or emoji only) is not a name.
    if (!needle) return null;

    if (haystack.includes(needle)) return trimmed;

    log.info(`Dropped unverified owner "${trimmed}" — the name does not occur in the transcript or roster`);
    return null;
  };
}
