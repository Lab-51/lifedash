// === FILE PURPOSE ===
// Unit tests for the owner verifier — the mechanical gate that keeps a name the
// model invented off an action item and off a pushed card.
//
// The cases that matter are the two failure directions: a real participant must
// survive (including across the diacritic spellings whisper and a calendar
// disagree on), and a name the meeting never contained must not.

import { describe, it, expect, vi } from 'vitest';
import { buildOwnerVerifier } from '../ownerVerificationService';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const segments = (...lines: Array<[string | null, string]>) =>
  lines.map(([speaker, content]) => ({ speaker, content }));

describe('buildOwnerVerifier', () => {
  it('keeps an owner the transcript actually names', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Marta will patch the batch limit before Friday.']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify('Marta')).toBe('Marta');
  });

  it('drops an owner that occurs nowhere — the invented-name case', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Someone should patch the batch limit before Friday.']),
      rosterNames: ['Marta'],
      selfName: null,
    });

    expect(verify('Petr')).toBeNull();
  });

  it('keeps a roster name the transcript never spelled — the roster is evidence too', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'She will send the timeline.']),
      rosterNames: ['Rina Kovac'],
      selfName: null,
    });

    expect(verify('Rina Kovac')).toBe('Rina Kovac');
  });

  it('matches across diacritics in both directions', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Hanuš pripravi podklady.']),
      rosterNames: [],
      selfName: null,
    });

    // Transcript accented, owner unaccented.
    expect(verify('Hanus')).toBe('Hanus');

    const reverse = buildOwnerVerifier({
      segments: segments([null, 'Hanus pripravi podklady.']),
      rosterNames: [],
      selfName: null,
    });
    // Transcript unaccented, owner accented.
    expect(reverse('Hanuš')).toBe('Hanuš');
  });

  it('accepts a name that appears only as a speaker label', () => {
    const verify = buildOwnerVerifier({
      segments: segments(['Marta', 'I will take that one.']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify('Marta')).toBe('Marta');
  });

  it('accepts the recording user by their own name', () => {
    const verify = buildOwnerVerifier({
      segments: segments(['Me', 'I will book the venue.']),
      rosterNames: [],
      selfName: 'Daniel',
    });

    expect(verify('Daniel')).toBe('Daniel');
  });

  it('ignores punctuation around the name in the transcript', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Right, (Marta) — can you take it?']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify('Marta')).toBe('Marta');
  });

  it('requires whole words — a name inside a longer word is not evidence', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'We ordered a banana box for the offsite.']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify('Ana')).toBeNull();
  });

  it('drops a multi-word owner when only one half occurs', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Marta will patch the export.']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify('Marta Novakova')).toBeNull();
  });

  it('returns null for null, empty and whitespace-only owners', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Marta will patch the export.']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify(null)).toBeNull();
    expect(verify('')).toBeNull();
    expect(verify('   ')).toBeNull();
  });

  it('returns null for an owner that folds to nothing', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Marta will patch the export.']),
      rosterNames: [],
      selfName: null,
    });

    expect(verify('---')).toBeNull();
  });

  it('returns the owner exactly as given, never a corrected spelling', () => {
    const verify = buildOwnerVerifier({
      segments: segments([null, 'Hanuš pripravi podklady.']),
      rosterNames: ['Hanuš Novak'],
      selfName: null,
    });

    // Evidence is accented; the returned value is still the caller's spelling.
    expect(verify('hanus')).toBe('hanus');
  });

  it('drops every owner when there is no evidence at all', () => {
    const verify = buildOwnerVerifier({ segments: [], rosterNames: [], selfName: null });

    expect(verify('Marta')).toBeNull();
  });
});
