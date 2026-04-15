// === Transcription provider configuration and status types ===

export type TranscriptionProviderType = 'local' | 'deepgram' | 'assemblyai';

export type TranscriptionLanguage = 'en' | 'cs' | 'sk' | 'fr' | 'cs-mix' | 'sk-mix' | 'en-mix' | 'auto';

export const TRANSCRIPTION_LANGUAGES: { code: TranscriptionLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Czech' },
  { code: 'sk', label: 'Slovak' },
  { code: 'fr', label: 'French' },
  { code: 'auto', label: 'Multilingual (auto-detect)' },
  { code: 'cs-mix', label: 'Czech (mixed CS/EN/SK)' },
  { code: 'sk-mix', label: 'Slovak (mixed SK/EN/CS)' },
  { code: 'en-mix', label: 'English (mixed EN/CS/SK)' },
];

export const DEFAULT_MIXED_PROMPTS: Record<'cs-mix' | 'sk-mix' | 'en-mix', string> = {
  'cs-mix':
    'Toto je schůzka v češtině s občasnými anglickými a slovenskými výrazy. This meeting is in Czech with occasional English and Slovak terms. Stretnutie v češtine s anglickými a slovenskými pojmami.',
  'sk-mix':
    'Toto je stretnutie v slovenčine s občasnými anglickými a českými výrazmi. This meeting is in Slovak with occasional English and Czech terms. Schůzka ve slovenštině s anglickými a českými pojmy.',
  'en-mix':
    'This is a meeting in English with occasional Czech and Slovak phrases. Schůzka v angličtině s českými a slovenskými výrazy. Stretnutie v angličtine so slovenskými a českými pojmami.',
};

export function resolveLanguagePreset(code: string): {
  baseLanguage: string;
  mixedCode: 'cs-mix' | 'sk-mix' | 'en-mix' | null;
} {
  if (code === 'cs-mix') return { baseLanguage: 'cs', mixedCode: 'cs-mix' };
  if (code === 'sk-mix') return { baseLanguage: 'sk', mixedCode: 'sk-mix' };
  if (code === 'en-mix') return { baseLanguage: 'en', mixedCode: 'en-mix' };
  return { baseLanguage: code, mixedCode: null };
}

export interface TranscriptionProviderConfig {
  type: TranscriptionProviderType;
  deepgramKeyEncrypted?: string; // Encrypted via safeStorage
  assemblyaiKeyEncrypted?: string; // Encrypted via safeStorage
}

export interface TranscriptionProviderStatus {
  type: TranscriptionProviderType;
  hasDeepgramKey: boolean;
  hasAssemblyaiKey: boolean;
  localModelAvailable: boolean;
}

/** Result from a cloud transcription provider (Deepgram or AssemblyAI) */
export interface TranscriberResult {
  text: string;
  segments: Array<{ text: string; startMs: number; endMs: number }>;
}
