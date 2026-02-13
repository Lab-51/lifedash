# Current State

## Session Info
Last updated: 2026-02-13
Session focus: Plan 8.5 — Remaining IPC Validation, IdeaDetailModal Decomposition & Console Cleanup

## Position
Milestone: Post-Review Improvements
Phase: 8 (Review Fixes)
Plan: 8.5 of TBD (COMPLETE — 3/3 tasks done)
Task: 3 of 3

## Phase 1 — COMPLETE
All 3 plans (8 tasks) delivered and pushed to GitHub.
- R1: Electron App Shell — 100%
- R2: PostgreSQL Database Layer — 100%
- R8: Navigation & Layout — 100%
- Commit: 5a286cc on origin/main

## Phase 2 — COMPLETE
Phase 2 covers R3: Project Dashboard (8 points, 9 tasks across 3 plans).
- Plan 2.1: Data Layer & Project Management — DONE
- Plan 2.2: Kanban Board — DONE
- Plan 2.3: Rich Text + Polish — DONE
- Plans 2.2 + 2.3 not yet committed (awaiting runtime test + git commit)

## Phase 3 — COMPLETE
Phase 3 covers R7: AI Provider System (5 pts) + R9: Settings & Configuration (3 pts).
Total: 8 points, 9 tasks across 3 plans.

### Plan 3.1: AI Provider Backend & Settings Foundation (3 tasks) — COMPLETE
- Commit: 81034b2 on origin/main

### Plan 3.2: Settings UI & AI Provider Management (3 tasks) — COMPLETE
- Not yet committed

### Plan 3.3: Theme, Usage & App Settings (3 tasks) — COMPLETE
- Not yet committed

## Phase 4 — COMPLETE
Phase 4 covers R4: Audio Capture (8 pts) + R5: Transcription (8 pts).
Total: 16 points, 12 tasks across 4 plans — all delivered.

### Plan 4.1: Dependencies, Meeting CRUD, and IPC Foundation (3 tasks) — COMPLETE
1. Install deps (electron-audio-loopback 1.0.6, @fugood/whisper.node 1.0.16, wavefile 11.0.0) + initMain() in main.ts — DONE
2. Create shared meeting types (10 types) + extend ElectronAPI (5 methods) — DONE
3. Create meetingService (7 functions) + IPC handlers (5 channels) + preload bridge — DONE
- Not yet committed

## Plan 4.1 Execution Results
- **Task 1**: Installed 3 packages. Added `initMain()` in main.ts line 28, before `app.requestSingleInstanceLock()`. Packages ship own `.d.ts` files — no custom declarations needed.
- **Task 2**: Added 10 types to shared/types.ts (Meeting, TranscriptSegment, MeetingBrief, ActionItem, input types, MeetingWithTranscript, RecordingState). ElectronAPI extended with 5 meeting CRUD methods. 4 recording methods commented out for Plans 4.2-4.3.
- **Task 3**: Created meetingService.ts (7 exports + toMeeting/toTranscriptSegment mappers). Created meetings.ts IPC handlers for 5 channels. Registered in ipc/index.ts. Extended preload.ts with 5 methods.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors.

## AI SDK v6 Findings (Discovered During Plan 3.1 Execution)
- `maxTokens` renamed to `maxOutputTokens` in generateText options
- Token usage fields: `result.usage.inputTokens` / `.outputTokens` / `.totalTokens` (not promptTokens/completionTokens)
- ollama-ai-provider v1.2.0 returns LanguageModelV1 (not V3) — needs `as LanguageModel` cast for generateText
- createOllama export confirmed: `import { createOllama } from 'ollama-ai-provider'` works correctly

## Phase 4 Package Verification (Discovered During Plan 4.1)
- electron-audio-loopback v1.0.6: ships TypeScript declarations, exports initMain + getLoopbackAudioMediaStream
- @fugood/whisper.node v1.0.16: confirmed package name with dot (published 2026-02-11 by jhen0409)
- wavefile v11.0.0: ships TypeScript declarations

## Confidence Levels
Overall approach: HIGH
Plan 4.1 execution: HIGH (all tasks verified, TypeScript clean)
Package installations: HIGH (all 3 verified on npm, installed successfully)

## Decisions Made (Phase 4)
- Meeting service: separate service file (not inline in IPC handlers) — cleaner for Plan 4.2-4.3 extensions
- toMeeting mapper: uses Drizzle $inferSelect for type safety, serializes Date → ISO string
- updateMeeting: builds dynamic update object to avoid overwriting unset fields
- Recording methods: commented out in ElectronAPI (will activate in Plan 4.2)

## Blockers
- None

### Plan 4.2: Audio Capture Pipeline (3 tasks) — COMPLETE
1. Audio processor service in main + recording IPC + preload + types — DONE
2. Audio capture bridge in renderer (loopback → PCM → IPC) — DONE
3. Recording Zustand store + UI components (RecordingControls, RecordingIndicator) — DONE
- Commit: 254255e on origin/main

## Plan 4.2 Execution Results
- **Task 1**: Created audioProcessor.ts (accumulate PCM, save WAV via wavefile, push recording state). Created recording.ts IPC handlers (3 channels: recording:start, recording:stop, audio:chunk). Extended preload with 7 recording methods. Uncommented ElectronAPI recording methods + added sendAudioChunk and loopback methods.
- **Task 2**: Created audioCaptureService.ts — thin bridge: loopback enable → getDisplayMedia → strip video → disable loopback → AudioContext at 16kHz → ScriptProcessorNode → Float32→Int16 → IPC stream. Proper cleanup on all paths.
- **Task 3**: Created recordingStore.ts (Zustand — startRecording creates meeting + starts capture, stopRecording saves WAV + updates meeting). Created RecordingControls.tsx (title input + start/stop + timer). Created RecordingIndicator.tsx (sidebar pulsing dot + elapsed). Added indicator to Sidebar.tsx. Added initListener in App.tsx AppShell.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors.

