// === FILE PURPOSE ===
// Embedded release notes for the current and recent versions.
// Updated during each release (before building) so the "What's New" modal
// can display patch notes without any network request.

export type ReleaseType = 'patch' | 'minor' | 'major';

export interface ReleaseNoteSection {
  category: 'new' | 'fixes' | 'internal';
  label: string;
  items: string[];
}

export interface ReleaseNotesData {
  version: string;
  sections: ReleaseNoteSection[];
}

/** Determine release type by comparing two semver strings. */
export function getReleaseType(prev: string, curr: string): ReleaseType {
  const [pMaj, pMin] = prev.split('.').map(Number);
  const [cMaj, cMin] = curr.split('.').map(Number);
  if (cMaj !== pMaj) return 'major';
  if (cMin !== pMin) return 'minor';
  return 'patch';
}

/** Full release history — most recent first. Keep at most 5 entries. */
export const releaseHistory: ReleaseNotesData[] = [
  {
    version: '2.2.38',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Slovak transcription language support — select Slovak explicitly in the language picker',
          'Two new Whisper models for much better Czech/Slovak accuracy: Enhanced (~539 MB) and Best / large-v3-turbo (~874 MB, recommended)',
          'Mixed-language presets for meetings that switch between Czech, Slovak, and English',
          "The 'Recommended' model badge now reflects the best choice for your selected language",
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Settings model picker now shows a distinct tier label per Whisper model (Basic / Standard / High Quality / Enhanced / Best) instead of calling three different models "Standard"',
          'Corrected the "Better Czech/Slovak transcription available" banner path to "Settings → General → Transcription"',
        ],
      },
    ],
  },
  {
    version: '2.2.37',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Auto-recover microphone — if your mic disconnects during recording, LifeDash automatically reconnects when it comes back and notifies you via toast',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Meeting briefs now work better with local models — improved prompt for fuller coverage',
          "Friendly error message when your local model's context window is too small for a request",
        ],
      },
    ],
  },
  {
    version: '2.2.36',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Meeting briefs are now concise — short one-sentence bullets instead of verbose paragraphs',
          'Action items now work reliably with local AI models (LM Studio, Ollama) — improved prompt and parser',
        ],
      },
    ],
  },
  {
    version: '2.2.35',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'LM Studio support — run local AI models through LM Studio with auto-detection, no API key needed',
          'Multi-tab intelligence feeds — create themed tabs (AI, Business, etc.) with per-tab source selection and scoped AI briefs',
          'Topic consolidation — daily briefs now merge same-event articles into single bullets with sub-links instead of repeating them',
        ],
      },
    ],
  },
  {
    version: '2.2.34',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Czech and French transcription language support — select Czech or French explicitly in the language picker for more accurate transcription',
          'Language-aware AI summaries — meeting briefs and action items are now generated in the language of the recording',
          'Fork-safe release infrastructure — forks no longer accidentally connect to the official update channel',
        ],
      },
    ],
  },
  {
    version: '2.2.33',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Fixed cloud sync failing for projects — sort order column was missing from the sync mapping, causing upsert errors',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
