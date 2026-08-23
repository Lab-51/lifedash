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

describe('resolveBriefLanguage — an explicit ISO code setting ("de")', () => {
  it.each(['cs-mix', 'cs', 'en', 'auto', null])(
    'always resolves to German regardless of transcriptionLanguage (%s)',
    (t) => {
      expect(resolveBriefLanguage('de', t)).toEqual({ code: 'de', name: 'German' });
    },
  );
});

describe('resolveBriefLanguage — defensive defaults', () => {
  it('treats an empty setting as English (defends against a corrupted stored value)', () => {
    expect(resolveBriefLanguage('', null)).toEqual({ code: 'en', name: null });
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
    expect(DEFAULT_BRIEF_LANGUAGE_SETTING).toBe('en');
  });

  it('the Settings option list includes English and "same as transcript"', () => {
    expect(BRIEF_LANGUAGE_OPTIONS.map((o) => o.value)).toEqual(expect.arrayContaining(['en', 'transcript']));
  });
});
