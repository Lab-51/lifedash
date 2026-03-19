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
  {
    version: '2.2.19',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: ['Delete your account and all cloud data from the Settings page'],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Fixed a critical bug where newly created projects and cards could be deleted by sync',
          'Article links in the Intelligence Brief now open the in-app reader correctly',
          'Article reader no longer shows "could not load" when a description is available',
          'Intelligence Feed now shows articles from the past week by default instead of today only',
          'Reduced background RSS fetch frequency to avoid unnecessary network activity',
        ],
      },
    ],
  },
  {
    version: '2.2.18',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: ['Brief history and pinning — save, browse, and pin your favorite intel briefs'],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Sync Now button now shows clear visual feedback (spinner, success, or error)',
          'Cloud sync service initializes reliably on startup',
          'Fixed database migration blocker that prevented sync from working',
        ],
      },
    ],
  },
  {
    version: '2.2.17',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Bookmarking articles from the reader preview now works correctly',
          'Long text no longer overflows chat message bubbles in Brainstorm',
          'Cleaned up duplicate category row in the Intel Feed',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
