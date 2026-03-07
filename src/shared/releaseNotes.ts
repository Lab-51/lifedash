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
  // Previous versions — add entries here during releases (max 5 total)
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
