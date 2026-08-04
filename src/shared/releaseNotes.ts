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
    // LOCAL-RT.1 — Built-in local AI runtime (bundled llama.cpp + model manager).
    // DRAFT entry ahead of the 2.7.0 release ceremony (which owns the version bump).
    version: '2.7.0',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'LifeDash now runs AI by itself. No second app to install, no API key, no account — pick a model in the setup wizard and it runs on your machine, using your GPU where one is available.',
          'Choose from a built-in model catalog with the tradeoffs spelled out: how much disk and RAM each one needs, where it came from, its license, and whether it can actually act on your board or only answer. Downloads resume where they left off and are checksum-verified before use.',
          'Not sure which to pick? Qwen3 4B (~2.5 GB) is the smallest model that can still create and move cards for you — a solid default on an 8 GB machine.',
          'Semantic search works out of the box too — the same step sets up a small local embedding model, so "what did we decide about pricing?" works without any cloud service.',
          'A new Local AI section in Settings manages everything: download or remove models, see exactly how much space each frees when you delete it, add your own GGUF file, and watch the runtime status live.',
          'Nothing runs behind your back. The model starts when you use it, shows a status card with a Stop button, and shuts itself down after 15 idle minutes. Installing this update starts nothing.',
          'Already using LM Studio, Ollama, or a cloud key? Nothing changes — your setup is untouched and all of them remain fully supported per task.',
          "See the built-in runtime's real performance, not just whether it's running: the status bar and Settings → Local AI's runtime card now show live tokens-per-second and context usage, both read from the exact same measurement so the two can never disagree. That figure is measured end-to-end at the moment LifeDash calls the model, so it includes a little queue/transport overhead and reads slightly lower than llama.cpp's own internal number. It does not show VRAM or overall system load.",
          'Downloading a model now switches the built-in runtime on for you — the provider is created and the model routed automatically, including models you downloaded before this update (picked up on the next start). Your existing assignments are never overwritten: if a task already points at LM Studio, Ollama, or a cloud model, it stays exactly where you put it.',
          'The meeting assistant chat can now start fresh: "New chat" keeps the old conversation in an archive you can reopen read-only, and "Clear" permanently empties the current one (with a confirmation — your transcript, brief, cards and learned facts are never touched, the chat is not a source for any of them).',
          'An empty meeting assistant now offers one-click starter questions ("What tasks do I need to do?", "What was decided?") instead of a blank box, and its work log names what it actually searched for, collapsing repeated steps instead of listing each one.',
          'The meeting workspace side panel is now resizable and collapsible, and remembers your width. Meeting analytics lay out to the panel instead of the window, so numbers no longer truncate.',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          "The post-meeting assistant could answer from your profile's general context instead of the meeting itself — most visibly when its brief had not finished generating. Answers are now grounded in the meeting's own brief, follow-up questions remember what earlier answers already found in the transcript, and when the assistant genuinely could not read the meeting it says so plainly instead of guessing.",
          'Dropdowns near the bottom of the window now open upward instead of running off-screen, so the last options are always reachable.',
          'The setup wizard now fits on screen on large displays — the Back, Skip, and confirm buttons could previously render below the visible area.',
        ],
      },
      {
        category: 'internal',
        label: 'Licenses',
        items: [
          'The bundled local AI runtime is llama.cpp (MIT), redistributed unmodified from its official release build. Full attribution and license text ship with the app in THIRD_PARTY_NOTICES.md. LifeDash itself stays under the PolyForm Noncommercial License 1.0.0.',
        ],
      },
    ],
  },
  {
    // CAL-UX.2 — Agenda Views, Event Details & Meeting Context. DRAFT entry ahead
    // of the 2.6.0 release ceremony (which owns the actual version bump).
    version: '2.6.0',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'See your week the way you want it — the Upcoming meetings panel now has three switchable views: the day-grouped list, a week board (default), and an Outlook-style hour timeline. Your choice is remembered.',
          "Click any meeting to open its details — time, attendees, recurring badge, and the suggested project — with a one-tap jump to the recorded session if you've already captured it, or straight into recording if you haven't.",
          'Meetings now remember each other: for recurring meetings the details show what happened last time — a snippet of the previous brief, the action items still open from it, and what your Brain already knows about the attendees. Instant, on-device lookups — no AI involved.',
          "Want more than a lookup? A 'Generate prep note' button asks your local model to write a short prep briefing from that context — only when you press it, never in the background.",
          'Meeting details now include the invite description (converted to plain text, stored only on your device, never synced) and the full attendee list with emails. Outlook needs a one-time reconnect to grant description access; Google works as-is.',
        ],
      },
      {
        category: 'internal',
        label: 'License',
        items: [
          'Starting with this release, LifeDash is licensed under the PolyForm Noncommercial License 1.0.0: free for personal and noncommercial use, while commercial use requires a license from the author. The source code remains fully public and inspectable. Releases up to v2.5.0 stay AGPL-3.0.',
        ],
      },
    ],
  },
  {
    // Phase G — Calendar Integration + BRAIN-UX.1 — Entity Knowledge &
    // Post-Meeting Chat + INTEL-FIX.1. Consolidated: the 2.4.0 draft (calendar)
    // was never released before BRAIN-UX.1 landed on main, so both ship
    // together as a single 2.5.0 (avoids a tag whose binaries would contain
    // features the release label doesn't claim).
    version: '2.5.0',
    sections: [
      {
        category: 'new',
        label: "What's New",
        items: [
          'Connect your Google or Microsoft/Outlook calendar so your upcoming meetings can drive recording — no more picking a project from a dropdown before you hit record.',
          'A new event ribbon on the Sessions home surfaces meetings that are about to start, with a one-click "Start recording" that prefills the title and project for you — nothing ever records automatically.',
          "Your upcoming week is always in view — the Sessions home shows a 7-day agenda grouped by day (Today, Tomorrow, and beyond) that stays visible even when it's empty, with a refresh button to sync with your calendar on demand.",
          'Choose exactly which calendars LifeDash syncs — pick any combination per account under Settings. Existing Google connections will ask you to reconnect once to grant calendar-list access.',
          'LifeDash learns which project a recurring meeting belongs to: record the same series against a project a couple of times and it starts suggesting that project on its own.',
          'A heads-up while you record — if another meeting is coming up soon, an in-recording banner tells you how many minutes you have left before the next one.',
          'Privacy-first by design: the calendar integration is read-only and metadata-only — it stores just event titles, times, and attendees, locally on your device. Event descriptions are never read in, and nothing is sent anywhere except to your own calendar provider.',
          'Connect in one click with the built-in setup, or bring your own OAuth app credentials under an Advanced option in Settings — either way, tokens are stored encrypted on your machine and your client secret is never shown back to you.',
          "The Brain now groups itself into Projects, People, and Topics — instead of one flat tree, you get three clear branches (plus Unlinked sessions) so it's obvious at a glance who and what your work is organized around.",
          "People and topics in the Brain now carry a real fact profile: durable facts your Twin learned about them, each one showing exactly which session it came from, with a one-tap forget for anything you don't want remembered.",
          '"Analyze past sessions" lets you backfill a person or topic\'s fact profile from meetings that happened before this feature existed — entirely on-demand, never automatic, so nothing runs in the background without you asking.',
          "Every finished session now has a post-meeting chat — ask questions about what was discussed and get grounded answers straight from that meeting's transcript, with no side-effect tools (it can't move cards or touch your board, just answer).",
          'The transcript view is easier to read and stays out of your way by default — it opens collapsed and expands automatically when a search result points you into it.',
          'The Intel news feed is back in the sidebar as a first-class destination.',
        ],
      },
      {
        category: 'fixes',
        label: 'Fixes',
        items: [
          'Intel feed: bookmarking now works from the reader panel and daily briefs, deleting an article no longer silently fails, and manually added articles show up immediately instead of vanishing into a disabled source.',
          'Intel feed: the Saved view now shows exactly what its badge counts — bookmarks no longer age out of the list after a week, and removing a source cleans up its reader and filter state instead of erroring.',
        ],
      },
    ],
  },
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
];

/** Current release notes (latest entry). */
export const releaseNotes: ReleaseNotesData = releaseHistory[0];
