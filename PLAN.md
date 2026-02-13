# Plan 8.2 — README, Within-Column Card Reordering, and UI Polish

**Source:** REVIEW.md findings (2026-02-13) — priorities #3 and #5, plus quick wins
**Scope:** Create README.md (critical documentation gap), implement within-column card reordering (most visibly missing Kanban feature), and batch quick UI fixes (padding, code dedup, confirmation)
**Approach:** One documentation task, one feature task, one polish batch — all independent, parallelizable.

## Review Triage (continued from Plan 8.1)

| Finding | Severity | This Plan? | Rationale |
|---------|----------|-----------|-----------|
| No README.md | HIGH | Task 1 | #3 review priority, developer cloning repo has zero guidance |
| Missing within-column card reordering | HIGH | Task 2 | #5 review priority, most visibly missing Kanban feature |
| BrainstormPage padding inconsistency | LOW | Task 3 | Quick fix, 1 line |
| getDueDateBadge duplication | LOW | Task 3 | Extract to shared util, remove 2 copies |
| restoreFromFile lacks confirmation | LOW | Task 3 | Small UX safety improvement |
| IPC input validation (Zod) | MEDIUM | Plan 8.3 | 60+ channels, needs dedicated plan |
| Structured logging | MEDIUM | Plan 8.3 | 67 console calls across 23 files |
| Component refactoring | HIGH | Plan 8.3 | 3 oversized components need careful decomposition |

---

