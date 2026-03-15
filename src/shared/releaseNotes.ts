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
  {
    version: '2.2.13',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Cloud sync pull no longer crashes on date fields from Supabase',
          'Enable Cloud Sync checkbox responds immediately after sign-in',
        ],
      },
    ],
  },
  {
    version: '2.2.12',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Backup restore now works reliably — fixed date handling and settings conflicts',
          'Cloud sync no longer deletes local data when remote is empty',
          'Dashboard refreshes automatically after restoring a backup',
        ],
      },
    ],
  },
  {
    version: '2.2.11',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Cloud sync now works for all table types — fixed query errors for boards, columns, meetings, and more',
          'Title bar sync status clears properly after signing out',
          'Sign-in now correctly updates the UI',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
