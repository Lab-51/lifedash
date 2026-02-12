# Living Dashboard — Roadmap

## Phase 1: Foundation & App Shell
**Goal:** Working Electron app with PostgreSQL, navigation, and design system.
**Requirements:** R1 (Electron Shell), R2 (Database Layer), R8 (Navigation & Layout)
**Complexity:** 15 points
**Estimated Tasks:** 8-10

### Deliverables
- [ ] Electron app boots with custom frameless window
- [ ] PostgreSQL running via Docker Compose
- [ ] Drizzle ORM connected with initial schema + migrations
- [ ] Sidebar navigation between views (Projects, Meetings, Ideas, Settings)
- [ ] React Router routing between views
- [ ] Tailwind CSS design system foundation (colors, typography, spacing)
- [ ] IPC bridge between main and renderer process
- [ ] System tray integration

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
- [ ] Create, edit, delete, archive projects
- [ ] Kanban board with customizable columns
- [ ] Card CRUD with drag-and-drop between columns
- [ ] Card detail view with TipTap rich text editor
- [ ] Labels/tags system
- [ ] Search and filter cards across projects
- [ ] Board sidebar with project list

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
- [ ] Vercel AI SDK integration with OpenAI + Anthropic + Ollama adapters
- [ ] Settings page: API key management (secure storage)
- [ ] Per-task model configuration UI
- [ ] Provider connectivity test
- [ ] Token usage tracking
- [ ] Whisper model download manager
- [ ] Theme toggle (light/dark)
- [ ] Docker/DB connection settings

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
- [ ] System audio capture via desktopCapturer
- [ ] Audio source selector
- [ ] Start/pause/stop recording controls
- [ ] Recording indicator in status bar
- [ ] Audio chunking pipeline (10s segments)
- [ ] Whisper transcription in worker thread
- [ ] Live transcript display during recording
- [ ] Transcript storage in database
- [ ] Background recording (tray mode)

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
- [ ] Post-meeting AI summary generation
- [ ] Action item extraction from transcript
- [ ] Review/edit/approve suggested actions UI
- [ ] Convert approved actions → project cards
- [ ] Meeting ↔ Project linking
- [ ] Meeting history view with search
- [ ] Prompt templates for summarization

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
- [ ] Conversational AI brainstorming interface
- [ ] Context injection (project data, cards, meetings)
- [ ] Brainstorm session management
- [ ] Idea capture interface (quick-add)
- [ ] Idea tagging and categorization
- [ ] Convert idea → project or feature card
- [ ] Idea analysis (AI-assisted feasibility/effort)

---

## Phase 7: v2 Features — Task Engine & Advanced
**Goal:** AI task structuring and advanced features.
**Requirements:** R11 (Task Structuring), R13 (Advanced Meetings), R14 (API Transcription), R15 (Backup), R16 (Advanced Cards), R17 (Notifications)
**Complexity:** 31 points
**Estimated Tasks:** 15-20

### Deliverables
- [ ] AI project planning assistant
- [ ] Production-focused pillars generator
- [ ] Advanced card features (comments, attachments, due dates)
- [ ] API transcription providers (Deepgram, AssemblyAI)
- [ ] Database backup/restore UI
- [ ] Desktop notifications
- [ ] Meeting templates

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
