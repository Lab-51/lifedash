// === Transcription provider configuration and status types ===

export type TranscriptionProviderType = 'local' | 'deepgram' | 'assemblyai';

export type TranscriptionLanguage = 'en' | 'cs' | 'auto';

export const TRANSCRIPTION_LANGUAGES: { code: TranscriptionLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Czech (Čeština)' },
  { code: 'auto', label: 'Auto-detect (mixed)' },
];

export interface TranscriptionProviderConfig {
  type: TranscriptionProviderType;
  deepgramKeyEncrypted?: string;    // Encrypted via safeStorage
  assemblyaiKeyEncrypted?: string;  // Encrypted via safeStorage
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
