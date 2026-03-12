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
  {
    version: '2.2.10',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Sign-in now correctly updates the UI — no more stuck "Sign in to enable cloud sync" screen',
        ],
      },
    ],
  },
  {
    version: '2.2.9',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Two-way sync — edits made on the web companion now sync back to the desktop app in real time',
          'Cloud sync indicator in the title bar — always visible next to "Up to date"',
          'Redesigned sign-in window to match the app aesthetic',
          'Sign-up flow now works correctly with email confirmation',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Items deleted on the web are now removed locally during sync',
          'Sync schema is now idempotent — safe to re-run without errors',
          'Sign-up toggle link now responds to clicks in the auth window',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
