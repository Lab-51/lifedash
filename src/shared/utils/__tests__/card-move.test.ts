import { describe, it, expect } from 'vitest';
import { computeCardMove } from '../card-move';
import type { CardSibling } from '../card-move';

// Helper: build a siblings list from ids at sequential positions
function makeSiblings(...ids: string[]): CardSibling[] {
  return ids.map((id, i) => ({ id, position: i }));
}

// Helper: reconstruct the full position array from the original siblings + updates
function reconstructPositions(
  movedCardId: string,
  siblingsInTarget: CardSibling[],
  updates: Array<{ id: string; position: number }>,
): Array<{ id: string; position: number }> {
  // Start with existing siblings (excluding moved card) at their old positions
  const map = new Map<string, number>();
  for (const s of siblingsInTarget) {
    if (s.id !== movedCardId) map.set(s.id, s.position);
  }
  // Apply updates (these override old positions and add the moved card)
  for (const u of updates) {
    map.set(u.id, u.position);
  }
  return Array.from(map.entries())
    .map(([id, position]) => ({ id, position }))
    .sort((a, b) => a.position - b.position);
}

describe('computeCardMove', () => {
  // ─── Basic scenarios ──────────────────────────────────────────────

  describe('basic scenarios', () => {
    it('moves card to position 0 (beginning) in a column with existing cards', () => {
      const siblings = makeSiblings('a', 'b', 'c');
      const result = computeCardMove('x', 0, siblings);

      expect(result.clampedPosition).toBe(0);
      // 'x' at 0, 'a' shifts to 1, 'b' shifts to 2, 'c' shifts to 3
      expect(result.updates).toContainEqual({ id: 'x', position: 0 });
      expect(result.updates).toContainEqual({ id: 'a', position: 1 });
      expect(result.updates).toContainEqual({ id: 'b', position: 2 });
      expect(result.updates).toContainEqual({ id: 'c', position: 3 });
    });

    it('moves card to last position in a column', () => {
      const siblings = makeSiblings('a', 'b', 'c');
      const result = computeCardMove('x', 3, siblings);

      expect(result.clampedPosition).toBe(3);
      expect(result.updates).toContainEqual({ id: 'x', position: 3 });
      // Existing cards stay at 0, 1, 2 — no shifts needed
      expect(result.updates).toHaveLength(1);
    });

    it('moves card to middle position', () => {
      const siblings = makeSiblings('a', 'b', 'c');
      const result = computeCardMove('x', 1, siblings);

      expect(result.clampedPosition).toBe(1);
      expect(result.updates).toContainEqual({ id: 'x', position: 1 });
      expect(result.updates).toContainEqual({ id: 'b', position: 2 });
      expect(result.updates).toContainEqual({ id: 'c', position: 3 });
      // 'a' stays at 0
      expect(result.updates.find((u) => u.id === 'a')).toBeUndefined();
    });

    it('moves card to empty column (no siblings)', () => {
      const result = computeCardMove('x', 0, []);

      expect(result.clampedPosition).toBe(0);
      expect(result.updates).toEqual([{ id: 'x', position: 0 }]);
    });
  });

  // ─── Same-column reorder ──────────────────────────────────────────

  describe('same-column reorder', () => {
    it('moves card forward from position 0 to position 2', () => {
      // Card 'a' is at 0 in siblings, moving it to position 2
      const siblings = makeSiblings('a', 'b', 'c', 'd');
      const result = computeCardMove('a', 2, siblings);

      expect(result.clampedPosition).toBe(2);
      // After removing 'a': [b=0, c=1, d=2]
      // Insert 'a' at 2: [b, c, a, d]
      expect(result.updates).toContainEqual({ id: 'a', position: 2 });
      expect(result.updates).toContainEqual({ id: 'b', position: 0 });
      expect(result.updates).toContainEqual({ id: 'c', position: 1 });
      // 'd' moves from 3 to 3 — but it was at position 3 originally and is now at 3? Let's check.
      // filtered = [b=1, c=2, d=3], reordered = [b, c, a, d]
      // b: was 1, now 0 → update. c: was 2, now 1 → update. a: always updated. d: was 3, now 3 → no update.
      expect(result.updates.find((u) => u.id === 'd')).toBeUndefined();
    });

    it('moves card backward from position 3 to position 1', () => {
      const siblings = makeSiblings('a', 'b', 'c', 'd');
      const result = computeCardMove('d', 1, siblings);

      expect(result.clampedPosition).toBe(1);
      // After removing 'd': [a=0, b=1, c=2]
      // Insert 'd' at 1: [a, d, b, c]
      expect(result.updates).toContainEqual({ id: 'd', position: 1 });
      expect(result.updates).toContainEqual({ id: 'b', position: 2 });
      expect(result.updates).toContainEqual({ id: 'c', position: 3 });
      // 'a' stays at 0
      expect(result.updates.find((u) => u.id === 'a')).toBeUndefined();
    });

    it('handles move to current position (always includes moved card)', () => {
      const siblings = makeSiblings('a', 'b', 'c');
      // 'b' is at position 1, move to position 1
      const result = computeCardMove('b', 1, siblings);

      expect(result.clampedPosition).toBe(1);
      // 'b' internal position is -1 so it always appears in updates
      expect(result.updates).toContainEqual({ id: 'b', position: 1 });
      // No other card shifts
      expect(result.updates).toHaveLength(1);
    });
  });

  // ─── Cross-column move ────────────────────────────────────────────

  describe('cross-column move', () => {
    it('inserts card not in siblings list at requested position', () => {
      const siblings = makeSiblings('a', 'b', 'c');
      const result = computeCardMove('x', 1, siblings);

      expect(result.clampedPosition).toBe(1);
      expect(result.updates).toContainEqual({ id: 'x', position: 1 });
    });

    it('renumbers siblings starting from 0 after insertion', () => {
      const siblings = makeSiblings('a', 'b', 'c');
      const result = computeCardMove('x', 0, siblings);

      const allPositions = reconstructPositions('x', siblings, result.updates);
      const positionValues = allPositions.map((p) => p.position);
      expect(positionValues).toEqual([0, 1, 2, 3]);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('clamps negative position to 0', () => {
      const siblings = makeSiblings('a', 'b');
      const result = computeCardMove('x', -1, siblings);

      expect(result.clampedPosition).toBe(0);
      expect(result.updates).toContainEqual({ id: 'x', position: 0 });
    });

    it('clamps oversized position to end', () => {
      const siblings = makeSiblings('a', 'b');
      const result = computeCardMove('x', 999, siblings);

      expect(result.clampedPosition).toBe(2);
      expect(result.updates).toContainEqual({ id: 'x', position: 2 });
    });

    it('handles single card in column, moved to position 0', () => {
      const siblings = makeSiblings('a');
      const result = computeCardMove('a', 0, siblings);

      expect(result.clampedPosition).toBe(0);
      expect(result.updates).toEqual([{ id: 'a', position: 0 }]);
    });

    it('only moved card appears in updates when no siblings shift', () => {
      // Move 'x' to the end — no existing card changes position
      const siblings = makeSiblings('a', 'b');
      const result = computeCardMove('x', 2, siblings);

      expect(result.updates).toHaveLength(1);
      expect(result.updates[0]).toEqual({ id: 'x', position: 2 });
    });
  });

  // ─── Position correctness invariants ──────────────────────────────

  describe('position correctness invariants', () => {
    const scenarios: Array<{
      name: string;
      movedCardId: string;
      targetPosition: number;
      siblings: CardSibling[];
    }> = [
      {
        name: 'cross-column to beginning',
        movedCardId: 'x',
        targetPosition: 0,
        siblings: makeSiblings('a', 'b', 'c'),
      },
      {
        name: 'cross-column to middle',
        movedCardId: 'x',
        targetPosition: 2,
        siblings: makeSiblings('a', 'b', 'c'),
      },
      {
        name: 'cross-column to end',
        movedCardId: 'x',
        targetPosition: 3,
        siblings: makeSiblings('a', 'b', 'c'),
      },
      {
        name: 'same-column forward',
        movedCardId: 'a',
        targetPosition: 2,
        siblings: makeSiblings('a', 'b', 'c'),
      },
      {
        name: 'same-column backward',
        movedCardId: 'c',
        targetPosition: 0,
        siblings: makeSiblings('a', 'b', 'c'),
      },
      {
        name: 'empty column',
        movedCardId: 'x',
        targetPosition: 0,
        siblings: [],
      },
      {
        name: 'clamped negative',
        movedCardId: 'x',
        targetPosition: -5,
        siblings: makeSiblings('a', 'b'),
      },
      {
        name: 'clamped oversized',
        movedCardId: 'x',
        targetPosition: 100,
        siblings: makeSiblings('a', 'b'),
      },
    ];

    for (const s of scenarios) {
      it(`forms contiguous 0..N-1 sequence: ${s.name}`, () => {
        const result = computeCardMove(s.movedCardId, s.targetPosition, s.siblings);
        const all = reconstructPositions(s.movedCardId, s.siblings, result.updates);
        const positions = all.map((p) => p.position).sort((a, b) => a - b);
        const expected = Array.from({ length: all.length }, (_, i) => i);
        expect(positions).toEqual(expected);
      });
    }

    it('updates array only includes cards whose position changed (plus moved card)', () => {
      const siblings = makeSiblings('a', 'b', 'c', 'd', 'e');
      // Move 'x' to position 3 — a, b, c stay at 0, 1, 2; d shifts to 4, e shifts to 5
      const result = computeCardMove('x', 3, siblings);

      for (const update of result.updates) {
        if (update.id === 'x') continue; // moved card is always included
        const original = siblings.find((s) => s.id === update.id);
        expect(original).toBeDefined();
        expect(update.position).not.toBe(original!.position);
      }
    });
  });
});
