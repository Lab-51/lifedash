<div align="center">

<img src="docs/icon.svg" alt="LifeDash" width="80" />

# LifeDash

**Your meetings. Your data. Your machine.**

Free, open-source meeting intelligence with a **learning digital twin** — running entirely on your desktop.
Record a meeting and the app *becomes* that session: a profiled AI assistant works alongside you, everything said turns into a living, searchable knowledge graph, and nothing ever leaves your computer.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Lab-51/lifedash/releases/latest)
[![Install on macOS (Beta)](https://img.shields.io/badge/Install-macOS%20(Beta)-000000?style=for-the-badge&logo=apple&logoColor=white)](#macos)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Lab-51/lifedash?style=social)](https://github.com/Lab-51/lifedash)
[![Latest Release](https://img.shields.io/github/v/release/Lab-51/lifedash)](https://github.com/Lab-51/lifedash/releases/latest)

<br />

<video src="https://github.com/user-attachments/assets/9cda3cce-4e80-4e99-be6d-c7c8e9413523" width="900" autoplay loop muted playsinline></video>

[Website](https://lifedash.space) · [Report Bug](https://github.com/Lab-51/lifedash/issues) · [Request Feature](https://github.com/Lab-51/lifedash/issues)

</div>

---

## What is LifeDash?

LifeDash records your meetings, transcribes them locally with Whisper, and generates briefs and action items — all offline, no accounts. But it goes further than a transcriber: **the recording session is the center of the app.**

A **Digital Twin** — built from a profile of your work and continuously learning from every session — works visibly alongside you during a meeting, answering questions and proposing and creating cards on a built-in Kanban board. Everything it hears builds a **living, queryable brain** (sessions → projects → cards → decisions → people) that you can watch grow as a mind map and search in plain language — *"what did we decide about pricing?"* — **answered, with citations, from your own past meetings.**

All of it runs **100% locally by default** — audio, transcription, reasoning, embeddings, and memory never have to leave the machine. Cloud is a per-task, clearly-labeled opt-in.

### Platform Support

| Platform | Status |
|----------|--------|
| Windows 10+ | Available. [Download the installer](https://github.com/Lab-51/lifedash/releases/latest) |
| macOS 12.3+ (Monterey) | Beta. `brew tap lab-51/lifedash && brew install --cask lifedash` ([manual install](#macos)) |
| Linux | [Planned](https://github.com/Lab-51/lifedash/issues/2). Contributions welcome |

## Why LifeDash?

| Feature | LifeDash | Otter.ai | Fireflies | Fathom |
|---------|:--------:|:--------:|:---------:|:------:|
| Local processing | Yes | No | No | No |
| Data leaves your machine | Never | Always | Always | Always |
| Works offline | Yes | No | No | No |
| Meeting transcription | Yes | Yes | Yes | Yes |
| AI briefs & summaries | Yes | Yes | Yes | Yes |
| Action item extraction | Yes | Yes | Yes | Yes |
| Project management | Yes | No | No | No |
| Learning digital-twin assistant | Yes | No | No | No |
| Ask your own meetings (cited, local) | Yes | No | No | No |
| Bring your own AI key | Yes | No | No | No |
| Open source | Yes | No | No | No |
| **Price** | **Free** | **$204/yr** | **$216/yr** | **$384/yr** |

## Download

**Just want to use it?** Grab the installer. No dev tools needed.

### Windows

1. Go to the [latest release](https://github.com/Lab-51/lifedash/releases/latest)
2. Download `LifeDash-X.X.X-Setup.exe`
3. Run the installer
4. Open LifeDash, add your AI API key (or point it at a local model) in the setup wizard, and start recording

### macOS

**Option A — Homebrew (recommended):**

```bash
brew tap lab-51/lifedash && brew install --cask lifedash
```

**Option B — Direct DMG download:**

1. Download `LifeDash-X.X.X-mac-arm64.dmg` from the [latest release](https://github.com/Lab-51/lifedash/releases/latest)
2. Open the DMG, drag LifeDash to Applications
3. **Important:** macOS will show "LifeDash is damaged" because the app is not yet Apple-notarized. Run this once to fix it:
   ```bash
   xattr -cr /Applications/lifedash.app
   ```
4. Open LifeDash normally

> Requires macOS 12.3 (Monterey) or later. Apple Silicon only (M1/M2/M3/M4).

> The app uses an embedded database and runs fully offline. No accounts, no cloud, nothing to configure beyond the installer.

## Features

### The Session Workspace
- The recording session is home — **Transcript · Board · Brain** on one switchable canvas
- A live rail for the brief, action items, twin proposals, and a session activity feed
- The relevant Kanban board is embedded right in the session — cards appear and move live as they're created, without leaving the conversation
- Post-meeting, each session is its own full page you can revisit, search, and continue working from

### The Digital Twin
- Author a profile of the professional you are — through a guided wizard (fully manual, or with an optional local-AI "Interview me" draft you always review), from a short brief, or mined from your own meeting history with explicit per-run consent
- Once authored, the Twin is woven into the **live assistant, live triage, and briefs** — so they speak your vocabulary, track your projects and people, and match your tone, within a strict budget that never crowds out the meeting
- **It learns from every finished session** — distilling a few durable facts (people, projects, preferences, commitments) into an **auditable memory**: every fact links to the session it came from, one tap forgets it for good, and a single switch pauses all learning
- Optional cited web research and deep, orchestrated profile creation on a frontier provider — nothing is saved until you confirm

### Meeting Intelligence
- Record system audio + microphone
- Real-time transcription (local Whisper or cloud providers)
- AI-generated meeting briefs and summaries
- Automatic action item extraction, turned into board cards in one click
- Speaker diarization and meeting analytics
- A proactive in-meeting assistant that proposes actions (propose → one-tap accept) and executes board work as you talk

### The Living Brain
- A collapsible **mind map** of your workspace — or a single session — rendered from your own local data
- It **grows live** during a meeting: new cards fade in, with a badge on collapsed branches so nothing is missed
- Hover any card, decision, or question to trace its provenance back to the session it came from
- Its first **semantic layer**: the people and topics from each meeting become entities linked across every session they appear in

### Search That Understands Meaning
- Full-text search across sessions, transcripts, briefs, cards, and projects — grouped, ranked, one click to jump in
- **Semantic search:** a paraphrase finds the right session even when the words don't match
- **Ask:** get a short, cited answer drawn straight from your own sessions — and an honest "I don't find that in your sessions" instead of a guess
- **Local-first:** the index is built on-device by default; choosing a cloud embedding model warns you, at that moment, that your content would be sent — it never happens silently

### Project Board
- Turn action items into Kanban cards, seen through the sessions that created them
- Drag-and-drop cards with customizable columns
- Card detail view with rich text, comments, checklists, due dates, labels, and tags
- **Card & Project Agents** (tool-calling AI per card/board) and **background agents** for autonomous stale-card detection and project insights

### Privacy by Design
- All data stored locally in embedded PostgreSQL (PGlite); audio recordings stay on your machine
- Local reasoning (LM Studio / Ollama) and **local embeddings** by default — cloud is a per-task, visible opt-in that warns before sending bulk content
- AI uses YOUR API keys. We never see your data
- Optional cloud sync (Supabase) — off by default, fully opt-in
- Encrypted API key storage via OS keychain
- Factory reset with full data deletion
- Open source. Read the code yourself

### Built to Last
- **Crash recovery** — The app takes periodic snapshots of your work. If it shuts down unexpectedly, you get a recovery dialog on next launch to restore exactly where you left off
- **Database integrity checks** — Every startup verifies your data is intact across all tables, with automatic retry if the database is slow to connect
- **Atomic backup/restore** — Restores run inside a database transaction. If anything goes wrong mid-restore, the whole thing rolls back and your original data stays untouched
- **Structured logging** — Daily log files with automatic rotation make it easy to diagnose issues without digging through console output
- **Graceful AI degradation** — If your AI provider is down or misconfigured, you get fallback behavior and clear error messages instead of crashes or silent failures; learning and semantic-index jobs are error-isolated so they can never break a brief
- **Keyboard accessible** — Every modal traps focus properly, cycles with Tab/Shift+Tab, and closes with Escape. Screen readers work out of the box
- **Input validation everywhere** — Every IPC channel validates its inputs at runtime with Zod schemas, not just at compile time
- **Optional crash reporting** — Opt-in Sentry integration strips all personal data (file paths, API keys) before sending. Off by default, always under your control
- **"What's New" on update** — After each update, a release notes modal shows what changed so you always know what's new

---

## Build from Source

> **For developers and contributors.** Most users should [download the installer](#download) instead.

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (includes npm)
- [Git](https://git-scm.com/)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload (needed for native modules)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

### Install & Run

```bash
git clone https://github.com/Lab-51/lifedash.git
cd lifedash
npm install
npm start
```

No database setup. The app uses PGlite (embedded PostgreSQL) and runs migrations on first launch.

### Configuration

- **AI API keys:** Set them in the Settings page. Keys are stored using OS-level encryption via Electron safeStorage.
- **Local models:** Point any task at LM Studio or Ollama for fully-private reasoning. Semantic search needs a local embedding model (e.g. a multilingual EmbeddingGemma-300M-class model in LM Studio) assigned to the Embedding task.
- **Whisper model:** Download and manage local Whisper models from Settings.
- **Transcription providers:** Deepgram and AssemblyAI can be configured as cloud alternatives to local Whisper.
- **Cloud sync:** Optionally sign in with Supabase to sync data across devices. Off by default.
- **Data export:** Export your entire database as JSON or CSV from Settings > Data & Storage.

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails with `node-gyp` errors | Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload |
| `npm install` fails with Python errors | Install Python 3.x and set `npm config set python python3` |
| App shows white screen on start | Run `npm run lint` to check for TypeScript errors |

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Launch in dev mode |
| `npm run package` | Package for distribution |
| `npm run make` | Build platform installers |
| `npm run lint` | Type-check with TypeScript |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:generate` | Generate migration files |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |

## Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Electron |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Database | PGlite (embedded WASM PostgreSQL) + pgvector |
| ORM | Drizzle ORM |
| AI SDK | Vercel AI SDK |
| AI Providers | OpenAI, Anthropic, Google (Gemini), LM Studio, Ollama, Kimi |
| Embeddings | Local by default (LM Studio) — on-device semantic index |
| Semantic search | pgvector (HNSW) + Postgres full-text, hybrid RRF fusion |
| Transcription Providers | Deepgram, AssemblyAI |
| Transcription | @fugood/whisper.node (local) |
| Brain / mind map | d3-hierarchy + d3-zoom (event-driven SVG) |
| Drag and Drop | @atlaskit/pragmatic-drag-and-drop |
| State | Zustand |
| Rich Text | TipTap |
| Animation | Framer Motion |
| Icons | Lucide React |
| Routing | React Router |
| Build | Vite |
| Cloud Sync | Supabase (optional) |
| Testing | Vitest |

## Project Structure

```
src/
  main/               # Electron main process
    db/                # Schema, migrations, connection (PGlite + pgvector)
    ipc/               # IPC handlers (100+ channels)
    services/          # Business logic (AI, transcription, twin, embeddings, brain, backup)
    workers/           # Background workers (transcription)
  preload/             # Electron preload bridge
  renderer/            # React frontend
    components/        # Session workspace, Twin, Brain mind map, Board, Settings, UI
    hooks/             # Custom React hooks
    pages/             # Route pages (Sessions, session detail, Twin, Board, Settings)
    services/          # Frontend service layer
    stores/            # Zustand state management
    styles/            # Global styles
  shared/              # Types and utilities shared across processes
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on reporting issues and submitting pull requests.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). For commercial licensing inquiries, contact the author directly.
