// === FILE PURPOSE ===
// Validation schema tests for the meetings:reassignFromUnassigned IPC.

import { describe, it, expect } from 'vitest';
import { reassignFromUnassignedSchema } from '../../../shared/validation/schemas';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440000';

describe('reassignFromUnassignedSchema', () => {
  it('accepts valid meetingId + newProjectId', () => {
    const result = reassignFromUnassignedSchema.safeParse({
      meetingId: VALID_UUID,
      newProjectId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing meetingId', () => {
    const result = reassignFromUnassignedSchema.safeParse({ newProjectId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it('rejects missing newProjectId', () => {
    const result = reassignFromUnassignedSchema.safeParse({ meetingId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID meetingId', () => {
    const result = reassignFromUnassignedSchema.safeParse({
      meetingId: 'not-a-uuid',
      newProjectId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects null newProjectId — must be a real project, not null', () => {
    const result = reassignFromUnassignedSchema.safeParse({
      meetingId: VALID_UUID,
      newProjectId: null,
    });
    expect(result.success).toBe(false);
  });
});
