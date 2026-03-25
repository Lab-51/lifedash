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
  {
    version: '2.2.23',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'RSS article titles and brief text now display cleanly without HTML codes',
          'Improved accessibility: better heading structure, ARIA labels, and command palette usability',
          'Fixed login loop where expired tokens could cause repeated failed refresh attempts',
        ],
      },
    ],
  },
  {
    version: '2.2.22',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: ['Intelligence Brief article links are now reliably clickable for all mentioned stories'],
      },
    ],
  },
  {
    version: '2.2.21',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: ['Fixed sync deleting locally saved RSS articles and intelligence briefs'],
      },
    ],
  },
  {
    version: '2.2.20',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Fixed sync duplicating intel feed articles when the same URL appeared more than once',
          'Fixed a race condition that caused RSS feeds to be fetched twice simultaneously during sync',
          'Fixed sync pulling incorrect XP data column, which could cause XP events to be lost',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
