# LifeDash — App Description

> A comprehensive reference for talking about LifeDash: what it does, how it was built, and why it stands out.

---

## Elevator Pitch

LifeDash is a free, open-source desktop app that turns your meetings into action. It records system audio, transcribes locally with Whisper, generates AI briefs, extracts action items, and flows them straight into a built-in project board — all without your data ever leaving your machine.

---

## What It Is

LifeDash is an AI-powered meeting intelligence and project management tool for professionals. It runs as a native desktop application (Electron) on Windows, with macOS support planned.

Unlike cloud-based competitors (Otter, Fireflies, Fathom), LifeDash is **100% local and private**. Recordings are processed on your machine. AI features use your own API keys (BYOK — Bring Your Own Key). There is no account required, no subscription, and no data uploaded to third-party servers.

**License:** AGPL-3.0 — free and open source.

---

## Core Features

### Meeting Intelligence
- **System audio capture** — records any meeting from any app (Zoom, Teams, Google Meet, etc.) by capturing system audio directly
- **Real-time transcription** — powered by Whisper running locally, or cloud providers (Deepgram, AssemblyAI) for faster results
- **Speaker diarization** — identifies who said what
- **AI-generated briefs** — automatic meeting summaries with key decisions highlighted
- **Action item extraction** — AI identifies actionable items and suggests them as tasks
- **Meeting-to-project flow** — approved action items convert directly into project cards with one click

### Project Management
- **Kanban boards** — drag-and-drop card management across customizable columns
- **Rich card details** — checklists, comments, attachments, due dates, priorities, labels, and card relationships (blocks, depends on, related)
- **Multi-project support** — organize work across unlimited projects and boards
- **Search and filter** — find any card across all projects instantly

### AI Agents (3 tiers)
- **Card Agent** — context-aware assistant attached to individual cards; can add checklists, update descriptions, create related cards, and more via tool calling
- **Project Agent** — strategic assistant for project-level planning and insights
- **Background Agent** — autonomous scheduled tasks: daily standup generation, insight synthesis, weekly reviews

### Additional Features
- **Brainstorming** — conversational AI brainstorming interface with context injection from your projects and meetings
- **Idea Repository** — quick-capture ideas with tags, then convert them into projects or cards when ready
- **Intel Feed** — curated RSS/news feed with AI-generated daily and weekly briefs
- **Focus Timer** — time tracking with billable hours, CSV export, and project-level reporting
- **Gamification** — achievements, streaks, and leveling system to keep momentum
- **Command Palette** — keyboard-driven navigation (Ctrl+K) for power users
- **Auto-backup** — scheduled database backups with one-click restore
- **Cloud sync** — optional Supabase sync for multi-device use (opt-in)

---

## How It Was Built

### Architecture

LifeDash follows a clean **three-process Electron architecture**:

| Layer | Technology | Role |
|-------|-----------|------|
| **Main process** | Node.js + TypeScript | Business logic, database, AI, audio capture, IPC handlers |
| **Preload bridge** | contextBridge API | 18+ domain-specific bridges — zero direct Node access from renderer |
| **Renderer** | React 19 + TypeScript + Tailwind CSS | UI with 9 lazy-loaded pages, 119 components, 16 Zustand stores |

All communication flows through typed IPC channels with **Zod validation** on every call. The renderer has no access to Node.js APIs — everything goes through the preload bridge.

### Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Electron 40 |
| Frontend | React 19, TypeScript 5.9 (strict), Tailwind CSS 4, React Router 7 |
| State | Zustand (16 stores) |
| Database | PGlite (embedded WASM PostgreSQL) + Drizzle ORM (29 migrations) |
| AI | Vercel AI SDK with tool calling — OpenAI, Anthropic, Ollama, Kimi K2.5 |
| Audio | electron-audio-loopback (system capture) + Whisper.node (local transcription) |
| Rich text | TipTap editor |
| Drag & drop | Atlassian Pragmatic DnD |
| Build | Vite 7, Electron Forge 7 |
| Testing | Vitest + Playwright + Testing Library |
| Error tracking | Sentry (opt-in) |
| Installer | Inno Setup (Windows), DMG (macOS) |

### Development Approach

LifeDash was built using a structured, AI-assisted development methodology:

- **State-driven development** — every session starts from documented state (position, decisions, blockers), ensuring continuity across hundreds of development sessions
- **Phase-based roadmap** — 7 phases + extensions, each with clear requirements and deliverables (99 complexity points total, all delivered)
- **Production audits** — formal multi-dimensional audits with remediation rounds to reach production-grade quality
- **415 automated tests** across unit, integration, and E2E layers

---

## Code Quality & Production Readiness

