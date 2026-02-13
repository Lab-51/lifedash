# Plan 8.1 — Critical Review Fixes: Performance, Testing Foundation, and Security Hardening

**Source:** REVIEW.md findings (2026-02-13)
**Scope:** Fix N+1 board query (#2 priority), set up Vitest test framework (#1 priority), add CSP + path validation (security gaps)
**Approach:** Three highest-impact fixes from the review, targeting performance, quality infrastructure, and security.

## Review Triage

| Finding | Severity | This Plan? | Rationale |
|---------|----------|-----------|-----------|
| Zero test coverage | CRITICAL | Task 2 | Set up framework + initial tests — foundation for all future quality |
| N+1 query in cards:list-by-board | HIGH | Task 1 | Concrete fix, 300+ queries → 4 queries, most-used feature |
| Missing CSP + path traversal | HIGH/Missing | Task 3 | Two small targeted security fixes, high impact |
| Silent error handling | HIGH | Deferred | Scattered across 23 files, needs structured logging plan |
| Oversized components | HIGH | Deferred | Refactoring needs careful UX review |
| IPC input validation (Zod) | MEDIUM | Deferred | 60+ channels, needs dedicated plan |
| 87 `any` type occurrences | MEDIUM | Deferred | Gradual cleanup, not urgent |

---

<phase n="8.1" name="Critical Review Fixes — Performance, Testing Foundation, and Security Hardening">
  <context>
    Post-review improvement plan. The project review (REVIEW.md) graded the project B- with
    "NEEDS ATTENTION" overall. All 17 requirements (99 pts) are delivered across 7 phases, but
    the codebase lacks test coverage, has a severe N+1 performance issue, and is missing
    standard security headers.

    Key files:
    @src/main/ipc/cards.ts — N+1 query in cards:list-by-board handler (lines 62-100)
    @src/main/db/schema/cards.ts — cards, cardLabels, labels tables
    @src/main/services/attachmentService.ts — openAttachment has no path validation
    @src/main/main.ts — BrowserWindow creation, no CSP headers
    @package.json — no test framework configured
    @vite.main.config.ts — Vite config for main process (needed for Vitest compat)

    Already confirmed:
    - Drizzle `inArray` is used successfully in ideaService.ts and brainstormService.ts
    - No vitest, @vitest/ui, or zod in dependencies
    - No test files exist anywhere in src/
    - openAttachment passes arbitrary filePath to shell.openPath() without validation
    - BrowserWindow has no Content-Security-Policy configured
  </context>

  <task type="auto" n="1">
    <n>Fix N+1 query in cards:list-by-board</n>
    <files>src/main/ipc/cards.ts</files>
    <action>
      ## WHY
      The `cards:list-by-board` IPC handler (lines 62-100) uses triple-nested loops that
      generate 300-600+ sequential DB queries for a medium board. This is the #2 priority
      finding and affects the most-used feature (Kanban board). The fix reduces it to exactly
      4 queries regardless of board size.

      ## WHAT

      Replace lines 62-100 in src/main/ipc/cards.ts with a batch-query approach:

      1. Add `inArray` to the existing drizzle-orm import:
         `import { eq, and, asc, desc, inArray } from 'drizzle-orm';`

      2. Replace the handler body:

      ```typescript
      ipcMain.handle('cards:list-by-board', async (_event, boardId: string) => {
        const db = getDb();

        // Query 1: Get all columns for this board
        const boardColumns = await db
          .select()
          .from(columns)
          .where(eq(columns.boardId, boardId));
        const columnIds = boardColumns.map((c) => c.id);
        if (columnIds.length === 0) return [];

        // Query 2: Batch-fetch all non-archived cards in these columns
        const allCardRows = await db
          .select()
          .from(cards)
          .where(and(inArray(cards.columnId, columnIds), eq(cards.archived, false)))
          .orderBy(asc(cards.position));
        if (allCardRows.length === 0) return [];

        const cardIds = allCardRows.map((c) => c.id);

        // Query 3: Batch-fetch all card-label junction rows for these cards
        const allCardLabelRows = await db
          .select()
          .from(cardLabels)
          .where(inArray(cardLabels.cardId, cardIds));

        // Query 4: Batch-fetch all labels referenced by these cards
        const labelIds = [...new Set(allCardLabelRows.map((cl) => cl.labelId))];
        const allLabels = labelIds.length > 0
          ? await db.select().from(labels).where(inArray(labels.id, labelIds))
          : [];

        // Build lookup maps
        const labelMap = new Map(allLabels.map((l) => [l.id, l as unknown as Label]));
        const cardLabelMap = new Map<string, Label[]>();
        for (const cl of allCardLabelRows) {
          const label = labelMap.get(cl.labelId);
          if (label) {
            const existing = cardLabelMap.get(cl.cardId) ?? [];
            existing.push(label);
            cardLabelMap.set(cl.cardId, existing);
          }
        }

        // Assemble result
        return allCardRows.map((card) => ({
          ...(card as unknown as Card),
          labels: cardLabelMap.get(card.id) ?? [],
        }));
      });
      ```

      3. Update the LIMITATIONS header comment (lines 9-10):
         Remove: "cards:list-by-board fetches labels per card in a loop (N+1 queries)."
         Replace with: "cards:list-by-board uses 4 batch queries (columns, cards, cardLabels, labels)."
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. No loops containing `await db.` remain in cards:list-by-board handler
      3. `inArray` import present in drizzle-orm import line
      4. Handler uses exactly 4 db queries: columns, cards, cardLabels, labels
      5. Empty-array guard on labelIds prevents empty inArray call
      6. Return type is unchanged: array of Card with labels
    </verify>
    <done>
      cards:list-by-board uses exactly 4 batch queries regardless of board size.
      No nested DB loops remain. LIMITATIONS comment updated. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Drizzle inArray works with UUID arrays (confirmed in ideaService.ts, brainstormService.ts)
      - Drizzle inArray with empty array is safe but we guard anyway for clarity
      - The `as unknown as Card` / `as unknown as Label` casts match existing pattern
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Set up Vitest test framework and write initial unit tests</n>
    <files>
      package.json (MODIFY — add devDependencies + scripts)
      vitest.config.ts (NEW)
      src/main/ipc/__tests__/cards-query.test.ts (NEW)
      src/shared/__tests__/types.test.ts (NEW)
    </files>
    <action>
      ## WHY
      Zero test coverage across 112 files is the #1 critical finding. Setting up the framework
      and writing initial tests establishes the pattern, unblocks all future testing, and
      validates the N+1 fix logic from Task 1.

      ## WHAT

      ### Step 1: Install Vitest

      Run: `npm install -D vitest @vitest/ui`

      ### Step 2: Create vitest.config.ts at project root

      ```typescript
      import { defineConfig } from 'vitest/config';

      export default defineConfig({
        test: {
          globals: true,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['node_modules', '.vite', 'out'],
          environment: 'node',
        },
      });
      ```

      Notes:
      - `environment: 'node'` for main-process and shared tests (renderer tests will need
        'jsdom' later, but that requires additional setup)
      - `globals: true` enables describe/it/expect without imports

      ### Step 3: Add scripts to package.json

      Add to "scripts":
      ```json
      "test": "vitest run",
      "test:watch": "vitest",
      "test:ui": "vitest --ui"
      ```

      ### Step 4: Write src/shared/__tests__/types.test.ts

      Test the MEETING_TEMPLATES constant and other exported constants/enums:
      ```typescript
      import { describe, it, expect } from 'vitest';

      // Test the MEETING_TEMPLATES constant
      describe('MEETING_TEMPLATES', () => {
        // Need to verify what's exported — import the actual constant
        // Tests: all 6 template types exist, each has type/name/description/agendaHint fields
      });
      ```

      Tests to write:
      - MEETING_TEMPLATES has exactly 6 entries
      - Each template has required fields: type, name, description, agendaHint
      - Template types are unique
      - Each template type value is one of the expected enum values

      Note: The executor should read src/shared/types.ts to find exact exports. If
      MEETING_TEMPLATES is not directly importable (it may be defined in types.ts which
      imports from Electron types), create a separate test for pure utility logic instead.

      ### Step 5: Write src/main/ipc/__tests__/cards-query.test.ts

      To make the N+1 fix from Task 1 testable, extract the label-assembly logic into a
      pure function. In cards.ts, add an exported helper:

      ```typescript
      /**
       * Build a map of cardId → Label[] from batch-fetched junction and label rows.
       * Exported for testing.
       */
      export function buildCardLabelMap(
        cardLabelRows: { cardId: string; labelId: string }[],
        allLabels: Label[],
      ): Map<string, Label[]> {
        const labelMap = new Map(allLabels.map((l) => [l.id, l]));
        const result = new Map<string, Label[]>();
        for (const cl of cardLabelRows) {
          const label = labelMap.get(cl.labelId);
          if (label) {
            const existing = result.get(cl.cardId) ?? [];
            existing.push(label);
            result.set(cl.cardId, existing);
          }
        }
        return result;
      }
      ```

      Then use this function in the handler body (replacing the inline Map-building code).

      Write tests:
      ```typescript
      import { describe, it, expect } from 'vitest';
      import { buildCardLabelMap } from '../cards';

      describe('buildCardLabelMap', () => {
        it('returns empty map for empty inputs', () => { ... });
        it('maps labels to correct cards', () => { ... });
        it('handles cards with no labels', () => { ... });
        it('handles multiple labels per card', () => { ... });
        it('handles labels shared across multiple cards', () => { ... });
        it('skips junction rows with missing label IDs', () => { ... });
      });
      ```

      IMPORTANT: The import `from '../cards'` will attempt to import the full cards.ts file
      which imports `ipcMain` from 'electron'. Since Vitest runs in Node (not Electron), this
      will fail. To solve this, either:
      a) Extract buildCardLabelMap into a separate util file (e.g., src/main/utils/card-utils.ts)
         that has no Electron dependencies, OR
      b) Move the function to src/shared/ since it's pure logic

      Recommended: Create src/shared/utils/card-utils.ts with the pure function,
      import it in both cards.ts and the test file.
    </action>
    <verify>
      1. `npm test` runs successfully and all tests pass
      2. `npx tsc --noEmit` still passes with zero errors
      3. vitest.config.ts exists at project root
      4. package.json has "test", "test:watch", and "test:ui" scripts
      5. At least 2 test files exist with 8+ test cases total
      6. buildCardLabelMap is in a pure module importable without Electron
      7. Tests cover: empty inputs, single card, multiple labels, shared labels, missing labels
    </verify>
    <done>
      Vitest installed and configured. `npm test` passes with all tests green.
      Two test files: types.test.ts (constant validation) and cards-query.test.ts
      (batch label assembly logic). buildCardLabelMap extracted as testable pure function.
      Foundation ready for additional test suites.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - Vitest works with Vite 7.3 and TypeScript 5.9 (Vitest tracks Vite versions closely)
      - Test files in __tests__ directories are found by Vitest's include pattern
      - Extracting buildCardLabelMap to a shared util avoids Electron import issues
      - MEETING_TEMPLATES or similar constants are importable from shared/types.ts without
        Electron dependencies (types.ts defines an ElectronAPI interface but shouldn't require
        electron at runtime — may need to verify)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Security hardening — CSP headers and attachment path validation</n>
    <files>
      src/main/main.ts (MODIFY — add CSP via session.webRequest)
      src/main/services/attachmentService.ts (MODIFY — validate path in openAttachment)
    </files>
    <action>
      ## WHY
      The review identified two security gaps:
      1. No Content-Security-Policy configured on BrowserWindow (Missing severity)
      2. `openAttachment` accepts any file path from renderer and passes to `shell.openPath()`
         without validating it's within the attachments directory (path traversal risk)

      Both are small, targeted fixes with high security impact.

      ## WHAT

      ### A) Add Content Security Policy to BrowserWindow (main.ts)

      After `mainWindow = new BrowserWindow({...})` (line 76) and before `mainWindow.once('ready-to-show', ...)` (line 79), add:

      ```typescript
      // Content Security Policy — defense-in-depth against XSS
      mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const cspDirectives = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",    // Tailwind injects inline styles
          "img-src 'self' data:",                 // data: URIs for icons
          "font-src 'self'",
          "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434",
        ];

        // In development, allow Vite dev server connections
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
          cspDirectives.push("connect-src 'self' ws: http://localhost:* https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434");
          // Override the connect-src with dev-mode version
          const idx = cspDirectives.findIndex(d => d.startsWith("connect-src 'self' https://"));
          if (idx !== -1) cspDirectives.splice(idx, 1);
        }

        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [cspDirectives.join('; ')],
          },
        });
      });
      ```

      Wait — the dev mode logic above has a bug with duplicate connect-src. Simpler approach:

      ```typescript
      // Content Security Policy — defense-in-depth against XSS
      const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
      const connectSrc = isDev
        ? "connect-src 'self' ws: http://localhost:* https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434"
        : "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434";
      const scriptSrc = isDev
        ? "script-src 'self' 'unsafe-eval'"       // Vite HMR needs eval in dev
        : "script-src 'self'";

      mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ${connectSrc}`
            ],
          },
        });
      });
      ```

      Note: `'unsafe-eval'` is needed in dev mode because Vite HMR uses eval for module
      hot replacement. It is NOT included in production CSP.

      ### B) Validate file paths in openAttachment (attachmentService.ts)

      Replace the `openAttachment` function (line 129-131) with:

      ```typescript
      export async function openAttachment(filePath: string): Promise<void> {
        // Validate that the path is within the attachments directory
        const attachmentsRoot = path.join(app.getPath('userData'), 'attachments');
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(attachmentsRoot)) {
          throw new Error('Access denied: file path is outside the attachments directory');
        }

        // Verify the file exists before attempting to open
        if (!fs.existsSync(resolved)) {
          throw new Error('File not found: the attachment file no longer exists on disk');
        }

        await shell.openPath(resolved);
      }
      ```

      This prevents:
      1. Path traversal (e.g., `../../etc/passwd` or `C:\Windows\System32\...`)
      2. Opening deleted files (gives clear error instead of OS-level failure)

      Update the LIMITATIONS comment at top of attachmentService.ts to note the path validation.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. main.ts has onHeadersReceived with Content-Security-Policy header
      3. CSP includes: default-src 'self', script-src 'self' (+ 'unsafe-eval' in dev only),
         style-src 'self' 'unsafe-inline', img-src 'self' data:, connect-src with API domains
      4. Dev mode CSP includes ws: and localhost:* for Vite HMR
      5. Production CSP does NOT include 'unsafe-eval'
      6. openAttachment validates path starts with userData/attachments/
      7. openAttachment checks file existence before opening
      8. openAttachment throws clear error messages for invalid/missing paths
      9. LIMITATIONS comment updated in attachmentService.ts
    </verify>
    <done>
      BrowserWindow has Content Security Policy (production-safe, with dev-mode HMR
      allowances). openAttachment validates paths are within attachments directory and
      files exist before opening. Both changes compile cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Tailwind CSS 4 requires 'unsafe-inline' for style-src (standard for utility-first CSS)
      - Vite 7 HMR requires 'unsafe-eval' in dev mode for script-src
      - MAIN_WINDOW_VITE_DEV_SERVER_URL global is available (declared by Electron Forge Vite plugin)
      - session.webRequest.onHeadersReceived works in Electron 40
      - app.getPath('userData') returns a consistent base path on Windows
      - path.resolve + startsWith check is sufficient for path traversal prevention on Windows
        (path.resolve normalizes separators and resolves ../ segments)
    </assumptions>
  </task>
</phase>