<phase n="8.2" name="README, Within-Column Card Reordering, and UI Polish">
  <context>
    Post-review improvement plan (continued from Plan 8.1). The project review graded B-
    with missing README (#3 priority), missing within-column card reordering (#5 priority),
    and several quick UI polish items.

    Key files:
    @src/renderer/pages/BoardPage.tsx — drag monitor (lines 299-324), column drop targets (lines 56-69)
    @src/renderer/components/KanbanCard.tsx — draggable setup (lines 77-93), getDueDateBadge (lines 29-50)
    @src/renderer/components/CardDetailModal.tsx — getDueDateBadge (lines 106-126)
    @src/renderer/pages/BrainstormPage.tsx — page wrapper (line 100-101, uses `space-y-4` only)
    @src/renderer/components/settings/BackupSection.tsx — restore handlers (lines 87-89, 118)
    @src/renderer/stores/boardStore.ts — moveCard (lines 185-190)
    @package.json — dependencies

    Already confirmed:
    - `@atlaskit/pragmatic-drag-and-drop` v1.7.7 installed (core only)
    - `@atlaskit/pragmatic-drag-and-drop-hitbox` v1.1.0 available on npm (edge detection for reordering)
    - BoardPage.tsx line 314: `if (sourceColumnId === targetColumnId) return;` explicitly skips same-column drops
    - All other pages use `p-6` wrapper; BrainstormPage uses only `space-y-4`
    - getDueDateBadge is nearly identical in KanbanCard.tsx:30-50 and CardDetailModal.tsx:107-126
    - BackupSection has inline confirmation for listed backups but restoreFromFile (line 118) has none
    - No README.md exists at project root
  </context>

  <task type="auto" n="1">
    <n>Create README.md with project overview and developer quick start</n>
    <files>README.md (NEW)</files>
    <action>
      ## WHY
      No README.md exists. A developer cloning this repo has zero guidance on prerequisites,
      setup, or how to run the application. The review estimates onboarding time drops from
      2-4 hours to 30-60 minutes with a good README. This is #3 review priority.

      ## WHAT

      Create README.md at project root. Read PROJECT.md, ROADMAP.md, package.json, and
      docker-compose.yml to ensure accuracy. The README should include:

      ### Section 1: Project Title + One-Line Description
      "Living Dashboard" — AI-powered desktop dashboard for meeting intelligence, project
      management, brainstorming, and idea tracking.

      ### Section 2: Features (bullet list)
      - Meeting recording + real-time transcription (local Whisper + API fallback)
      - Kanban project management with drag-and-drop
      - AI-powered meeting briefs and action item extraction
      - Conversational AI brainstorming
      - AI task structuring and project planning
      - Idea repository with tags, analysis, and project conversion
      - Multi-provider AI support (OpenAI, Anthropic, Ollama, Deepgram, AssemblyAI)
      - Database backup/restore and data export
      - Desktop notifications for due dates and daily digest
      - Dark theme UI with system tray integration

      ### Section 3: Prerequisites
      - Node.js 18+ (verify actual minimum from package.json engines or tsconfig target)
      - Docker Desktop (for PostgreSQL 16)
      - Git

      ### Section 4: Quick Start
      ```bash
      git clone [repo-url]
      cd living-dashboard
      npm install
      docker compose up -d     # Start PostgreSQL
      npm start                # Launch in development mode
      ```

      ### Section 5: Available Scripts
      Table format from package.json scripts:
      | Script | Description |
      | `npm start` | Start development server |
      | `npm run package` | Package for distribution |
      | `npm run make` | Build distributable |
      | `npm test` | Run tests |
      | `npm run test:watch` | Run tests in watch mode |
      | `npm run db:generate` | Generate Drizzle migration |
      | `npm run db:migrate` | Apply migrations |
      | `npm run db:studio` | Open Drizzle Studio |
      | `npm run db:up` | Start PostgreSQL container |
      | `npm run db:down` | Stop PostgreSQL container |

      ### Section 6: Tech Stack (compact table)
      | Layer | Technology |
      | Desktop Shell | Electron 40 |
      | Frontend | React 19, TypeScript 5.9, Tailwind CSS 4 |
      | Database | PostgreSQL 16 (Docker), Drizzle ORM |
      | AI | Vercel AI SDK 6, OpenAI, Anthropic, Ollama |
      | Transcription | Whisper (local), Deepgram, AssemblyAI |
      | Drag-and-drop | @atlaskit/pragmatic-drag-and-drop |
      | Rich text | TipTap |
      | State | Zustand |

      ### Section 7: Project Structure (abbreviated tree)
      ```
      src/
        main/           # Electron main process
          db/            # Schema, migrations, connection
          ipc/           # IPC handlers (60+ channels)
          services/      # Business logic services
        preload/         # Electron preload bridge
        renderer/        # React frontend
          components/    # Reusable components
          pages/         # Route pages
          stores/        # Zustand state management
        shared/          # Types and utilities shared across processes
      ```

      ### Section 8: Configuration
      - Copy `.env.example` to `.env` for custom database settings
      - AI API keys: configured in Settings page (stored with OS-level encryption)
      - Whisper model: download from Settings page

      ### Section 9: License
      "This project is not currently licensed for public distribution."
      (No LICENSE file exists — state this honestly.)

      IMPORTANT: Keep the README concise and accurate. Do NOT fabricate setup steps you
      haven't verified. Read the actual files to ensure all script names and descriptions
      are correct.
    </action>
    <verify>
      1. README.md exists at project root
      2. All script names match actual package.json scripts
      3. Tech stack versions match actual package.json dependencies
      4. Prerequisites listed (Node.js, Docker, Git)
      5. Quick start includes: clone, npm install, docker compose up -d, npm start
      6. Project structure tree matches actual directory layout
      7. No fabricated URLs or links (except placeholder for clone URL)
    </verify>
    <done>
      README.md exists with project overview, features, prerequisites, quick start,
      scripts table, tech stack, project structure, and configuration notes.
      All content verified against actual project files.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - docker-compose.yml exists and uses `docker compose` command (not `docker-compose`)
      - .env.example exists with database configuration
      - No specific Node.js engine version is specified in package.json (will use 18+ as safe minimum)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Implement within-column card reordering via drag-and-drop</n>
    <files>
      package.json (MODIFY — add @atlaskit/pragmatic-drag-and-drop-hitbox)
      src/renderer/components/KanbanCard.tsx (MODIFY — add drop target with edge detection)
      src/renderer/pages/BoardPage.tsx (MODIFY — update drag monitor for same-column + cross-column)
    </files>
    <action>
      ## WHY
      Within-column card reordering is the #5 review priority and the most visibly missing
      Kanban feature. BoardPage.tsx line 314 explicitly returns early for same-column drops:
      `if (sourceColumnId === targetColumnId) return;`. Users can drag cards between columns
      but cannot reorder cards within a column, which is a fundamental Kanban expectation.

      ## WHAT

      ### Step 1: Install hitbox addon

      Run: `npm install @atlaskit/pragmatic-drag-and-drop-hitbox`

      This provides `attachClosestEdge` and `extractClosestEdge` for determining whether
      a drop occurred on the top or bottom edge of a target card.

      ### Step 2: Make KanbanCard a drop target (KanbanCard.tsx)

      Add imports:
      ```typescript
      import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
      import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
      ```

      Add a `closestEdge` state:
      ```typescript
      const [closestEdge, setClosestEdge] = useState<'top' | 'bottom' | null>(null);
      ```

      Register the card as a drop target (in a new useEffect alongside the draggable one):
      ```typescript
      useEffect(() => {
        const el = cardRef.current;
        if (!el) return;

        return dropTargetForElements({
          element: el,
          canDrop: ({ source }) => source.data.type === 'card' && source.data.cardId !== card.id,
          getData: ({ input, element }) => {
            const data = { type: 'card', cardId: card.id, columnId: card.columnId, position: card.position };
            return attachClosestEdge(data, { input, element, allowedEdges: ['top', 'bottom'] });
          },
          onDragEnter: ({ self }) => {
            setClosestEdge(extractClosestEdge(self.data));
          },
          onDrag: ({ self }) => {
            setClosestEdge(extractClosestEdge(self.data));
          },
          onDragLeave: () => setClosestEdge(null),
          onDrop: () => setClosestEdge(null),
        });
      }, [card.id, card.columnId, card.position]);
      ```

      Add a visual drop indicator line. In the card's JSX, add a blue line indicator
      showing where the card will be inserted:

      ```tsx
      {/* Drop indicator — shows where the card will be placed */}
      {closestEdge === 'top' && (
        <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
      )}
      {closestEdge === 'bottom' && (
        <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
      )}
      ```

      Ensure the card's outer div has `relative` in its className for absolute positioning.

      ### Step 3: Update BoardPage drag monitor (BoardPage.tsx)

      Replace the existing drag monitor (lines 299-324) with a version that handles
      both same-column reordering AND cross-column moves:

      ```typescript
      // Board-level drag monitor — handles card moves (cross-column and within-column reorder)
      useEffect(() => {
        return monitorForElements({
          canMonitor: ({ source }) => source.data.type === 'card',
          onDrop: ({ source, location }) => {
            const dropTargets = location.current.dropTargets;
            if (dropTargets.length === 0) return;

            const cardId = source.data.cardId as string;
            const sourceColumnId = source.data.sourceColumnId as string;
            const sourcePosition = source.data.sourcePosition as number;

            // Check if we dropped on a card (reorder) or just a column (append)
            const cardTarget = dropTargets.find(t => t.data.type === 'card');
            const columnTarget = dropTargets.find(t => t.data.columnId && t.data.type !== 'card');

            if (cardTarget) {
              // Dropped on a specific card — insert above or below it
              const targetColumnId = cardTarget.data.columnId as string;
              const targetPosition = cardTarget.data.position as number;
              const edge = extractClosestEdge(cardTarget.data);

              let newPosition: number;
              if (sourceColumnId === targetColumnId) {
                // Same-column reorder
                if (edge === 'top') {
                  newPosition = sourcePosition < targetPosition ? targetPosition - 1 : targetPosition;
                } else {
                  newPosition = sourcePosition < targetPosition ? targetPosition : targetPosition + 1;
                }
                // No-op if position didn't change
                if (newPosition === sourcePosition) return;
              } else {
                // Cross-column: insert at target position
                newPosition = edge === 'top' ? targetPosition : targetPosition + 1;
              }

              moveCard(cardId, targetColumnId, newPosition);
            } else if (columnTarget) {
              // Dropped on empty area of column — append to end
              const targetColumnId = columnTarget.data.columnId as string;
              if (sourceColumnId === targetColumnId) return; // No-op for same column
              const targetCards = getCardsByColumn(cards, targetColumnId);
              moveCard(cardId, targetColumnId, targetCards.length);
            }

            setDragOverColumnId(null);
          },
        });
      }, [cards, moveCard]);
      ```

      Add the `extractClosestEdge` import at the top of BoardPage.tsx:
      ```typescript
      import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
      ```

      ### Step 4: Update cards:move IPC handler for position reordering

      The current `cards:move` handler (src/main/ipc/cards.ts) just sets the new
      columnId + position but doesn't shift other cards. For within-column reordering to
      work properly, we need to reorder positions of sibling cards.

      Modify the `cards:move` handler to:
      1. If column changed OR position changed, shift sibling card positions
      2. Use a simple approach: set the moved card's position, then re-index all cards
         in the target column by their existing order

      ```typescript
      ipcMain.handle(
        'cards:move',
        async (_event, id: string, columnId: string, position: number) => {
          const db = getDb();

          // Update the card's column and position
          const [card] = await db
            .update(cards)
            .set({ columnId, position, updatedAt: new Date() })
            .where(eq(cards.id, id))
            .returning();

          // Re-index all non-archived cards in the target column to close gaps
          const columnCards = await db
            .select({ id: cards.id })
            .from(cards)
            .where(and(eq(cards.columnId, columnId), eq(cards.archived, false)))
            .orderBy(asc(cards.position), asc(cards.updatedAt));

          for (let i = 0; i < columnCards.length; i++) {
            if (i !== columnCards[i].position) {
              await db.update(cards).set({ position: i }).where(eq(cards.id, columnCards[i].id));
            }
          }

          logCardActivity(id, 'moved', { columnId, position });
          return card;
        },
      );
      ```

      Wait — this approach has a problem. The card we just moved already has the new
      position, but other cards haven't been shifted yet. A cleaner approach:

      ```typescript
      ipcMain.handle(
        'cards:move',
        async (_event, id: string, columnId: string, position: number) => {
          const db = getDb();

          // Get all non-archived cards in target column (excluding the moved card)
          const siblingsInTarget = await db
            .select()
            .from(cards)
            .where(
              and(
                eq(cards.columnId, columnId),
                eq(cards.archived, false),
              ),
            )
            .orderBy(asc(cards.position));

          // Remove the moved card from the list (it may already be in this column)
          const filtered = siblingsInTarget.filter(c => c.id !== id);

          // Insert at the requested position
          const reordered = [...filtered];
          reordered.splice(position, 0, { id } as typeof cards.$inferSelect);

          // Update all positions in one pass
          for (let i = 0; i < reordered.length; i++) {
            await db.update(cards).set({ position: i, ...(reordered[i].id === id ? { columnId, updatedAt: new Date() } : {}) }).where(eq(cards.id, reordered[i].id));
          }

          // Return the updated card
          const [updated] = await db.select().from(cards).where(eq(cards.id, id));

          logCardActivity(id, 'moved', { columnId, position });
          return updated;
        },
      );
      ```

      The executor should implement a clean version of this. The key requirements are:
      1. Get sibling cards in target column (sorted by position)
      2. Remove the dragged card from the list
      3. Insert it at the requested position index
      4. Update all card positions to match their array index
      5. Return the updated card

      NOTE: This replaces the existing `cards:move` handler (lines 162-174 in cards.ts).
    </action>
    <verify>
      1. `npm install` completes (new dependency added)
      2. `npx tsc --noEmit` — zero TypeScript errors
      3. KanbanCard has both `draggable()` and `dropTargetForElements()` registered
      4. KanbanCard shows a blue drop indicator line on drag hover (top or bottom edge)
      5. BoardPage drag monitor handles both same-column AND cross-column drops
      6. The `if (sourceColumnId === targetColumnId) return;` line is REMOVED
      7. cards:move handler reorders sibling positions in the target column
      8. Dragging a card within the same column updates its position correctly
      9. Cross-column drag still works (existing functionality preserved)
    </verify>
    <done>
      Within-column card reordering works via drag-and-drop. Cards show a blue
      insertion indicator. Both same-column reorder and cross-column move are supported.
      cards:move handler properly reindexes sibling positions. TypeScript compiles clean.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - @atlaskit/pragmatic-drag-and-drop-hitbox v1.1.0 is compatible with core v1.7.7
      - extractClosestEdge returns 'top' | 'bottom' | null from the attached edge data
      - attachClosestEdge adds edge data to the getData response
      - The position reindexing approach (fetch siblings, splice, update all) is correct
        for PostgreSQL integer positions
      - Multiple sequential DB updates for position reindexing is acceptable (small card counts
        per column, typically 5-20 cards)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>UI polish batch — BrainstormPage padding, getDueDateBadge extraction, restore confirmation</n>
    <files>
      src/renderer/pages/BrainstormPage.tsx (MODIFY — add p-6 wrapper)
      src/renderer/utils/date-utils.ts (NEW — shared getDueDateBadge)
      src/renderer/components/KanbanCard.tsx (MODIFY — import from shared util)
      src/renderer/components/CardDetailModal.tsx (MODIFY — import from shared util)
      src/renderer/components/settings/BackupSection.tsx (MODIFY — add restoreFromFile confirmation)
    </files>
    <action>
      ## WHY
      Three quick wins from the review: inconsistent page padding, duplicated utility function,
      and a missing safety confirmation. Each is 5-15 lines of change, but together they
      polish the UI and reduce code duplication.

      ## WHAT

      ### Fix A: BrainstormPage padding

      In BrainstormPage.tsx, line 101, change:
      ```tsx
      <div className="space-y-4">
      ```
      to:
      ```tsx
      <div className="p-6 space-y-4">
      ```

      This matches every other page: SettingsPage (`p-6`), ProjectsPage (`p-6`),
      MeetingsPage (`p-6`), IdeasPage (`p-6`), BoardPage (`px-6 pt-6`).

      ### Fix B: Extract getDueDateBadge to shared utility

      Create `src/renderer/utils/date-utils.ts`:
      ```typescript
      // === FILE PURPOSE ===
      // Shared date utility functions used across renderer components.

      /** Get badge classes and label for a due date string */
      export function getDueDateBadge(dueDateStr: string): { label: string; classes: string } {
        const now = new Date();
        const due = new Date(dueDateStr);
        const diffMs = due.getTime() - now.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffMs < 0) {
          return { label: 'Overdue', classes: 'bg-red-500/20 text-red-400' };
        }
        if (diffDays < 1) {
          return { label: 'Due today', classes: 'bg-amber-500/20 text-amber-400' };
        }
        if (diffDays < 3) {
          return { label: `Due in ${Math.ceil(diffDays)}d`, classes: 'bg-amber-500/10 text-amber-300' };
        }
        if (diffDays < 7) {
          return { label: `Due in ${Math.ceil(diffDays)}d`, classes: 'bg-blue-500/10 text-blue-300' };
        }
        const formatted = new Date(dueDateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return { label: formatted, classes: 'bg-surface-800 text-surface-400' };
      }
      ```

      Then in KanbanCard.tsx:
      - Delete the local `getDueDateBadge` function (lines 29-50)
      - Add import: `import { getDueDateBadge } from '../utils/date-utils';`
      Note: KanbanCard is in `src/renderer/components/`, so the import path is `../utils/date-utils`.

      In CardDetailModal.tsx:
      - Delete the local `getDueDateBadge` function (lines 106-126)
      - Add import: `import { getDueDateBadge } from '../utils/date-utils';`
      Note: CardDetailModal is in `src/renderer/components/`, same import path.

      Note: CardDetailModal has a `formatDate` helper used in its version of getDueDateBadge.
      If this `formatDate` is ONLY used by getDueDateBadge, you can remove it too. If it's
      used elsewhere in the file, keep it. Check before removing.

      ### Fix C: Add restoreFromFile confirmation

      In BackupSection.tsx, line 118 calls `restoreFromFile` directly without confirmation.
      Add a confirmation state and UI:

      1. Add state: `const [confirmRestoreFile, setConfirmRestoreFile] = useState(false);`

      2. Change the "Restore from File..." button onClick from `restoreFromFile` to
         `() => setConfirmRestoreFile(true)`

      3. When confirmRestoreFile is true, show inline confirmation buttons (matching
         the existing pattern used for individual backup restore at lines 201-218):
         ```tsx
         {confirmRestoreFile ? (
           <div className="flex items-center gap-2">
             <span className="text-sm text-amber-400">Overwrite current database?</span>
             <button onClick={() => setConfirmRestoreFile(false)} className="...">Cancel</button>
             <button onClick={() => { setConfirmRestoreFile(false); restoreFromFile(); }} className="...">Confirm</button>
           </div>
         ) : (
           <button onClick={() => setConfirmRestoreFile(true)}>Restore from File...</button>
         )}
         ```

      Match the existing button styling patterns in BackupSection.tsx.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. BrainstormPage wrapper div has `p-6` class
      3. date-utils.ts exists in src/renderer/utils/
      4. KanbanCard.tsx imports getDueDateBadge from utils, no local definition
      5. CardDetailModal.tsx imports getDueDateBadge from utils, no local definition
      6. Both components still show correct due date badges (no visual regression)
      7. BackupSection "Restore from File..." shows confirmation before executing
      8. Existing individual backup restore confirmation still works
    </verify>
    <done>
      BrainstormPage has consistent p-6 padding. getDueDateBadge is a single shared
      utility imported by both KanbanCard and CardDetailModal. restoreFromFile shows
      confirmation before overwriting the database. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Adding p-6 to BrainstormPage won't break its split-panel layout (the inner container
        has its own height calculation via h-[calc(100vh-10rem)] which may need adjustment)
      - getDueDateBadge is functionally identical in both files (confirmed via code read)
      - The src/renderer/utils/ directory may not exist yet (create it)
      - BackupSection's existing button styling can be matched for the confirmation UI
    </assumptions>
  </task>
</phase>