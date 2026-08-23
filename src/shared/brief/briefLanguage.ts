// === FILE PURPOSE ===
// Pure brief-language resolution (BRIEF-QUAL.1 Task 1), shared between main and
// renderer. Turns the `brief:language` setting plus the meeting's own
// transcription language into the { code, name } pair Tasks 2/3 inject into the
// brief prompt ("Write the entire brief in Czech."). No I/O, no Electron/Node
// imports — safe to bundle into the renderer for the Settings option list.

// === DEPENDENCIES ===
// ../types/transcription (resolveLanguagePreset — the SAME preset mapping the
// transcription pipeline uses, so 'cs-mix' resolves to 'cs' here too).
// Intl.DisplayNames (Node/Chromium builtin) for the English display name.

// === LIMITATIONS ===
// - `name` is always the ENGLISH display name of the language — the prompt
//   instruction itself is written in English regardless of the brief's target
//   language.
// - English resolves to `name: null` so Tasks 2/3 can keep the English prompt
//   path byte-identical to the pre-BRIEF-QUAL.1 prompt.

import { resolveLanguagePreset } from '../types/transcription';

/** Settings-table key this preference lives under (mirrors 'transcription:language'). */
export const BRIEF_LANGUAGE_SETTING_KEY = 'brief:language';

/** Default when the setting has never been written. */
export const DEFAULT_BRIEF_LANGUAGE_SETTING = 'en';

/** Options surfaced by the Settings control (Task 4). Values are exactly what
 *  gets stored under {@link BRIEF_LANGUAGE_SETTING_KEY} and passed into
 *  {@link resolveBriefLanguage}. */
export const BRIEF_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'transcript', label: 'Same as transcript' },
  { value: 'cs', label: 'Czech' },
  { value: 'sk', label: 'Slovak' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
];

/** Defensive fallback for the three presets' bases, used only if
 *  `Intl.DisplayNames` is unavailable or throws for one of them (e.g. a
 *  non-full-ICU build) — never a hand-written table for arbitrary codes. */
const DISPLAY_NAME_FALLBACK: Record<string, string> = { en: 'English', cs: 'Czech', sk: 'Slovak' };

/** English display name for an ISO language code, for the prompt instruction. */
function displayNameFor(code: string): string {
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = displayNames.of(code);
    if (name) return name;
  } catch {
    // Falls through to the fallback map / raw code below.
  }
  return DISPLAY_NAME_FALLBACK[code] ?? code;
}

/** Resolve the 'transcript' setting to a base ISO code via the SAME preset table
 *  the transcription pipeline uses (so 'cs-mix' -> 'cs', fixing the accidental-
 *  English gap). 'auto' (multilingual/no fixed language) and a meeting with no
 *  transcriptionLanguage recorded both mean "no known target" -> English. */
function resolveTranscriptCode(transcriptionLanguage: string | null): string {
  if (!transcriptionLanguage) return 'en';
  const { baseLanguage } = resolveLanguagePreset(transcriptionLanguage);
  return baseLanguage === 'auto' ? 'en' : baseLanguage;
}

/**
 * Resolve the `brief:language` setting (plus the meeting's own transcription
 * language, needed only for the 'transcript' value) to the prompt-ready
 * `{ code, name }` pair. English always yields `name: null` so the English
 * prompt path stays byte-identical to today's.
 */
export function resolveBriefLanguage(
  setting: string,
  transcriptionLanguage: string | null,
): { code: string; name: string | null } {
  let code: string;
  if (!setting || setting === 'en') {
    code = 'en';
  } else if (setting === 'transcript') {
    code = resolveTranscriptCode(transcriptionLanguage);
  } else {
    code = setting;
  }

  if (code === 'en') return { code: 'en', name: null };
  return { code, name: displayNameFor(code) };
}
