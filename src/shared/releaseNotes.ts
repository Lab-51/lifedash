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
  version: '2.0.16',
  sections: [
    {
      category: 'fixes',
      label: 'Fixes',
      items: [
        'Fixed "Enter License Key" button in trial banner not opening the License tab',
        'App now follows your OS light/dark theme by default on first launch',
        'Clarified that local AI (Ollama) is for advanced users with capable hardware',
      ],
    },
  ],
};
