// === FILE PURPOSE ===
// Proves each suspectDetector.ts rule fires and does not fire, in both
// directions, with invented Czech/English content (TRANS-COV.1 Task 3). No
// real meeting content anywhere in this file.

import { describe, it, expect } from 'vitest';
import { detectSuspectSpans, type SuspectSegmentInput } from '../suspectDetector';

function seg(id: string, startTime: number, endTime: number, content: string): SuspectSegmentInput {
  return { id, startTime, endTime, content, speaker: null };
}

describe('detectSuspectSpans', () => {
  it('returns no spans for an empty transcript', () => {
    expect(detectSuspectSpans([])).toEqual([]);
  });

  describe('repetition', () => {
    it('flags a short phrase repeated 4 times in a row inside one segment', () => {
      const spans = detectSuspectSpans([seg('a', 0, 1000, 'Konec. Konec. Konec. Konec.')]);
      expect(spans).toHaveLength(1);
      expect(spans[0].reasons).toEqual(['repetition']);
    });

    it('does not flag ordinary Czech speech with no repeated phrase', () => {
      expect(detectSuspectSpans([seg('a', 0, 1000, 'Konec. Dobře, pokračujeme.')])).toEqual([]);
    });

    it('flags three identical consecutive segments even though each is short', () => {
      const segments = [seg('a', 0, 100, 'Ano.'), seg('b', 100, 200, 'Ano.'), seg('c', 200, 300, 'Ano.')];
      const spans = detectSuspectSpans(segments);
      expect(spans).toEqual([{ startMs: 0, endMs: 300, segmentIds: ['a', 'b', 'c'], reasons: ['repetition'] }]);
    });

    it('does not flag two identical consecutive segments (below the 3-in-a-row floor)', () => {
      expect(detectSuspectSpans([seg('a', 0, 100, 'Ano.'), seg('b', 100, 200, 'Ano.')])).toEqual([]);
    });
  });

  describe('duplicate', () => {
    it('does not flag two adjacent segments that only share a 2-token overlap echo', () => {
      const segments = [
        seg('a', 0, 1000, 'we agreed to hit the deadline'),
        seg('b', 1000, 2000, 'the deadline is next friday for design'),
      ];
      expect(detectSuspectSpans(segments)).toEqual([]);
    });

    it('does not flag a short segment fully contained in its neighbor, below the 6-token floor', () => {
      const segments = [
        seg('a', 0, 1000, 'so basically we agreed to move the deadline to next friday for the whole team'),
        seg('b', 1000, 2000, 'the deadline'),
      ];
      expect(detectSuspectSpans(segments)).toEqual([]);
    });

    it('flags two adjacent 8-token identical segments', () => {
      const content = 'we should probably revisit this decision next week';
      const segments = [seg('a', 0, 1000, content), seg('b', 1000, 2000, content)];
      const spans = detectSuspectSpans(segments);
      expect(spans).toEqual([{ startMs: 0, endMs: 2000, segmentIds: ['a', 'b'], reasons: ['duplicate'] }]);
    });

    it('flags an 8-token segment fully contained in a longer adjacent neighbor', () => {
      const segments = [
        seg('a', 0, 1000, 'so we should probably revisit this decision next week before Friday'),
        seg('b', 1000, 2000, 'we should probably revisit this decision next week'),
      ];
      const spans = detectSuspectSpans(segments);
      expect(spans).toHaveLength(1);
      expect(spans[0].reasons).toEqual(['duplicate']);
    });
  });

  describe('garbled', () => {
    it('flags a low-letters-to-characters segment of digits and punctuation', () => {
      const spans = detectSuspectSpans([seg('a', 0, 1000, '0123456789!@#$%^&*()'.repeat(2))]);
      expect(spans).toHaveLength(1);
      expect(spans[0].reasons).toEqual(['garbled']);
    });

    it('does not flag a normal Czech sentence with háčky and čárky', () => {
      expect(
        detectSuspectSpans([seg('a', 0, 1000, 'Musíme si ještě promluvit o rozpočtu na příští čtvrtletí.')]),
      ).toEqual([]);
    });

    it('does not flag "strč prst skrz krk" (syllabic r, no conventional vowels)', () => {
      expect(detectSuspectSpans([seg('a', 0, 1000, 'strč prst skrz krk')])).toEqual([]);
    });

    it('does not flag longer syllabic-r speech once padded past the 20-char ratio floor', () => {
      expect(detectSuspectSpans([seg('a', 0, 1000, 'Prosím, strč prst skrz krk hned teď.')])).toEqual([]);
    });

    it('flags a single token longer than 30 characters', () => {
      const spans = detectSuspectSpans([seg('a', 0, 1000, 'ana'.repeat(12))]);
      expect(spans).toHaveLength(1);
      expect(spans[0].reasons).toEqual(['garbled']);
    });

    it('flags a segment where over 40% of words have no vowel and no syllabic l/r', () => {
      const spans = detectSuspectSpans([seg('a', 0, 1000, 'xzpt qmvb dfgh wjkc')]);
      expect(spans).toHaveLength(1);
      expect(spans[0].reasons).toEqual(['garbled']);
    });
  });

  describe('hallucination', () => {
    it('flags a stored subtitle-credit hallucination phrase', () => {
      const spans = detectSuspectSpans([seg('a', 0, 1000, 'Titulky vytvořil Petr Svoboda')]);
      expect(spans).toHaveLength(1);
      expect(spans[0].reasons).toEqual(['hallucination']);
    });
  });

  describe('merging', () => {
    it('merges adjacent flagged segments and unions reasons, but not across a clean segment', () => {
      const segments = [
        seg('s1', 0, 1000, '0123456789!@#$%^&*()'.repeat(2)),
        seg('s2', 1000, 2000, 'Titulky vytvořil Petr Svoboda'),
        seg('s3', 2000, 3000, "Let's move the deadline to next Friday and confirm with design."),
        seg('s4', 3000, 4000, 'Thanks for watching'),
      ];
      const spans = detectSuspectSpans(segments);
      expect(spans).toEqual([
        { startMs: 0, endMs: 2000, segmentIds: ['s1', 's2'], reasons: ['garbled', 'hallucination'] },
        { startMs: 3000, endMs: 4000, segmentIds: ['s4'], reasons: ['hallucination'] },
      ]);
    });
  });
});
