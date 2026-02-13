import { describe, it, expect } from 'vitest';
import { MEETING_TEMPLATES } from '../types';

describe('MEETING_TEMPLATES', () => {
  it('has exactly 6 templates', () => {
    expect(MEETING_TEMPLATES).toHaveLength(6);
  });

  it('each template has required fields', () => {
    for (const t of MEETING_TEMPLATES) {
      expect(t).toHaveProperty('type');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('icon');
      expect(t).toHaveProperty('agenda');
      expect(t).toHaveProperty('aiPromptHint');
      expect(typeof t.type).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.icon).toBe('string');
      expect(Array.isArray(t.agenda)).toBe(true);
      expect(typeof t.aiPromptHint).toBe('string');
    }
  });

  it('has unique template types', () => {
    const types = MEETING_TEMPLATES.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('includes expected template types', () => {
    const types = MEETING_TEMPLATES.map((t) => t.type);
    expect(types).toContain('standup');
    expect(types).toContain('retro');
    expect(types).toContain('one_on_one');
    expect(types).toContain('planning');
    expect(types).toContain('brainstorm');
    expect(types).toContain('none');
  });

  it('non-general templates have agenda items and AI prompt hints', () => {
    const nonGeneral = MEETING_TEMPLATES.filter((t) => t.type !== 'none');
    for (const t of nonGeneral) {
      expect(t.agenda.length).toBeGreaterThan(0);
      expect(t.aiPromptHint.length).toBeGreaterThan(0);
    }
  });

  it('general template has empty agenda and prompt hint', () => {
    const general = MEETING_TEMPLATES.find((t) => t.type === 'none');
    expect(general).toBeDefined();
    expect(general!.agenda).toEqual([]);
    expect(general!.aiPromptHint).toBe('');
  });
});
