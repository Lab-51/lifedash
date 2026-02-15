# Living Dashboard — Roadmap

## Phase 1: Foundation & App Shell
**Goal:** Working Electron app with PGlite, navigation, and design system.
**Requirements:** R1 (Electron Shell), R2 (Database Layer), R8 (Navigation & Layout)
**Complexity:** 15 points
**Estimated Tasks:** 8-10

### Deliverables
- [x] Electron app boots with custom frameless window
- [x] PGlite embedded database (no Docker required)
- [x] Drizzle ORM connected with initial schema + migrations
- [x] Sidebar navigation between views (Projects, Meetings, Ideas, Settings)
- [x] React Router routing between views
- [x] Tailwind CSS design system foundation (colors, typography, spacing)
- [x] IPC bridge between main and renderer process
- [x] System tray integration

### Key Decisions
- Electron Forge vs electron-builder for packaging
- Vite vs Webpack for Electron renderer bundling
- Mono-repo structure (main process + renderer)

---

## Phase 2: Project Dashboard
**Goal:** Full card-based project management with drag-and-drop.
**Requirements:** R3 (Project Dashboard)
**Complexity:** 8 points
**Estimated Tasks:** 6-8

### Deliverables
- [x] Create, edit, delete, archive projects
- [x] Kanban board with customizable columns
- [x] Card CRUD with drag-and-drop between columns
- [x] Card detail view with TipTap rich text editor
- [x] Labels/tags system
- [x] Search and filter cards across projects
- [x] Board sidebar with project list

### Key Decisions
- Card data model (what fields, what's extensible)
- Board layout (fixed columns vs user-defined)
- Card detail: modal vs side panel vs full page

---

## Phase 3: AI Provider System
**Goal:** Configurable AI backend that supports multiple providers.
**Requirements:** R7 (AI Provider System), R9 (Settings)
**Complexity:** 8 points
**Estimated Tasks:** 5-7

### Deliverables
- [x] Vercel AI SDK integration with OpenAI + Anthropic + Ollama adapters
- [x] Settings page: API key management (secure storage)
- [x] Per-task model configuration UI
- [x] Provider connectivity test
- [x] Token usage tracking
- [x] Whisper model download manager
- [x] Theme toggle (light/dark)
- [x] Database settings

### Key Decisions
- Secure storage approach (Electron safeStorage API)
- Default models for each task type
- How to handle missing API keys gracefully

---

## Phase 4: Meeting Intelligence — Capture & Transcription
**Goal:** Record meetings and transcribe in real-time.
**Requirements:** R4 (Audio Capture), R5 (Transcription)
**Complexity:** 16 points
**Estimated Tasks:** 8-10

### Deliverables
- [x] System audio capture via desktopCapturer
- [x] Audio source selector
- [x] Start/pause/stop recording controls
- [x] Recording indicator in status bar
- [x] Audio chunking pipeline (10s segments)
- [x] Whisper transcription in worker thread
- [x] Live transcript display during recording
- [x] Transcript storage in database
- [x] Background recording (tray mode)

### Key Decisions
- Audio format (WAV vs WebM vs PCM)
- Chunk size and overlap for transcription
- Worker thread vs child process for Whisper
- How to handle long meetings (memory management)

---

## Phase 5: Meeting Intelligence — Briefs & Actions
**Goal:** AI generates meeting summaries and actionable items.
**Requirements:** R6 (AI Brief & Actions)
**Complexity:** 8 points
**Estimated Tasks:** 5-7

### Deliverables
- [x] Post-meeting AI summary generation
- [x] Action item extraction from transcript
- [x] Review/edit/approve suggested actions UI
- [x] Convert approved actions → project cards
- [x] Meeting ↔ Project linking
- [x] Meeting history view with search
- [x] Prompt templates for summarization

### Key Decisions
- Summary format (bullet points vs narrative)
- How to present suggestions (inline vs separate panel)
- Action item confidence scoring

---

## Phase 6: v2 Features — Brainstorming & Ideas
**Goal:** AI brainstorming agent and idea repository.
**Requirements:** R10 (Brainstorming Agent), R12 (Idea Repository)
**Complexity:** 13 points
**Estimated Tasks:** 8-10

### Deliverables
- [x] Conversational AI brainstorming interface
- [x] Context injection (project data, cards, meetings)
- [x] Brainstorm session management
- [x] Idea capture interface (quick-add)
- [x] Idea tagging and categorization
- [x] Convert idea → project or feature card
- [x] Idea analysis (AI-assisted feasibility/effort)

---

## Phase 7: v2 Features — Task Engine & Advanced
**Goal:** AI task structuring and advanced features.
**Requirements:** R11 (Task Structuring), R13 (Advanced Meetings), R14 (API Transcription), R15 (Backup), R16 (Advanced Cards), R17 (Notifications)
**Complexity:** 31 points
**Estimated Tasks:** 15-20

### Deliverables
- [x] AI project planning assistant
- [x] Production-focused pillars generator
- [x] Advanced card features (comments, attachments, due dates)
- [x] API transcription providers (Deepgram, AssemblyAI)
- [x] Database backup/restore UI
- [x] Desktop notifications
- [x] Meeting templates

---

## Phase-to-Requirement Traceability

| Phase | Requirements | Points |
|-------|-------------|--------|
| Phase 1: Foundation | R1, R2, R8 | 15 |
| Phase 2: Dashboard | R3 | 8 |
| Phase 3: AI System | R7, R9 | 8 |
| Phase 4: Audio & Transcription | R4, R5 | 16 |
| Phase 5: Briefs & Actions | R6 | 8 |
| Phase 6: Brainstorm & Ideas | R10, R12 | 13 |
| Phase 7: Advanced Features | R11, R13-R17 | 31 |
| **Total** | **R1-R17** | **99** |

## Critical Path
```
Phase 1 (Foundation) → Phase 2 (Dashboard) → Phase 3 (AI System) → Phase 4 (Audio)
                                                                  → Phase 5 (Briefs)
Phase 3 (AI System) → Phase 6 (Brainstorm & Ideas)
Phase 5 (Briefs) → Phase 7 (Advanced)
```

Phases 1-3 are sequential (each builds on the previous). Phase 4 and 5 are sequential. Phase 6 can start after Phase 3. Phase 7 is last.
