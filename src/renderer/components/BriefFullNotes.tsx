// === FILE PURPOSE ===
// The Brief panel's collapsed "Full notes" disclosure (BRIEF-QUAL.2 Task 2): the
// COMPLETE stored structure, rendered through the same line renderer as the
// brief body itself, one click away from the (possibly incomplete) narrative
// summary. Pure presentation — no state, no store access, no model call; the
// structure is already on the brief row (BRIEF-QUAL.1) and the rendering is
// deterministic (briefRecordText.ts).
//
// === DEPENDENCIES ===
// ../../shared/utils/briefRecordText (structureToText, countsLabel), ./briefLines
// (renderLine), MeetingStructure (TYPE-ONLY — this file must never pull zod into
// the renderer bundle).

import { structureToText, countsLabel } from '../../shared/utils/briefRecordText';
import { renderLine } from './briefLines';
import type { MeetingStructure } from '../../shared/types/briefStructure';

interface BriefFullNotesProps {
  structure: MeetingStructure;
}

/** A native `<details>` disclosure — keyboard-reachable and screen-reader
 *  announced for free, which is exactly why it is used instead of a div+onClick.
 *  Collapsed by default: the complete record sits one click away rather than
 *  crowding out the brief's own narrative summary. Renders nothing when the
 *  structure has nothing to show. */
export default function BriefFullNotes({ structure }: BriefFullNotesProps) {
  const text = structureToText(structure);
  if (text === '') return null;

  return (
    <details className="mt-2">
      <summary className="text-xs text-surface-500 cursor-pointer">Full notes · {countsLabel(structure)}</summary>
      <div className="overflow-hidden break-words">{text.split('\n').map(renderLine)}</div>
    </details>
  );
}
