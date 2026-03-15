// === FILE PURPOSE ===
// Relationships section UI for card detail view.
// Allows adding and removing card-to-card relationships (blocks, depends_on, related_to).
// Groups relationships by type with inverse labels for incoming relationships.

// === DEPENDENCIES ===
// react, lucide-react, boardStore (Zustand) for cards, cardDetailStore (Zustand) for
// relationship state, shared types (CardRelationshipType)

import { useState } from 'react';
import { Link2, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useBoardStore } from '../stores/boardStore';
import { useCardDetailStore } from '../stores/cardDetailStore';
import type { CardRelationshipType } from '../../shared/types';
import HudSelect from './HudSelect';

/** Display label for each relationship type (outgoing / incoming) */
const TYPE_LABELS: Record<CardRelationshipType, { outgoing: string; incoming: string }> = {
  blocks: { outgoing: 'Blocks', incoming: 'Blocked by' },
  depends_on: { outgoing: 'Depends on', incoming: 'Depended on by' },
  related_to: { outgoing: 'Related to', incoming: 'Related to' },
};

/** All group keys in display order */
const GROUP_ORDER = ['Blocks', 'Blocked by', 'Depends on', 'Depended on by', 'Related to'] as const;

interface ParsedRelationship {
  id: string;
  groupLabel: string;
  linkedCardTitle: string;
}

interface RelationshipsSectionProps {
  cardId: string;
}

function RelationshipsSection({ cardId }: RelationshipsSectionProps) {
  const allCards = useBoardStore((s) => s.allCards);
  const selectedCardRelationships = useCardDetailStore((s) => s.selectedCardRelationships);
  const addRelationship = useCardDetailStore((s) => s.addRelationship);
  const deleteRelationship = useCardDetailStore((s) => s.deleteRelationship);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [selectedType, setSelectedType] = useState<CardRelationshipType>('related_to');
  const [expanded, setExpanded] = useState(false);

  // --- Parse relationships into display groups ---
  const parsed: ParsedRelationship[] = selectedCardRelationships.map((rel) => {
    const isOutgoing = rel.sourceCardId === cardId;
    const labels = TYPE_LABELS[rel.type];
    const groupLabel = isOutgoing ? labels.outgoing : labels.incoming;
    const linkedCardTitle = isOutgoing
      ? (rel.targetCardTitle ?? 'Unknown card')
      : (rel.sourceCardTitle ?? 'Unknown card');

    return { id: rel.id, groupLabel, linkedCardTitle };
  });

  // Group by label, preserving defined order
  const groups = new Map<string, ParsedRelationship[]>();
  for (const item of parsed) {
    const list = groups.get(item.groupLabel) ?? [];
    list.push(item);
    groups.set(item.groupLabel, list);
  }

  // Filter available cards (exclude self, archived, and already-linked)
  const alreadyLinkedIds = new Set(selectedCardRelationships.flatMap((r) => [r.sourceCardId, r.targetCardId]));
  const availableCards = allCards.filter((c) => c.id !== cardId && !c.archived && !alreadyLinkedIds.has(c.id));

  // --- Handlers ---
  const handleAdd = async () => {
    if (!selectedTargetId) return;
    await addRelationship({
      sourceCardId: cardId,
      targetCardId: selectedTargetId,
      type: selectedType,
    });
    setSelectedTargetId('');
    setSelectedType('related_to');
    setShowAddForm(false);
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-1.5 mb-3">
        <Link2 size={14} className="text-[var(--color-accent-dim)]" />
        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Relationships</span>
        {selectedCardRelationships.length > 0 && (
          <span className="font-data text-xs px-1.5 py-0.5 rounded-full ml-1.5 text-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)]">
            {selectedCardRelationships.length}
          </span>
        )}

        {/* Toggle add form */}
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 ml-auto transition-colors"
        >
          {showAddForm ? 'Cancel' : 'Add Relationship'}
        </button>
      </div>

      {/* Add relationship form */}
      {showAddForm && (
        <div className="hud-panel rounded-lg p-3 mt-2 mb-3">
          <div className="flex items-center gap-2">
            {/* Card picker */}
            <div className="flex-1 min-w-0">
              <HudSelect
                value={selectedTargetId}
                onChange={(v) => setSelectedTargetId(v)}
                placeholder="Select a card..."
                options={[
                  { value: '', label: 'Select a card...' },
                  ...availableCards.map((c) => ({ value: c.id, label: c.title })),
                ]}
              />
            </div>

            {/* Type selector */}
            <HudSelect
              value={selectedType}
              onChange={(v) => setSelectedType(v as CardRelationshipType)}
              compact
              options={[
                { value: 'blocks', label: 'Blocks' },
                { value: 'depends_on', label: 'Depends on' },
                { value: 'related_to', label: 'Related to' },
              ]}
            />

            {/* Add button */}
            <button
              onClick={handleAdd}
              disabled={!selectedTargetId}
              className="text-surface-400 hover:text-surface-800 dark:text-surface-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors p-1"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Grouped relationship list */}
      {parsed.length === 0 ? (
        <p className="text-sm text-surface-500 italic">No relationships</p>
      ) : (
        <div>
          {(() => {
            const COLLAPSED_COUNT = 3;
            let remaining = expanded ? Infinity : COLLAPSED_COUNT;

            return (
              <>
                {GROUP_ORDER.map((groupLabel) => {
                  const items = groups.get(groupLabel);
                  if (!items || items.length === 0 || remaining <= 0) return null;

                  const visibleItems = items.slice(0, remaining);
                  remaining -= visibleItems.length;

                  return (
                    <div key={groupLabel}>
                      <span className="font-hud text-[0.625rem] tracking-widest text-[var(--color-accent-dim)] mt-3 mb-1 block">
                        {groupLabel}
                      </span>
                      {visibleItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-1 group">
                          <span className="text-sm text-surface-800 dark:text-surface-200 truncate">
                            {item.linkedCardTitle}
                          </span>
                          <button
                            onClick={() => deleteRelationship(item.id)}
                            className="text-surface-500 hover:text-surface-700 dark:text-surface-300 opacity-0 group-hover:opacity-100 transition-all p-0.5"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* Expand/collapse toggle */}
                {parsed.length > COLLAPSED_COUNT && (
                  <button
                    onClick={() => setExpanded((prev) => !prev)}
                    className="mt-2 flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp size={12} />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown size={12} />
                        Show all {parsed.length} relationships
                      </>
                    )}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default RelationshipsSection;
