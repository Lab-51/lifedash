// === FILE PURPOSE ===
// Pure utility functions for card data assembly.
// Extracted for testability — no Electron dependencies.

// === DEPENDENCIES ===
// None — uses only shared types.

// === LIMITATIONS ===
// None known.

// === VERIFICATION STATUS ===
// Covered by unit tests in __tests__/card-utils.test.ts

import type { Label } from '../types';

/**
 * Build a map of cardId -> Label[] from batch-fetched junction and label rows.
 * Used by cards:list-by-board to assemble card-label relationships after batch queries.
 */
export function buildCardLabelMap(
  cardLabelRows: { cardId: string; labelId: string }[],
  allLabels: Label[],
): Map<string, Label[]> {
  const labelMap = new Map(allLabels.map((l) => [l.id, l]));
  const result = new Map<string, Label[]>();
  for (const cl of cardLabelRows) {
    const label = labelMap.get(cl.labelId);
    if (label) {
      const existing = result.get(cl.cardId) ?? [];
      existing.push(label);
      result.set(cl.cardId, existing);
    }
  }
  return result;
}
