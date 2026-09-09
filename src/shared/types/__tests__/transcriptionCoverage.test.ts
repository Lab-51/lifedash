// === FILE PURPOSE ===
// dominantLanguage (2026-09-09): the one language a transcript was decoded in,
// by saved-window majority, read by the brief's "Same as transcript" setting.

import { describe, it, expect } from 'vitest';
import { dominantLanguage, emptyCoverageTally } from '../transcriptionCoverage';

describe('dominantLanguage', () => {
  it('returns the code with the most saved windows', () => {
    expect(dominantLanguage({ cs: 41, en: 3, sk: 7 })).toBe('cs');
  });

  it('returns null when nothing was tallied, or the field is absent (pre-2026-09-09 record)', () => {
    expect(dominantLanguage({})).toBeNull();
    expect(dominantLanguage(undefined)).toBeNull();
  });

  it('breaks a tie deterministically by insertion order', () => {
    expect(dominantLanguage({ sk: 5, cs: 5 })).toBe('sk');
    expect(dominantLanguage({ cs: 5, sk: 5 })).toBe('cs');
  });

  it('a fresh tally carries an empty languages map', () => {
    expect(emptyCoverageTally().languages).toEqual({});
  });
});
