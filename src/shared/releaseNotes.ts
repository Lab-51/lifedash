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
    version: '2.2.7',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Cloud Sync — sign in and sync your projects, meetings, briefs, and ideas to the cloud',
          'Access your data from the web companion (coming soon)',
          'Sync status indicator in the status bar with real-time feedback',
          'Audio recordings always stay on your machine — only summaries and metadata sync',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Removed meeting prep section from recording project selector',
        ],
      },
    ],
  },
  {
    version: '2.2.6',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Crash recovery — the app snapshots your work periodically and offers to restore it after unexpected shutdowns',
          'Database integrity checks on every startup with automatic connection retry',
          'Atomic backup/restore — failed restores roll back cleanly so your data stays intact',
          'Graceful AI degradation — fallback summaries and clear messages when your AI provider is unavailable',
          'Transcription failure notifications — the app now tells you when transcription stops working instead of failing silently',
          'Full keyboard navigation with focus trapping in every modal',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'All IPC channels now validate inputs at runtime (100% Zod coverage)',
          'Structured file logging with automatic daily rotation',
          'Optional crash reporting with automatic PII stripping (opt-in)',
        ],
      },
    ],
  },
  {
    version: '2.2.5',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Font size setting — choose Small, Default, Large, or Extra Large in Settings > Appearance',
          'Cancel button for meeting recording and voice input across all features',
        ],
      },
    ],
  },
  {
    version: '2.2.4',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Larger, more readable text in brainstorm chat',
          'AI responses are now shorter with 1-2 examples and an option to expand',
        ],
      },
    ],
  },
  {
    version: '2.2.3',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Clearer error messages when API key validation fails in Settings and Setup Wizard',
        ],
      },
      {
        category: 'new',
        label: "What's New",
        items: [
          'App icon now displayed in the README header',
        ],
      },
    ],
  },
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
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
