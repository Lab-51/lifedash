# Plan 8.3 — Structured Logging, Zod IPC Validation, and BoardColumn Extraction

**Source:** REVIEW.md findings (2026-02-13) — structured logging (MEDIUM), IPC validation (MEDIUM), component refactoring (HIGH)
**Scope:** Create structured logger and migrate main-process logging, add Zod validation to the first IPC module (projects.ts as pilot), extract BoardColumn from BoardPage to its own file.
**Approach:** Infrastructure task, validation pilot, and one safe extraction — all touching different file areas, potentially parallelizable.

## Scope Rationale

The full review findings (104 IPC handlers, 67 console calls, 9 oversized components) are too large for one plan. This plan tackles:
- **Structured logging:** All 50 main-process calls (complete migration)
- **Zod validation:** Pilot on projects.ts (9 handlers) + reusable infrastructure
- **Component refactoring:** BoardColumn extraction (safest, highest-impact extraction)

Remaining work deferred to Plan 8.4:
- Zod validation for remaining 95 IPC handlers
- Renderer-side logging (17 calls)
- IdeaDetailModal (814 lines) + CardDetailModal (502 lines) decomposition

---

<phase n="8.3" name="Structured Logging, Zod IPC Validation, and BoardColumn Extraction">
  <context>
    Post-review improvement plan (continued from Plan 8.2). The project review identified
    three systematic issues: raw console logging (67 calls, no structure), zero IPC input
    validation (104 handlers accept unvalidated data), and 9 oversized components.

    This plan addresses all three areas with scoped, achievable tasks.

    Key files:
    @src/main/services/ — 10 files with 39 console calls (transcriptionService has 12 alone)
    @src/main/main.ts — 4 console calls (startup/shutdown lifecycle)
    @src/main/ipc/ — 1 console call (cards.ts)
    @src/main/ipc/projects.ts — 9 IPC handlers, 6 input types already defined in types.ts
    @src/shared/types.ts — 24 input interfaces (CreateProjectInput, UpdateProjectInput, etc.)
    @src/renderer/pages/BoardPage.tsx — 620 lines, BoardColumn nested at lines 27-205

    Already confirmed:
    - Zod v3.25.76 available as transitive dependency (via AI SDK), NOT in package.json directly
    - 50 console calls in main process across 12 files
    - All logging uses [Prefix] convention (e.g., [Transcription], [AutoBackup], [DB])
    - BoardColumn is a named function component with explicit BoardColumnProps interface
    - BoardColumn is used only in BoardPage.tsx (no other imports)
    - projects.ts imports 6 input types: Create/Update for Project, Board, Column
  </context>

  <task type="auto" n="1">
    <n>Create structured logger and migrate all main-process logging</n>
    <files>
      src/main/services/logger.ts (NEW)
      src/main/main.ts (MODIFY)
      src/main/ipc/cards.ts (MODIFY)
      src/main/ipc/brainstorm.ts (MODIFY)
      src/main/services/ai-provider.ts (MODIFY)
      src/main/services/audioProcessor.ts (MODIFY)
      src/main/services/autoBackupScheduler.ts (MODIFY)
      src/main/services/backupService.ts (MODIFY)
      src/main/services/notificationScheduler.ts (MODIFY)
      src/main/services/notificationService.ts (MODIFY)
      src/main/services/speakerDiarizationService.ts (MODIFY)
      src/main/services/transcriptionProviderService.ts (MODIFY)
      src/main/services/transcriptionService.ts (MODIFY)
    </files>
    <action>
      ## WHY
      The project has 50 raw console.log/error/warn calls in the main process with no
      structure, no log levels, and no timestamps. A structured logger improves debuggability,
      enables filtering by level/prefix, and provides timestamps. The existing [Prefix]
      convention is a good foundation to build on.

      ## WHAT

      ### Create src/main/services/logger.ts

      A lightweight logger — NOT a full library (no winston/pino needed for a desktop app).
      The logger wraps console methods with structure:

      ```typescript
      // === FILE PURPOSE ===
      // Structured logger for main process. Wraps console with levels, timestamps, and prefixes.

      export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

      const LOG_LEVELS: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
      };

      let currentLevel: LogLevel = 'info';

      export function setLogLevel(level: LogLevel): void {
        currentLevel = level;
      }

      function shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
      }

      function formatTimestamp(): string {
        return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
      }

      function formatMessage(level: LogLevel, prefix: string, message: string, ...args: unknown[]): void {
        if (!shouldLog(level)) return;
        const tag = `${formatTimestamp()} [${level.toUpperCase().padEnd(5)}] [${prefix}]`;
        switch (level) {
          case 'error':
            console.error(tag, message, ...args);
            break;
          case 'warn':
            console.warn(tag, message, ...args);
            break;
          default:
            console.log(tag, message, ...args);
            break;
        }
      }

      /** Create a scoped logger with a fixed prefix */
      export function createLogger(prefix: string) {
        return {
          debug: (message: string, ...args: unknown[]) => formatMessage('debug', prefix, message, ...args),
          info: (message: string, ...args: unknown[]) => formatMessage('info', prefix, message, ...args),
          warn: (message: string, ...args: unknown[]) => formatMessage('warn', prefix, message, ...args),
          error: (message: string, ...args: unknown[]) => formatMessage('error', prefix, message, ...args),
        };
      }
      ```

      ### Migrate all 50 main-process console calls

      For each file, create a scoped logger at the top and replace console calls:

      **Migration rules:**
      - `console.log('[Prefix] message')` → `log.info('message')` (prefix moves to createLogger)
      - `console.error('[Prefix] message:', err)` → `log.error('message:', err)`
      - `console.warn(...)` → `log.warn(...)`
      - `console.log(...)` for debug/progress → `log.debug(...)` or `log.info(...)` based on context
      - Status messages (startup, connected, etc.) → `log.info(...)`
      - Error handling → `log.error(...)`
      - Progress/diagnostic (word counts, fallback decisions) → `log.debug(...)`

      **File-by-file migration (50 calls across 12 files):**

      | File | Calls | Logger Prefix |
      |------|-------|---------------|
      | transcriptionService.ts | 12 | Transcription |
      | autoBackupScheduler.ts | 9 | AutoBackup |
      | notificationScheduler.ts | 7 | Notifications |
      | speakerDiarizationService.ts | 4 | Diarization |
      | main.ts | 4 | App |
      | notificationService.ts | 3 | Notifications |
      | backupService.ts | 3 | Backup |
      | ai-provider.ts | 2 | AI |
      | audioProcessor.ts | 2 | Audio |
      | transcriptionProviderService.ts | 2 | TranscriptionProvider |
      | cards.ts (IPC) | 1 | Cards |
      | brainstorm.ts (IPC) | 1 | Brainstorm |

      NOTE: notificationScheduler.ts and notificationService.ts can share the same
      prefix 'Notifications' since they're the same subsystem, OR use distinct prefixes
      'NotificationScheduler' and 'NotificationService' if the existing [Prefix] differs.
      Check the actual prefix strings in each file and match them.

      IMPORTANT: Read each file before modifying. Preserve the exact log message content
      — only change the call site pattern. The [Prefix] text that was inline in each
      console call should be REMOVED from the message string since it's now provided
      by createLogger.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. logger.ts exists in src/main/services/
      3. Zero `console.log`, `console.error`, or `console.warn` calls remain in src/main/
         (search with grep to confirm — exception: the logger.ts file itself uses console internally)
      4. Each migrated file has `const log = createLogger('...')` at the top
      5. `npm test` — all 12 tests still pass
    </verify>
    <done>
      Structured logger created. All 50 main-process console calls migrated to
      log.info/warn/error/debug. Zero raw console calls remain in main process
      (except inside logger.ts itself). TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - A lightweight custom logger is sufficient (no need for winston/pino in a desktop app)
      - The [Prefix] convention in existing logs maps cleanly to createLogger prefixes
      - Renderer-side logging (17 calls) is intentionally deferred to Plan 8.4
      - Debug level won't be visible by default (currentLevel starts at 'info')
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Add Zod IPC validation — infrastructure + projects.ts pilot</n>
    <files>
      package.json (MODIFY — add zod as direct dependency)
      src/shared/validation/schemas.ts (NEW — Zod schemas for project/board/column inputs)
      src/shared/validation/ipc-validator.ts (NEW — withValidation wrapper)
      src/main/ipc/projects.ts (MODIFY — apply validation to all 9 handlers)
    </files>
    <action>
      ## WHY
      All 104 IPC handlers accept parameters without runtime validation. TypeScript types
      provide compile-time safety but IPC calls come from the renderer process at runtime —
      malformed data can cause uncaught errors or corrupt the database. Zod validation at
      the IPC boundary catches bad input early with clear error messages.

      This task establishes the validation pattern on one module (projects.ts, 9 handlers)
      as a pilot. The pattern can then be applied to remaining handlers incrementally.

      ## WHAT

      ### Step 1: Add Zod as direct dependency

      Run: `npm install zod`

      Zod v3.25.76 is already available as a transitive dependency via AI SDK, but it
      should be listed explicitly in package.json for clarity.

      ### Step 2: Create Zod schemas (src/shared/validation/schemas.ts)

      Read the input interfaces from src/shared/types.ts (lines 64-96 for project/board/column
      types) and create matching Zod schemas:

      ```typescript
      // === FILE PURPOSE ===
      // Zod validation schemas for IPC input types.
      // Each schema mirrors a TypeScript interface from shared/types.ts.
      // Used by the IPC validation wrapper to validate incoming data at runtime.

      import { z } from 'zod';

      // --- ID validation (reusable) ---
      const uuid = z.string().uuid();

      // --- Projects ---
      export const createProjectInputSchema = z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        color: z.string().max(50).optional(),
      });

      export const updateProjectInputSchema = z.object({
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        color: z.string().max(50).nullable().optional(),
        archived: z.boolean().optional(),
      });

      // --- Boards ---
      export const createBoardInputSchema = z.object({
        projectId: uuid,
        name: z.string().min(1).max(200),
      });

      export const updateBoardInputSchema = z.object({
        name: z.string().min(1).max(200).optional(),
      });

      // --- Columns ---
      export const createColumnInputSchema = z.object({
        boardId: uuid,
        name: z.string().min(1).max(200),
        position: z.number().int().min(0),
      });

      export const updateColumnInputSchema = z.object({
        name: z.string().min(1).max(200).optional(),
        position: z.number().int().min(0).optional(),
      });

      // --- Common ---
      export const idParamSchema = uuid;
      ```

      IMPORTANT: Read the actual TypeScript interfaces in types.ts to ensure the Zod
      schemas match exactly. Check which fields are optional, nullable, or have
      specific constraints. Do NOT guess — verify against the source.

      ### Step 3: Create IPC validation wrapper (src/shared/validation/ipc-validator.ts)

      ```typescript
      // === FILE PURPOSE ===
      // Reusable IPC validation wrapper. Validates handler parameters using Zod schemas
      // before executing the handler logic. Returns structured errors on validation failure.

      import { z } from 'zod';

      /** Validate IPC handler input against a Zod schema */
      export function validateInput<T>(schema: z.ZodType<T>, data: unknown): T {
        const result = schema.safeParse(data);
        if (!result.success) {
          const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
          throw new Error(`Validation failed: ${issues}`);
        }
        return result.data;
      }
      ```

      This is deliberately simple — a function, not a decorator or middleware pattern.
      Handlers call `validateInput(schema, data)` at the top of their handler body.
      If validation fails, it throws an Error that Electron IPC propagates to the renderer.

      ### Step 4: Apply validation to projects.ts (9 handlers)

      Read src/main/ipc/projects.ts and modify each handler to validate inputs.

      **For handlers that receive typed objects:**
      ```typescript
      // Before:
      ipcMain.handle('projects:create', async (_event, data: CreateProjectInput) => {
        const db = getDb();
        // ...
      });

      // After:
      ipcMain.handle('projects:create', async (_event, data: unknown) => {
        const input = validateInput(createProjectInputSchema, data);
        const db = getDb();
        // use input.name, input.description, etc.
      });
      ```

      **For handlers that receive primitive ID params:**
      ```typescript
      // Before:
      ipcMain.handle('projects:get', async (_event, id: string) => { ... });

      // After:
      ipcMain.handle('projects:get', async (_event, id: unknown) => {
        const validId = validateInput(idParamSchema, id);
        // use validId
      });
      ```

      **For list handlers with no params:**
      No validation needed (projects:list takes no arguments).

      Apply to all 9 handlers in projects.ts:
      1. projects:list — no params, skip
      2. projects:create — validate CreateProjectInput
      3. projects:get — validate id (UUID)
      4. projects:update — validate id + UpdateProjectInput
      5. projects:delete — validate id
      6. boards:create — validate CreateBoardInput
      7. boards:update — validate id + UpdateBoardInput
      8. columns:create — validate CreateColumnInput
      9. columns:update — validate id + UpdateColumnInput

      NOTE: There may also be boards:list-by-project, columns:list-by-board, etc.
      Read the file to find ALL handlers and validate all that take parameters.

      Add imports at the top of projects.ts:
      ```typescript
      import { validateInput } from '../../shared/validation/ipc-validator';
      import {
        createProjectInputSchema,
        updateProjectInputSchema,
        createBoardInputSchema,
        updateBoardInputSchema,
        createColumnInputSchema,
        updateColumnInputSchema,
        idParamSchema,
      } from '../../shared/validation/schemas';
      ```

      Change parameter types from specific types to `unknown` to enforce runtime
      validation. The Zod schema provides the runtime guarantee that TypeScript
      types previously only provided at compile time.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. zod appears in package.json dependencies (not just devDependencies)
      4. src/shared/validation/schemas.ts exists with 6+ schemas
      5. src/shared/validation/ipc-validator.ts exists with validateInput function
      6. Every handler in projects.ts that takes parameters calls validateInput()
      7. Parameter types changed from specific types to `unknown` where validation added
      8. No handler in projects.ts directly uses unvalidated params (all go through schema)
    </verify>
    <done>
      Zod added as direct dependency. Validation schemas created for project/board/column
      inputs. validateInput wrapper created. All projects.ts handlers validated with
      Zod schemas. Pattern documented and ready for incremental rollout to remaining
      95 handlers. TypeScript compiles clean.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - Zod v3.25.76 (transitive) is compatible as direct dependency (no version conflicts)
      - The 6 input types in types.ts have fields that map cleanly to Zod types
      - Changing handler param types from specific to `unknown` is safe since Zod provides the typing
      - UUID validation via z.string().uuid() matches the actual ID format used by the DB
      - Simple function wrapper (not middleware) is sufficient for the pattern
      - Remaining 95 handlers can follow the same pattern in future plans
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Extract BoardColumn component from BoardPage to its own file</n>
    <files>
      src/renderer/components/BoardColumn.tsx (NEW)
      src/renderer/pages/BoardPage.tsx (MODIFY)
    </files>
    <action>
      ## WHY
      BoardPage.tsx is 620 lines — the second-largest React file. Lines 25-205 contain
      BoardColumn, a fully-defined function component with its own interface (BoardColumnProps)
      that is nested inside BoardPage.tsx. Extracting it to its own file immediately reduces
      BoardPage to ~415 lines and makes BoardColumn independently testable and reusable.

      This is the safest refactoring because:
      1. BoardColumn is already a named function (not an inline component)
      2. It has an explicit props interface (BoardColumnProps)
      3. It uses no closured state from BoardPage (all data passed via props)
      4. It's used in only one place (BoardPage.tsx)

      ## WHAT

      ### Step 1: Read BoardPage.tsx to understand the extraction boundary

      Read the full file. Identify:
      - The BoardColumnProps interface (starts around line 27)
      - The BoardColumn function component (starts around line 39, ends around line 205)
      - All imports used by BoardColumn (React hooks, drag-and-drop, types, components)
      - All imports used ONLY by BoardColumn (can be moved, not duplicated)

      ### Step 2: Create src/renderer/components/BoardColumn.tsx

      Move:
      - The BoardColumnProps interface
      - The BoardColumn function component
      - All necessary imports

      The new file structure:
      ```typescript
      // === FILE PURPOSE ===
      // BoardColumn — renders a single Kanban column with drop target, card list, and add-card form.

      // === DEPENDENCIES ===
      // react, @atlaskit/pragmatic-drag-and-drop, KanbanCard, types

      import { ... } from 'react';
      import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
      import KanbanCard from './KanbanCard';
      import type { Card, Column, UpdateCardInput, CardPriority } from '../../shared/types';

      // [BoardColumnProps interface]
      // [BoardColumn function - export default]

      export default BoardColumn;
      ```

      IMPORTANT: Check what imports BoardColumn actually uses vs what BoardPage uses.
      Only move the imports that BoardColumn needs. BoardPage keeps its own imports.

      Check if BoardColumn references any other functions/variables from BoardPage scope
      (like utility functions or constants). If so, those need to move too or be passed as props.

      ### Step 3: Update BoardPage.tsx

      - Remove the BoardColumnProps interface (lines ~27-37)
      - Remove the BoardColumn function (lines ~39-205)
      - Add import: `import BoardColumn from '../components/BoardColumn';`
      - Remove any imports that were ONLY used by BoardColumn (now handled in the new file)
      - Keep the existing BoardPage function and all its logic unchanged

      ### Step 4: Verify no broken references

      - Check that BoardPage still renders BoardColumn with the correct props
      - Check that drag-and-drop still works (BoardColumn is both a drop target and card container)
      - Check the types passed via props match the extracted interface
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. src/renderer/components/BoardColumn.tsx exists with BoardColumn component
      4. BoardPage.tsx imports BoardColumn from '../components/BoardColumn'
      5. BoardPage.tsx no longer contains the BoardColumn function or BoardColumnProps interface
      6. BoardPage.tsx is ~415 lines or fewer (was 620)
      7. BoardColumn.tsx is ~180-200 lines
      8. No duplicate imports between the two files
    </verify>
    <done>
      BoardColumn extracted to its own file. BoardPage reduced from 620 to ~415 lines.
      BoardColumn is independently importable with clean props interface. Drag-and-drop
      behavior preserved. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - BoardColumn uses no closured state from BoardPage (confirmed: all data via props)
      - The BoardColumnProps interface fully defines the component's contract
      - No other file imports BoardColumn (it was a nested function)
      - Moving the component doesn't affect React reconciliation (same component identity)
      - Drag-and-drop registration (dropTargetForElements) works the same in a separate file
    </assumptions>
  </task>
</phase>
