// === FILE PURPOSE ===
// Ranks the twin's learned facts by how much they have to do with the meeting at
// hand, so a tight injection budget is spent on the facts that matter HERE rather
// than on whichever facts happen to be newest.
//
// WHY: learned facts used to be injected newest-first with no regard for the
// meeting. After a few dozen meetings the newest facts are about other meetings.
//
// HOW: pure and deterministic, no model and no embedding call (injection runs on
// every triage pass and every chat message, and must never fail or wait). A fact
// scores by the words it shares with the meeting's text, each weighted by how
// RARE the word is among the facts themselves: log(facts / facts containing it),
// which is exactly 0 for a word every fact has, so no language-specific stop-word
// list is needed. Very short words are skipped unless they carry a digit ("Q3").
// The score is the share of the fact's own total weight that the meeting mentions,
// so a long fact does not win just by having more words to match. Words are compared by a
// short stem so an inflected form still matches. Ties keep the supplied order,
// which is recency, so with no overlap at all the output is exactly the input.
//
// === DEPENDENCIES ===
// ownerVerificationService.foldWords (the one shared diacritic/punctuation fold;
// its own dependency list is a logger).

import { foldWords } from './ownerVerificationService';

/** Words this short are mostly function words ("the", "and", "was") and are not
 *  matched, unless they carry a digit ("Q3", "v2"). */
const MAX_SHORT_WORD_LENGTH = 3;
/** Compare words by their first characters so "Marta"/"Martě", "invoice"/"invoices" meet. */
const STEM_LENGTH = 5;
/** Scores closer than this are a tie (float noise), resolved by recency. */
const SCORE_EPSILON = 1e-9;

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of foldWords(text).split(' ')) {
    if (word.length > MAX_SHORT_WORD_LENGTH || /\d/.test(word)) out.add(word.slice(0, STEM_LENGTH));
  }
  return out;
}

/**
 * Reorder `facts` so the ones most related to `contextText` come first. Stable:
 * equal scores (including all-zero) keep their input order. Never drops or alters
 * a fact.
 */
export function rankFactsByRelevance(facts: string[], contextText: string): string[] {
  if (facts.length < 2 || !contextText.trim()) return facts;
  const context = stems(contextText);
  if (context.size === 0) return facts;

  const factStems = facts.map(stems);
  const docFreq = new Map<string, number>();
  for (const set of factStems) for (const s of set) docFreq.set(s, (docFreq.get(s) ?? 0) + 1);
  // Rarity among the facts: 0 for a word in every fact, highest for a word in one.
  const rarity = (stem: string): number => Math.log(facts.length / (docFreq.get(stem) ?? facts.length));

  const scored = facts.map((fact, index) => {
    let matched = 0;
    let total = 0;
    for (const s of factStems[index]) {
      const weight = rarity(s);
      total += weight;
      if (context.has(s)) matched += weight;
    }
    return { fact, index, score: total > 0 ? matched / total : 0 };
  });
  scored.sort((a, b) => (Math.abs(b.score - a.score) > SCORE_EPSILON ? b.score - a.score : a.index - b.index));
  return scored.map((s) => s.fact);
}

/**
 * The text a meeting is "about", for ranking: its title plus its transcript lines.
 * Accepts any meeting-shaped object so each caller passes what it already holds.
 */
export function meetingRelevanceText(meeting: {
  title?: string | null;
  segments?: { content: string }[] | null;
}): string {
  return [meeting.title ?? '', ...(meeting.segments ?? []).map((s) => s.content)].join('\n');
}
