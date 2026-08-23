// === FILE PURPOSE ===
// The meeting STRUCTURE contract (BRIEF-QUAL.1): the validated, complete,
// owner-honest extraction a transcript is turned into before any brief is
// written. One schema for every model tier — gpt-5-mini and a 4B local model at
// 16k answer with the same JSON, so there is exactly one parser to be wrong.
//
// Shape notes, all deliberate:
//   - FLAT and STRING-TYPED. Small models fail on nested objects, enums and real
//     date types; `due` is whatever the transcript said ("Friday", "end of Q3"),
//     not an ISO date, because normalizing it here would mean guessing.
//   - `explicit` is the owner-trust flag: true ONLY when the transcript names the
//     person responsible. The brief writer and action-item extraction treat
//     `owner` as trustworthy ONLY when `explicit` is true — that is the whole
//     defence against a model attributing a task to whoever spoke last.
//   - The MODEL is asked for everything EXCEPT provenance: it cannot know which
//     provider ran it or how many passes it took. The service stamps that.
//
// === DEPENDENCIES ===
// zod (already a project dependency; used across main for validation).
//
// === LIMITATIONS ===
// - Deliberately NOT re-exported from src/shared/types/index.ts: that barrel is
//   imported by renderer code, and adding a zod-importing module to it would pull
//   zod into the renderer bundle for no benefit. Import this file directly.

import { z } from 'zod';

/** Bumped when the persisted structure's shape changes incompatibly. Stamped into
 *  every structure so a later reader can tell what it is looking at. */
export const BRIEF_STRUCTURE_SCHEMA_VERSION = 1;

/** Trim, then treat a blank string as absent. Small models answer "unknown" fields
 *  with `""` about as often as with `null`; both must mean "not stated", never a
 *  commitment with an empty-string owner that later renders as a real one. */
const nullableText = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  });

/** Lenient boolean: `true` / `"true"` / `"yes"` are true, EVERYTHING else — including
 *  a missing field — is false. Biased to false on purpose: false means "do not trust
 *  this owner", so a model that fumbles the flag loses attribution rather than
 *  inventing it. */
const lenientBoolean = z
  .union([z.boolean(), z.string(), z.null()])
  .optional()
  .transform((value) => value === true || (typeof value === 'string' && /^(true|yes)$/i.test(value)));

/** A list of free-text lines, blanks dropped. Absent list -> []. Lenient because a
 *  stray `""` in `terms` must not invalidate an otherwise perfect extraction. */
const textList = z
  .array(z.string())
  .nullish()
  .transform((list) => (list ?? []).map((item) => item.trim()).filter((item) => item.length > 0));

/** `[]` for a missing OR null list — `.default()` alone would let an explicit
 *  `"topics": null` through as null. Absent sections are normal output, not errors. */
function nullishList<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(item)
    .nullish()
    .transform((list) => list ?? []);
}

/** One thing the meeting was actually about. `detail` carries the WHY and any
 *  conditions — it is the field that makes a brief useful rather than a title list. */
export const TopicSchema = z.object({
  title: z.string().trim().min(1),
  detail: z
    .string()
    .nullish()
    .transform((value) => value?.trim() ?? ''),
});

export const DecisionSchema = z.object({
  statement: z.string().trim().min(1),
  rationale: nullableText,
});

/** `task` is the one strictly required field in the whole schema: a commitment
 *  without a task is not a commitment. Owner/due stay optional by design. */
export const CommitmentSchema = z.object({
  owner: nullableText,
  task: z.string().trim().min(1),
  due: nullableText,
  explicit: lenientBoolean,
});

/** Stamped by the service, never asked of the model. */
export const ProvenanceSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** Number of extraction passes = number of transcript parts (1 when it fit). */
  passes: z.number().int().positive(),
  extractedAt: z.string(),
  schemaVersion: z.literal(BRIEF_STRUCTURE_SCHEMA_VERSION),
});

/** What the MODEL is asked to return. Lenient where it is safe (missing arrays ->
 *  [], missing rationale/due -> null, missing explicit -> false) and strict where
 *  it matters (a topic needs a title, a decision a statement, a commitment a task),
 *  so a retry is spent on output that is genuinely unusable, never on a model that
 *  merely omitted an empty section. */
export const MeetingStructureDraftSchema = z.object({
  topics: nullishList(TopicSchema),
  decisions: nullishList(DecisionSchema),
  commitments: nullishList(CommitmentSchema),
  openQuestions: textList,
  terms: textList,
});

/** The persisted shape: a draft plus the provenance the service stamps. */
export const MeetingStructureSchema = MeetingStructureDraftSchema.extend({
  provenance: ProvenanceSchema,
});

export type Topic = z.infer<typeof TopicSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type StructureProvenance = z.infer<typeof ProvenanceSchema>;
export type MeetingStructureDraft = z.infer<typeof MeetingStructureDraftSchema>;
export type MeetingStructure = z.infer<typeof MeetingStructureSchema>;
