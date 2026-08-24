// === FILE PURPOSE ===
// The DETERMINISTIC merge of per-part extraction drafts (BRIEF-QUAL.1): the one I/O-free stage that
// guarantees nothing is lost across parts. A merge CALL to the model was rejected by design — code
// cannot drop anything, a model can (AI-CTX.1 (e) forbids partial results).
//
// LOCAL-QUAL.1 adds a second, CONTAINMENT pass for cross-part paraphrases the exact-key pass cannot
// see — still BY RULE (SPEC §813), never a model call. THE ASYMMETRY BEHIND EVERY GUARD BELOW: a false
// merge LOSES content and silently deletes a real action-item card (`structure.commitments` feeds
// those with no model call to notice); a missed merge only leaves a duplicate. When in doubt, keep both.
//
// === DEPENDENCIES ===
// shared/types/briefStructure.ts (the draft shape only — no services, no I/O).

import type { Commitment, Decision, MeetingStructureDraft, Topic } from '../../shared/types/briefStructure';

// Combining-diacritical-marks block, from character codes so the source stays ASCII.
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

/** Match key for dedup across part boundaries: case-, whitespace-, diacritic- and
 *  trailing-punctuation-insensitive. Nothing stronger — two genuinely different
 *  items must never collide. The ONE normalizer both passes below share. */
function normalizeKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '')
    .trim();
}

/** Dedupe preserving FIRST-SEEN order (Map re-set keeps the original position),
 *  combining collisions with `merge` so a duplicate can only ADD information. */
function dedupe<T>(items: T[], keyOf: (item: T) => string, merge: (kept: T, dup: T) => T): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const kept = byKey.get(key);
    byKey.set(key, kept === undefined ? item : merge(kept, item));
  }
  return [...byKey.values()];
}

// A subset must carry at least this many of its own words to collapse into a richer item — the guard
// against a short fragment ("the schema") looking "contained in" nearly everything.
const MIN_CONTAINMENT_TOKENS = 4;

/** `small`'s tokens are ALL present in `big`, order-agnostic — never true under
 *  the guard above. */
function isSubsetOf(small: Set<string>, big: Set<string>): boolean {
  if (small.size < MIN_CONTAINMENT_TOKENS) return false;
  for (const token of small) if (!big.has(token)) return false;
  return true;
}

/** `normalizeKey`'s own output, split into words — no second normalizer. */
const tokenize = (text: string): Set<string> => new Set(normalizeKey(text).split(' ').filter(Boolean));

/** Second pass, per section: collapse a re-stated PARAPHRASE the exact-key pass cannot see, when one
 *  item's whole token set is contained in another's. The RICHER (superset) wording survives, at
 *  whichever position was seen FIRST. Strict containment only — no similarity score, no model call. */
function collapseContainment<T>(
  items: T[],
  textOf: (item: T) => string,
  merge: (kept: T, dup: T) => T,
  sameGroup: (a: T, b: T) => boolean = () => true,
): T[] {
  const survivors: T[] = [];
  const tokensOf: Set<string>[] = [];
  for (const item of items) {
    const tokens = tokenize(textOf(item));
    const matchIndex = survivors.findIndex(
      (candidate, i) =>
        sameGroup(item, candidate) && (isSubsetOf(tokens, tokensOf[i]) || isSubsetOf(tokensOf[i], tokens)),
    );
    if (matchIndex === -1) {
      survivors.push(item);
      tokensOf.push(tokens);
      continue;
    }
    const richer = tokens.size > tokensOf[matchIndex].size;
    survivors[matchIndex] = richer ? merge(item, survivors[matchIndex]) : merge(survivors[matchIndex], item);
    if (richer) tokensOf[matchIndex] = tokens;
  }
  return survivors;
}

interface SectionSpec<T> {
  textOf: (item: T) => string;
  merge: (kept: T, dup: T) => T;
  keyOf?: (item: T) => string; // exact-key pass key; defaults to normalizeKey(textOf(item))
  sameGroup?: (a: T, b: T) => boolean; // containment-pass grouping guard; unscoped unless given
}

/** One section, both passes: exact-key dedupe, then the containment collapse. */
function mergeSection<T>(items: T[], spec: SectionSpec<T>): T[] {
  const keyOf = spec.keyOf ?? ((item: T) => normalizeKey(spec.textOf(item)));
  const deduped = dedupe(items, keyOf, spec.merge);
  return collapseContainment(deduped, spec.textOf, spec.merge, spec.sameGroup);
}

// Per-section identity + merge rules (`terms` has none: a glossary entry is a label, not a sentence).
const topicText = (topic: Topic) => topic.title;
const mergeTopic = (kept: Topic, dup: Topic): Topic =>
  dup.detail.length > kept.detail.length ? { ...kept, detail: dup.detail } : kept;

const decisionText = (decision: Decision) => decision.statement;
const mergeDecision = (kept: Decision, dup: Decision): Decision => ({
  ...kept,
  rationale: kept.rationale ?? dup.rationale,
});

const commitmentText = (commitment: Commitment) => commitment.task;
const commitmentKey = (c: Commitment) => `${normalizeKey(c.owner ?? '')}|${normalizeKey(commitmentText(c))}`;
const mergeCommitment = (kept: Commitment, dup: Commitment): Commitment => ({
  ...kept,
  owner: kept.owner ?? dup.owner,
  due: kept.due ?? dup.due,
  explicit: kept.explicit || dup.explicit,
});
// Commitments collapse ONLY within the same owner, even for an identical task.
const sameOwner = (a: Commitment, b: Commitment): boolean =>
  normalizeKey(a.owner ?? '') === normalizeKey(b.owner ?? '');

const questionText = (question: string) => question;
const keepFirst = <T>(kept: T): T => kept;

// Concatenate the parts in order, dedupe each section by exact key, then collapse contained
// paraphrases. A duplicate — exact or contained — keeps the richer of the two (longer detail, a
// rationale/due the other lacked, explicit ownership); every distinct item from every part survives.
export function mergeDrafts(drafts: MeetingStructureDraft[]): MeetingStructureDraft {
  const allTopics = drafts.flatMap((d) => d.topics);
  const allDecisions = drafts.flatMap((d) => d.decisions);
  const allCommitments = drafts.flatMap((d) => d.commitments);
  const allQuestions = drafts.flatMap((d) => d.openQuestions);
  const allTerms = drafts.flatMap((d) => d.terms);
  return {
    topics: mergeSection(allTopics, { textOf: topicText, merge: mergeTopic }),
    decisions: mergeSection(allDecisions, { textOf: decisionText, merge: mergeDecision }),
    commitments: mergeSection(allCommitments, {
      textOf: commitmentText,
      merge: mergeCommitment,
      keyOf: commitmentKey,
      sameGroup: sameOwner,
    }),
    openQuestions: mergeSection(allQuestions, { textOf: questionText, merge: keepFirst }),
    terms: dedupe(allTerms, normalizeKey, keepFirst),
  };
}
