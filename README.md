<div align="center">

<img src="docs/icon.svg" alt="LifeDash" width="80" />

# LifeDash

**Your meetings. Your data. Your machine.**

Free, open-source meeting intelligence that runs entirely on your desktop.
Record, transcribe, and pull out action items. Nothing leaves your computer.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Lab-51/lifedash/releases/latest)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Lab-51/lifedash?style=social)](https://github.com/Lab-51/lifedash)
[![Latest Release](https://img.shields.io/github/v/release/Lab-51/lifedash)](https://github.com/Lab-51/lifedash/releases/latest)

<br />

<img src="docs/lifedash.png" alt="LifeDash Dashboard" width="900" />

[Website](https://lifedash.space) · [Report Bug](https://github.com/Lab-51/lifedash/issues) · [Request Feature](https://github.com/Lab-51/lifedash/issues)

</div>

---

## What is LifeDash?

LifeDash records your meetings, transcribes them locally with Whisper, generates briefs, and pulls out action items. No cloud. No accounts. Push those action items straight to a built-in Kanban board, brainstorm with AI, track your time. One app.

### Platform Support

| Platform | Status |
|----------|--------|
| Windows 10+ | Available. [Download the installer](https://github.com/Lab-51/lifedash/releases/latest) |
| macOS | [Planned](https://github.com/Lab-51/lifedash/issues/1). Contributions welcome |
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
| Bring your own AI key | Yes | No | No | No |
| Open source | Yes | No | No | No |
| **Price** | **Free** | **$204/yr** | **$216/yr** | **$384/yr** |

## Download

**Just want to use it?** Grab the installer. No dev tools needed.

1. Go to the [latest release](https://github.com/Lab-51/lifedash/releases/latest)
2. Download `LifeDash-X.X.X-Setup.exe`
3. Run the installer
4. Open LifeDash, add your AI API key in the setup wizard, and start recording

> The app uses an embedded database and runs fully offline. No accounts, no cloud, nothing to configure beyond the installer.

## Features

### Meeting Intelligence
- Record system audio + microphone
- Real-time transcription (local Whisper or cloud providers)
- AI-generated meeting briefs and summaries
- Automatic action item extraction
- Speaker diarization and meeting analytics
- Searchable transcript archive
- Meeting templates (standup, retro, planning, etc.)

### From Action Items to Project Board
- Turn action items into Kanban cards in one click
- Link meetings to projects
- Drag-and-drop cards with customizable columns
- Card detail view with rich text, comments, checklists, due dates
- Labels, tags, and search across all projects

### AI Agents
- **Card Agent**: AI assistant per task (tool-calling, checklist management, research)
- **Project Agent**: AI assistant per project (cross-board intelligence)
- **Background Agents**: Autonomous project analysis and insights
- **Brainstorm Sessions**: Conversational AI for ideation with project context
- **Idea Repository**: Capture, tag, analyze, and convert ideas to projects

### Focus & Time Tracking
- Pomodoro-style focus sessions
- Billable time tracking with hourly rates
- Project-level time reports
- CSV export for invoicing

### Privacy by Design
- All data stored locally in embedded PostgreSQL (PGlite)
- Audio recordings stay on your machine
- AI uses YOUR API keys. We never see your data
- No accounts, no cloud sync, no telemetry
- Encrypted API key storage via OS keychain
- Open source. Read the code yourself

### Built to Last
- **Crash recovery** — The app takes periodic snapshots of your work. If it shuts down unexpectedly, you get a recovery dialog on next launch to restore exactly where you left off
- **Database integrity checks** — Every startup verifies your data is intact across all tables, with automatic retry if the database is slow to connect
- **Atomic backup/restore** — Restores run inside a database transaction. If anything goes wrong mid-restore, the whole thing rolls back and your original data stays untouched
- **Structured logging** — Daily log files with automatic rotation make it easy to diagnose issues without digging through console output
- **Graceful AI degradation** — If your AI provider is down or misconfigured, you get fallback summaries and clear error messages instead of crashes or silent failures
- **Keyboard accessible** — Every modal in the app traps focus properly, cycles with Tab/Shift+Tab, and closes with Escape. Screen readers work out of the box
- **Input validation everywhere** — Every IPC channel validates its inputs at runtime with Zod schemas, not just at compile time
- **Optional crash reporting** — Opt-in Sentry integration strips all personal data (file paths, API keys) before sending. Off by default, always under your control

---

## Build from Source

> **For developers and contributors.** Most users should [download the installer](#download) instead.

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (includes npm)
- [Git](https://git-scm.com/)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload (needed for native modules)

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
- **Whisper model:** Download and manage local Whisper models from Settings.
- **Transcription providers:** Deepgram and AssemblyAI can be configured as cloud alternatives to local Whisper.

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
| Database | PGlite (embedded WASM PostgreSQL) |
| ORM | Drizzle ORM |
| AI SDK | Vercel AI SDK |
| AI Providers | OpenAI, Anthropic, Ollama, Deepgram, AssemblyAI |
| Transcription | @fugood/whisper.node (local) |
| Drag and Drop | @atlaskit/pragmatic-drag-and-drop |
| State | Zustand |
| Rich Text | TipTap |
| Animation | Framer Motion |
| Icons | Lucide React |
| Routing | React Router |
| Build | Vite |
| Testing | Vitest |

## Project Structure

```
src/
  main/               # Electron main process
    db/                # Schema, migrations, connection
    ipc/               # IPC handlers (100+ channels across 17 modules)
    services/          # Business logic (AI, transcription, backup, etc.)
    workers/           # Background workers (transcription)
  preload/             # Electron preload bridge
  renderer/            # React frontend
    components/        # Reusable UI components
    hooks/             # Custom React hooks
    pages/             # Route pages (Board, Meetings, Ideas, etc.)
    services/          # Frontend service layer
    stores/            # Zustand state management
    styles/            # Global styles
  shared/              # Types and utilities shared across processes
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on reporting issues and submitting pull requests.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). For commercial licensing inquiries, contact the author directly.
