// === FILE PURPOSE ===
// Embedded release notes for the current version.
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

export const releaseNotes: ReleaseNotesData = {
  version: '2.0.19',
  sections: [
    {
      category: 'new',
      label: "What's New",
      items: [
        'Simplified meeting action items push-to-project experience with inline column picker',
        'Approve now doubles as selection — no more separate checkboxes',
      ],
    },
  ],
};
