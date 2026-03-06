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
  version: '2.1.0',
  sections: [
    {
      category: 'new',
      label: "What's New",
      items: [
        'Auto-assign button for model assignments — instantly picks the best models for your provider',
        'Feature tour for new users to discover key capabilities',
        'Contextual help tips throughout the interface',
        'Empty feature states with guided onboarding for each section',
      ],
    },
    {
      category: 'fixes',
      label: 'Fixes',
      items: [
        'Consistent Rajdhani font across all descriptions and settings',
        'Provider cards now pin action buttons to the bottom and handle long URLs gracefully',
        'Updated Anthropic model list with Opus 4.6 and Sonnet 4.6',
      ],
    },
  ],
};
