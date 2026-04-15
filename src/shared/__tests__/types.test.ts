import { describe, it, expect } from 'vitest';
import { MEETING_TEMPLATES } from '../types';
import { TRANSCRIPTION_LANGUAGES, DEFAULT_MIXED_PROMPTS, resolveLanguagePreset } from '../types/transcription';

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

describe('resolveLanguagePreset', () => {
  it('returns base language and mixedCode for cs-mix', () => {
    expect(resolveLanguagePreset('cs-mix')).toEqual({ baseLanguage: 'cs', mixedCode: 'cs-mix' });
  });

  it('returns base language and mixedCode for sk-mix', () => {
    expect(resolveLanguagePreset('sk-mix')).toEqual({ baseLanguage: 'sk', mixedCode: 'sk-mix' });
  });

  it('returns base language and mixedCode for en-mix', () => {
    expect(resolveLanguagePreset('en-mix')).toEqual({ baseLanguage: 'en', mixedCode: 'en-mix' });
  });

  it('returns null mixedCode for plain language codes', () => {
    expect(resolveLanguagePreset('en')).toEqual({ baseLanguage: 'en', mixedCode: null });
    expect(resolveLanguagePreset('cs')).toEqual({ baseLanguage: 'cs', mixedCode: null });
    expect(resolveLanguagePreset('sk')).toEqual({ baseLanguage: 'sk', mixedCode: null });
    expect(resolveLanguagePreset('fr')).toEqual({ baseLanguage: 'fr', mixedCode: null });
    expect(resolveLanguagePreset('auto')).toEqual({ baseLanguage: 'auto', mixedCode: null });
  });
});

describe('TRANSCRIPTION_LANGUAGES', () => {
  it('includes sk, cs-mix, sk-mix, en-mix entries', () => {
    const codes = TRANSCRIPTION_LANGUAGES.map((l) => l.code);
    expect(codes).toContain('sk');
    expect(codes).toContain('cs-mix');
    expect(codes).toContain('sk-mix');
    expect(codes).toContain('en-mix');
  });

  it('has non-empty labels for all entries', () => {
    for (const lang of TRANSCRIPTION_LANGUAGES) {
      expect(lang.label.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_MIXED_PROMPTS', () => {
  it('has non-empty prompts for all three mix codes', () => {
    expect(DEFAULT_MIXED_PROMPTS['cs-mix'].length).toBeGreaterThan(0);
    expect(DEFAULT_MIXED_PROMPTS['sk-mix'].length).toBeGreaterThan(0);
    expect(DEFAULT_MIXED_PROMPTS['en-mix'].length).toBeGreaterThan(0);
  });
});
