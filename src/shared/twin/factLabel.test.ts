// === FILE PURPOSE ===
// Unit tests for labelFor (TWIN-READ.1 Task 1) — the ONE accessor every surface
// reads a twin fact's display label through. Proves: the stored label always
// wins when present; a null OR empty-string stored label falls back to a derived
// short label; the derived fallback is capped and never blank for non-empty
// input.

import { describe, it, expect } from 'vitest';
import { labelFor } from './factLabel';

describe('labelFor — prefers the stored label', () => {
  it('returns the stored label verbatim when present', () => {
    expect(labelFor({ fact: 'Acme is migrating billing to Stripe.', label: 'Billing migration' })).toBe(
      'Billing migration',
    );
  });

  it('trims incidental whitespace around a stored label', () => {
    expect(labelFor({ fact: 'Dana leads billing.', label: '  Dana owns billing  ' })).toBe('Dana owns billing');
  });
});

describe('labelFor — falls back when there is no usable stored label', () => {
  it('falls back for a null label', () => {
    expect(labelFor({ fact: 'Prefers async standups.', label: null })).toBe('Prefers async standups');
  });

  it('falls back for an undefined label', () => {
    expect(labelFor({ fact: 'Prefers async standups.' })).toBe('Prefers async standups');
  });

  it('falls back for an empty-string label', () => {
    expect(labelFor({ fact: 'Prefers async standups.', label: '' })).toBe('Prefers async standups');
  });

  it('falls back for a whitespace-only label', () => {
    expect(labelFor({ fact: 'Prefers async standups.', label: '   ' })).toBe('Prefers async standups');
  });
});

describe('labelFor — derived fallback is capped and never blank', () => {
  it('keeps a short fact (<= 4 words) exactly, with no truncation marker', () => {
    expect(labelFor({ fact: 'Dana leads billing' })).toBe('Dana leads billing');
  });

  it('drops only a trailing period without treating it as truncation', () => {
    expect(labelFor({ fact: 'Works in fintech.' })).toBe('Works in fintech');
  });

  it('caps a long sentence at ~4 words and marks it truncated', () => {
    // The exact example from PLAN-TWIN-READ.md's "why deriving was rejected" note.
    expect(labelFor({ fact: 'The Q3 pricing decision was deferred to the board meeting.' })).toBe(
      'The Q3 pricing decision…',
    );
  });

  it('stops at the first clause boundary even under the 4-word cap', () => {
    expect(labelFor({ fact: "Deferred to Q3, per Sarah's request." })).toBe('Deferred to Q3…');
  });

  it('hard-caps a single abnormally long word by character count', () => {
    const longWord = 'A'.repeat(60);
    const result = labelFor({ fact: longWord });
    expect(result.length).toBeLessThanOrEqual(41); // 40 chars + the ellipsis marker
    expect(result.endsWith('…')).toBe(true);
  });

  it('is never blank for non-empty fact text', () => {
    expect(labelFor({ fact: '!!!' })).not.toBe('');
    expect(labelFor({ fact: 'x' })).not.toBe('');
  });
});