LifeDash has undergone a formal **production readiness audit** scoring **90/100 (Gold tier)**, up from 69 after six remediation rounds.

### Audit Scores

| Dimension | Score | Highlights |
|-----------|-------|-----------|
| **Code Quality** | 93/100 | TypeScript strict mode, ESLint + Prettier enforced, pre-commit hooks, large files split into focused modules |
| **Database Health** | 86/100 | UUID primary keys, comprehensive foreign keys, 29 Drizzle migrations, parameterized queries, auto-backup, sync with conflict resolution |
| **Operational Readiness** | 85/100 | Structured logging with rotation, crash recovery, auto-updater, memory monitoring, notification dedup, graceful shutdown |
| **Infrastructure** | 82/100 | GitHub Actions CI (lint + type-check + audit + test + E2E), Electron Forge with security fuses, code obfuscation, pre-commit hooks |
| **Security** | 80/100 | Context isolation, CSP, API key encryption (DPAPI), Zod IPC validation, DOMPurify XSS sanitization, navigation guards |
| **Testing** | 80/100 | 415 tests across 23 files, Vitest + Playwright, coverage thresholds, all layers tested (services, IPC, stores, components) |
| **Frontend Performance** | 76/100 | Lazy loading for all 9 routes, React.memo, useMemo/useCallback, CSS animations on transform/opacity, Tailwind purging |
| **Compliance** | 76/100 | Privacy policy, data deletion UI (factory reset), Sentry opt-in with PII stripping, no analytics, AGPL-3.0 license |

### Non-Negotiable Gates (all passed)

- Structured logging with rotation and version tracking
- Database health checks on startup
- Graceful shutdown (stops all services + DB disconnect on quit)
- Dependency scanning (npm audit in CI)
- Global error handling (uncaught exceptions + unhandled rejections)
- Secure authentication (DPAPI encryption, sandboxed auth windows, token rotation)

### Security Hardening

- **Electron Fuses** — RunAsNode disabled, cookie encryption enabled, Node CLI inspect disabled, ASAR integrity validation, app-only-from-ASAR enforced
- **Process isolation** — contextIsolation enabled, nodeIntegration disabled, all IPC validated with Zod schemas
- **Content Security Policy** — inline scripts blocked (`script-src 'self'`)
- **API key security** — encrypted with Electron safeStorage (DPAPI on Windows), never exposed to renderer process
- **XSS prevention** — DOMPurify sanitization on all external HTML content

### Accessibility

- ARIA attributes throughout (120+ instances)
- Focus trap management in all modals
- Keyboard navigation with global shortcuts
- Semantic HTML elements

---

## Key Differentiators

| | LifeDash | Cloud competitors (Otter, Fireflies, Fathom) |
|---|---------|----------------------------------------------|
| **Privacy** | 100% local — recordings never leave your machine | Cloud-processed, stored on third-party servers |
| **Cost** | Free + BYOK (use your own AI API keys) | $16-30/month subscriptions |
| **Scope** | Meeting intelligence + project management + AI agents | Meeting recording/transcription only |
| **Offline** | Works offline with local Whisper + Ollama | Requires internet |
| **Open source** | AGPL-3.0, fully auditable | Proprietary, closed-source |
| **Data ownership** | Your data in a local database you control | Vendor lock-in |

---

## By the Numbers

| Metric | Value |
|--------|-------|
| Version | 2.2.24 |
| Source files | 335 TypeScript/TSX |
| React components | 119 |
| Zustand stores | 16 |
| Database tables | 19 (29 migrations) |
| Automated tests | 415 |
| IPC handler modules | 28 |
| AI providers supported | 4 (OpenAI, Anthropic, Ollama, Kimi) |
| Main process services | 41 |
| Production audit score | 90/100 (Gold) |
| Roadmap phases delivered | 7 + extensions (99 complexity points) |
| License | AGPL-3.0 |
| Price | Free |

---

## Target Audience

Founders, consultants, lawyers, project managers, and developers who:
- Attend frequent meetings and need actionable outcomes
- Want AI assistance without giving up data privacy
- Are tired of juggling separate tools for meetings, tasks, and projects
- Value open-source software they can inspect and trust

---

## One-Liner Variations

**For developers:**
LifeDash is a local-first Electron app that captures meeting audio, transcribes with Whisper, generates AI briefs, and manages projects with agentic AI — all running on your machine.

**For professionals:**
LifeDash records your meetings, writes the summary, pulls out action items, and tracks them in a built-in project board — completely free and private.

**For privacy-conscious users:**
Your meetings, your machine, your data. LifeDash does everything Otter and Fireflies do, but nothing ever leaves your computer.