### Plan 4.3: Whisper Transcription Pipeline (3 tasks) — COMPLETE
1. Whisper model manager + transcription worker thread — DONE
2. Transcription service + audioProcessor integration — DONE
3. Whisper model types, IPC handlers, and preload bridge — DONE
- Not yet committed

## Plan 4.3 Execution Results
- **Task 1**: Created whisperModelManager.ts (6 models, HuggingFace download with redirect/progress/abort). Created transcriptionWorker.ts (worker_threads, init/transcribe/stop protocol). Updated forge.config.ts (worker build entry without target). Updated vite.main.config.ts (externalized @fugood/whisper.node).
- **Task 2**: Created transcriptionService.ts (10s segment accumulation, worker dispatch queue, DB save, renderer push). Modified audioProcessor.ts (integrated transcription at setMainWindow, startRecording, addChunk, stopRecording, pushState).
- **Task 3**: Created whisper.ts IPC handlers (3 channels). Extended shared/types.ts (WhisperModel, WhisperDownloadProgress, 4 ElectronAPI methods). Registered in ipc/index.ts. Extended preload.ts (4 whisper bridge methods).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors.

### Plan 4.4: Meetings UI & Transcript Display (3 tasks) — COMPLETE
1. Meeting store + MeetingsPage list view + RecordingControls — DONE
2. Meeting detail modal + transcript timeline + real-time updates — DONE
3. Meeting-project linking + whisper model status notice — DONE
- Not yet committed

## Plan 4.4 Execution Results
- **Task 1**: Created meetingStore.ts (Zustand — loadMeetings, loadMeeting, updateMeeting, deleteMeeting, clearSelectedMeeting, addTranscriptSegment). Created MeetingCard.tsx (title, date, time, duration, status badge, project name). Replaced MeetingsPage.tsx stub with full page (RecordingControls, filter tabs, meeting cards grid, loading/empty/error states, auto-refresh on recording stop).
- **Task 2**: Created MeetingDetailModal.tsx (editable title, status/duration/date metadata, scrollable transcript timeline with MM:SS timestamps, auto-scroll during live recording, delete with confirmation, Escape + overlay close). Wired into MeetingsPage (loadMeeting on select, onTranscriptSegment real-time listener, list refresh on close).
- **Task 3**: Added project selector dropdown to MeetingDetailModal (No project + all projects from projectStore). Added whisper model notice to MeetingsPage (hasWhisperModel check, download button with real-time progress bar via onWhisperDownloadProgress).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors.
- **Note**: TranscriptSegment uses `startTime`/`content` fields (not `startMs`/`text` as in plan). Code correctly uses actual field names.

## Phase 4 — COMPLETE
All 4 plans (12 tasks) executed successfully. Phase 4 delivers:
- R4: Audio Capture — meeting CRUD, audio capture pipeline, recording UI
- R5: Transcription — whisper model manager, transcription worker, meetings UI with transcript display

## Phase 5 — COMPLETE
Phase 5 covers R6: Meeting Intelligence — AI Brief & Actions (8 pts).
Total: 8 points, 6 tasks across 2 plans — all delivered.

Architecture decisions:
- meetingIntelligenceService.ts: central service for AI brief/action generation
- Provider resolution: settings table `task_models` JSON → fallback to first enabled provider
- Prompt templates: structured summarization + JSON action extraction with line-by-line fallback
- Action lifecycle: pending → approved/dismissed → converted (to card)
- MeetingWithTranscript extended with brief + actionItems fields
- 6 new IPC channels for intelligence operations

### Plan 5.1: Meeting Intelligence Service & IPC (3 tasks) — COMPLETE
1. Create meetingIntelligenceService.ts (8 exports, AI prompts, action CRUD, convert-to-card) — DONE
2. IPC handlers + shared types + preload bridge + meetingService.getMeeting() extension — DONE
3. meetingStore extensions (brief/actions state + 4 new actions) — DONE
- Commit: b90aa4d on origin/main

### Plan 5.2: Meeting Intelligence UI (3 tasks) — COMPLETE
1. Create BriefSection.tsx + ActionItemList.tsx (standalone components) — DONE
2. Create ConvertActionModal.tsx + integrate all into MeetingDetailModal — DONE
3. Add meeting history search to MeetingsPage — DONE
- Commit: ab355be on origin/main

