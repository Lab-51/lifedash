// === FILE PURPOSE ===
// Unit tests for briefLanguage (BRIEF-QUAL.1 Task 1) — the pure resolution from
// the `brief:language` setting + a meeting's transcription language to the
// prompt-ready { code, name } pair. Matrix-driven: every setting value against
// every transcriptionLanguage value that can reach it.

import { describe, it, expect } from 'vitest';
import {
  resolveBriefLanguage,
  BRIEF_LANGUAGE_SETTING_KEY,
  DEFAULT_BRIEF_LANGUAGE_SETTING,
  BRIEF_LANGUAGE_OPTIONS,
} from '../briefLanguage';

describe('resolveBriefLanguage — "en" setting (transcriptionLanguage is irrelevant)', () => {
  it.each(['cs-mix', 'cs', 'en', 'auto', null])('always resolves to English when transcriptionLanguage is %s', (t) => {
    expect(resolveBriefLanguage('en', t)).toEqual({ code: 'en', name: null });
  });
});

describe('resolveBriefLanguage — "transcript" setting', () => {
  it('resolves cs-mix through the preset base (cs) — the accidental-English gap fix', () => {
    expect(resolveBriefLanguage('transcript', 'cs-mix')).toEqual({ code: 'cs', name: 'Czech' });
  });

  it('resolves a plain base code (cs) directly', () => {
    expect(resolveBriefLanguage('transcript', 'cs')).toEqual({ code: 'cs', name: 'Czech' });
  });

  it('resolves English to name: null', () => {
    expect(resolveBriefLanguage('transcript', 'en')).toEqual({ code: 'en', name: null });
  });

  it('resolves "auto" (multilingual) to English', () => {
    expect(resolveBriefLanguage('transcript', 'auto')).toEqual({ code: 'en', name: null });
  });

  it('resolves a null transcriptionLanguage (never recorded) to English', () => {
    expect(resolveBriefLanguage('transcript', null)).toEqual({ code: 'en', name: null });
  });
});

describe('resolveBriefLanguage — the language whisper actually decoded wins (2026-09-09)', () => {
  it('a meeting recorded on "auto" follows the detected language, not English', () => {
    expect(resolveBriefLanguage('transcript', 'auto', 'cs')).toEqual({ code: 'cs', name: 'Czech' });
  });

  it('a detected language beats the configured preset base', () => {
    // Recorded on the cs-mix preset, but whisper decoded Slovak all meeting.
    expect(resolveBriefLanguage('transcript', 'cs-mix', 'sk')).toEqual({ code: 'sk', name: 'Slovak' });
  });

  it('a detected "auto" or null falls back to the preset base, then English', () => {
    expect(resolveBriefLanguage('transcript', 'cs-mix', 'auto')).toEqual({ code: 'cs', name: 'Czech' });
    expect(resolveBriefLanguage('transcript', 'cs-mix', null)).toEqual({ code: 'cs', name: 'Czech' });
    expect(resolveBriefLanguage('transcript', null, null)).toEqual({ code: 'en', name: null });
  });

  it('a pinned language ignores the detection entirely', () => {
    expect(resolveBriefLanguage('en', 'cs-mix', 'cs')).toEqual({ code: 'en', name: null });
    expect(resolveBriefLanguage('de', 'cs-mix', 'cs')).toEqual({ code: 'de', name: 'German' });
  });

  it('a detected English resolves to name: null like every other English path', () => {
    expect(resolveBriefLanguage('transcript', 'auto', 'en')).toEqual({ code: 'en', name: null });
  });
});

describe('resolveBriefLanguage — an explicit ISO code setting ("de")', () => {
  it.each(['cs-mix', 'cs', 'en', 'auto', null])(
    'always resolves to German regardless of transcriptionLanguage (%s)',
    (t) => {
      expect(resolveBriefLanguage('de', t)).toEqual({ code: 'de', name: 'German' });
    },
  );
});

describe('resolveBriefLanguage — defensive defaults', () => {
  it('treats an empty setting as the default ("transcript"): English with nothing known, the detected language otherwise', () => {
    expect(resolveBriefLanguage('', null)).toEqual({ code: 'en', name: null });
    expect(resolveBriefLanguage('', 'auto', 'cs')).toEqual({ code: 'cs', name: 'Czech' });
  });

  it('falls back to the raw code when Intl.DisplayNames has no localized name for it', () => {
    // 'xx' is a syntactically valid but unassigned BCP-47 subtag — Intl.DisplayNames
    // echoes it back rather than throwing, and that's a legitimate resolution here.
    expect(resolveBriefLanguage('xx', null)).toEqual({ code: 'xx', name: 'xx' });
  });
});

describe('module constants', () => {
  it('exposes the settings key and default used by readBriefLanguageSetting', () => {
    expect(BRIEF_LANGUAGE_SETTING_KEY).toBe('brief:language');
    // 'transcript' since 2026-09-09: the brief follows the spoken language by default.
    expect(DEFAULT_BRIEF_LANGUAGE_SETTING).toBe('transcript');
  });

  it('the Settings option list includes English and "same as transcript"', () => {
    expect(BRIEF_LANGUAGE_OPTIONS.map((o) => o.value)).toEqual(expect.arrayContaining(['en', 'transcript']));
  });
});
