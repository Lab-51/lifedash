// === FILE PURPOSE ===
// One deterministic, PURE rendering of a meeting's validated structure into the
// same markdown dialect BriefSection's line renderer already understands
// (BRIEF-QUAL.2). The brief's narrative summary may omit a minor topic — that is
// only acceptable because the complete record is one render call away. THREE
// independent consumers share this exact text: the renderer's collapsed "Full
// notes" disclosure, Task 3's twin/entity-fact readers, and Task 4's semantic
// index — so it lives here, in shared, rather than duplicated in any one of them.
//
// === DEPENDENCIES ===
// None at runtime. TYPE-ONLY import of `MeetingStructure` — this file is bundled
// by the renderer and must never pull zod in; parsing (`safeParse`) stays
// main-side in briefStructure.ts.
//
// === LIMITATIONS ===
// - Deliberately dateless and provenance-free: `structure.provenance` (provider,
//   model, passes, extractedAt) is metadata ABOUT the extraction, not part of the
//   record, so it is never read here — the same input must render the same
//   string forever, regardless of who ran the extraction.

import type { MeetingStructure, Topic, Decision, Commitment } from '../types/briefStructure';

function topicLine(topic: Topic): string {
  return topic.detail ? `- ${topic.title} — ${topic.detail}` : `- ${topic.title}`;
}

function decisionLine(decision: Decision): string {
  return decision.rationale ? `- ${decision.statement} — ${decision.rationale}` : `- ${decision.statement}`;
}

/** Owner is rendered only when the transcript named them explicitly — the same
 *  trust flag the brief writer and action-item extraction honor. */
function commitmentLine(commitment: Commitment): string {
  const owner = commitment.explicit && commitment.owner ? commitment.owner : 'unassigned';
  const due = commitment.due ? ` (due ${commitment.due})` : '';
  return `- ${commitment.task} — ${owner}${due}`;
}

/** `null` when `lines` is empty so the caller can drop the section (and its
 *  heading) entirely rather than rendering a heading with nothing under it. */
function section(heading: string, lines: string[]): string | null {
  return lines.length > 0 ? [`### ${heading}`, ...lines].join('\n') : null;
}

/**
 * Render the full structure as markdown, `###` sub-headings so it nests under a
 * `## Full notes` heading in text consumers and under the disclosure in the UI.
 * Sections appear in a fixed order and are omitted entirely when empty; `''`
 * when every section is empty.
 */
export function structureToText(structure: MeetingStructure): string {
  const sections = [
    section('Topics', structure.topics.map(topicLine)),
    section('Decisions', structure.decisions.map(decisionLine)),
    section('Commitments', structure.commitments.map(commitmentLine)),
    section(
      'Open questions',
      structure.openQuestions.map((question) => `- ${question}`),
    ),
    structure.terms.length > 0 ? `### Terms\n${structure.terms.join(', ')}` : null,
  ].filter((rendered): rendered is string => rendered !== null);

  return sections.join('\n\n');
}

function countPart(n: number, singular: string): string | null {
  return n > 0 ? `${n} ${n === 1 ? singular : `${singular}s`}` : null;
}

/**
 * A short UI label — `"{n} topics · {n} decisions · {n} commitments · {n}
 * questions"` with zero-count parts omitted and singular forms for exactly one.
 * `''` when every count is zero. Ignores `terms` by design (they have no count
 * of their own worth surfacing here); used by the "Full notes" disclosure label
 * and nothing else.
 */
export function countsLabel(structure: MeetingStructure): string {
  const parts = [
    countPart(structure.topics.length, 'topic'),
    countPart(structure.decisions.length, 'decision'),
    countPart(structure.commitments.length, 'commitment'),
    countPart(structure.openQuestions.length, 'question'),
  ].filter((part): part is string => part !== null);

  return parts.join(' · ');
}

/**
 * The text every Task 3 reader (twin learning, entity facts, the post-meeting
 * assistant) uses in place of the bare narrative summary. Returns `summary`
 * UNCHANGED — byte-identical, not even trimmed — when there is no structure to
 * append or it renders to nothing; otherwise the summary plus one `## Full
 * notes` heading and the rendered structure.
 */
export function briefRecordText(summary: string, structure: MeetingStructure | null): string {
  if (!structure) return summary;
  const record = structureToText(structure);
  return record === '' ? summary : `${summary.trimEnd()}\n\n## Full notes\n${record}`;
}
