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
  {
    version: '2.2.16',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Search the Intel Feed — find articles by keyword across all your sources',
          'Bookmarks view — save articles and access them from a dedicated tab',
          'Trending topics — see what themes are popular across your feed',
        ],
      },
    ],
  },
  {
    version: '2.2.15',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: ['Links now open in your default browser instead of getting trapped in an in-app window'],
      },
    ],
  },
  {
    version: '2.2.14',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Intelligence Feed — browse AI and tech news from RSS sources right inside LifeDash',
          'AI Daily & Weekly Briefs — get an AI-generated summary of the most important stories',
          'In-app article reader with clean typography and comfortable reading experience',
          'Reddit support — posts and top comments rendered natively in the reader',
          "Brief Discussion chat — ask AI about the day's news directly from the brief panel",
          'Magazine-style grid layout with hero card for top stories',
          'Article actions — save as idea, start a project, or discuss with AI from any article',
          'Clickable article titles in the daily brief open the in-app reader',
          'Source favicons displayed next to article source names',
          'Updated feature tour and setup wizard with quick-start actions',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          "Daily brief now correctly analyzes only today's articles",
          'Source toggle and delete immediately refreshes the article feed',
          'Fixed modals closing instantly when opened (FocusTrap issue)',
          'RSS feeds work reliably with Reddit, Google AI Blog, and other tricky sources',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
