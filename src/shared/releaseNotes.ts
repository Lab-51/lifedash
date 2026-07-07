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
    // V3.1 session-centric pivot (Tasks 1-6) + V3.2 Living Brain (Tasks 1-5) +
    // V3.3 Digital Twin (Tasks 1-5). Version number is a draft — confirm against
    // package.json at release time (/nexus-release owns the actual bump).
    version: '2.3.0',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Sessions is now the home screen — meetings, transcripts, and everything about a recording live in one place, with the nav simplified down to Sessions, Twin, and Settings.',
          'Each session now opens as its own full page instead of a popup — Transcript, Board, and Brain tabs side by side with a rail for the brief, action items, live proposals, and session activity.',
          'The project board now lives right inside a session — switch to the Board tab during or after a meeting to see cards update live as they are created, without leaving the conversation.',
          'A new Session Activity feed shows what happened during a live meeting (or after it) — accepted proposals, assistant tool calls, and new cards — with a click to jump straight to the relevant tab.',
          'Full-text search on the Sessions home — search meeting titles, transcripts, briefs, card titles/descriptions, and project names all from one box, with grouped, ranked results you can jump to instantly.',
          'A new Brain tab renders your workspace — or a single session — as a living, collapsible mind map: expand and collapse branches to browse projects, columns, cards, decisions, and questions.',
          'The Brain map grows live during a session — new cards and updates fade in as they happen, with a small badge on collapsed branches so nothing gets missed while they stay collapsed.',
          'Hover any card, decision, or question in the Brain map to see its dashed provenance link back to the session it came from.',
          'The Brain map is built entirely from your own local data, matches light and dark themes, and asks before expanding an unusually large branch instead of freezing.',
          'A new Digital Twin profile — the professional you work for — authored through a guided 8-step wizard: fully manual, or with an optional local-AI "Interview me" draft per step that you always review and edit before saving.',
          'The Twin page lets you view and edit every profile section — identity, domain, projects, people, vocabulary, goals, and preferences — any time, not just during the wizard.',
          'Once authored, your Twin profile is automatically woven into the Live Assistant, live triage proposals, and meeting briefs — so the assistant speaks your vocabulary, tracks your projects and people, and matches your tone, within a strict per-task budget that never crowds out the meeting itself.',
          "A new Twin Interview Assist row in AI settings lets you route the wizard's optional AI drafting to a different model than Live Assistant, if you'd rather split them.",
        ],
      },
      {
        category: 'internal',
        label: 'Internal',
        items: [
          'Search runs as query-time Postgres full-text search (websearch_to_tsquery) with the query always parameterized — no new indexes or migrations needed at this scale.',
          'The Brain map renders as pure event-driven SVG (d3-hierarchy tidy tree + d3-zoom pan/zoom) — no continuous animation loop, so it costs nothing while idle.',
          'Twin profile context is deterministically serialized and budgeted per task (triage ~800 chars, assistant ~1500, brief ~1200), trimmed at section boundaries only — never mid-sentence — and is a byte-identical no-op when no profile has been authored.',
        ],
      },
    ],
  },
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
          'Live Mode — a full-screen takeover during recording with the live transcript and an AI assistant chat, so you stay present in the meeting instead of juggling a side panel.',
          'Ask questions mid-meeting ("What\'s still open?", "Summarize so far") and get answers grounded in what was actually said — no waiting for the meeting to end.',
          'Proactive proposals — Live Mode surfaces action items, decisions, and questions as they come up during the meeting as one-tap Accept/Dismiss chips. Anything left un-actioned when the meeting ends still shows up afterward in the meeting detail, so nothing gets lost.',
          'The assistant can act on your board mid-meeting — move cards, check project stats, search cards, and capture notes, all without leaving the conversation.',
          "Cards created live — ask the Live Assistant to capture an action item and it lands straight in the project's Inbox column while the meeting is still running.",
          'Fully local by default — Live Mode routes to your configured LM Studio or Ollama model just like the rest of LifeDash, so transcripts stay on your machine unless you choose a cloud provider yourself.',
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
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
