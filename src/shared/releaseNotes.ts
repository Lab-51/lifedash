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
    // V3.3 Digital Twin (Tasks 1-5) + V3.3.5/V3.3.6 + V3.4 + GUARD.1.
    // Shipped as 2.3.1, not 2.3.0: the v2.3.0 tag/release was already public
    // (macOS assets from an earlier, older commit) by the time this was ready,
    // so this content ships under the next clean version instead.
    version: '2.3.1',
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
          'Deep Creation for your Twin — beyond the manual form, build your profile from a short brief-seeded interview, or from your own meeting history (excerpts, briefs, projects, and cards) with an explicit per-run consent prompt before anything is ever sent to a cloud model. On a frontier provider you can also enrich it with cited public web research. Every path lands an editable draft in review — nothing is saved until you confirm.',
          'The Deep interview is now guided end to end — start from your role (optionally researched on a frontier model into a cited dossier of the vocabulary, goals, and identity typical of your field), answer a short gap-focused interview, optionally fold in your meeting history, then review one merged draft that augments your existing profile instead of overwriting it.',
          'Google Gemini is now a first-class AI provider — add a Gemini API key in Settings and route any task (including Twin creation and web research) to it, right alongside OpenAI, Anthropic, and your local models.',
          'Your Twin now learns from every finished session — it pulls a few durable facts (the people you work with, your projects, preferences, and commitments) out of each brief into a memory you can audit: every fact shows the session it came from, one tap forgets any fact for good, and a single switch pauses all learning.',
          'Search now understands meaning, not just keywords — a paraphrase finds the right session even when the exact words don\'t match — and a new "Ask" answers questions straight from your own sessions with citations, saying plainly when it doesn\'t find something instead of guessing.',
          'Semantic search stays local-first: the index is built on-device by default, and choosing a cloud embedding model warns you, right at that moment, that your briefs, transcripts, and cards would be sent — it never happens silently.',
          "The Brain now grows its first people and topics — each session's key names and subjects become flat entities linked across every session they appear in, so you can see who and what recurs across your work and jump to the sessions behind them.",
          'A recording left running in silence now warns you before it does anything — after 10 minutes of no audio (configurable, or turn it off entirely in Settings), a banner and desktop notification start a 2-minute countdown with a one-tap "Keep recording", and if it\'s genuinely unattended the recording stops the normal, clean way and is saved just like any other meeting.',
          'A new "Local-only transcription" switch in Settings guarantees meeting audio never leaves your machine — it overrides any cloud provider back to local Whisper for every recording, and blocks the one operation (speaker diarization) that has no local equivalent rather than letting it slip through.',
          'Switching your transcription provider from local Whisper to a cloud service (Deepgram, AssemblyAI) now asks for explicit confirmation every time, naming exactly which provider your audio would be sent to — nothing is sent until you confirm, and declining keeps you on local.',
          'Every AI provider and transcription option in Settings now carries a small "Local" or "Cloud" badge so you can see at a glance where your data goes before you choose.',
        ],
      },
      {
        category: 'internal',
        label: 'Internal',
        items: [
          'Search runs as query-time Postgres full-text search (websearch_to_tsquery) with the query always parameterized — no new indexes or migrations needed at this scale.',
          'The Brain map renders as pure event-driven SVG (d3-hierarchy tidy tree + d3-zoom pan/zoom) — no continuous animation loop, so it costs nothing while idle.',
          'Twin profile context is deterministically serialized and budgeted per task (triage ~800 chars, assistant ~1500, brief ~1200), trimmed at section boundaries only — never mid-sentence — and is a byte-identical no-op when no profile has been authored.',
          "V3.4 adds a pgvector semantic index (HNSW) over briefs, cards, and transcript chunks with hybrid full-text + vector retrieval (RRF fusion); it degrades to exactly today's full-text results when no embedding model is configured, records the model it was built with (rebuild-on-mismatch), and runs all learning/embedding jobs on an error-isolated post-session seam so they never block a brief.",
          "Fixed macOS auto-update, which had been silently compiled out of every release since 2.2.34: the release build now sets OFFICIAL_BUILD at build time (both locally and in CI), and the publish preflight fails fast if it's missing instead of shipping another update-less build.",
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