## Plan 5.2 Execution Results
- **Task 1**: Created BriefSection.tsx (113 lines) — renders meeting brief with markdown parsing (## headings, - bullets, paragraphs), relative timestamp, loading spinner, generate button. Created ActionItemList.tsx (179 lines) — renders action items with status icons (Circle/CheckCircle2/XCircle/ArrowRightCircle), contextual action buttons (approve/dismiss/convert per status), count badge, loading state, generate button.
- **Task 2**: Created ConvertActionModal.tsx (317 lines) — 3-step wizard (project → board → column) with auto-skip for single-board projects, step indicator dots, back navigation, loading spinners, escape/overlay close, z-[60] stacking. Modified MeetingDetailModal.tsx (263→306 lines) — integrated BriefSection, ActionItemList, and ConvertActionModal between project linking and transcript sections.
- **Task 3**: Modified MeetingsPage.tsx (218→270 lines) — added search input with Search icon and clear button on filter tabs row, case-insensitive title filtering combined with status filter, search-specific empty state, result count display.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Phase 6 — IN PROGRESS
Phase 6 covers R10: AI Brainstorming Agent (8 pts) + R12: Idea Repository (5 pts).
Total: 13 points, ~9 tasks across 3 plans.

### Plan 6.1: Idea Repository — Service, Store & UI (3 tasks) — COMPLETE
1. Idea types + ideaService.ts (7 exports) + IPC handlers (7 channels) + preload bridge — DONE
2. ideaStore.ts (Zustand, 8 actions) + IdeasPage.tsx (269 lines, grid/filters/search) — DONE
3. IdeaDetailModal.tsx (672 lines, edit/tags/convert wizard) — DONE
- Not yet committed

## Plan 6.1 Execution Results
- **Task 1**: Added 9 idea types to shared/types.ts (Idea, CreateIdeaInput, UpdateIdeaInput, IdeaStatus, EffortLevel, ImpactLevel, ConvertIdeaToCardInput, ConvertIdeaToProjectResult, ConvertIdeaToCardResult). ElectronAPI extended with 7 idea methods. Created ideaService.ts (7 exports + toIdea/loadTagsForIdeas/replaceTags helpers). Created ideas.ts IPC handlers (7 channels). Registered in ipc/index.ts. Extended preload.ts with 7 methods.
- **Task 2**: Created ideaStore.ts (100 lines, Zustand — loadIdeas, loadIdea, createIdea, updateIdea, deleteIdea, clearSelectedIdea, convertToProject, convertToCard). Replaced IdeasPage.tsx stub (269 lines — quick-add form, 5 filter tabs, search, responsive card grid, status badges/tags/effort/impact, 3 empty states).
- **Task 3**: Created IdeaDetailModal.tsx (672 lines — editable title, description textarea, status/effort/impact dropdowns, tags editor with add/remove, convert-to-project confirmation, convert-to-card 3-step wizard, delete with confirmation, save button). Uncommented import/render in IdeasPage.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.
- **Code Review**: 0 critical, 0 high, 2 medium (file size 672 lines — could extract wizard; missing loading spinner in wizard). Approved.

### Plan 6.2: Brainstorming — Schema, Service & Chat UI (3 tasks) — COMPLETE
1. Schema + types + streamGenerate + brainstormService + IPC + preload — DONE
2. brainstormStore (Zustand) + BrainstormPage (session sidebar + chat + streaming) — DONE
3. ChatMessage component (markdown) + context display + session rename/archive — DONE
- Architecture: first streaming feature (streamText from AI SDK v6)
- Key refactoring: extracting resolveTaskModel from meetingIntelligenceService to ai-provider
- Migration: 0002_futuristic_christian_walker.sql (brainstorm tables + enums)
- Not yet committed

### Plan 6.3: AI Features & Cross-Feature Integration (3 tasks) — COMPLETE
1. AI idea analysis — service, IPC, types, store (backend pipeline) — DONE
2. AI analysis UI + "Brainstorm This Idea" button in IdeaDetailModal — DONE
3. Enhanced brainstorm context injection (cards, ideas, meeting briefs) — DONE
- Not yet committed

## Confidence Levels
Overall approach: HIGH
Plan 6.1 execution: HIGH (all tasks verified, TypeScript clean)
Plan 6.2 execution: HIGH (all 3 tasks verified, TypeScript clean, migration applied)
Plan 6.3 execution: HIGH (all 3 tasks verified, TypeScript clean)

## Decisions Made (Phase 6)
- Ideas schema already exists — no migrations needed for Plan 6.1
- Tags managed via delete-all + re-insert (simpler than individual add/remove)
- Convert to project: creates project + links idea + marks active
- Convert to card: reuses ConvertActionModal wizard pattern (project → board → column)
- AI idea analysis deferred to Plan 6.3 (not in 6.1)
- IdeaDetailModal at 672 lines (above 500 guideline) — accepted for now, wizard extraction deferred
- Brainstorming uses streamText (not generateText) — first streaming AI feature
- resolveTaskModel extracted to ai-provider.ts for shared use
- Context injection: project name + boards + meeting titles in system prompt
- Lightweight regex markdown rendering (no external library)
- Export to idea: creates idea from assistant message content

## Blockers
- None

## Plan 6.2 Execution Results
- **Task 1**: Created brainstorming.ts schema (2 tables: brainstorm_sessions + brainstorm_messages, 2 enums). Added 6 brainstorm types + 8 ElectronAPI methods to types.ts. Extracted resolveTaskModel + ResolvedProvider + DEFAULT_MODELS from meetingIntelligenceService.ts to ai-provider.ts. Added streamGenerate (streamText wrapper) + logUsage to ai-provider.ts. Created brainstormService.ts (9 exports: CRUD + messages + context + export). Created brainstorm.ts IPC handlers (7 channels with streaming send-message). Registered handlers + extended preload (8 bridge methods including onBrainstormChunk with cleanup). Migration generated + applied.
- **Task 2**: Created brainstormStore.ts (169 lines, Zustand — 8 actions with streaming chunk accumulation and optimistic user message). Replaced BrainstormPage.tsx stub (376 lines — split-panel: session sidebar with create/delete/project link + chat area with message bubbles + streaming display + textarea input).
- **Task 3**: Created ChatMessage.tsx (210 lines — regex markdown renderer: headings, bullets, numbered lists, code blocks, inline code/bold/italic). Updated BrainstormPage.tsx (415 lines — ChatMessage component, context indicator, session rename via double-click, archive toggle, show-archived filter).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Plan 6.3 Execution Results
- **Task 1**: Added IdeaAnalysis type to types.ts. Created analyzeIdea in ideaService.ts (AI prompt, JSON parsing with 3-tier fallback, effort/impact validation). Added idea:analyze IPC channel + preload bridge. Extended ideaStore with analysis/analyzing/analysisError state + analyzeIdea/clearAnalysis actions. clearSelectedIdea resets analysis state.
- **Task 2**: Added AI Analysis section to IdeaDetailModal (Analyze with AI button, loading spinner, error state with provider hint, results panel with Apply/Dismiss for effort/impact suggestions, feasibility notes, rationale). Added "Brainstorm This Idea" button (creates session, sends initial message with idea context, navigates to /brainstorm). Renamed Convert section to Actions. IdeasPage passes onNavigate to modal via useNavigate.
- **Task 3**: Enriched buildContext() in brainstormService.ts with card titles per board (up to 5), idea titles+status (up to 5, excluding archived), meeting brief summaries (up to 3, truncated to 200 chars). Main queries parallelized with Promise.all. Updated LIMITATIONS header.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Phase 6 — COMPLETE
All 3 plans (9 tasks) executed successfully. Phase 6 delivers:
- R10: AI Brainstorming Agent — schema, streaming service, chat UI, context injection, export to idea
- R12: Idea Repository — CRUD, tags, filters, detail modal, convert wizard, AI analysis, brainstorm bridge

## Phase 7 — IN PROGRESS
Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans.

### Plan 7.1: Advanced Card Features — Comments, Relationships & Activity Log (3 tasks) — COMPLETE
1. Schema + migration (cardComments, cardRelationships, cardActivities tables + 2 enums) — DONE
2. IPC handlers (8 channels) + logCardActivity helper + preload bridge (8 methods) — DONE
3. Activity auto-logging in existing handlers + boardStore extensions (7 new actions) — DONE
- Not yet committed

## Plan 7.1 Execution Results
- **Task 1**: Added 2 enums (cardRelationshipTypeEnum, cardActivityActionEnum) + 3 tables (cardRelationships, cardComments, cardActivities) to cards.ts schema. Generated migration 0003_mute_magik.sql. Added 7 types + 8 ElectronAPI methods to shared/types.ts.
- **Task 2**: Added logCardActivity helper (fire-and-forget). Added 8 IPC handlers: 4 comments (CRUD) + 3 relationships (CRD) + 1 activities (read, limit 50). Added 8 preload bridge methods. Updated LIMITATIONS header.
- **Task 3**: Wired logCardActivity into cards:create ('created'), cards:update ('archived'/'restored'/'updated'), cards:move ('moved'). Extended boardStore with 4 state fields + 7 actions (loadCardDetails, clearCardDetails, addComment, updateComment, deleteComment, addRelationship, deleteRelationship).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Decisions Made (Phase 7)
- IPC-inline pattern for comments/relationships (follows existing cards.ts pattern)
- Card relationships as directed edges (sourceCardId → targetCardId)
- Activity details as JSON text (avoids nullable columns)
- N+1 queries acceptable for relationship title enrichment (small counts)
- Activities limited to 50 most recent per card
- Skip activity logging for card delete (cascade-deleted anyway)

### Plan 7.2: Advanced Card Features — Comments, Relationships & Activity UI (3 tasks) — COMPLETE
1. CommentsSection (~192 lines, add/edit/delete) + ActivityLog (~155 lines, read-only timeline) — DONE
2. RelationshipsSection (~190 lines, card picker, grouped display) + CardDetailModal integration (load/clear lifecycle, 3 sections, max-w-3xl) — DONE
3. Card template presets (5 templates) + template selector dropdown in CardDetailModal — DONE
- Not yet committed

## Plan 7.2 Execution Results
- **Task 1**: Created CommentsSection.tsx (add/edit/delete, Ctrl+Enter shortcut, inline edit, timeAgo helper). Created ActivityLog.tsx (8 action types with color-coded icons, describeActivity with JSON details parsing, timeline connector).
- **Task 2**: Created RelationshipsSection.tsx (card picker filtering current/archived/linked, type selector, grouped by direction with inverse labels, hover-reveal delete). Modified CardDetailModal.tsx (loadCardDetails/clearCardDetails useEffect, 3 sections between Labels and Timestamps, loading guard, max-w-3xl).
- **Task 3**: Added 5 card templates (Bug Report, Feature Request, Meeting Action, Quick Note, Research Task) with template selector dropdown. applyTemplate fills TipTap + sets priority. Outside-click close.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

### Plan 7.3: Database Backup/Restore & Data Export (3 tasks) — COMPLETE
1. Backup service + export service + types + IPC + preload — DONE
2. Backup management UI + export UI in Settings — DONE
3. Auto-backup scheduler + retention cleanup — DONE
- Not yet committed

## Plan 7.3 Execution Results
- **Task 1**: Created backupService.ts (pg_dump/psql via Docker exec, backup file management, auto-backup settings persistence). Created exportService.ts (Drizzle queries, JSON/CSV serialization, API key exclusion). Created backup.ts IPC handlers (8 channels + file/folder dialogs). Extended types.ts (7 types + 9 ElectronAPI methods). Extended preload.ts (9 bridge methods). Registered in ipc/index.ts.
- **Task 2**: Created backupStore.ts (Zustand — 10 actions: CRUD, export, auto-settings, progress). Created BackupSection.tsx (~280 lines — create/restore buttons, progress indicator, error banner, backup list with inline restore/delete confirmations, auto-backup controls with toggle/frequency/retention). Created ExportSection.tsx (~100 lines — JSON/CSV export buttons, success/error display). Modified SettingsPage.tsx (progress event listener, added both sections).
- **Task 3**: Created autoBackupScheduler.ts (~100 lines — hourly check, daily/weekly frequency support, retention cleanup, graceful error handling). Modified main.ts (initAutoBackup after DB connect, stopAutoBackup on before-quit).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Decisions Made (Plan 7.3)
- Backup via pg_dump stdout → file (not pg_dump --file, which runs inside container)
- Restore via spawn + stdin pipe (psql needs stdin for SQL input)
- Export strips apiKeyEncrypted from aiProviders table
- CSV: one file per table in user-selected directory
- Auto-backup: hourly polling with 10s startup delay
- Safety backup before every restore (logged but non-blocking on failure)
- Filename validation regex prevents path traversal in deleteBackup

### Plan 7.4: AI Task Structuring Engine (3 tasks) — COMPLETE
1. Task structuring types + service + IPC + preload (backend) — DONE
2. Task structuring store + ProjectPlanningModal + ProjectsPage integration — DONE
3. TaskBreakdownSection + CardDetailModal integration — DONE
- Not yet committed

## Plan 7.4 Execution Results
- **Task 1**: Added 'task_structuring' to AITaskType. Added 7 types (ProjectPillar, PillarTask, ProjectMilestone, ProjectPlan, SubtaskSuggestion, TaskBreakdown) + 3 ElectronAPI methods to types.ts. Created taskStructuringService.ts (~270 lines, 2 system prompts, 3 exports: generateProjectPlan, generateQuickPlan, generateTaskBreakdown, with shared generatePlanFromContext helper). Created task-structuring.ts IPC handlers (3 channels). Registered in ipc/index.ts. Extended preload.ts (3 bridge methods).
- **Task 2**: Created taskStructuringStore.ts (83 lines, Zustand — 5 actions). Created ProjectPlanningModal.tsx (462 lines — context textarea, generate/regenerate, pillar tabs with task checkboxes and priority/effort badges, milestones, apply creates board+columns+cards). Modified ProjectsPage.tsx (added Sparkles "Plan with AI" button on each project card, modal render).
- **Task 3**: Created TaskBreakdownSection.tsx (~230 lines — generate button, subtask list with checkboxes/badges, select all toggle, apply creates cards in same column, success feedback). Modified CardDetailModal.tsx (4 changes: imports, clearBreakdown on unmount, TaskBreakdownSection after ActivityLog).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Decisions Made (Plan 7.4)
- Transient AI output: no new DB tables, results displayed in modal, applied as real boards/columns/cards
- Non-streaming: generate() not streamGenerate(), JSON output must be parsed
- New task type: 'task_structuring' added to AITaskType for per-task model routing
- Production-focused prompts: pillars include Architecture, Security, Testing, DevOps, Performance, Documentation
- Temperature 0.4: lower than brainstorming (0.7), balances structure with useful suggestions
- Apply creates: board → columns (named after pillars) → cards (one per selected task)
- generate() in ai-provider.ts already handles usage logging internally, no separate logUsage needed
- Modal uses window.electronAPI directly for board/column/card creation (not boardStore, which is scoped to loaded board)
- TaskBreakdownSection creates cards in same column as parent card

### Plan 7.5: Meeting Templates & Desktop Notifications (3 tasks) — COMPLETE
1. Meeting templates — schema, types, service, and template-aware AI prompts — DONE
2. Meeting templates — UI integration (RecordingControls, MeetingsPage, MeetingDetailModal) — DONE
3. Desktop notifications — service, scheduler, IPC, and settings UI — DONE
- Not yet committed

## Plan 7.5 Execution Results
- **Task 1**: Added meetingTemplateEnum (6 types) to schema. Migration 0004_sour_paper_doll.sql generated. Added MeetingTemplateType, MeetingTemplate, MEETING_TEMPLATES constant (6 presets) to types.ts. Updated Meeting + CreateMeetingInput. Updated meetingService (toMeeting + createMeeting). Made meetingIntelligenceService prompts template-aware (getSummarizationPrompt + getActionExtractionPrompt functions).
- **Task 2**: Added template selector dropdown to RecordingControls (6 options, agenda hint). Updated recordingStore (template parameter). Added template badge to MeetingCard. Added template info section to MeetingDetailModal.
- **Task 3**: Created notificationService.ts (Electron Notification API, settings persistence). Created notificationScheduler.ts (hourly checks, due-card reminders, daily digest). Created notifications.ts IPC handlers (3 channels). Extended preload (3 methods). Wired scheduler into main.ts (init/stop lifecycle). Created NotificationSection.tsx (master toggle, 3 feature toggles, hour selector, test button). Added to SettingsPage.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Decisions Made (Plan 7.5)
- Meeting templates as enum + constant presets (not separate DB table)
- Template-aware prompts: base prompt + template hint appended
- Default template 'none' — backward compatible with existing meetings
- Notification preferences stored as JSON in settings table
- Scheduler: 30s startup delay, 1h interval (follows autoBackupScheduler pattern)
- Due-card query uses eq(cards.archived, false) for boolean column check
- Notifications capped at 5 per check cycle to avoid spam
- Daily digest tracked by lastDigestDate to avoid duplicate sends

### Plan 7.6: API Transcription Providers (3 tasks) — COMPLETE
1. Transcription provider infrastructure — types, config service, IPC, preload — DONE
2. Deepgram + AssemblyAI transcribers, transcriptionService refactor, and fallback — DONE
3. Transcription provider settings UI — DONE
- Not yet committed

## Plan 7.6 Execution Results
- **Task 1**: Added TranscriptionProviderType, TranscriptionProviderConfig, TranscriptionProviderStatus, TranscriberResult types. Updated AITaskType with 'transcription'. Extended ElectronAPI (4 methods). Created transcriptionProviderService.ts (getConfig/getStatus/setProviderType/setApiKey/getDecryptedKey with encrypted key storage). Created transcription-provider.ts IPC handlers (4 channels). Extended preload.ts (4 bridge methods).
- **Task 2**: Created deepgramTranscriber.ts (~100 lines, REST /v1/listen, nova-2, audio/raw, Token auth, word timing seconds→ms). Created assemblyaiTranscriber.ts (~195 lines, PCM→WAV via wavefile, 3-step upload→submit→poll, raw key auth, ms timestamps). Refactored transcriptionService.ts (215→343 lines, provider-aware routing, API dispatch, fallback to local Whisper, usage logging). Wired test handlers in IPC.
- **Task 3**: Created TranscriptionProviderSection.tsx (~343 lines, 3 radio options, API key inputs with save/clear/show-hide, test connection with latency display, status indicators). Added to SettingsPage between Appearance and AI Providers.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.
- **Key fixes**: net.fetch() with Uint8Array body (Electron BodyInit requirement), direct DB insert for usage logging (null providerId avoids UUID issues), Deepgram Content-Type audio/raw (not audio/l16), AssemblyAI needs WAV headers (not raw PCM).

## Decisions Made (Plan 7.6)
- Deepgram REST API (not WebSocket): fits existing 10-sec segment pipeline
- AssemblyAI PCM→WAV conversion via wavefile (AssemblyAI needs container format)
- Electron net.fetch() instead of Node.js native fetch (proxy support)
- Deepgram auth: Token prefix; AssemblyAI auth: raw key (no prefix)
- AI usage logging: direct DB insert with null providerId (not through logUsage helper)
- Fallback: API failure → local Whisper if worker exists (no warm fallback spawn for MVP)
- TranscriptionProviderSection placed before AI Providers in settings (more user-visible)

### Plan 7.7: Speaker Diarization & Meeting Analytics (3 tasks) — COMPLETE
1. Schema extension + diarization service + transcriber functions + IPC — DONE
2. Meeting analytics service + types + IPC + preload — DONE
3. Speaker labels in transcript + meeting analytics UI + diarization trigger — DONE
- Not yet committed

## Plan 7.7 Execution Results
- **Task 1**: Added speaker varchar(50) column to transcripts. Added DiarizationWord/DiarizationResult types. Added transcribeFileWithDiarization to both Deepgram (diarize=true) and AssemblyAI (speaker_labels=true). Speaker normalization to "Speaker 1", "Speaker 2". Created speakerDiarizationService.ts (orchestrator: resolve provider → read WAV → API → map speakers by timestamp overlap → update DB). Updated toTranscriptSegment mapper, added updateSegmentSpeakers. IPC + preload wired. Migration 0005 generated.
- **Task 2**: Added SpeakerStats and MeetingAnalytics types. Created meetingAnalyticsService.ts (on-demand analytics from transcripts + action items, no stored data). IPC handler meeting:analytics + preload bridge.
- **Task 3**: Extended meetingStore with diarizing/analytics state + 3 actions. Created MeetingAnalyticsSection.tsx (stats grid, speaker bars with 6-color palette, "Identify Speakers" button, action item counts). MeetingDetailModal: analytics section, color-coded [Speaker N] transcript labels, load/clear lifecycle.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Decisions Made (Plan 7.7)
- Post-recording diarization (not per-segment): 10-sec segments too short for reliable cross-segment speaker consistency
- Full WAV file sent to API with diarization enabled, speaker labels mapped back to existing segments by timestamp
- Speaker column on transcripts: nullable varchar(50), null = not diarized (backward compatible)
- Speaker labels normalized to "Speaker 1", "Speaker 2" etc. across providers
- Analytics computed on-demand (not stored) — derived from transcript + action items
- Calendar integration and auto meeting detection deferred to ISSUES.md

### Plan 7.8: Card Attachments, Due Date UI & KanbanCard Enhancements (3 tasks) — COMPLETE
1. Card attachments — schema, types, service, IPC, and preload (backend) — DONE
2. Due date picker in CardDetailModal + overdue badge on KanbanCard — DONE
3. Attachments UI — store extensions + AttachmentsSection + CardDetailModal integration — DONE
- Not yet committed

## Plan 7.8 Execution Results
- **Task 1**: Added cardAttachments table to schema (id, cardId, fileName, filePath, fileSize, mimeType, createdAt). Created attachmentService.ts (~120 lines: MIME lookup, getAttachmentsDir helper, getAttachments, addAttachment with file dialog + copy + collision handling, deleteAttachment with disk + DB cleanup, openAttachment via shell.openPath). Added CardAttachment type + 4 ElectronAPI methods. 4 IPC handlers with activity logging. 4 preload bridge methods. Migration 0006 generated.
- **Task 2**: Added toDateTimeLocalValue + getDueDateBadge helpers to CardDetailModal. Added datetime-local input with dark mode support, status badge (Overdue/Due today/Due in Nd), Clear button. Added Clock + getDueDateBadge to KanbanCard with compact due date badge in footer row.
- **Task 3**: Extended boardStore with selectedCardAttachments state, loadCardDetails parallel fetch, clearCardDetails reset, addAttachment/deleteAttachment/openAttachment actions. Created AttachmentsSection.tsx (~140 lines: file icon by MIME type, file size formatting, timeAgo, add/open/delete with confirmation). Integrated in CardDetailModal as first section inside loading guard.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Decisions Made (Plan 7.8)
- File storage in app data directory: userData/attachments/{cardId}/ — files copied, originals stay
- Native HTML datetime-local input (no date picker library) — works well in Electron Chromium
- Attachment metadata in separate table (not inline on cards) — supports multiple per card
- MIME type from extension lookup map (20 common types) — default to application/octet-stream
- getDueDateBadge duplicated in CardDetailModal + KanbanCard (small function, avoids shared util)
- Filename collision handling: append -1, -2 etc. before extension
- AttachmentsSection placed before CommentsSection in card detail

## Phase 7 — COMPLETE
All 8 plans (24 tasks) executed successfully. Phase 7 delivers:
- R16: Advanced Card Features — comments, relationships, activity log, templates, attachments, due date UI
- R15: Database Backup/Restore — pg_dump/psql, JSON/CSV export, auto-backup scheduler
- R11: AI Task Structuring — project planning modal, task breakdown section
- R13: Meeting Templates + Desktop Notifications + Speaker Diarization + Meeting Analytics
- R14: API Transcription Providers (Deepgram, AssemblyAI) with fallback
- R17: Desktop Notifications — due date reminders, daily digest

## Phase 8 — IN PROGRESS (Post-Review Improvements)
Source: REVIEW.md (graded B-, "NEEDS ATTENTION")
Focus: Highest-impact fixes from project review.

### Plan 8.1: Critical Review Fixes — Performance, Testing, Security (3 tasks) — COMPLETE
1. Fix N+1 query in cards:list-by-board (300+ queries → 4 batch queries with inArray) — DONE
2. Set up Vitest test framework + write initial unit tests (zero → foundation) — DONE
3. Security hardening — CSP headers on BrowserWindow + path validation in openAttachment — DONE
- Commit: 5abc3c8 on origin/main

## Plan 8.1 Execution Results
- **Task 1**: Replaced triple-nested N+1 loop in cards:list-by-board with 4 batch queries using `inArray`. Reduced 300-600+ queries to exactly 4 (columns, cards, cardLabels, labels). Updated LIMITATIONS comment.
- **Task 2**: Installed vitest v4.0.18 + @vitest/ui. Created vitest.config.ts (globals, node env). Added 3 test scripts to package.json. Extracted `buildCardLabelMap` to src/shared/utils/card-utils.ts (pure, no Electron deps). Updated cards.ts to import from shared util. Created card-utils.test.ts (6 tests) + types.test.ts (6 tests). All 12 tests pass.
- **Task 3**: Added Content-Security-Policy via session.webRequest.onHeadersReceived in main.ts (dev: ws + unsafe-eval for HMR, prod: strict). Added path traversal prevention + file existence check in attachmentService.ts openAttachment(). Updated LIMITATIONS comment.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.

## Confidence Levels
Overall approach: HIGH
Plan 8.1 execution: HIGH (all 3 tasks verified, TypeScript clean, 12 tests passing)

## Decisions Made (Plan 8.1)
- Vitest v4.0.18 compatible with Vite 7.3 and TypeScript 5.9
- buildCardLabelMap placed in src/shared/utils/ (not src/main/) for Electron-free testing
- CSP: 'unsafe-inline' for styles (Tailwind), 'unsafe-eval' for scripts in dev only (Vite HMR)
- CSP connect-src includes all 4 API providers + Ollama localhost
- Path validation uses path.resolve + startsWith (handles ../ and Windows paths)
- types.test.ts adapted to actual MEETING_TEMPLATES fields (icon, agenda, aiPromptHint)

### Plan 8.2: README, Within-Column Reordering, UI Polish (3 tasks) — COMPLETE
1. Create README.md with project overview and developer quick start — DONE
2. Implement within-column card reordering via drag-and-drop (pragmatic-drag-and-drop-hitbox) — DONE
3. UI polish batch — BrainstormPage padding, getDueDateBadge extraction, restore confirmation — DONE
- Commit: b6e9841 on origin/main

## Plan 8.2 Execution Results
- **Task 1**: Created README.md (122 lines) — project title, features list, prerequisites, quick start, 12 verified scripts table, tech stack with versions from package.json, project structure tree (verified against actual dirs), env vars from .env.example, configuration notes, honest license statement. All content verified against actual project files.
- **Task 2**: Installed @atlaskit/pragmatic-drag-and-drop-hitbox. Made KanbanCard both draggable and drop target with edge detection (closestEdge state + blue indicator lines). Replaced BoardPage drag monitor to handle both same-column reorder and cross-column move (removed blocking early return). Replaced cards:move IPC handler with full reorder implementation (query siblings, splice, update positions). Added optimistic UI in boardStore.
- **Task 3**: Added p-6 to BrainstormPage wrapper (adjusted height calc from 10rem to 13rem). Extracted getDueDateBadge to src/renderer/utils/date-utils.ts. Updated KanbanCard + CardDetailModal to import from shared util. Added restoreFromFile confirmation dialog in BackupSection (amber-themed, matching existing pattern).
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.
- **Tests**: 12/12 passing.

## Confidence Levels
Overall approach: HIGH
Plan 8.2 execution: HIGH (all 3 tasks verified, TypeScript clean, tests passing)

## Decisions Made (Plan 8.2)
- README: 100+ IPC channels (not 60+ as originally estimated), verified via grep
- README: .env.example has DB_PASSWORD and DATABASE_URL variables
- Card reordering: edge detection via pragmatic-drag-and-drop-hitbox attachClosestEdge/extractClosestEdge
- Card reordering: optimistic UI in boardStore (instant local update before IPC)
- Card reordering: backend reindexes only cards whose position actually changed
- BrainstormPage: height calc adjusted from 10rem to 13rem to compensate for p-6 padding
- getDueDateBadge: shared version omits year (matches KanbanCard compact format)
- CardDetailModal: formatDate helper kept (used independently for Created/Updated timestamps)

### Plan 8.3: Structured Logging, Zod IPC Validation, BoardColumn Extraction (3 tasks) — COMPLETE
1. Create structured logger + migrate all 50 main-process console calls (12 files) — DONE
2. Add Zod IPC validation — infrastructure + projects.ts pilot (13 handlers) — DONE
3. Extract BoardColumn component from BoardPage to its own file (621 → 441 lines) — DONE
- Commit: 1383ed5 on origin/main

## Plan 8.3 Execution Results
- **Task 1**: Created logger.ts (createLogger with levels/timestamps/prefixes). Migrated ~50 console calls across 12 files. Zero raw console calls remain in src/main/ (only inside logger.ts). 12 prefixes: App, Transcription, AutoBackup, Notifications, NotificationScheduler, Diarization, Backup, AI, Audio, TranscriptionProvider, Cards, Brainstorm.
- **Task 2**: Added zod as direct dependency. Created schemas.ts (7 schemas + columnReorder) and ipc-validator.ts (validateInput wrapper). Applied validation to all 13 handlers in projects.ts (16 validateInput calls). Param types changed to `unknown`. Pattern ready for rollout to remaining ~95 handlers.
- **Task 3**: Created BoardColumn.tsx (192 lines). BoardPage.tsx reduced from 621 to 441 lines. Cleaned up BoardPage imports. Component identity and DnD behavior preserved.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors after all 3 tasks.
- **Tests**: 12/12 passing.

## Decisions Made (Plan 8.3)
- Custom lightweight logger (no winston/pino) — sufficient for desktop app
- Logger default level: 'info' (debug hidden by default, available via setLogLevel)
- notificationScheduler and notificationService use distinct prefixes (NotificationScheduler vs Notifications)
- Zod schemas match TypeScript interfaces exactly — verified against types.ts
- Handler params changed from specific types to `unknown` — Zod provides runtime typing
- validateInput throws Error with structured issue messages (path + message)
- columnReorderSchema validates array of UUIDs (boardId validated separately)
- BoardColumn extracted cleanly — no closured state from BoardPage
- dropTargetForElements removed from BoardPage (only needed in BoardColumn)

## Confidence Levels
Overall approach: HIGH
Plan 8.4 execution: HIGH (all 3 tasks verified, TypeScript clean, 12/12 tests passing)

### Plan 8.4: Zod IPC Validation Rollout — Schemas + 5 Handler Files (3 tasks) — COMPLETE
1. Create all remaining Zod schemas (~21 input types) — extends schemas.ts — DONE
2. Apply Zod validation to cards.ts (23 handlers — largest IPC file) — DONE
3. Apply Zod validation to ai-providers.ts (8), ideas.ts (8), meetings.ts (5), meeting-intelligence.ts (6) — 27 handlers — DONE
- Commit: 5b89bbb on origin/main

## Plan 8.4 Execution Results
- **Task 1**: Extended schemas.ts with 14 enum schemas + 27 object schemas + 4 primitive schemas (45 total exports, up from 8). Covers cards, labels, comments, relationships, attachments, AI providers, ideas, meetings, meeting intelligence, plus bonus schemas for brainstorm, backup, notifications, settings.
- **Task 2**: Applied validateInput to all 23 handlers in cards.ts (29 validateInput calls). Changed all params to `unknown`. Removed CreateCardInput, UpdateCardInput, CreateLabelInput, UpdateLabelInput type imports. Kept Card/Label imports for return type casts.
- **Task 3**: Applied validateInput to 27 handlers across 4 files: ai-providers.ts (5 validated, 3 no-param skip), ideas.ts (7 validated, 1 skip), meetings.ts (4 validated, 1 skip), meeting-intelligence.ts (6 validated). Removed old type imports. Total: 78 validateInput calls across 6 IPC files.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors.
- **Tests**: 12/12 passing.

## Decisions Made (Plan 8.4)
- baseUrl allows any string (not URL-validated) — Ollama uses localhost URLs
- dueDate validated as string (ISO timestamp expected but not enforced at schema level)
- Tag arrays capped at 20 items per idea, each max 100 chars
- cards:move uses cardMoveSchema for {columnId, position} as compound object
- AIProviderName type import kept in ai-providers.ts (used for cast in testConnection)
- Bonus schemas added for brainstorm, backup, notifications, settings (covers future Plan 8.5 files)
- Total validated handlers: 63 of ~112 (~56%), up from 13 (~12%)

### Plan 8.5: Remaining IPC Validation, IdeaDetailModal Decomposition & Console Cleanup (3 tasks) — COMPLETE
1. Apply Zod validation to 6 medium IPC files (brainstorm, backup, settings, notifications, transcription-provider, task-structuring) — 29 handlers — DONE
2. Apply Zod validation to 5 small IPC files (recording, whisper, diarization, database, window-controls) — 13 handlers + renderer console cleanup — DONE
3. Decompose IdeaDetailModal (815 → 470 lines) — extract IdeaAnalysisSection + IdeaConvertWizard — DONE
- Commit: afde301 on origin/main

## Plan 8.5 Execution Results
- **Task 1**: Applied validateInput to all param handlers across 6 files: brainstorm.ts (10 calls, 7 handlers), backup.ts (5 calls), settings.ts (5 calls), notifications.ts (2 calls), transcription-provider.ts (5 calls), task-structuring.ts (6 calls). Added 3 new schemas: taskStructuringNameSchema, taskStructuringDescriptionSchema, whisperModelNameSchema. Removed old type imports. All params changed to `unknown`.
- **Task 2**: Applied validateInput to recording.ts (1 param handler), whisper.ts (1 param handler), diarization.ts (2 param handlers). Added comments to database.ts and window-controls.ts (all parameterless). audio:chunk skipped (binary data). Removed 2 console.log calls from audioCaptureService.ts. Zero console.log in renderer.
- **Task 3**: Extracted IdeaAnalysisSection.tsx (135 lines — AI analysis button, loading, error, results with Apply/Dismiss). Extracted IdeaConvertWizard.tsx (273 lines — 3-step project→board→column wizard with internal state). IdeaDetailModal reduced from 815 to 470 lines.
- **TypeScript**: `npx tsc --noEmit` passes with zero errors.
- **Tests**: 12/12 passing.

## Decisions Made (Plan 8.5)
- Pre-created schemas in schemas.ts before parallel agent dispatch (resolved file collision for parallel mode)
- brainstorm:export-to-idea takes sessionId + messageId (both UUIDs), not messageContent as plan suggested
- audio:chunk binary data not Zod-validated (comment explains why)
- window-controls.ts and database.ts: all parameterless, validation not needed (documented)
- IdeaConvertWizard larger than estimated (273 vs ~150) due to internal state management moving from parent
- Total validateInput calls: 103 across 15 IPC files (100% handler coverage)

## Confidence Levels
Overall approach: HIGH
Plan 8.5 execution: HIGH (all 3 tasks verified, TypeScript clean, 12/12 tests passing)

## Next Steps
1. `/nexus:git` — Commit Plan 8.5 changes
2. Plan 8.6+: TBD based on review
