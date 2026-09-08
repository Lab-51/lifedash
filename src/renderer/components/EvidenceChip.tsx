// === FILE PURPOSE ===
// The "where was this said" affordance on a Full-notes decision or commitment
// (BRIEF-EVID.1 Task 5). Exactly three states, and which one shows is decided by
// CODE upstream, never by the model:
//   - anchored (`evidence` present) → an mm:ss chip that jumps to the passage;
//   - quoted but unanchored (`quote` present, `evidence` null) → an "unsupported"
//     badge, because evidenceAnchorService could NOT find that quote in the
//     transcript and a quote nobody said is exactly what this phase exists to
//     surface;
//   - neither → nothing at all, so every pre-BRIEF-EVID.1 brief and every item
//     the model left unquoted looks exactly as it does today.
//
// === DEPENDENCIES ===
// lucide-react (AlertTriangle — the app's established warning glyph, reused
// rather than a new one), ./meeting-detail/utils (formatTimestamp — the same
// mm:ss the transcript column shows), Evidence (TYPE-ONLY: this file is in the
// renderer bundle and must never pull zod in).

import { AlertTriangle } from 'lucide-react';
import { formatTimestamp } from './meeting-detail/utils';
import type { Evidence } from '../../shared/types/briefStructure';

interface EvidenceChipProps {
  /** The transcript anchor CODE stamped on the item, or null when none matched. */
  evidence: Evidence | null;
  /** The verbatim passage the model proposed, or null when it proposed none. */
  quote: string | null;
  /**
   * Jump to the passage. OPTIONAL: a host with no transcript to jump to (the
   * Brain inspector renders the same brief without a transcript tab) omits it,
   * and the chip degrades to a static label rather than an inert button — an
   * affordance that does nothing is worse than none.
   */
  onShowEvidence?: (excerpt: string) => void;
}

/** Muted, small, and shared by both states so a row never gains two visual
 *  vocabularies. `break-words` because the title carries model text. */
const CHIP_BASE = 'ml-1.5 align-middle text-[10px] px-1.5 py-0.5 rounded border break-words';

export default function EvidenceChip({ evidence, quote, onShowEvidence }: EvidenceChipProps) {
  if (evidence) {
    const at = formatTimestamp(evidence.startTime);
    const className = `${CHIP_BASE} font-data border-[var(--color-border)] text-[var(--color-accent-dim)]`;

    if (!onShowEvidence) {
      return (
        <span className={className} title={evidence.excerpt}>
          {at}
        </span>
      );
    }

    return (
      <button
        type="button"
        className={`${className} hover:text-[var(--color-accent)] hover:border-[var(--color-border-accent)] transition-colors`}
        title={evidence.excerpt}
        aria-label={`Show passage at ${at}`}
        onClick={() => onShowEvidence(evidence.excerpt)}
      >
        {at}
      </button>
    );
  }

  if (quote) {
    return (
      <span
        className={`${CHIP_BASE} border-amber-500/30 text-amber-400 inline-flex items-center gap-1`}
        title="The transcript has no passage matching this quote"
      >
        <AlertTriangle size={10} aria-hidden="true" />
        unsupported
      </span>
    );
  }

  return null;
}
