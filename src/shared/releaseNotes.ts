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
  version: '2.0.11',
  sections: [
    {
      category: 'new',
      label: "What's New",
      items: [
        'AI Insights consolidated across all projects into a single card per detection type',
        'Per-project analysis selection for AI background analysis',
      ],
    },
    {
      category: 'fixes',
      label: 'Fixes',
      items: [
        'Fixed crash when opening the AI settings tab',
        'Project picker moved from settings to the dashboard',
        'Insights panel auto-opens when clicking the project scope toggle',
      ],
    },
  ],
};
