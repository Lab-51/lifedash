import { describe, it, expect } from 'vitest';
import { buildCardLabelMap } from '../card-utils';
import type { Label } from '../../types';

function makeLabel(id: string, name: string): Label {
  return {
    id,
    projectId: 'p1',
    name,
    color: '#000',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('buildCardLabelMap', () => {
  it('returns empty map for empty inputs', () => {
    const result = buildCardLabelMap([], []);
    expect(result.size).toBe(0);
  });

  it('maps labels to correct cards', () => {
    const labels = [makeLabel('l1', 'Bug'), makeLabel('l2', 'Feature')];
    const junctions = [
      { cardId: 'c1', labelId: 'l1' },
      { cardId: 'c2', labelId: 'l2' },
    ];
    const result = buildCardLabelMap(junctions, labels);
    expect(result.get('c1')).toEqual([labels[0]]);
    expect(result.get('c2')).toEqual([labels[1]]);
  });

  it('handles cards with no labels', () => {
    const labels = [makeLabel('l1', 'Bug')];
    const junctions = [{ cardId: 'c1', labelId: 'l1' }];
    const result = buildCardLabelMap(junctions, labels);
    expect(result.has('c2')).toBe(false);
  });

  it('handles multiple labels per card', () => {
    const labels = [
      makeLabel('l1', 'Bug'),
      makeLabel('l2', 'Feature'),
      makeLabel('l3', 'Urgent'),
    ];
    const junctions = [
      { cardId: 'c1', labelId: 'l1' },
      { cardId: 'c1', labelId: 'l2' },
      { cardId: 'c1', labelId: 'l3' },
    ];
    const result = buildCardLabelMap(junctions, labels);
    expect(result.get('c1')).toHaveLength(3);
    expect(result.get('c1')).toEqual(labels);
  });

  it('handles labels shared across multiple cards', () => {
    const labels = [makeLabel('l1', 'Bug')];
    const junctions = [
      { cardId: 'c1', labelId: 'l1' },
      { cardId: 'c2', labelId: 'l1' },
    ];
    const result = buildCardLabelMap(junctions, labels);
    expect(result.get('c1')).toEqual([labels[0]]);
    expect(result.get('c2')).toEqual([labels[0]]);
  });

  it('skips junction rows with missing label IDs', () => {
    const labels = [makeLabel('l1', 'Bug')];
    const junctions = [
      { cardId: 'c1', labelId: 'l1' },
      { cardId: 'c1', labelId: 'l-nonexistent' },
    ];
    const result = buildCardLabelMap(junctions, labels);
    expect(result.get('c1')).toHaveLength(1);
    expect(result.get('c1')).toEqual([labels[0]]);
  });
});
