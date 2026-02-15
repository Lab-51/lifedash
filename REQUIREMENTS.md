# Living Dashboard — Requirements

## v1 Requirements (MVP)

### R1: Electron App Shell
- **Priority:** Critical
- **Complexity:** Medium (5 pts)
- Electron desktop app with custom frameless window
- Custom title bar with window controls (minimize, maximize, close)
- System tray integration (minimize to tray, background operation)
- Window state persistence (size, position remembered between sessions)
- IPC bridge between renderer and main process
- App lifecycle management (startup, shutdown, auto-launch option)

### R2: PostgreSQL Database Layer
- **Priority:** Critical
- **Complexity:** Medium (5 pts)
- PGlite embedded WASM PostgreSQL (no Docker required)
- Drizzle ORM integration with TypeScript schema
- Database migration system (drizzle-kit)
- Connection management (health checks, reconnection)
- Core data model: Projects, Boards, Cards, Labels, Meetings, Transcripts, Ideas
- Automatic migration on app startup

### R3: Project Dashboard (Card-Based)
- **Priority:** Critical
- **Complexity:** High (8 pts)
- Multi-project support (create, switch, archive projects)
- Kanban board view with columns (customizable per project)
- Card CRUD (create, read, update, delete)
- Drag-and-drop cards between columns (pragmatic-drag-and-drop)
- Card detail view with rich text description (TipTap editor)
- Labels/tags system for card categorization
- Card search and filtering across projects
- Board navigation sidebar

### R4: Meeting Intelligence — Audio Capture
- **Priority:** Critical
- **Complexity:** High (8 pts)
- System audio capture via `electron-audio-loopback` (WASAPI on Windows, CoreAudio on macOS)
- Audio stream management (start, pause, stop recording)
- Audio source selection (choose which audio to capture)
- Recording indicator in status bar
- Audio resampling pipeline (48kHz stereo → 16kHz mono for Whisper)
- Audio storage (temporary WAV during recording)
- Background recording (continues when app is minimized to tray)

### R5: Meeting Intelligence — Transcription
- **Priority:** Critical
- **Complexity:** High (8 pts)
- Local transcription via `@fugood/whisper.node` v1.0.16 (NAPI native addon)
- Audio chunking system (10-second segments with overlap)
- Real-time transcript display during meeting
- Transcript storage in PostgreSQL
- Model selection (tiny/base/small/medium) based on hardware
- Worker thread for transcription (non-blocking UI)

### R6: Meeting Intelligence — AI Brief & Actions
- **Priority:** Critical
- **Complexity:** High (8 pts)
- AI-generated meeting brief/summary after recording ends
- Actionable suggestion extraction (tasks, decisions, follow-ups)
- User can review, edit, and approve suggested actions
- Approved actions convert to cards on project dashboard
- Meeting → Project linking (assign meeting to a project)

### R7: AI Provider System
- **Priority:** Critical
- **Complexity:** Medium (5 pts)
- Vercel AI SDK integration for multi-provider support
- Provider configuration UI (API keys, model selection)
- Per-task model assignment (transcription, summarization, brainstorming, etc.)
- Secure API key storage (Electron safeStorage)
- Provider health check / connectivity test
- Token usage tracking and cost estimation

### R8: Navigation & Layout
- **Priority:** Critical
- **Complexity:** Medium (5 pts)
- Sidebar navigation (Projects, Meetings, Ideas, Brainstorm, Settings)
- React Router for view management
- Responsive layout within Electron window
- Consistent design system with Tailwind CSS
- Loading states and error boundaries
- Keyboard shortcuts for common actions

### R9: Settings & Configuration
- **Priority:** High
- **Complexity:** Low (3 pts)
- AI provider configuration (API keys, models per task)
- Whisper model selection and download
- Audio device/source preferences
- Theme preference (light/dark)
- Database settings
- Data export/import

---

## v2 Requirements (Post-MVP)

### R10: AI Brainstorming Agent
- **Priority:** High
- **Complexity:** High (8 pts)
- Conversational AI interface for ideation
- Context-aware (knows about current project, cards, meetings)
- Conversation history stored in database
- Multiple brainstorm sessions per project
- Export brainstorm outcomes to cards/ideas

