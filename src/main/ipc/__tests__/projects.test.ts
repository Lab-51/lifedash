import { describe, it, expect } from 'vitest';
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  createBoardInputSchema,
  updateBoardInputSchema,
  createColumnInputSchema,
  updateColumnInputSchema,
  columnReorderSchema,
  idParamSchema,
} from '../../../shared/validation/schemas';
import { validateInput } from '../../../shared/validation/ipc-validator';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

// ============================================================================
// createProjectInputSchema
// ============================================================================

describe('createProjectInputSchema', () => {
  it('accepts valid input with name only', () => {
    const result = createProjectInputSchema.safeParse({ name: 'My Project' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Project');
      expect(result.data.description).toBeUndefined();
      expect(result.data.color).toBeUndefined();
    }
  });

  it('accepts valid input with all optional fields', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'My Project',
      description: 'A detailed project description',
      color: '#3b82f6',
      hourlyRate: 150,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hourlyRate).toBe(150);
    }
  });

  it('accepts null hourlyRate', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'Project',
      hourlyRate: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts name at max length (200 chars)', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'x'.repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = createProjectInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createProjectInputSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 characters', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects description over 2000 characters', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'Project',
      description: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects color over 50 characters', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'Project',
      color: 'x'.repeat(51),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// updateProjectInputSchema
// ============================================================================

describe('updateProjectInputSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateProjectInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with name only', () => {
    const result = updateProjectInputSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts setting archived and pinned booleans', () => {
    const result = updateProjectInputSchema.safeParse({
      archived: true,
      pinned: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts nullable fields set to null', () => {
    const result = updateProjectInputSchema.safeParse({
      description: null,
      color: null,
      hourlyRate: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = updateProjectInputSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 characters', () => {
    const result = updateProjectInputSchema.safeParse({
      name: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean archived', () => {
    const result = updateProjectInputSchema.safeParse({ archived: 'yes' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// idParamSchema for project delete/archive
// ============================================================================

describe('idParamSchema (project operations)', () => {
  it('accepts a valid UUID for project delete', () => {
    expect(validateInput(idParamSchema, VALID_UUID)).toBe(VALID_UUID);
  });

  it('throws on non-UUID string', () => {
    expect(() => validateInput(idParamSchema, 'project-123')).toThrow(/Validation failed/);
  });

  it('throws on empty string', () => {
    expect(() => validateInput(idParamSchema, '')).toThrow();
  });

  it('throws on null', () => {
    expect(() => validateInput(idParamSchema, null)).toThrow();
  });

  it('throws on undefined', () => {
    expect(() => validateInput(idParamSchema, undefined)).toThrow();
  });

  it('throws on numeric input', () => {
    expect(() => validateInput(idParamSchema, 42)).toThrow();
  });
});

// ============================================================================
// createBoardInputSchema
// ============================================================================

describe('createBoardInputSchema', () => {
  it('accepts valid board input', () => {
    const result = createBoardInputSchema.safeParse({
      projectId: VALID_UUID,
      name: 'Sprint Board',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing projectId', () => {
    const result = createBoardInputSchema.safeParse({ name: 'Board' });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = createBoardInputSchema.safeParse({ projectId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createBoardInputSchema.safeParse({
      projectId: VALID_UUID,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID projectId', () => {
    const result = createBoardInputSchema.safeParse({
      projectId: 'bad-id',
      name: 'Board',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// updateBoardInputSchema
// ============================================================================

describe('updateBoardInputSchema', () => {
  it('accepts empty object', () => {
    expect(updateBoardInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts name update', () => {
    const result = updateBoardInputSchema.safeParse({ name: 'Renamed Board' });
    expect(result.success).toBe(true);
  });

  it('accepts position update', () => {
    const result = updateBoardInputSchema.safeParse({ position: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects negative position', () => {
    const result = updateBoardInputSchema.safeParse({ position: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer position', () => {
    const result = updateBoardInputSchema.safeParse({ position: 1.5 });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// createColumnInputSchema
// ============================================================================

describe('createColumnInputSchema', () => {
  it('accepts valid column input', () => {
    const result = createColumnInputSchema.safeParse({
      boardId: VALID_UUID,
      name: 'In Progress',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing boardId', () => {
    const result = createColumnInputSchema.safeParse({ name: 'Done' });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createColumnInputSchema.safeParse({
      boardId: VALID_UUID,
      name: '',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// columnReorderSchema
// ============================================================================

describe('columnReorderSchema', () => {
  it('accepts valid array of UUIDs', () => {
    const result = columnReorderSchema.safeParse([VALID_UUID, '660e8400-e29b-41d4-a716-446655440000']);
    expect(result.success).toBe(true);
  });

  it('accepts empty array', () => {
    const result = columnReorderSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects array with non-UUID strings', () => {
    const result = columnReorderSchema.safeParse(['not-a-uuid', 'also-bad']);
    expect(result.success).toBe(false);
  });

  it('rejects non-array input', () => {
    const result = columnReorderSchema.safeParse('not-an-array');
    expect(result.success).toBe(false);
  });
});
