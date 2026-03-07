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
    version: '2.2.2',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Meeting cards now update correctly when all action items are dismissed',
          'Fixed TypeScript build error in voice input hook',
        ],
      },
    ],
  },
  {
    version: '2.2.1',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Voice-to-text input for brainstorm chat, card descriptions, and comments',
          'Whisper model picker in Settings — choose between Standard and High Quality models',
          'Automatic GPU detection for transcription (Vulkan, CUDA, or CPU fallback)',
          'Multilingual transcription support — 99 languages with auto-detect',
          'Conversational brainstorm UX with quick-reply chips and streaming markdown',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Improved Whisper accuracy with beam search, context carryover, and segment overlap',
          'Fixed voice input producing only "you" — now captures raw PCM at correct sample rate',
          'Consistent Rajdhani font in AI agent chat panel and markdown responses',
          'Card relationships now show titles and support cross-project picking',
          'Focus overlay pause/stop buttons are now clickable',
        ],
      },
    ],
  },
  {
    version: '2.2.0',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Open source release — LifeDash is now free and open source under AGPL-3.0',
          'Redesigned README with prominent download button and cleaner layout',
          'Repositioned as a meeting intelligence tool with privacy-first narrative',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
