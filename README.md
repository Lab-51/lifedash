<div align="center">

# LifeDash

**Your meetings. Your data. Your machine.**

Free, open-source meeting intelligence that never leaves your desktop.
Record, transcribe, and extract action items — 100% locally.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Lab-51/lifedash/releases/latest)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Lab-51/lifedash?style=social)](https://github.com/Lab-51/lifedash)
[![Latest Release](https://img.shields.io/github/v/release/Lab-51/lifedash)](https://github.com/Lab-51/lifedash/releases/latest)

<br />

<img src="docs/lifedash.png" alt="LifeDash Dashboard" width="900" />

[Report Bug](https://github.com/Lab-51/lifedash/issues) · [Request Feature](https://github.com/Lab-51/lifedash/issues)

</div>

---

## What is LifeDash?

LifeDash is an AI-powered desktop app that records your meetings, transcribes them locally, generates briefs, and extracts action items — all without sending a single byte to the cloud. It also includes project management, AI brainstorming, idea tracking, and focus/time tracking in one unified interface.

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
| Bring your own AI key | Yes | N/A | N/A | N/A |
| Open source | Yes | No | No | No |
| **Price** | **Free** | **$204/yr** | **$216/yr** | **$384/yr** |

## Features

### Meeting Intelligence
- Record system audio + microphone
- Real-time transcription (local Whisper or cloud providers)
- AI-generated meeting briefs and summaries
- Automatic action item extraction
- Speaker diarization and meeting analytics
- Searchable transcript archive
- Meeting templates (standup, retro, planning, etc.)

### Action Items to Project Board
- Convert action items to Kanban cards in one click
- Link meetings to projects
- Drag-and-drop card management with customizable columns
- Card detail view with rich text editor, comments, checklists, due dates
- Labels, tags, and search across all projects

### AI Agents
- **Card Agent** — AI assistant per task (tool-calling, checklist management, research)
- **Project Agent** — AI assistant per project (cross-board intelligence)
- **Background Agents** — Autonomous project analysis and insights
- **Brainstorm Sessions** — Conversational AI for ideation with project context
- **Idea Repository** — Capture, tag, analyze, and convert ideas to projects

### Focus & Time Tracking
- Pomodoro-style focus sessions
- Billable time tracking with hourly rates
- Project-level time reports
- CSV export for invoicing

### Privacy by Design
- All data stored locally in embedded PostgreSQL (PGlite)
- Audio recordings never leave your machine
- AI processing uses YOUR API keys — we never see your data
- No accounts, no cloud sync, no telemetry
- Encrypted API key storage via OS keychain
- Open source — audit the code yourself

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (includes npm)
- [Git](https://git-scm.com/)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload (required for native modules)

### Install & Run

```bash
git clone https://github.com/Lab-51/lifedash.git
cd lifedash
npm install
npm start
```

No database setup needed — the app uses an embedded database (PGlite) and runs migrations automatically on first launch.

### Configuration

- **AI API keys:** Configured in the Settings page within the app. Keys are stored using OS-level encryption via Electron safeStorage.
- **Whisper model:** Download and manage local Whisper models from the Settings page.
- **Transcription providers:** Deepgram and AssemblyAI can be configured as cloud transcription alternatives to local Whisper.

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails with `node-gyp` errors | Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload |
| `npm install` fails with Python errors | Install Python 3.x and set `npm config set python python3` |
| App shows white screen on start | Run `npm run lint` to check for TypeScript errors |

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Launch the app in development mode |
| `npm run package` | Package the app for distribution |
| `npm run make` | Build platform-specific installers |
| `npm run lint` | Type-check with TypeScript |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:generate` | Generate database migration files |
| `npm run db:migrate` | Apply database migrations |
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
