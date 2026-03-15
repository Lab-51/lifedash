// === FILE PURPOSE ===
// Pure card-move reordering logic — computes new positions after moving a card.
// No DB access; takes siblings list, returns update instructions.

export interface CardSibling {
  id: string;
  position: number;
}

export interface MoveResult {
  /** The clamped position the card ended up at */
  clampedPosition: number;
  /** Updates to apply: [cardId, newPosition][] — includes moved card */
  updates: Array<{ id: string; position: number }>;
}

/**
 * Compute the new positions after moving a card to a target position.
 * Pure function — no side effects, no DB access.
 *
 * @param movedCardId - The ID of the card being moved
 * @param targetPosition - The requested position in the target column
 * @param siblingsInTarget - All non-archived cards currently in the target column (sorted by position)
 */
export function computeCardMove(
  movedCardId: string,
  targetPosition: number,
  siblingsInTarget: CardSibling[],
): MoveResult {
  // Remove the moved card from siblings (may already be in column for same-column reorder)
  const filtered = siblingsInTarget.filter((c) => c.id !== movedCardId);

  // Clamp position to valid range
  const clampedPosition = Math.max(0, Math.min(targetPosition, filtered.length));

  // Insert at clamped position
  const reordered = [...filtered];
  reordered.splice(clampedPosition, 0, { id: movedCardId, position: -1 });

  // Compute updates — only cards whose position actually changed
  const updates: MoveResult['updates'] = [];
  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].id === movedCardId || reordered[i].position !== i) {
      updates.push({ id: reordered[i].id, position: i });
    }
  }

  return { clampedPosition, updates };
}
