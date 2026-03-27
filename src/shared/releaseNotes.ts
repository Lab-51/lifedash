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
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