### R11: Task Structuring Engine
- **Priority:** High
- **Complexity:** High (8 pts)
- AI-assisted project planning when starting new projects
- Generates project pillars (architecture, security, scalability, etc.)
- Suggests task breakdown and dependencies
- Production-focused templates and checklists
- Sprint/milestone planning assistance

### R12: Idea Repository
- **Priority:** High
- **Complexity:** Medium (5 pts)
- Dedicated idea capture interface (quick-add)
- Tag/categorize ideas
- AI-assisted idea analysis (feasibility, effort, impact)
- Convert idea → new project or → feature card on existing project
- Idea voting/priority system

### R13: Advanced Meeting Features
- **Priority:** Medium
- **Complexity:** High (8 pts)
- Speaker diarization (who said what) — requires API provider
- Meeting calendar integration
- Automatic meeting detection (detect when audio starts)
- Meeting templates (standup, retro, planning, etc.)
- Meeting analytics (talk time, action item tracking)

### R14: API-Based Transcription Providers
- **Priority:** Medium
- **Complexity:** Medium (5 pts)
- Deepgram integration for true real-time streaming transcription
- AssemblyAI integration with speaker diarization
- Provider selection in settings (local Whisper vs cloud API)
- Automatic fallback (local → API if local is too slow)

### R15: Database Backup & Sync
- **Priority:** Medium
- **Complexity:** Medium (5 pts)
- Scheduled automatic backups (pg_dump via Docker)
- Manual backup/restore via UI
- Export data to JSON/CSV
- Optional cloud backup (S3, Google Drive)

### R16: Advanced Card Features
- **Priority:** Medium
- **Complexity:** Medium (5 pts)
- Card comments and activity log
- File attachments on cards
- Card templates
- Due dates and reminders
- Card relationships (blocks, depends on, related to)

### R17: Notifications & Reminders
- **Priority:** Low
- **Complexity:** Medium (5 pts)
- Desktop notifications for upcoming meetings, due tasks
- Meeting recording reminders
- Daily digest of tasks and meetings
- System tray notifications

---

## Out of Scope (Not Planned)

### OS1: Multi-User / Authentication
- No user accounts, login, or permissions for v1/v2
- Single-user desktop application
- May revisit if converting to team tool later

### OS2: Web/Mobile Version
- Electron desktop only — no web or mobile deployment
- Not a SaaS product

### OS3: Calendar Integration
- No Google Calendar, Outlook, or calendar sync in v1
- Deferred to v2+ (R13)

### OS4: Video Recording
- Audio-only capture — no video recording
- No screen recording or meeting video

### OS5: Real-Time Collaboration
- Single-user — no real-time multi-user editing
- No sharing or collaborative features

### OS6: Plugin/Extension System
- No third-party plugins or marketplace
- Extensibility is internal only

---

## Complexity Summary

| Category | v1 Points | v2 Points |
|----------|-----------|-----------|
| App Shell & Infrastructure | 15 | 5 |
| Meeting Intelligence | 24 | 13 |
| Project Dashboard | 8 | 10 |
| AI System | 5 | 16 |
| Settings | 3 | 0 |
| **Total** | **55** | **44** |

## Tech Stack (Confirmed via Research)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop Shell | Electron | System audio access, desktop integration |
| Frontend | React 19 + TypeScript | Largest ecosystem, mature tooling |
| Styling | Tailwind CSS 4 | Utility-first, fast development |
| State | Zustand | Lightweight, TypeScript-native |
| Drag & Drop | pragmatic-drag-and-drop | 4.7kB, headless, by Atlassian |
| Rich Text | TipTap | Extension-based, ProseMirror core |
| Routing | React Router 7 | Standard for React SPAs |
| Database | PGlite (embedded WASM PostgreSQL) | Zero-setup, local, reliable |
| ORM | Drizzle ORM | Lightweight, SQL-first, TypeScript |
| AI SDK | Vercel AI SDK 5+ | Multi-provider, type-safe, streaming |
| Transcription | @fugood/whisper.node v1.0.16 (local) | NAPI native addon, prebuilt binaries, PCM streaming |
| Icons | Lucide React | Consistent, tree-shakeable |
