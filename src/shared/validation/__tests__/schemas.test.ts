import { describe, it, expect } from 'vitest';
import {
  idParamSchema,
  settingKeySchema,
  filePathSchema,
  cardPrioritySchema,
  ideaStatusSchema,
  meetingTemplateTypeSchema,
  aiProviderNameSchema,
  createProjectInputSchema,
  createCardInputSchema,
  updateCardInputSchema,
  createIdeaInputSchema,
  createMeetingInputSchema,
  exportOptionsSchema,
  taskStructuringNameSchema,
  taskStructuringDescriptionSchema,
  whisperModelNameSchema,
} from '../schemas';

// Valid UUID for reuse across tests
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

// ============================================================================
// Primitive / common schemas
// ============================================================================

describe('idParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(idParamSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(idParamSchema.safeParse('not-a-uuid').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(idParamSchema.safeParse('').success).toBe(false);
  });

  it('rejects a number', () => {
    expect(idParamSchema.safeParse(123).success).toBe(false);
  });
});

describe('settingKeySchema', () => {
  it('accepts a valid key', () => {
    expect(settingKeySchema.safeParse('theme.darkMode').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(settingKeySchema.safeParse('').success).toBe(false);
  });

  it('rejects a string over 200 characters', () => {
    expect(settingKeySchema.safeParse('x'.repeat(201)).success).toBe(false);
  });

  it('accepts a string of exactly 200 characters', () => {
    expect(settingKeySchema.safeParse('x'.repeat(200)).success).toBe(true);
  });
});

describe('filePathSchema', () => {
  it('accepts a valid file path', () => {
    expect(filePathSchema.safeParse('/home/user/file.txt').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(filePathSchema.safeParse('').success).toBe(false);
  });
});

// ============================================================================
// Enum schemas
// ============================================================================

describe('cardPrioritySchema', () => {
  it.each(['low', 'medium', 'high', 'urgent'])('accepts "%s"', (val) => {
    expect(cardPrioritySchema.safeParse(val).success).toBe(true);
  });

  it('rejects an invalid value', () => {
    expect(cardPrioritySchema.safeParse('invalid').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(cardPrioritySchema.safeParse('').success).toBe(false);
  });
});

describe('ideaStatusSchema', () => {
  it.each(['new', 'exploring', 'active', 'archived'])('accepts "%s"', (val) => {
    expect(ideaStatusSchema.safeParse(val).success).toBe(true);
  });

  it('rejects an invalid value', () => {
    expect(ideaStatusSchema.safeParse('deleted').success).toBe(false);
  });
});

describe('meetingTemplateTypeSchema', () => {
  it.each(['none', 'standup', 'retro', 'planning', 'brainstorm', 'one_on_one'])(
    'accepts "%s"',
    (val) => {
      expect(meetingTemplateTypeSchema.safeParse(val).success).toBe(true);
    },
  );

  it('rejects an invalid value', () => {
    expect(meetingTemplateTypeSchema.safeParse('workshop').success).toBe(false);
  });
});

describe('aiProviderNameSchema', () => {
  it.each(['openai', 'anthropic', 'ollama', 'kimi'])('accepts "%s"', (val) => {
    expect(aiProviderNameSchema.safeParse(val).success).toBe(true);
  });

  it('rejects an invalid provider', () => {
    expect(aiProviderNameSchema.safeParse('gemini').success).toBe(false);
  });
});

// ============================================================================
// Object schemas
// ============================================================================

describe('createProjectInputSchema', () => {
  it('accepts valid input', () => {
    const result = createProjectInputSchema.safeParse({ name: 'My Project' });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const result = createProjectInputSchema.safeParse({
      name: 'My Project',
      description: 'A description',
      color: '#ff0000',
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
    const result = createProjectInputSchema.safeParse({ name: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});

describe('createCardInputSchema', () => {
  it('accepts valid input with required fields', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'A card',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const result = createCardInputSchema.safeParse({
      columnId: VALID_UUID,
      title: 'A card',
      description: 'Details here',
      priority: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing columnId', () => {
    const result = createCardInputSchema.safeParse({ title: 'A card' });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID columnId', () => {
    const result = createCardInputSchema.safeParse({
      columnId: 'not-a-uuid',
      title: 'A card',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing title', () => {
    const result = createCardInputSchema.safeParse({ columnId: VALID_UUID });
    expect(result.success).toBe(false);
  });
});

describe('updateCardInputSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateCardInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with title only', () => {
    const result = updateCardInputSchema.safeParse({ title: 'New title' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid priority', () => {
    const result = updateCardInputSchema.safeParse({ priority: 'critical' });
    expect(result.success).toBe(false);
  });

  it('accepts null for nullable fields', () => {
    const result = updateCardInputSchema.safeParse({
      description: null,
      dueDate: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('createIdeaInputSchema', () => {
  it('accepts valid input with title only', () => {
    const result = createIdeaInputSchema.safeParse({ title: 'Great idea' });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all optional fields', () => {
    const result = createIdeaInputSchema.safeParse({
      title: 'Great idea',
      description: 'Detailed description',
      projectId: VALID_UUID,
      tags: ['tag1', 'tag2'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = createIdeaInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects too many tags (>20)', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const result = createIdeaInputSchema.safeParse({
      title: 'Idea',
      tags,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 20 tags', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    const result = createIdeaInputSchema.safeParse({
      title: 'Idea',
      tags,
    });
    expect(result.success).toBe(true);
  });
});

describe('createMeetingInputSchema', () => {
  it('accepts valid input with title only', () => {
    const result = createMeetingInputSchema.safeParse({ title: 'Standup' });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with template', () => {
    const result = createMeetingInputSchema.safeParse({
      title: 'Standup',
      template: 'standup',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid template', () => {
    const result = createMeetingInputSchema.safeParse({
      title: 'Meeting',
      template: 'workshop',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing title', () => {
    const result = createMeetingInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('exportOptionsSchema', () => {
  it('accepts valid JSON format', () => {
    const result = exportOptionsSchema.safeParse({ format: 'json' });
    expect(result.success).toBe(true);
  });

  it('accepts valid CSV format', () => {
    const result = exportOptionsSchema.safeParse({ format: 'csv' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid format', () => {
    const result = exportOptionsSchema.safeParse({ format: 'xml' });
    expect(result.success).toBe(false);
  });

  it('accepts with optional tables array', () => {
    const result = exportOptionsSchema.safeParse({
      format: 'json',
      tables: ['projects', 'cards'],
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Plan 8.5 schemas
// ============================================================================

describe('taskStructuringNameSchema', () => {
  it('accepts a valid name', () => {
    expect(taskStructuringNameSchema.safeParse('Build the feature').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(taskStructuringNameSchema.safeParse('').success).toBe(false);
  });

  it('rejects a string over 500 characters', () => {
    expect(taskStructuringNameSchema.safeParse('x'.repeat(501)).success).toBe(false);
  });

  it('accepts a string of exactly 500 characters', () => {
    expect(taskStructuringNameSchema.safeParse('x'.repeat(500)).success).toBe(true);
  });
});

describe('taskStructuringDescriptionSchema', () => {
  it('accepts a valid description', () => {
    expect(taskStructuringDescriptionSchema.safeParse('A task description').success).toBe(true);
  });

  it('rejects a string over 10000 characters', () => {
    expect(taskStructuringDescriptionSchema.safeParse('x'.repeat(10001)).success).toBe(false);
  });

  it('accepts a string of exactly 10000 characters', () => {
    expect(taskStructuringDescriptionSchema.safeParse('x'.repeat(10000)).success).toBe(true);
  });
});

describe('whisperModelNameSchema', () => {
  it('accepts a valid model name', () => {
    expect(whisperModelNameSchema.safeParse('ggml-base.en.bin').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(whisperModelNameSchema.safeParse('').success).toBe(false);
  });

  it('rejects a string over 200 characters', () => {
    expect(whisperModelNameSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});
