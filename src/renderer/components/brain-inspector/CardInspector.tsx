// === FILE PURPOSE ===
// In-brain Inspector — CARD subview. Renders rich card detail INSIDE the Brain
// panel by REUSING the card-detail sub-sections (no rebuilt views, no new IPC):
// a compact header from the lean `boardStore.allCards` item (title / priority /
// completed / description preview) plus the cardId-driven sub-sections
// (TaskBreakdown / Checklist / Attachments / Relationships / Comments / Activity),
// which self-load via `cardDetailStore.loadCardDetails(cardId)` — exactly the same
// data CardDetailModal shows, minus the modal shell and editors.
//
// === DEPENDENCIES ===
// react, cardDetailStore (loadCardDetails), boardStore (allCards lean item),
// card-detail section components (Checklist/Comments/Relationships/ActivityLog/
// Attachments/TaskBreakdown)

import { useEffect } from 'react';
import { useBoardStore } from '../../stores/boardStore';
import { useCardDetailStore } from '../../stores/cardDetailStore';
import ChecklistSection from '../ChecklistSection';
import CommentsSection from '../CommentsSection';
import RelationshipsSection from '../RelationshipsSection';
import ActivityLog from '../ActivityLog';
import AttachmentsSection from '../AttachmentsSection';
import TaskBreakdownSection from '../TaskBreakdownSection';

const PRIORITY_LABEL: Record<string, { label: string; className: string }> = {
  low: { label: 'LOW', className: 'bg-emerald-500/20 text-emerald-500' },
  medium: { label: 'MED', className: 'bg-blue-500/20 text-blue-500' },
  high: { label: 'HIGH', className: 'bg-amber-500/20 text-amber-500' },
  urgent: { label: 'URG', className: 'bg-red-500/20 text-red-500' },
};

/** Strip TipTap HTML to a plain-text preview for the compact header (safe — no
 *  raw HTML injection; the full rich body lives on the card's own page). Uses the
 *  DOM to decode ALL entities (&amp;/&lt;/&#39;/… not just &nbsp;); parseFromString
 *  never executes scripts, and we render the result as an escaped text node. */
function descriptionPreview(html: string | null): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  }
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

interface CardInspectorProps {
  /** The lean card id (BrainNode.entityId) — drives every sub-section's own load. */
  cardId: string;
  /** Fallback label when the card isn't in the globally-loaded allCards (e.g. it
   *  was archived after the tree was built) — never fabricate a title. */
  fallbackLabel: string;
}

export default function CardInspector({ cardId, fallbackLabel }: CardInspectorProps) {
  const card = useBoardStore((s) => s.allCards.find((c) => c.id === cardId));
  const loadCardDetails = useCardDetailStore((s) => s.loadCardDetails);
  const loading = useCardDetailStore((s) => s.loadingCardDetails);

  // Load comments/relationships/activities/attachments/checklist for this card —
  // the same call CardDetailModal makes; sub-sections read from cardDetailStore.
  // Intentionally does NOT clearCardDetails on unmount: cardDetailStore is a single
  // global slot shared with the board's CardDetailModal, so clearing here could
  // wipe a card the modal is concurrently showing. The next consumer's
  // loadCardDetails flips loadingCardDetails synchronously and fully overwrites the
  // slot, so no stale detail is ever shown.
  useEffect(() => {
    void loadCardDetails(cardId);
  }, [cardId, loadCardDetails]);

  const priority = card ? PRIORITY_LABEL[card.priority] : undefined;
  const preview = descriptionPreview(card?.description ?? null);

  return (
    <div data-testid="brain-inspector-card" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {priority && (
            <span className={`text-[0.625rem] font-bold px-1.5 py-0.5 rounded ${priority.className}`}>
              {priority.label}
            </span>
          )}
          {card?.completed && (
            <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500">
              DONE
            </span>
          )}
        </div>
        <h3
          className={`text-base font-semibold ${
            card?.completed ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {card?.title ?? fallbackLabel}
        </h3>
        {preview && (
          <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">{preview}</p>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-[var(--color-text-muted)] py-6 text-center animate-pulse">Loading details…</div>
      ) : (
        <div className="flex flex-col gap-8">
          {card?.columnId && <TaskBreakdownSection cardId={cardId} columnId={card.columnId} />}
          <ChecklistSection cardId={cardId} />
          <AttachmentsSection cardId={cardId} />
          <RelationshipsSection cardId={cardId} />
          <CommentsSection cardId={cardId} />
          <ActivityLog cardId={cardId} />
        </div>
      )}
    </div>
  );
}
