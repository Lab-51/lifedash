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
    version: '2.2.31',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Grid/list view toggle on the Projects page — switch between card grid and compact list view, preference is remembered',
          'Drag-and-drop project reordering — arrange projects in any order you want by dragging them (works in both grid and list views)',
        ],
      },
    ],
  },
  {
    version: '2.2.30',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Quick record shortcut (Ctrl+Shift+R) — start or stop a recording instantly from anywhere in the app',
          'Recording completion toast — when a meeting finishes processing, a notification appears with a "View Results" button so you never miss it',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Keyboard shortcuts help modal now shows the correct page for every shortcut (Ctrl+2 through Ctrl+8 were wrong)',
        ],
      },
    ],
  },
  {
    version: '2.2.29',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'GPU transcription now works in the packaged app — native Vulkan/CUDA addons were missing from the build, causing silent CPU fallback',
        ],
      },
    ],
  },
  {
    version: '2.2.28',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Saved briefs now open in a slide-in panel — no more losing your place in the feed when reviewing a pinned brief',
          'macOS support (beta) — native Apple Silicon build with Metal GPU acceleration, Homebrew tap install, and automatic update notifications',
        ],
      },
    ],
  },
  {
    version: '2.2.27',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Real-time progress bar when processing recordings — see exactly which segment is being transcribed and how far along it is',
          'Parallel transcription — two audio segments now process at the same time, cutting wait times roughly in half',
          'Speed presets for local Whisper (Fast / Balanced / Accurate) — choose your speed vs. accuracy trade-off in Settings',
          'GPU vs CPU indicator in Settings — see whether Whisper is using GPU acceleration',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
