# Plan 8.7 — Preload Bridge Namespacing, `any` Elimination & Developer Documentation

**Source:** REVIEW.md findings. Plans 8.1-8.6 addressed 12 of 14 short-term items (N+1 fix, test framework, README, IPC validation, card reordering, structured logging, CSP, types split, IdeaDetailModal/BoardColumn/boardStore decomposition). Remaining high-impact items: monolithic preload bridge (274 lines, 80+ flat methods, arch concern #1), 80 `any` type occurrences (code quality concern #7), and missing developer/architecture documentation (documentation review: "SPARSE").
**Scope:** 3 tasks — all independent (different file domains), safe for parallel execution.
**Approach:** Task 1 splits preload.ts into domain modules and replaces 29 `any` params with proper types. Task 2 eliminates remaining ~51 `any` occurrences across 13 service/component files. Task 3 creates DEVELOPMENT.md and ARCHITECTURE.md developer documentation.

## Scope Rationale

`preload.ts` at 274 lines with 80+ flat methods is the #1 architecture concern: "Every new feature requires modifying this file." At 2x features it would exceed 500 lines. Domain-scoped modules follow the same pattern used for types.ts (Plan 8.6) and IPC handlers (existing architecture). The 29 `any` params in preload account for 36% of all `any` occurrences — fixing them during the restructure is efficient.

The remaining 51 `any` types are concentrated in API response parsing (assemblyaiTranscriber: 17, deepgramTranscriber: 7, exportService: 8) where proper response interfaces add type safety to external API boundaries.

Developer documentation was rated "SPARSE / NEEDS WORK" in the review. README.md exists (Plan 8.2) but new developers still have no guide for setup workflow, project structure explanation, adding features, or understanding the architecture (process model, IPC patterns, data flow).

---

<phase n="8.7" name="Preload Bridge Namespacing, any Elimination & Developer Documentation">
  <context>
    Plans 8.1-8.6 completed. Remaining high-impact review items:
    - preload.ts: 274 lines, 80+ flat methods, 29 `any` params (architecture concern #1)
    - 80 `any` type occurrences across 14 files (code quality concern #7)
    - No DEVELOPMENT.md or ARCHITECTURE.md (documentation: "SPARSE")

    Key reference files:
    @src/preload/preload.ts — 274 lines, monolithic preload bridge to split
    @src/shared/types/electron-api.ts — ElectronAPI interface (typed contract)
    @src/main/services/assemblyaiTranscriber.ts — 17 `any` occurrences
    @src/main/services/deepgramTranscriber.ts — 7 `any` occurrences
    @src/main/services/exportService.ts — 8 `any` occurrences
    @src/main/services/transcriptionService.ts — 5 `any` occurrences
    @src/main/services/ai-provider.ts — 3 `any` occurrences
    @src/main/services/taskStructuringService.ts — 2 `any` occurrences
    @README.md — existing project overview for doc reference
    @PROJECT.md — vision and architecture overview
  </context>

  <task type="auto" n="1">
    <n>Namespace preload bridge into domain modules with typed parameters</n>
    <files>
      src/preload/preload.ts (MODIFY — 274 → ~40 lines, orchestrator)
      src/preload/domains/window.ts (CREATE — window controls)
      src/preload/domains/database.ts (CREATE — DB status)
      src/preload/domains/projects.ts (CREATE — projects, boards, columns, cards, labels)
      src/preload/domains/card-details.ts (CREATE — comments, relationships, activities, attachments)
      src/preload/domains/settings.ts (CREATE — settings, AI providers, AI usage)
      src/preload/domains/meetings.ts (CREATE — meetings, recording, whisper, intelligence, diarization, analytics)
      src/preload/domains/ideas.ts (CREATE — ideas, idea analysis)
      src/preload/domains/brainstorm.ts (CREATE — brainstorm sessions, streaming)
      src/preload/domains/backup.ts (CREATE — backup, restore, export, auto-settings)
      src/preload/domains/task-structuring.ts (CREATE — task structuring)
      src/preload/domains/notifications.ts (CREATE — notification preferences)
      src/preload/domains/transcription.ts (CREATE — transcription provider config)
    </files>
    <action>
      ## WHY
      preload.ts at 274 lines with 80+ flat methods is architecture concern #1.
      The review says: "Every new feature requires modifying this file. Uses `any`
      for parameters at runtime." At 2x features it would exceed 500 lines. The
      29 `any` params also break type safety at the IPC boundary.

      ## WHAT

      1. READ src/preload/preload.ts FULLY. Identify all domain sections by the
         existing `// Comments`, `// Cards`, `// Meetings` etc. comments.

      2. READ src/shared/types/electron-api.ts to understand the typed contract.
         The domain files should match the ElectronAPI interface signatures.

      3. Create directory: src/preload/domains/

      4. Create domain files. Each file:
         - Imports `ipcRenderer` from 'electron'
         - Imports relevant types from '../../shared/types' for parameter typing
         - Exports an object with the domain's methods
         - Replaces `any` params with proper types (e.g., `data: any` → `data: CreateProjectInput`)

      Domain mapping (verify against actual preload.ts):

      | File | Methods | `any` params to type |
      |------|---------|---------------------|
      | window.ts | windowMinimize, windowMaximize, windowClose, windowIsMaximized, onWindowMaximizeChange | 0 |
      | database.ts | getDatabaseStatus | 0 |
      | projects.ts | getProjects, createProject, updateProject, deleteProject, getBoards, createBoard, updateBoard, deleteBoard, getColumns, createColumn, updateColumn, deleteColumn, reorderColumns, getCardsByBoard, createCard, updateCard, deleteCard, moveCard, getLabels, createLabel, updateLabel, deleteLabel, attachLabel, detachLabel | ~12 (create/update params) |
      | card-details.ts | getCardComments, addCardComment, updateCardComment, deleteCardComment, getCardRelationships, addCardRelationship, deleteCardRelationship, getCardActivities, getCardAttachments, addCardAttachment, deleteCardAttachment, openCardAttachment | 0 (already typed) |
      | settings.ts | getSetting, setSetting, getAllSettings, deleteSetting, getAIProviders, createAIProvider, updateAIProvider, deleteAIProvider, testAIConnection, isEncryptionAvailable, getAIUsage, getAIUsageSummary | ~4 |
      | meetings.ts | getMeetings, getMeeting, createMeeting, updateMeeting, deleteMeeting, startRecording, stopRecording, sendAudioChunk, enableLoopbackAudio, disableLoopbackAudio, onRecordingState, onTranscriptSegment, getWhisperModels, downloadWhisperModel, hasWhisperModel, onWhisperDownloadProgress, generateBrief, generateActionItems, getMeetingBrief, getMeetingActionItems, updateActionItemStatus, convertActionToCard, diarizeMeeting, getMeetingAnalytics | ~6 (callbacks + create) |
      | ideas.ts | getIdeas, getIdea, createIdea, updateIdea, deleteIdea, convertIdeaToProject, convertIdeaToCard, analyzeIdea | ~2 |
      | brainstorm.ts | getBrainstormSessions, getBrainstormSession, createBrainstormSession, updateBrainstormSession, deleteBrainstormSession, sendBrainstormMessage, onBrainstormChunk, exportBrainstormToIdea | ~2 |
      | backup.ts | backupCreate, backupList, backupRestore, backupRestoreFromFile, backupDelete, backupExport, backupAutoSettingsGet, backupAutoSettingsUpdate, onBackupProgress | ~3 |
      | task-structuring.ts | taskStructuringGeneratePlan, taskStructuringBreakdown, taskStructuringQuickPlan | 0 |
      | notifications.ts | notificationGetPreferences, notificationUpdatePreferences, notificationSendTest | ~1 |
      | transcription.ts | transcriptionGetConfig, transcriptionSetProvider, transcriptionSetApiKey, transcriptionTestProvider | 0 |

      5. Rewrite preload.ts as an orchestrator:
         ```typescript
         import { contextBridge } from 'electron';
         import { windowBridge } from './domains/window';
         import { databaseBridge } from './domains/database';
         import { projectsBridge } from './domains/projects';
         // ... all domain imports

         contextBridge.exposeInMainWorld('electronAPI', {
           platform: process.platform,
           ...windowBridge,
           ...databaseBridge,
           ...projectsBridge,
           ...cardDetailsBridge,
           ...settingsBridge,
           ...meetingsBridge,
           ...ideasBridge,
           ...brainstormBridge,
           ...backupBridge,
           ...taskStructuringBridge,
           ...notificationsBridge,
           ...transcriptionBridge,
         });
         ```

      6. Verify the exported API is identical — same method names, same behavior.

      IMPORTANT:
      - DO NOT change the ElectronAPI interface (shared/types/electron-api.ts)
      - DO NOT change any renderer code — the API surface is identical
      - The `ipcRenderer.on()` listener patterns (onRecordingState, onBrainstormChunk,
        etc.) need `ipcRenderer` imported in each domain file
      - `sendAudioChunk` uses `ipcRenderer.send()` (not invoke) — preserve this
      - `Buffer.from(buffer)` in sendAudioChunk is OK in preload context (Node APIs available)
      - Type imports should use `import type { ... }` for types-only imports
      - Each domain file should be 15-40 lines
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all 98 tests pass
      3. preload.ts is under 50 lines (orchestrator only)
      4. 12 domain files exist in src/preload/domains/
      5. Zero `any` occurrences in preload.ts and all domain files:
         `grep -r "any" src/preload/ --include="*.ts" | grep -v "import type" | grep -v "node_modules"`
      6. All domain files export a named bridge object
    </verify>
    <done>
      preload.ts reduced from 274 to ~40 lines. 12 domain modules in
      src/preload/domains/. All 29 `any` params replaced with proper types.
      API surface unchanged — zero renderer changes needed.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Object spread in contextBridge.exposeInMainWorld works correctly
      - ipcRenderer can be imported in each domain file independently
      - Type imports from shared/types resolve in preload context (same as current)
      - No method name collisions across domains (each domain has unique prefixes)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Eliminate all remaining `any` types across source files</n>
    <files>
      src/main/services/assemblyaiTranscriber.ts (MODIFY — replace 9 `any` types)
      src/main/services/deepgramTranscriber.ts (MODIFY — replace 4 `any` types)
      src/main/services/exportService.ts (MODIFY — replace 8 `any` types)
      src/main/services/transcriptionService.ts (MODIFY — replace 3 `any` types)
      src/main/services/ai-provider.ts (MODIFY — replace 2 `any` types)
      src/main/services/taskStructuringService.ts (MODIFY — replace 1 `any` type)
      src/main/services/ideaService.ts (MODIFY — replace 1 `any` type)
      src/main/services/whisperModelManager.ts (MODIFY — replace 1 `any` type)
      src/main/workers/transcriptionWorker.ts (MODIFY — replace 1 `any` type)
      src/renderer/stores/settingsStore.ts (MODIFY — replace 1 `any` type)
      src/renderer/components/ProjectPlanningModal.tsx (MODIFY — replace 1 `any` type)
      src/renderer/components/settings/BackupSection.tsx (MODIFY — replace 1 `any` type)
    </files>
    <action>
      ## WHY
      87 `any` type occurrences were flagged as MEDIUM severity in the code quality
      review. After Task 1 removes 29 from preload, ~51 remain across 12+ files.
      Most are in API response parsing (assemblyai: 17 grep matches, deepgram: 7)
      where typed interfaces catch breaking API changes at compile time.

      Note: grep counts include `eslint-disable-next-line @typescript-eslint/no-explicit-any`
      comments. The actual `any` TYPE occurrences are fewer. When you replace the `any`
      with a proper type, also remove the corresponding eslint-disable comment.

      ## WHAT

      READ each file before modifying. For each `any`, determine the correct type.

      ### 1. assemblyaiTranscriber.ts (highest count — ~9 actual `any` types)

      Create response interfaces for AssemblyAI API responses:
      ```typescript
      interface AssemblyAIUploadResponse { upload_url: string }
      interface AssemblyAITranscript {
        id: string;
        status: 'queued' | 'processing' | 'completed' | 'error';
        text?: string;
        error?: string;
        words?: Array<{ text: string; start: number; end: number; speaker?: string }>;
      }
      ```
      Replace `const uploadData: any` → `const uploadData: AssemblyAIUploadResponse`
      Replace `const transcriptData: any` → `const transcriptData: AssemblyAITranscript`
      Replace `const result: any` in poll loops → `const result: AssemblyAITranscript`
      Replace `(w: any)` in word mapping → `(w: AssemblyAITranscript['words'][number])`
      Similar for `transcribeFileWithDiarization` function.
      Remove all `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments.

      ### 2. deepgramTranscriber.ts (~4 actual `any` types)

      Create response interface:
      ```typescript
      interface DeepgramResponse {
        results?: {
          channels?: Array<{
            alternatives?: Array<{
              transcript?: string;
              words?: Array<{ word: string; start: number; end: number; speaker?: number }>;
            }>;
          }>;
        };
      }
      ```
      Replace all `any` response types. Remove eslint-disable comments.

      ### 3. exportService.ts (8 `any` types)

      - `EXPORT_TABLES: Record<string, any>` → `Record<string, PgTable>` (import from drizzle-orm/pg-core or use a more specific type). If PgTable is not available, use `Record<string, { [key: string]: unknown }>` or the actual Drizzle table type.
      - `Record<string, any[]>` → `Record<string, Record<string, unknown>[]>`
      - `(row: any)` → `(row: Record<string, unknown>)`
      - `toCsvRow(values: any[])` → `toCsvRow(values: unknown[])`
      - `tableToCsv(rows: any[])` → `tableToCsv(rows: Record<string, unknown>[])`

      READ the Drizzle schema imports to determine the most accurate types.

      ### 4. transcriptionService.ts (~3 actual `any` types)

      READ the file first. Replace `any` with specific types (likely worker message
      types or transcription result types).

      ### 5. ai-provider.ts (~2 actual `any` types)

      Likely in error handling or response parsing. Replace with `unknown` or
      specific SDK types from `ai` package.

      ### 6. Remaining files (1 each)

      - taskStructuringService.ts: likely JSON parse result → use `unknown` + type guard
      - ideaService.ts: likely JSON parse result → use `unknown` + type guard
      - whisperModelManager.ts: likely HTTP response or error → use `unknown`
      - transcriptionWorker.ts: likely message handler → type the message protocol
      - settingsStore.ts: likely settings value → use `string | null`
      - ProjectPlanningModal.tsx: likely event handler or API response → specific type
      - BackupSection.tsx: likely event handler → specific type

      IMPORTANT:
      - Prefer specific types over `unknown` when the shape is known
      - Use `unknown` over `any` when the shape is truly unknown, with type guards
      - Remove all `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments
        when the underlying `any` is fixed
      - Do NOT change behavior — only types
      - Each file's interfaces should be defined locally (near usage), not in shared/types
        (these are internal implementation details, not public API)
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all 98 tests pass
      3. Zero `any` type annotations in source files (excluding test files, node_modules):
         Run: `grep -rn "\bany\b" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "__tests__" | grep -v "eslint-disable" | grep -v "\/\/" | grep -v "string literal"`
         Verify count is 0 (or only in string literals like "any blockers")
      4. All eslint-disable comments for `no-explicit-any` removed
    </verify>
    <done>
      All `any` type annotations eliminated from source files. API response
      interfaces created for AssemblyAI, Deepgram, and export service. Type
      safety at all external API boundaries. Zero eslint-disable-any comments.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - AssemblyAI and Deepgram API response shapes are stable (typed from observed usage)
      - Drizzle ORM provides adequate table types for exportService
      - JSON.parse results can use `unknown` with type assertions after validation
      - `any` in string literals (e.g., "any blockers" in meeting prompts) are false positives
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Create developer documentation — DEVELOPMENT.md and ARCHITECTURE.md</n>
    <files>
      docs/DEVELOPMENT.md (CREATE — ~150 lines)
      docs/ARCHITECTURE.md (CREATE — ~200 lines)
    </files>
    <action>
      ## WHY
      The documentation review rated coverage as "SPARSE" and onboarding as "NEEDS WORK."
      README.md exists (Plan 8.2) but provides only a quick start. New developers have
      no guide for daily workflow, project structure, adding features, debugging, or
      understanding the architecture. The review estimates onboarding time drops from
      2-4 hours to under 15 minutes with proper dev + architecture docs.

      ## WHAT

      READ these files before writing docs to ensure accuracy:
      - README.md — existing overview (don't duplicate, reference it)
      - PROJECT.md — vision and tech stack
      - package.json — all scripts
      - src/ directory structure (use `ls -R` or glob to map it)
      - src/main/main.ts — app lifecycle
      - src/main/ipc/index.ts — IPC registration pattern
      - src/main/db/connection.ts — DB connection
      - src/main/db/schema/ — schema files
      - src/preload/preload.ts — preload bridge (will be refactored by Task 1 but doc the pattern)
      - src/renderer/App.tsx — React app entry
      - src/renderer/stores/ — Zustand stores
      - vitest.config.ts — test configuration
      - forge.config.ts — Electron Forge config
      - docker-compose.yml — Docker setup

      ### 1. DEVELOPMENT.md (~150 lines)

      Sections:
      - **Prerequisites** — Node.js, Docker, Git (with version requirements from package.json engines)
      - **First-Time Setup** — step-by-step (clone, install, docker compose up, env, start)
      - **Daily Development** — `npm start`, hot reload behavior, what runs where
      - **Project Structure** — tree diagram of src/ with one-line descriptions per directory
      - **NPM Scripts** — table of all scripts from package.json with descriptions
      - **Adding a New Feature** — the standard flow:
        1. Add types to src/shared/types/ (create domain file or extend existing)
        2. Create/extend service in src/main/services/
        3. Add IPC handler in src/main/ipc/
        4. Register handler in src/main/ipc/index.ts
        5. Add preload bridge method in src/preload/domains/
        6. Extend ElectronAPI interface in src/shared/types/electron-api.ts
        7. Create/extend Zustand store in src/renderer/stores/
        8. Build UI components in src/renderer/components/
      - **Database** — running migrations, creating new migrations, schema location
      - **Testing** — running tests, writing tests, test file location conventions
      - **Debugging** — DevTools access, main process logging, common issues
      - **Common Issues** — Docker not running, port conflicts, Whisper model not found

      ### 2. ARCHITECTURE.md (~200 lines)

      Sections:
      - **Overview** — high-level diagram (text-based) of the 3-process model
      - **Process Model** — main process, preload, renderer (what runs where, why)
      - **Data Flow** — unidirectional: UI → Store → IPC → Service → DB → IPC → Store → UI
      - **IPC Communication** — how channels work, naming conventions, handler registration
      - **Database Layer** — PostgreSQL via Docker, Drizzle ORM, migration system, schema organization
      - **State Management** — Zustand stores pattern, 9 stores listed with responsibility
      - **AI Provider System** — provider abstraction, per-task model routing, usage logging
      - **Security Model** — context isolation, API key encryption, CSP, IPC validation (Zod)
      - **Audio Pipeline** — capture → chunking → transcription → storage → display
      - **Key Patterns** — service layer pattern, store pattern, IPC handler pattern, type organization

      IMPORTANT:
      - All content MUST be verified against actual source code — DO NOT fabricate
      - Reference specific file paths so developers can find things
      - Keep it practical and scannable (tables, code blocks, bullet points)
      - Do NOT duplicate README.md content — reference it instead
      - Use actual npm script names, actual file paths, actual patterns from the codebase
      - Create the docs/ directory if it doesn't exist
    </action>
    <verify>
      1. docs/DEVELOPMENT.md exists and is 100-200 lines
      2. docs/ARCHITECTURE.md exists and is 150-250 lines
      3. All file paths referenced in docs actually exist (spot-check 5+)
      4. All npm scripts referenced match package.json
      5. Architecture descriptions match actual code patterns
      6. `npx tsc --noEmit` — still passes (docs don't affect compilation)
    </verify>
    <done>
      DEVELOPMENT.md (setup guide, project structure, adding features, debugging)
      and ARCHITECTURE.md (process model, data flow, IPC, stores, AI, security)
      created in docs/ directory. All content verified against actual codebase.
      New developer onboarding time estimated to drop from 2-4 hours to under 15 minutes.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - docs/ directory can be created at project root
      - Text-based architecture diagrams are sufficient (no image tooling)
      - Doc content can reference Task 1's preload namespacing pattern (if Task 1 runs first)
        OR the current flat pattern (if docs run first) — either is valid
      - README.md linking to docs/ is optional (can be added separately)
    </assumptions>
  </task>
</phase>
