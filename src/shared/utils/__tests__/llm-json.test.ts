// Unit tests for the tolerant model-JSON parser (BRIEF-QUAL.1). Pure function, no
// mocks: every case here is a shape a local model has actually been observed to
// emit — a fence, a polite opening sentence, a closing remark — plus the two that
// must NOT be rescued (no JSON at all, broken JSON).

import { describe, it, expect } from 'vitest';
import { parseModelJson, ModelJsonError } from '../llm-json';

describe('parseModelJson', () => {
  it('parses a bare object', () => {
    expect(parseModelJson('{"topics":[]}')).toEqual({ topics: [] });
  });

  it('strips a ```json fence', () => {
    const raw = '```json\n{"terms":["P2"]}\n```';
    expect(parseModelJson(raw)).toEqual({ terms: ['P2'] });
  });

  it('strips a bare ``` fence', () => {
    expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('tolerates a leading sentence before the JSON', () => {
    const raw = 'Sure! Here is the extracted structure:\n{"decisions":[{"statement":"Ship on Friday"}]}';
    expect(parseModelJson(raw)).toEqual({ decisions: [{ statement: 'Ship on Friday' }] });
  });

  it('tolerates trailing commentary after the JSON', () => {
    const raw = '{"openQuestions":["Who owns the migration?"]}\n\nLet me know if you need more detail.';
    expect(parseModelJson(raw)).toEqual({ openQuestions: ['Who owns the migration?'] });
  });

  it('tolerates prose on BOTH sides of a fenced object', () => {
    const raw = 'Here you go:\n```json\n{"a":{"b":2}}\n```\nThat covers everything.';
    expect(parseModelJson(raw)).toEqual({ a: { b: 2 } });
  });

  it('parses a top-level array', () => {
    expect(parseModelJson('Here:\n[{"task":"Send the deck"}]\nDone.')).toEqual([{ task: 'Send the deck' }]);
  });

  it('prefers whichever of { or [ opens FIRST', () => {
    // An object whose value is an array: the '[' appears later, so the object wins.
    expect(parseModelJson('{"terms":["a","b"]}')).toEqual({ terms: ['a', 'b'] });
    // An array of objects: the '[' opens first, so the array wins.
    expect(parseModelJson('[{"x":1},{"x":2}]')).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it('preserves nested structure and unicode content exactly', () => {
    const raw = '```json\n{"topics":[{"title":"Rozpočet","detail":"Náklady vzrostly o 12 %."}]}\n```';
    expect(parseModelJson(raw)).toEqual({ topics: [{ title: 'Rozpočet', detail: 'Náklady vzrostly o 12 %.' }] });
  });

  it('throws ModelJsonError when there is no JSON at all', () => {
    expect(() => parseModelJson('I am sorry, I cannot help with that.')).toThrow(ModelJsonError);
  });

  it('throws ModelJsonError on malformed JSON rather than repairing it', () => {
    expect(() => parseModelJson('{"topics":[{"title":}]}')).toThrow(ModelJsonError);
  });

  it('throws ModelJsonError on empty or whitespace-only input', () => {
    expect(() => parseModelJson('')).toThrow(ModelJsonError);
    expect(() => parseModelJson('   \n  ')).toThrow(ModelJsonError);
  });

  it('carries at most 200 chars of the offending text on the error', () => {
    const garbage = `no json here ${'x'.repeat(500)}`;
    try {
      parseModelJson(garbage);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelJsonError);
      const modelErr = err as ModelJsonError;
      expect(modelErr.snippet).toHaveLength(200);
      expect(modelErr.snippet.startsWith('no json here')).toBe(true);
      expect(modelErr.message).toContain('no json here');
    }
  });
});
