import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateInput } from '../ipc-validator';

describe('validateInput', () => {
  const stringSchema = z.string().min(1);
  const objectSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
  });
  const optionalFieldsSchema = z.object({
    required: z.string(),
    optional: z.string().optional(),
  });

  // --- Valid data ---

  it('returns parsed result for valid string input', () => {
    const result = validateInput(stringSchema, 'hello');
    expect(result).toBe('hello');
  });

  it('returns parsed result for valid object input', () => {
    const data = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test' };
    const result = validateInput(objectSchema, data);
    expect(result).toEqual(data);
  });

  // --- Invalid data ---

  it('throws Error for invalid data', () => {
    expect(() => validateInput(stringSchema, '')).toThrow(Error);
  });

  it('error message starts with "Validation failed:"', () => {
    expect(() => validateInput(stringSchema, '')).toThrow(/^Validation failed:/);
  });

  it('error message contains field path for object validation', () => {
    expect(() =>
      validateInput(objectSchema, { id: 'not-a-uuid', name: 'Test' }),
    ).toThrow(/id/);
  });

  it('error message contains validation issue description', () => {
    expect(() =>
      validateInput(objectSchema, { id: 'not-a-uuid', name: 'Test' }),
    ).toThrow(/Invalid uuid/i);
  });

  // --- Nested / compound validation ---

  it('validates nested object with UUID field', () => {
    const nestedSchema = z.object({
      card: z.object({
        columnId: z.string().uuid(),
      }),
    });
    const valid = { card: { columnId: '550e8400-e29b-41d4-a716-446655440000' } };
    expect(validateInput(nestedSchema, valid)).toEqual(valid);

    expect(() =>
      validateInput(nestedSchema, { card: { columnId: 'bad' } }),
    ).toThrow(/card\.columnId/);
  });

  // --- Optional fields ---

  it('accepts undefined for optional fields', () => {
    const result = validateInput(optionalFieldsSchema, { required: 'hello' });
    expect(result).toEqual({ required: 'hello' });
  });

  it('rejects null for non-nullable optional fields', () => {
    expect(() =>
      validateInput(optionalFieldsSchema, { required: 'hello', optional: null }),
    ).toThrow(Error);
  });

  // --- Multiple errors ---

  it('joins multiple validation issues with semicolons', () => {
    try {
      validateInput(objectSchema, { id: '', name: '' });
      expect.fail('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(';');
      expect(message).toContain('id');
      expect(message).toContain('name');
    }
  });
});
