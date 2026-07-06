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
    version: '2.2.40',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          "Action items now land automatically in your project's Inbox column when a recording ends — no approval click required. Reject any card you don't want.",
          "Auto-detect routes meetings to the right project based on what's said in the transcript. Unrecognized meetings go to an Unassigned inbox with a one-click reassign prompt.",
          'Per-project auto-push override in the board view header — set a project to Always, Never, or follow the global setting.',
          'Global auto-push toggle in Settings → General → Meetings for when you prefer to approve items manually.',
          'Live Assistant drawer — a collapsible panel with the live transcript and an AI chat that is present for the whole recording, not just after it ends.',
          'Ask questions mid-meeting ("What\'s still open?", "Summarize so far") and get answers grounded in what was actually said — no waiting for the meeting to end.',
          "Cards created live — ask the Live Assistant to capture an action item and it lands straight in the project's Inbox column while the meeting is still running.",
          'Fully local by default — the Live Assistant routes to your configured LM Studio or Ollama model just like the rest of LifeDash, so transcripts stay on your machine unless you choose a cloud provider yourself.',
        ],
      },
      {
        category: 'internal',
        label: 'Internal',
        items: [
          'Code-quality hardening: broke 4 circular dependencies, promoted no-explicit-any to error, added no-floating-promises + complexity guardrails.',
        ],
      },
    ],
  },
  {
    version: '2.2.39',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Meeting modal stays open when you assign a project — no more accidental closes mid-edit',
          'Retry/regenerate the meeting brief directly from the brief section if the first pass misses the mark',
          'Create a new project inline from the project picker dropdown — no need to leave the meeting',
        ],
      },
    ],
  },
  {
    version: '2.2.38',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Slovak transcription language support — select Slovak explicitly in the language picker',
          'Two new Whisper models for much better Czech/Slovak accuracy: Enhanced (~539 MB) and Best / large-v3-turbo (~874 MB, recommended)',
          'Mixed-language presets for meetings that switch between Czech, Slovak, and English',
          "The 'Recommended' model badge now reflects the best choice for your selected language",
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Settings model picker now shows a distinct tier label per Whisper model (Basic / Standard / High Quality / Enhanced / Best) instead of calling three different models "Standard"',
          'Corrected the "Better Czech/Slovak transcription available" banner path to "Settings → General → Transcription"',
        ],
      },
    ],
  },
  {
    version: '2.2.37',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Auto-recover microphone — if your mic disconnects during recording, LifeDash automatically reconnects when it comes back and notifies you via toast',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Meeting briefs now work better with local models — improved prompt for fuller coverage',
          "Friendly error message when your local model's context window is too small for a request",
        ],
      },
    ],
  },
  {
    version: '2.2.36',
    sections: [
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Meeting briefs are now concise — short one-sentence bullets instead of verbose paragraphs',
          'Action items now work reliably with local AI models (LM Studio, Ollama) — improved prompt and parser',
        ],
      },
    ],
  },
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
