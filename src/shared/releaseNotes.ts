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
    version: '2.2.28',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Saved briefs now open in a slide-in panel — no more losing your place in the feed when reviewing a pinned brief',
          'macOS support (beta) — native Apple Silicon build with Metal GPU acceleration, Homebrew tap install, and automatic update notifications',
        ],
      },
    ],
  },
  {
    version: '2.2.27',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Real-time progress bar when processing recordings — see exactly which segment is being transcribed and how far along it is',
          'Parallel transcription — two audio segments now process at the same time, cutting wait times roughly in half',
          'Speed presets for local Whisper (Fast / Balanced / Accurate) — choose your speed vs. accuracy trade-off in Settings',
          'GPU vs CPU indicator in Settings — see whether Whisper is using GPU acceleration',
        ],
      },
    ],
  },
  {
    version: '2.2.26',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: ['Creator credit with LinkedIn link in Settings → About'],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: ['Saved badge now shows the correct total count (bookmarked articles + saved briefs)'],
      },
    ],
  },
  {
    version: '2.2.25',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Smart article ranking — articles are now scored by AI automatically when fetched, so the best stories surface first',
          'Personalized feed — add your interests in Settings → Intel Feed to boost articles that matter to you',
          'Top/Recent sort toggle in the Intelligence Feed',
          'Duplicate article detection — similar stories from different sources are now merged',
          'Feature guides on every page — dismissible tips that explain how each feature works, with a "How does it work?" button to bring them back',
        ],
      },
    ],
  },
  {
    version: '2.2.24',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: ['Faster recording stop — audio now streams to disk during recording instead of saving all at once'],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: ['Fixed modals occasionally failing to open when clicked'],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
