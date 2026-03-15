import { describe, it, expect } from 'vitest';
import {
  createCardInputSchema,
  updateCardInputSchema,
  cardMoveSchema,
  createLabelInputSchema,
  createCardCommentInputSchema,
  createCardRelationshipInputSchema,
  addChecklistItemSchema,
  updateChecklistItemSchema,
  reorderChecklistItemsSchema,
  addChecklistItemsBatchSchema,
  createCardTemplateSchema,
  idParamSchema,
} from '../../../shared/validation/schemas';
import { validateInput } from '../../../shared/validation/ipc-validator';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440000';

// ============================================================================
// createCardInputSchema
// ============================================================================

describe('createCardInputSchema', () => {
  it('accepts valid input with required fields only', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'Fix login bug',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.columnId).toBe(VALID_UUID);
      expect(result.data.title).toBe('Fix login bug');
      expect(result.data.description).toBeUndefined();
      expect(result.data.priority).toBeUndefined();
    }
  });

  it('accepts valid input with all optional fields', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'Deploy v2',
      description: 'Ship the release to production',
      priority: 'urgent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('urgent');
      expect(result.data.description).toBe('Ship the release to production');
    }
  });

  it('accepts title at max length (500 chars)', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing columnId', () => {
    const result = createCardInputSchema.safeParse({ title: 'A card' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects title over 500 characters', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID columnId', () => {
    const result = createCardInputSchema.safeParse({
      columnId: 'not-a-uuid',
      title: 'A card',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority value', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'A card',
      priority: 'critical',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description over 5000 characters', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'A card',
      description: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// cardMoveSchema
// ============================================================================

describe('cardMoveSchema', () => {
  it('accepts valid move with position 0', () => {
    const result = cardMoveSchema.safeParse({
      columnId: VALID_UUID,
      position: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid move with positive position', () => {
    const result = cardMoveSchema.safeParse({
      columnId: VALID_UUID,
      position: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBe(5);
    }
  });

  it('accepts large position values', () => {
    const result = cardMoveSchema.safeParse({
      columnId: VALID_UUID,
      position: 9999,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative position', () => {
    const result = cardMoveSchema.safeParse({
      columnId: VALID_UUID,
      position: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer position', () => {
    const result = cardMoveSchema.safeParse({
      columnId: VALID_UUID,
      position: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing columnId', () => {
    const result = cardMoveSchema.safeParse({ position: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID columnId', () => {
    const result = cardMoveSchema.safeParse({
      columnId: 'abc',
      position: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing position', () => {
    const result = cardMoveSchema.safeParse({ columnId: VALID_UUID });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// updateCardInputSchema
// ============================================================================

describe('updateCardInputSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateCardInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with title only', () => {
    const result = updateCardInputSchema.safeParse({ title: 'Updated title' });
    expect(result.success).toBe(true);
  });

  it('accepts setting completed and archived booleans', () => {
    const result = updateCardInputSchema.safeParse({
      completed: true,
      archived: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts nullable fields set to null', () => {
    const result = updateCardInputSchema.safeParse({
      description: null,
      dueDate: null,
      recurrenceType: null,
      recurrenceEndDate: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid recurrenceType values', () => {
    for (const rt of ['daily', 'weekly', 'biweekly', 'monthly']) {
      const result = updateCardInputSchema.safeParse({ recurrenceType: rt });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid recurrenceType', () => {
    const result = updateCardInputSchema.safeParse({ recurrenceType: 'yearly' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = updateCardInputSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// validateInput with card schemas
// ============================================================================

describe('validateInput with card schemas', () => {
  it('returns parsed data for valid createCard input', () => {
    const data = { columnId: VALID_UUID, title: 'Test card' };
    const result = validateInput(createCardInputSchema, data);
    expect(result.columnId).toBe(VALID_UUID);
    expect(result.title).toBe('Test card');
  });

  it('throws with "Validation failed:" prefix on invalid input', () => {
    expect(() => validateInput(createCardInputSchema, {})).toThrow(/^Validation failed:/);
  });

  it('throws with field path in error message for invalid UUID', () => {
    expect(() => validateInput(createCardInputSchema, { columnId: 'bad', title: 'x' })).toThrow(/columnId/);
  });

  it('validates idParamSchema for card delete operations', () => {
    expect(validateInput(idParamSchema, VALID_UUID)).toBe(VALID_UUID);
    expect(() => validateInput(idParamSchema, 'not-a-uuid')).toThrow();
    expect(() => validateInput(idParamSchema, 123)).toThrow();
    expect(() => validateInput(idParamSchema, '')).toThrow();
  });
});

// ============================================================================
// createCardRelationshipInputSchema
// ============================================================================

describe('createCardRelationshipInputSchema', () => {
  it('accepts valid relationship input', () => {
    const result = createCardRelationshipInputSchema.safeParse({
      sourceCardId: VALID_UUID,
      targetCardId: VALID_UUID_2,
      type: 'blocks',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid relationship types', () => {
    for (const type of ['blocks', 'depends_on', 'related_to']) {
      const result = createCardRelationshipInputSchema.safeParse({
        sourceCardId: VALID_UUID,
        targetCardId: VALID_UUID_2,
        type,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid relationship type', () => {
    const result = createCardRelationshipInputSchema.safeParse({
      sourceCardId: VALID_UUID,
      targetCardId: VALID_UUID_2,
      type: 'parent_of',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID sourceCardId', () => {
    const result = createCardRelationshipInputSchema.safeParse({
      sourceCardId: 'bad',
      targetCardId: VALID_UUID_2,
      type: 'blocks',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// addChecklistItemSchema & addChecklistItemsBatchSchema
// ============================================================================

describe('addChecklistItemSchema', () => {
  it('accepts valid checklist item', () => {
    const result = addChecklistItemSchema.safeParse({
      cardId: VALID_UUID,
      title: 'Write tests',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = addChecklistItemSchema.safeParse({
      cardId: VALID_UUID,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing cardId', () => {
    const result = addChecklistItemSchema.safeParse({ title: 'Test' });
    expect(result.success).toBe(false);
  });
});

describe('addChecklistItemsBatchSchema', () => {
  it('accepts valid batch with multiple titles', () => {
    const result = addChecklistItemsBatchSchema.safeParse({
      cardId: VALID_UUID,
      titles: ['Item 1', 'Item 2', 'Item 3'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty titles array', () => {
    const result = addChecklistItemsBatchSchema.safeParse({
      cardId: VALID_UUID,
      titles: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 50 items', () => {
    const titles = Array.from({ length: 51 }, (_, i) => `Item ${i}`);
    const result = addChecklistItemsBatchSchema.safeParse({
      cardId: VALID_UUID,
      titles,
    });
    expect(result.success).toBe(false);
  });
});
