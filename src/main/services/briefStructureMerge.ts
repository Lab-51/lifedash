// === FILE PURPOSE ===
// The DETERMINISTIC merge of per-part extraction drafts (BRIEF-QUAL.1). Split out
// of briefExtractionService.ts to keep that file under the 500-line ceiling, and
// because this is the one piece of the pipeline with no I/O at all: pure, total,
// and the thing that guarantees "nothing is lost across parts".
//
// A merge CALL to the model was rejected by design — it would re-introduce the
// compression step this phase exists to remove, and AI-CTX.1 (e) forbids partial
// results. Code cannot drop anything; a model can.
//
// === DEPENDENCIES ===
// shared/types/briefStructure.ts (the draft shape only — no services, no I/O).

import type { MeetingStructureDraft } from '../../shared/types/briefStructure';

/** Match key for dedup across part boundaries: case-, whitespace- and
 *  trailing-punctuation-insensitive. Nothing stronger — two genuinely different
 *  items must never collide, since the merge cannot un-drop anything. */
function normalizeKey(text: string): string {
  return text
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

/**
 * Concatenate the parts in order, then dedupe each section. Pure and total: every
 * distinct item from every part survives, and a duplicate keeps the richer of the
 * two (longer detail, a rationale/due the other lacked, explicit ownership).
 */
export function mergeDrafts(drafts: MeetingStructureDraft[]): MeetingStructureDraft {
  return {
    topics: dedupe(
      drafts.flatMap((d) => d.topics),
      (topic) => normalizeKey(topic.title),
      (kept, dup) => (dup.detail.length > kept.detail.length ? { ...kept, detail: dup.detail } : kept),
    ),
    decisions: dedupe(
      drafts.flatMap((d) => d.decisions),
      (decision) => normalizeKey(decision.statement),
      (kept, dup) => ({ ...kept, rationale: kept.rationale ?? dup.rationale }),
    ),
    commitments: dedupe(
      drafts.flatMap((d) => d.commitments),
      (commitment) => `${normalizeKey(commitment.owner ?? '')}|${normalizeKey(commitment.task)}`,
      (kept, dup) => ({
        ...kept,
        owner: kept.owner ?? dup.owner,
        due: kept.due ?? dup.due,
        explicit: kept.explicit || dup.explicit,
      }),
    ),
    openQuestions: dedupe(
      drafts.flatMap((d) => d.openQuestions),
      normalizeKey,
      (kept) => kept,
    ),
    terms: dedupe(
      drafts.flatMap((d) => d.terms),
      normalizeKey,
      (kept) => kept,
    ),
  };
}
