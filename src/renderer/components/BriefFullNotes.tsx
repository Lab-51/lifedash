// === FILE PURPOSE ===
// The Brief panel's collapsed "Full notes" disclosure (BRIEF-QUAL.2 Task 2): the
// COMPLETE stored structure, rendered through the same line renderer as the
// brief body itself, one click away from the (possibly incomplete) narrative
// summary. Pure presentation — no state, no store access, no model call; the
// structure is already on the brief row (BRIEF-QUAL.1) and the rendering is
// deterministic (briefRecordText.ts).
//
// BRIEF-EVID.1 Task 5: decisions and commitments are no longer plain lines —
// each is a ROW carrying its status label and its evidence chip. The LINE TEXT
// still comes from briefRecordText's own `decisionLine`/`commitmentLine`, and
// `structureToText` is NOT changed: its text feeds the twin/entity readers and
// the semantic index, and none of them may ever ingest a chip. The section
// order and the omit-when-empty rule below therefore MIRROR structureToText, and
// a test pins the rendered lines against it so the two cannot drift.
//
// === DEPENDENCIES ===
// ../../shared/utils/briefRecordText (structureToText, countsLabel and the three
// per-line renderers), ./briefLines (renderLine), ./EvidenceChip, MeetingStructure
// (TYPE-ONLY — this file must never pull zod into the renderer bundle).

import type { ReactNode } from 'react';
import {
  structureToText,
  countsLabel,
  topicLine,
  decisionLine,
  commitmentLine,
} from '../../shared/utils/briefRecordText';
import { renderLine } from './briefLines';
import EvidenceChip from './EvidenceChip';
import type { Commitment, Decision, DecisionStatus, MeetingStructure } from '../../shared/types/briefStructure';

interface BriefFullNotesProps {
  structure: MeetingStructure;
  /** Jump to the transcript passage behind an anchored item. Optional — see
   *  EvidenceChip: a host without a transcript surface simply omits it. */
  onShowEvidence?: (excerpt: string) => void;
}

/**
 * One decision or commitment: the same bullet line the record renders, plus what
 * only the UI may show — how settled it is, and where it was said.
 *
 * `status` is absent on a raw v1 object (nothing marked it), so a legacy record
 * shows NO label; a v1 structure that went through the parser reads 'proposed',
 * which is the honest default the schema documents — nothing in a v1 record ever
 * said "agreed".
 *
 * Markup is byte-identical to briefLines' `- ` branch (bullet span + text) so a
 * row still reads as part of the same list, with `break-words` because both the
 * line and the chip title carry model-written text.
 */
function NoteRow({
  line,
  status,
  quote,
  evidence,
  onShowEvidence,
}: {
  line: string;
  status?: DecisionStatus;
  quote: string | null;
  evidence: Decision['evidence'];
  onShowEvidence?: (excerpt: string) => void;
}) {
  return (
    <p className="ml-4 text-surface-700 dark:text-surface-300 text-sm break-words">
      <span className="mr-1.5">&bull;</span>
      {line.slice(2)}
      {status && (
        <span className="ml-1.5 align-middle text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">
          {status}
        </span>
      )}
      <EvidenceChip evidence={evidence} quote={quote} onShowEvidence={onShowEvidence} />
    </p>
  );
}

/** A native `<details>` disclosure — keyboard-reachable and screen-reader
 *  announced for free, which is exactly why it is used instead of a div+onClick.
 *  Collapsed by default: the complete record sits one click away rather than
 *  crowding out the brief's own narrative summary. Renders nothing when the
 *  structure has nothing to show. */
export default function BriefFullNotes({ structure, onShowEvidence }: BriefFullNotesProps) {
  // The same emptiness gate as before, asked of the pure renderer rather than
  // recomputed here — an all-empty structure still renders nothing at all.
  if (structureToText(structure) === '') return null;

  // One flat list so every key is unique; `nodes.length` is the running index
  // renderLine already uses as its key.
  const nodes: ReactNode[] = [];
  const line = (text: string) => nodes.push(renderLine(text, nodes.length));
  const row = (text: string, item: Decision | Commitment, status?: DecisionStatus) =>
    nodes.push(
      <NoteRow
        key={nodes.length}
        line={text}
        status={status}
        quote={item.quote}
        evidence={item.evidence}
        onShowEvidence={onShowEvidence}
      />,
    );

  if (structure.topics.length > 0) {
    line('### Topics');
    structure.topics.forEach((topic) => line(topicLine(topic)));
  }
  if (structure.decisions.length > 0) {
    line('### Decisions');
    structure.decisions.forEach((decision) => row(decisionLine(decision), decision, decision.status));
  }
  if (structure.commitments.length > 0) {
    line('### Commitments');
    structure.commitments.forEach((commitment) => row(commitmentLine(commitment), commitment));
  }
  if (structure.openQuestions.length > 0) {
    line('### Open questions');
    structure.openQuestions.forEach((question) => line(`- ${question}`));
  }
  if (structure.terms.length > 0) {
    line('### Terms');
    line(structure.terms.join(', '));
  }

  return (
    <details className="mt-2">
      <summary className="text-xs text-surface-500 cursor-pointer">Full notes · {countsLabel(structure)}</summary>
      <div className="overflow-hidden break-words">{nodes}</div>
    </details>
  );
}
