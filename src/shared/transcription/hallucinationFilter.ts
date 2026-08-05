// === FILE PURPOSE ===
// Single source of truth for detecting known Whisper hallucination phrases
// (subtitle-credit boilerplate, "thanks for watching" outros, bare URLs) that
// whisper.cpp sometimes emits for silent/near-silent audio. Used by
// transcriptionService (drop before persist/UI/triage) and voice-input.ts
// (return empty string), and will be reused by the Task 4 DB cleanup sweep.
// Pure — no I/O, no main-process imports — so it is importable everywhere.
//
// Matching is deliberately conservative: a segment is only flagged when it IS
// essentially the hallucination phrase (normalized containment + a small
// length slack for a credited name), never because real speech mentions
// "subtitles" in passing. False negatives are acceptable; false positives
// are not — see TRANS-HALL.1 session decisions.

/** Known hallucination phrases, stored pre-normalized (lowercase). Extensible. */
export const HALLUCINATION_PHRASES: readonly string[] = [
  // Czech
  'titulky vytvořil',
  'titulky vytvořila',
  'překlad a titulky',
  'titulky ve spolupráci',
  // Slovak
  'titulky vytvoril',
  'preklad a titulky',
  // English
  'thanks for watching',
  'thank you for watching',
  'subtitles by',
  'subtitled by',
  'amara.org',
];

/** Slack (in chars) allowed beyond the matched phrase's length, e.g. for a credited name. */
const LENGTH_SLACK = 25;

/** Chars stripped from both ends of a segment during normalization: whitespace,
 * common punctuation/quote glyphs, dashes, and music-note glyphs (Whisper wraps
 * non-speech audio in these, e.g. "♪ Thanks for watching ♪"). */
const EDGE_CHARS = /^[\s"'“”‘’.,!?;:\-–—―*_~♪♫♩♬]+|[\s"'“”‘’.,!?;:\-–—―*_~♪♫♩♬]+$/g;

/** Matches a string that, in full, is nothing but a URL/www address. */
const URL_ONLY = /^(https?:\/\/|www\.)\S+$/i;

/** Lowercase, trim, collapse internal whitespace, strip surrounding punctuation/dash/music-note glyphs. */
function normalize(text: string): string {
  const collapsed = text.toLowerCase().trim().replace(/\s+/g, ' ');
  return collapsed.replace(EDGE_CHARS, '').trim();
}

/**
 * Return the matched hallucination phrase for a segment, or null if it is not
 * a hallucination. Exposed separately (not just a boolean) so callers can log
 * which phrase matched.
 */
export function findMatchedHallucinationPhrase(text: string): string | null {
  const normalized = normalize(text);
  if (!normalized) return null;

  if (URL_ONLY.test(normalized)) return normalized;

  for (const phrase of HALLUCINATION_PHRASES) {
    if (normalized.includes(phrase) && normalized.length <= phrase.length + LENGTH_SLACK) {
      return phrase;
    }
  }

  return null;
}

/** True iff the segment text is (essentially) a known hallucination phrase. */
export function isHallucinatedSegment(text: string): boolean {
  return findMatchedHallucinationPhrase(text) !== null;
}
