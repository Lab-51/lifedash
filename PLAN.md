# Phase 2 — Plan 1 of 3: Data Layer & Project Management

## Coverage
- **R3: Project Dashboard** (first ~35% — types, IPC CRUD, state management, project list UI)

## Plan Overview
Phase 2 delivers the full project dashboard (R3). It requires 3 plans:

- **Plan 2.1** (this plan): Data layer foundation — domain types, IPC CRUD handlers for all
  entities (projects, boards, columns, cards, labels), preload bridge, Zustand store, and
  the interactive project list UI. This establishes the full data pipeline from DB → IPC →
  preload → renderer.
- **Plan 2.2** (next): Kanban board UI — board view with columns, card list rendering,
  card CRUD forms, drag-and-drop with pragmatic-drag-and-drop.
- **Plan 2.3** (final): Rich text + polish — TipTap card description editor, labels UI,
  search/filter, board sidebar.

## Dependencies to Install (all Phase 2)
- `zustand` — state management (needed this plan)
- `@atlaskit/pragmatic-drag-and-drop` — drag-and-drop (Plan 2.2)
- `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/extension-placeholder` — rich text (Plan 2.3)
- `framer-motion` — card/column animations (Plan 2.2+)

---

<phase n="2.1" name="Data Layer &amp; Project Management">
  <context>
    Phase 1 is complete. The app has:
    - Electron Forge + Vite + React 19 + TypeScript + Tailwind CSS 4
    - Custom frameless window, system tray, IPC bridge
    - PostgreSQL via Docker + Drizzle ORM with 12-table schema
    - HashRouter, Sidebar (icon-only, w-16), AppLayout, ErrorBoundary, Suspense
    - StatusBar, keyboard shortcuts, Inter font, design system globals
    - 6 pages: Projects, Meetings, Ideas, Brainstorm, Settings, NotFound

    Database schema already exists for all Phase 2 entities:
    - projects: id, name, description, color, archived, createdAt, updatedAt
    - boards: id, projectId, name, position, createdAt
    - columns: id, boardId, name, position, createdAt
    - cards: id, columnId, title, description, position, priority (enum), dueDate, archived, createdAt, updatedAt
    - labels: id, projectId, name, color, createdAt
    - card_labels: cardId, labelId (junction table, composite PK)

    IPC pattern (from existing code):
    - Handler modules: src/main/ipc/{domain}.ts exporting registerXHandlers()
    - Central registration: src/main/ipc/index.ts calls all register functions
    - Preload bridge: src/preload/preload.ts wraps ipcRenderer.invoke() calls
    - Types: src/shared/types.ts defines ElectronAPI interface

    DB access pattern (from connection.ts):
    - getDb() returns the Drizzle instance with schema
    - All queries use Drizzle's type-safe query builder
    - Schema imported as `import * as schema from './schema'`

    Current renderer file structure:
    ```
    src/renderer/
    ├── App.tsx
    ├── main.tsx
    ├── index.html
    ├── styles/globals.css
    ├── components/ (TitleBar, Sidebar, AppLayout, StatusBar, ErrorBoundary, LoadingSpinner, PageSkeleton)
    ├── hooks/ (useDatabaseStatus, useKeyboardShortcuts)
    └── pages/ (ProjectsPage, MeetingsPage, IdeasPage, BrainstormPage, SettingsPage, NotFoundPage)
    ```

    @src/shared/types.ts
    @src/main/db/schema/index.ts
    @src/main/db/schema/projects.ts
    @src/main/db/schema/boards.ts
    @src/main/db/schema/cards.ts
    @src/main/db/schema/labels.ts
    @src/main/db/connection.ts
    @src/main/ipc/index.ts
    @src/main/ipc/database.ts
    @src/preload/preload.ts
    @src/renderer/App.tsx
    @src/renderer/components/Sidebar.tsx
    @src/renderer/pages/ProjectsPage.tsx
    @package.json
  </context>

  <task type="auto" n="1">
    <n>Install Phase 2 dependencies + expand domain types</n>
    <files>
      package.json (modify — add zustand, @atlaskit/pragmatic-drag-and-drop, @tiptap/react, @tiptap/starter-kit, @tiptap/extension-placeholder, framer-motion)
      src/shared/types.ts (modify — add domain types + input types + expand ElectronAPI)
    </files>
    <action>
      Install all Phase 2 dependencies upfront and create comprehensive TypeScript types
      for the entire project dashboard domain.

      WHY: Installing all deps now avoids multiple npm install steps across plans.
      Comprehensive types enable type-safe IPC from the start — both the handler
      implementations (Task 2) and the Zustand store (Task 3) depend on these types.

      Steps:

      1. Install Phase 2 dependencies:
         ```
         npm install zustand @atlaskit/pragmatic-drag-and-drop @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder framer-motion
         ```

      2. Expand src/shared/types.ts — add domain types AFTER the existing DatabaseStatus
         interface but BEFORE the ElectronAPI interface. Keep all existing code intact.

         Add these domain types (matching Drizzle schema columns but using frontend-friendly
         types — string dates instead of Date objects, since they cross the IPC boundary as JSON):

         ```typescript
         // === DOMAIN TYPES (match DB schema, serialized for IPC) ===

         export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

         export interface Project {
           id: string;
           name: string;
           description: string | null;
           color: string | null;
           archived: boolean;
           createdAt: string;
           updatedAt: string;
         }

         export interface Board {
           id: string;
           projectId: string;
           name: string;
           position: number;
           createdAt: string;
         }

         export interface Column {
           id: string;
           boardId: string;
           name: string;
           position: number;
           createdAt: string;
         }

         export interface Card {
           id: string;
           columnId: string;
           title: string;
           description: string | null;
           position: number;
           priority: CardPriority;
           dueDate: string | null;
           archived: boolean;
           createdAt: string;
           updatedAt: string;
           labels?: Label[];
         }

         export interface Label {
           id: string;
           projectId: string;
           name: string;
           color: string;
           createdAt: string;
         }
         ```

         Add input types for create/update operations (used by IPC and UI forms):

         ```typescript
         // === INPUT TYPES (for create/update operations) ===

         export interface CreateProjectInput {
           name: string;
           description?: string;
           color?: string;
         }

         export interface UpdateProjectInput {
           name?: string;
           description?: string | null;
           color?: string | null;
           archived?: boolean;
         }

         export interface CreateBoardInput {
           projectId: string;
           name: string;
         }

         export interface UpdateBoardInput {
           name?: string;
           position?: number;
         }

         export interface CreateColumnInput {
           boardId: string;
           name: string;
         }

         export interface UpdateColumnInput {
           name?: string;
           position?: number;
         }

         export interface CreateCardInput {
           columnId: string;
           title: string;
           description?: string;
           priority?: CardPriority;
         }

         export interface UpdateCardInput {
           title?: string;
           description?: string | null;
           priority?: CardPriority;
           dueDate?: string | null;
           archived?: boolean;
           columnId?: string;
           position?: number;
         }

         export interface CreateLabelInput {
           projectId: string;
           name: string;
           color: string;
         }

         export interface UpdateLabelInput {
           name?: string;
           color?: string;
         }
         ```

      3. Expand the ElectronAPI interface — add methods for all CRUD operations.
         Add these INSIDE the existing ElectronAPI interface, after the `getDatabaseStatus` line:

         ```typescript
         // Projects
         getProjects: () => Promise&lt;Project[]&gt;;
         createProject: (data: CreateProjectInput) => Promise&lt;Project&gt;;
         updateProject: (id: string, data: UpdateProjectInput) => Promise&lt;Project&gt;;
         deleteProject: (id: string) => Promise&lt;void&gt;;

         // Boards
         getBoards: (projectId: string) => Promise&lt;Board[]&gt;;
         createBoard: (data: CreateBoardInput) => Promise&lt;Board&gt;;
         updateBoard: (id: string, data: UpdateBoardInput) => Promise&lt;Board&gt;;
         deleteBoard: (id: string) => Promise&lt;void&gt;;

         // Columns
         getColumns: (boardId: string) => Promise&lt;Column[]&gt;;
         createColumn: (data: CreateColumnInput) => Promise&lt;Column&gt;;
         updateColumn: (id: string, data: UpdateColumnInput) => Promise&lt;Column&gt;;
         deleteColumn: (id: string) => Promise&lt;void&gt;;
         reorderColumns: (boardId: string, columnIds: string[]) => Promise&lt;void&gt;;

         // Cards
         getCardsByBoard: (boardId: string) => Promise&lt;Card[]&gt;;
         createCard: (data: CreateCardInput) => Promise&lt;Card&gt;;
         updateCard: (id: string, data: UpdateCardInput) => Promise&lt;Card&gt;;
         deleteCard: (id: string) => Promise&lt;void&gt;;
         moveCard: (id: string, columnId: string, position: number) => Promise&lt;Card&gt;;

         // Labels
         getLabels: (projectId: string) => Promise&lt;Label[]&gt;;
         createLabel: (data: CreateLabelInput) => Promise&lt;Label&gt;;
         updateLabel: (id: string, data: UpdateLabelInput) => Promise&lt;Label&gt;;
         deleteLabel: (id: string) => Promise&lt;void&gt;;
         attachLabel: (cardId: string, labelId: string) => Promise&lt;void&gt;;
         detachLabel: (cardId: string, labelId: string) => Promise&lt;void&gt;;
         ```

      IMPORTANT:
      - Keep ALL existing types and interfaces untouched
      - Domain types go BETWEEN DatabaseStatus and ElectronAPI
      - ElectronAPI additions go AFTER existing methods
      - Use HTML entities for angle brackets in XML: &amp;lt; and &amp;gt;
        (but write actual angle brackets in the TypeScript code, of course)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Check package.json has all 6 new dependencies: zustand, @atlaskit/pragmatic-drag-and-drop, @tiptap/react, @tiptap/starter-kit, @tiptap/extension-placeholder, framer-motion
      3. Read src/shared/types.ts and verify:
         - Project, Board, Column, Card, Label interfaces exist
         - All Create*Input and Update*Input types exist
         - CardPriority type exists
         - ElectronAPI has ~25 new methods (getProjects through detachLabel)
         - Existing types (DatabaseStatus, window controls) are unchanged
    </verify>
    <done>
      All Phase 2 npm dependencies installed.
      Complete domain type system in shared/types.ts — domain entities, input types, and
      ElectronAPI expansion. Both main process and renderer can import these types.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - @atlaskit/pragmatic-drag-and-drop is the correct npm package name for Atlassian's drag-and-drop library
      - @tiptap/react, @tiptap/starter-kit, @tiptap/extension-placeholder are the correct TipTap v2 packages
      - zustand works in Electron renderer without special configuration
      - framer-motion works with React 19
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>IPC CRUD handlers + preload bridge for all entities</n>
    <files>
      src/main/ipc/projects.ts (create — project + board + column handlers)
      src/main/ipc/cards.ts (create — card + label handlers)
      src/main/ipc/index.ts (modify — register new handlers)
      src/preload/preload.ts (modify — expose new IPC methods)
    </files>
    <preconditions>
      - Task 1 completed (types exist in shared/types.ts, dependencies installed)
    </preconditions>
    <action>
      Create IPC handlers for all CRUD operations and wire them through the preload bridge.
      This establishes the complete data pipeline from renderer → preload → main → DB.

      WHY: The renderer process cannot access the database directly (contextIsolation).
      All data operations must go through IPC. This task creates the entire backend API
      that the UI (Task 3 and Plans 2.2/2.3) will consume.

      PATTERN TO FOLLOW (from existing database.ts):
      ```typescript
      import { ipcMain } from 'electron';
      import { getDb } from '../db/connection';
      // Import types from shared/types.ts
      // Export a register function called from index.ts
      ```

      Steps:

      1. Create src/main/ipc/projects.ts:

         ```typescript
         // === FILE PURPOSE ===
         // IPC handlers for projects, boards, and columns CRUD operations.
         // Groups related entities that form the board structure.

         import { ipcMain } from 'electron';
         import { eq, asc } from 'drizzle-orm';
         import { getDb } from '../db/connection';
         import { projects, boards, columns } from '../db/schema';
         import type {
           CreateProjectInput, UpdateProjectInput,
           CreateBoardInput, UpdateBoardInput,
           CreateColumnInput, UpdateColumnInput,
         } from '../../shared/types';

         export function registerProjectHandlers(): void {
           // --- Projects ---
           ipcMain.handle('projects:list', async () => {
             const db = getDb();
             return db.select().from(projects).orderBy(asc(projects.createdAt));
           });

           ipcMain.handle('projects:create', async (_event, data: CreateProjectInput) => {
             const db = getDb();
             const [project] = await db.insert(projects).values({
               name: data.name,
               description: data.description ?? null,
               color: data.color ?? null,
             }).returning();
             return project;
           });

           ipcMain.handle('projects:update', async (_event, id: string, data: UpdateProjectInput) => {
             const db = getDb();
             const [project] = await db.update(projects)
               .set({ ...data, updatedAt: new Date() })
               .where(eq(projects.id, id))
               .returning();
             return project;
           });

           ipcMain.handle('projects:delete', async (_event, id: string) => {
             const db = getDb();
             await db.delete(projects).where(eq(projects.id, id));
           });

           // --- Boards ---
           ipcMain.handle('boards:list', async (_event, projectId: string) => {
             const db = getDb();
             return db.select().from(boards)
               .where(eq(boards.projectId, projectId))
               .orderBy(asc(boards.position));
           });

           ipcMain.handle('boards:create', async (_event, data: CreateBoardInput) => {
             const db = getDb();
             // Get next position
             const existing = await db.select().from(boards)
               .where(eq(boards.projectId, data.projectId));
             const [board] = await db.insert(boards).values({
               projectId: data.projectId,
               name: data.name,
               position: existing.length,
             }).returning();

             // Auto-create default columns for new boards
             const defaultColumns = ['To Do', 'In Progress', 'Done'];
             for (let i = 0; i &lt; defaultColumns.length; i++) {
               await db.insert(columns).values({
                 boardId: board.id,
                 name: defaultColumns[i],
                 position: i,
               });
             }

             return board;
           });

           ipcMain.handle('boards:update', async (_event, id: string, data: UpdateBoardInput) => {
             const db = getDb();
             const [board] = await db.update(boards)
               .set(data)
               .where(eq(boards.id, id))
               .returning();
             return board;
           });

           ipcMain.handle('boards:delete', async (_event, id: string) => {
             const db = getDb();
             await db.delete(boards).where(eq(boards.id, id));
           });

           // --- Columns ---
           ipcMain.handle('columns:list', async (_event, boardId: string) => {
             const db = getDb();
             return db.select().from(columns)
               .where(eq(columns.boardId, boardId))
               .orderBy(asc(columns.position));
           });

           ipcMain.handle('columns:create', async (_event, data: CreateColumnInput) => {
             const db = getDb();
             const existing = await db.select().from(columns)
               .where(eq(columns.boardId, data.boardId));
             const [column] = await db.insert(columns).values({
               boardId: data.boardId,
               name: data.name,
               position: existing.length,
             }).returning();
             return column;
           });

           ipcMain.handle('columns:update', async (_event, id: string, data: UpdateColumnInput) => {
             const db = getDb();
             const [column] = await db.update(columns)
               .set(data)
               .where(eq(columns.id, id))
               .returning();
             return column;
           });

           ipcMain.handle('columns:delete', async (_event, id: string) => {
             const db = getDb();
             await db.delete(columns).where(eq(columns.id, id));
           });

           ipcMain.handle('columns:reorder', async (_event, boardId: string, columnIds: string[]) => {
             const db = getDb();
             for (let i = 0; i &lt; columnIds.length; i++) {
               await db.update(columns)
                 .set({ position: i })
                 .where(eq(columns.id, columnIds[i]));
             }
           });
         }
         ```

         KEY DESIGN DECISIONS:
         - boards:create auto-creates 3 default columns ("To Do", "In Progress", "Done")
           WHY: Every new board needs columns. Creating them automatically provides a
           useful starting point without extra user steps.
         - Position fields use array index (0-based) for ordering
         - columns:reorder accepts an ordered array of IDs and updates positions
           WHY: Simpler and more reliable than calculating position swaps

      2. Create src/main/ipc/cards.ts:

         ```typescript
         // === FILE PURPOSE ===
         // IPC handlers for cards and labels CRUD operations.
         // Includes card movement between columns and label attachment.

         import { ipcMain } from 'electron';
         import { eq, and, asc } from 'drizzle-orm';
         import { getDb } from '../db/connection';
         import { cards, cardLabels } from '../db/schema/cards';
         import { labels } from '../db/schema/labels';
         import { columns } from '../db/schema/boards';
         import type {
           CreateCardInput, UpdateCardInput,
           CreateLabelInput, UpdateLabelInput,
           Card, Label,
         } from '../../shared/types';

         export function registerCardHandlers(): void {
           // --- Cards ---
           ipcMain.handle('cards:list-by-board', async (_event, boardId: string) => {
             const db = getDb();
             // Get all columns for this board, then all cards in those columns
             const boardColumns = await db.select().from(columns)
               .where(eq(columns.boardId, boardId));
             const columnIds = boardColumns.map(c => c.id);

             if (columnIds.length === 0) return [];

             // Get cards for all columns in the board
             const allCards: (Card & { labels: Label[] })[] = [];
             for (const colId of columnIds) {
               const colCards = await db.select().from(cards)
                 .where(and(eq(cards.columnId, colId), eq(cards.archived, false)))
                 .orderBy(asc(cards.position));

               for (const card of colCards) {
                 // Get labels for each card
                 const cardLabelRows = await db.select().from(cardLabels)
                   .where(eq(cardLabels.cardId, card.id));
                 const cardLabelList: Label[] = [];
                 for (const cl of cardLabelRows) {
                   const [label] = await db.select().from(labels)
                     .where(eq(labels.id, cl.labelId));
                   if (label) cardLabelList.push(label as unknown as Label);
                 }
                 allCards.push({ ...(card as unknown as Card), labels: cardLabelList });
               }
             }
             return allCards;
           });

           ipcMain.handle('cards:create', async (_event, data: CreateCardInput) => {
             const db = getDb();
             // Get next position in the column
             const existing = await db.select().from(cards)
               .where(eq(cards.columnId, data.columnId));
             const [card] = await db.insert(cards).values({
               columnId: data.columnId,
               title: data.title,
               description: data.description ?? null,
               priority: data.priority ?? 'medium',
               position: existing.length,
             }).returning();
             return card;
           });

           ipcMain.handle('cards:update', async (_event, id: string, data: UpdateCardInput) => {
             const db = getDb();
             const [card] = await db.update(cards)
               .set({ ...data, updatedAt: new Date() })
               .where(eq(cards.id, id))
               .returning();
             return card;
           });

           ipcMain.handle('cards:delete', async (_event, id: string) => {
             const db = getDb();
             await db.delete(cards).where(eq(cards.id, id));
           });

           ipcMain.handle('cards:move', async (_event, id: string, columnId: string, position: number) => {
             const db = getDb();
             const [card] = await db.update(cards)
               .set({ columnId, position, updatedAt: new Date() })
               .where(eq(cards.id, id))
               .returning();
             return card;
           });

           // --- Labels ---
           ipcMain.handle('labels:list', async (_event, projectId: string) => {
             const db = getDb();
             return db.select().from(labels)
               .where(eq(labels.projectId, projectId))
               .orderBy(asc(labels.name));
           });

           ipcMain.handle('labels:create', async (_event, data: CreateLabelInput) => {
             const db = getDb();
             const [label] = await db.insert(labels).values({
               projectId: data.projectId,
               name: data.name,
               color: data.color,
             }).returning();
             return label;
           });

           ipcMain.handle('labels:update', async (_event, id: string, data: UpdateLabelInput) => {
             const db = getDb();
             const [label] = await db.update(labels)
               .set(data)
               .where(eq(labels.id, id))
               .returning();
             return label;
           });

           ipcMain.handle('labels:delete', async (_event, id: string) => {
             const db = getDb();
             await db.delete(labels).where(eq(labels.id, id));
           });

           ipcMain.handle('labels:attach', async (_event, cardId: string, labelId: string) => {
             const db = getDb();
             await db.insert(cardLabels).values({ cardId, labelId })
               .onConflictDoNothing();
           });

           ipcMain.handle('labels:detach', async (_event, cardId: string, labelId: string) => {
             const db = getDb();
             await db.delete(cardLabels)
               .where(and(eq(cardLabels.cardId, cardId), eq(cardLabels.labelId, labelId)));
           });
         }
         ```

         KEY DESIGN DECISIONS:
         - cards:list-by-board fetches all cards for a board (across columns) with labels
           WHY: The Kanban UI needs all cards at once to render the board. Fetching per-column
           would require N+1 requests.
         - labels:attach uses onConflictDoNothing to prevent duplicate attachments
         - cards:move updates both columnId and position in one operation

         NOTE: The cards:list-by-board implementation iterates per-column and per-card for
         label joins. This is simple but not optimal for large boards. For v1 with single-user
         desktop use, this is acceptable. Can be optimized with joins later if needed.

      3. Update src/main/ipc/index.ts — add imports and registration calls:

         Add these imports at the top (after existing imports):
         ```typescript
         import { registerProjectHandlers } from './projects';
         import { registerCardHandlers } from './cards';
         ```

         Add these calls inside registerIpcHandlers() (after existing calls):
         ```typescript
         registerProjectHandlers();
         registerCardHandlers();
         ```

      4. Update src/preload/preload.ts — expose all new IPC methods.

         Add these inside the contextBridge.exposeInMainWorld('electronAPI', { ... }) object,
         after the existing getDatabaseStatus line:

         ```typescript
         // Projects
         getProjects: () => ipcRenderer.invoke('projects:list'),
         createProject: (data: import('../../shared/types').CreateProjectInput) =>
           ipcRenderer.invoke('projects:create', data),
         updateProject: (id: string, data: import('../../shared/types').UpdateProjectInput) =>
           ipcRenderer.invoke('projects:update', id, data),
         deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),

         // Boards
         getBoards: (projectId: string) => ipcRenderer.invoke('boards:list', projectId),
         createBoard: (data: import('../../shared/types').CreateBoardInput) =>
           ipcRenderer.invoke('boards:create', data),
         updateBoard: (id: string, data: import('../../shared/types').UpdateBoardInput) =>
           ipcRenderer.invoke('boards:update', id, data),
         deleteBoard: (id: string) => ipcRenderer.invoke('boards:delete', id),

         // Columns
         getColumns: (boardId: string) => ipcRenderer.invoke('columns:list', boardId),
         createColumn: (data: import('../../shared/types').CreateColumnInput) =>
           ipcRenderer.invoke('columns:create', data),
         updateColumn: (id: string, data: import('../../shared/types').UpdateColumnInput) =>
           ipcRenderer.invoke('columns:update', id, data),
         deleteColumn: (id: string) => ipcRenderer.invoke('columns:delete', id),
         reorderColumns: (boardId: string, columnIds: string[]) =>
           ipcRenderer.invoke('columns:reorder', boardId, columnIds),

         // Cards
         getCardsByBoard: (boardId: string) => ipcRenderer.invoke('cards:list-by-board', boardId),
         createCard: (data: import('../../shared/types').CreateCardInput) =>
           ipcRenderer.invoke('cards:create', data),
         updateCard: (id: string, data: import('../../shared/types').UpdateCardInput) =>
           ipcRenderer.invoke('cards:update', id, data),
         deleteCard: (id: string) => ipcRenderer.invoke('cards:delete', id),
         moveCard: (id: string, columnId: string, position: number) =>
           ipcRenderer.invoke('cards:move', id, columnId, position),

         // Labels
         getLabels: (projectId: string) => ipcRenderer.invoke('labels:list', projectId),
         createLabel: (data: import('../../shared/types').CreateLabelInput) =>
           ipcRenderer.invoke('labels:create', data),
         updateLabel: (id: string, data: import('../../shared/types').UpdateLabelInput) =>
           ipcRenderer.invoke('labels:update', id, data),
         deleteLabel: (id: string) => ipcRenderer.invoke('labels:delete', id),
         attachLabel: (cardId: string, labelId: string) =>
           ipcRenderer.invoke('labels:attach', cardId, labelId),
         detachLabel: (cardId: string, labelId: string) =>
           ipcRenderer.invoke('labels:detach', cardId, labelId),
         ```

         NOTE on preload typing: The preload script runs in a special context where
         standard imports may not resolve at runtime. Use inline `import('...')` type
         annotations for the parameter types. The actual type checking happens via the
         ElectronAPI interface in shared/types.ts.

         ALTERNATIVE if inline imports cause issues: Use plain parameter types
         (e.g., `data: { name: string; description?: string; color?: string }`) and
         rely on the ElectronAPI interface for the renderer-side type safety. The
         executing agent should check if `npx tsc --noEmit` passes with the inline
         import approach first; if not, fall back to explicit object types.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify src/main/ipc/projects.ts exists with handlers for:
         projects:list, projects:create, projects:update, projects:delete,
         boards:list, boards:create, boards:update, boards:delete,
         columns:list, columns:create, columns:update, columns:delete, columns:reorder
      3. Verify src/main/ipc/cards.ts exists with handlers for:
         cards:list-by-board, cards:create, cards:update, cards:delete, cards:move,
         labels:list, labels:create, labels:update, labels:delete, labels:attach, labels:detach
      4. Verify src/main/ipc/index.ts imports and registers both new handler modules
      5. Verify src/preload/preload.ts exposes all new methods
      6. Spot-check: preload method names match ElectronAPI interface method names
    </verify>
    <done>
      Complete IPC CRUD layer for all Phase 2 entities.
      24 IPC handlers registered (13 project/board/column + 11 card/label).
      Preload bridge exposes all 24 methods to the renderer.
      boards:create auto-creates default columns (To Do, In Progress, Done).
      All methods are type-safe via shared/types.ts.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Drizzle ORM's eq, and, asc from drizzle-orm work with the postgres-js driver
      - ipcMain.handle supports multiple positional arguments (id, data)
      - Preload inline import() type annotations compile in Electron's preload context
      - onConflictDoNothing() is available in Drizzle for the card_labels insert
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Zustand project store + project list UI + board route shell</n>
    <files>
      src/renderer/stores/projectStore.ts (create — Zustand store for projects)
      src/renderer/pages/ProjectsPage.tsx (modify — replace placeholder with project list)
      src/renderer/pages/BoardPage.tsx (create — minimal board view shell)
      src/renderer/App.tsx (modify — add /projects/:projectId route)
      src/renderer/components/Sidebar.tsx (modify — active state for /projects/* paths)
    </files>
    <preconditions>
      - Task 1 completed (types and dependencies installed)
      - Task 2 completed (IPC handlers and preload bridge in place)
    </preconditions>
    <action>
      Create the Zustand store for project state, replace the ProjectsPage placeholder with
      an interactive project list, add a board route, and update the sidebar.

      WHY: This is the first real interactive feature. Users need to create and manage projects
      before they can use boards/cards (Plans 2.2/2.3). The Zustand store provides reactive
      state management that Electron + React needs (no server — state must be managed client-side
      with IPC calls to the main process).

      Steps:

      1. Create src/renderer/stores/projectStore.ts:

         ```typescript
         // === FILE PURPOSE ===
         // Zustand store for project-level state management.
         // Manages the project list, selection, and CRUD operations.
         // All data fetching goes through window.electronAPI (IPC bridge).

         import { create } from 'zustand';
         import type { Project, CreateProjectInput, UpdateProjectInput } from '../../shared/types';

         interface ProjectStore {
           // State
           projects: Project[];
           loading: boolean;
           error: string | null;

           // Actions
           loadProjects: () => Promise&lt;void&gt;;
           createProject: (data: CreateProjectInput) => Promise&lt;Project&gt;;
           updateProject: (id: string, data: UpdateProjectInput) => Promise&lt;void&gt;;
           deleteProject: (id: string) => Promise&lt;void&gt;;
         }

         export const useProjectStore = create&lt;ProjectStore&gt;((set, get) => ({
           projects: [],
           loading: false,
           error: null,

           loadProjects: async () => {
             set({ loading: true, error: null });
             try {
               const projects = await window.electronAPI.getProjects();
               set({ projects, loading: false });
             } catch (error) {
               set({
                 error: error instanceof Error ? error.message : 'Failed to load projects',
                 loading: false,
               });
             }
           },

           createProject: async (data) => {
             const project = await window.electronAPI.createProject(data);
             set({ projects: [...get().projects, project] });
             return project;
           },

           updateProject: async (id, data) => {
             const updated = await window.electronAPI.updateProject(id, data);
             set({
               projects: get().projects.map(p => p.id === id ? updated : p),
             });
           },

           deleteProject: async (id) => {
             await window.electronAPI.deleteProject(id);
             set({
               projects: get().projects.filter(p => p.id !== id),
             });
           },
         }));
         ```

      2. Replace src/renderer/pages/ProjectsPage.tsx with an interactive project list:

         The page should:
         - Load projects on mount via useProjectStore.loadProjects()
         - Show a header with "Projects" title and a "+ New Project" button
         - Display projects as a grid of cards (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3)
         - Each project card shows:
           - Color dot (w-3 h-3 rounded-full, using project.color or default primary-500)
           - Project name (font-semibold text-surface-100)
           - Description truncated to 2 lines (text-surface-400 line-clamp-2)
           - "Created [relative date]" text (text-xs text-surface-500)
           - Archive button (Archive icon from lucide-react, click calls updateProject with archived: true)
         - Clicking a project card navigates to /projects/:projectId (use useNavigate)
         - Filter: show only non-archived projects (filter on projects.archived === false)
         - Empty state: show FolderKanban icon + "No projects yet" + "Create your first project" text
         - Loading state: show LoadingSpinner while loading === true
         - Error state: show error message in red text

         For the "New Project" form:
         - Toggle visibility with a boolean state (showCreateForm)
         - When visible, show an inline form above the project grid:
           - Name input (required, text-sm, bg-surface-800, border border-surface-700)
           - Description textarea (optional, same styling, 2 rows)
           - Color picker: 6 preset color circles the user can click to select
             Colors: #3b82f6 (blue), #22c55e (green), #f59e0b (amber), #ef4444 (red),
                     #8b5cf6 (purple), #ec4899 (pink)
           - "Create" button (bg-primary-600 hover:bg-primary-500) + "Cancel" button
         - On submit: call createProject, reset form, hide form, navigate to new project
         - Use basic form state with useState — no form library needed

         Component structure:
         ```
         ProjectsPage
         ├── Header (h1 + "New Project" button)
         ├── CreateProjectForm (inline, conditionally rendered)
         └── Project grid OR empty state OR loading state
         ```

         Keep it as ONE file (ProjectsPage.tsx). It's a page component, not a reusable widget.
         The create form can be a local component defined in the same file.

      3. Create src/renderer/pages/BoardPage.tsx — minimal board view shell:

         This is a PLACEHOLDER that will be fully built in Plan 2.2.
         For now, just show:
         - The project name as a heading (fetch via getProjects and find by ID, or
           better: read projectId from URL params and show a simple header)
         - "Board view coming soon" message
         - A "Back to Projects" link

         ```typescript
         // === FILE PURPOSE ===
         // Board view page — displays the Kanban board for a project.
         // Currently a shell/placeholder. Full implementation in Plan 2.2.

         import { useParams, Link } from 'react-router-dom';
         import { useEffect, useState } from 'react';
         import { ArrowLeft, Columns3 } from 'lucide-react';
         import type { Project } from '../../shared/types';

         function BoardPage() {
           const { projectId } = useParams&lt;{ projectId: string }&gt;();
           const [project, setProject] = useState&lt;Project | null&gt;(null);

           useEffect(() => {
             if (!projectId) return;
             window.electronAPI.getProjects().then(projects => {
               const found = projects.find(p => p.id === projectId);
               if (found) setProject(found);
             });
           }, [projectId]);

           return (
             &lt;div className="flex-1 flex flex-col p-6"&gt;
               &lt;div className="flex items-center gap-3 mb-6"&gt;
                 &lt;Link to="/" className="text-surface-400 hover:text-surface-200"&gt;
                   &lt;ArrowLeft size={20} /&gt;
                 &lt;/Link&gt;
                 &lt;h1 className="text-2xl font-bold text-surface-100"&gt;
                   {project?.name ?? 'Loading...'}
                 &lt;/h1&gt;
               &lt;/div&gt;

               &lt;div className="flex-1 flex flex-col items-center justify-center text-surface-500"&gt;
                 &lt;Columns3 size={48} className="mb-4 text-surface-600" /&gt;
                 &lt;p className="text-lg"&gt;Board view coming in Plan 2.2&lt;/p&gt;
               &lt;/div&gt;
             &lt;/div&gt;
           );
         }

         export default BoardPage;
         ```

         WHY a placeholder: The routing must be set up now so project cards can navigate
         to /projects/:projectId. The full board UI is Plan 2.2.

      4. Update src/renderer/App.tsx — add the board route:

         Add lazy import:
         ```typescript
         const BoardPage = lazy(() => import('./pages/BoardPage'));
         ```

         Add route inside the AppLayout Route, BEFORE the catch-all:
         ```tsx
         &lt;Route path="/projects/:projectId" element={&lt;BoardPage /&gt;} /&gt;
         ```

         The final route order inside AppLayout should be:
         - index (ProjectsPage)
         - /meetings
         - /ideas
         - /brainstorm
         - /settings
         - /projects/:projectId (NEW)
         - * (NotFoundPage — must remain LAST)

      5. Update src/renderer/components/Sidebar.tsx — make Projects icon active on board routes:

         Currently uses NavLink with `end={path === '/'}` which means the Projects icon
         is ONLY active on exactly `/`. When on `/projects/some-uuid`, it would be inactive.

         Fix: Replace the current NavLink rendering for the Projects item to use
         `useLocation()` to check if the current path is `/` OR starts with `/projects/`.

         Approach:
         - Import `useLocation` from react-router-dom
         - For the Projects NavItem specifically (path === '/'), compute isActive manually:
           `location.pathname === '/' || location.pathname.startsWith('/projects/')`
         - For all other nav items, keep using NavLink's built-in isActive

         The simplest implementation: keep NavLink for all items, but for the '/' item,
         remove the `end` prop and instead use a custom `className` function that checks
         the location. Example:

         ```tsx
         import { NavLink, useLocation } from 'react-router-dom';
         // ...

         function Sidebar() {
           const location = useLocation();

           return (
             &lt;nav className="..."&gt;
               {navItems.map(({ path, label, icon: Icon }) => {
                 // Projects icon should be active for both / and /projects/*
                 const isProjectsItem = path === '/';
                 const isActive = isProjectsItem
                   ? location.pathname === '/' || location.pathname.startsWith('/projects/')
                   : false; // Let NavLink handle other items

                 return (
                   &lt;NavLink
                     key={path}
                     to={path}
                     end={isProjectsItem}
                     title={label}
                     className={({ isActive: navActive }) => {
                       const active = isProjectsItem ? isActive : navActive;
                       return [
                         'w-full h-12 flex items-center justify-center transition-colors',
                         active
                           ? 'bg-primary-600/15 text-primary-400 border-l-2 border-primary-500'
                           : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200 border-l-2 border-transparent',
                       ].join(' ');
                     }}
                   &gt;
                     &lt;Icon size={20} /&gt;
                   &lt;/NavLink&gt;
                 );
               })}
             &lt;/nav&gt;
           );
         }
         ```

      IMPORTANT IMPLEMENTATION NOTES:
      - Do NOT install any additional packages — everything was installed in Task 1
      - The project list must actually call window.electronAPI methods (not mock data)
      - The Zustand store is the single source of truth for project state
      - Use lucide-react icons only (already installed): FolderKanban, Plus, Archive, ArrowLeft, Columns3
      - Follow existing code patterns: file purpose comments, default export
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify src/renderer/stores/projectStore.ts exists with useProjectStore hook
      3. Verify ProjectsPage.tsx has:
         - useProjectStore() for state
         - useEffect to loadProjects on mount
         - Project grid with clickable cards
         - Inline create project form
         - Empty state when no projects exist
      4. Verify BoardPage.tsx exists with useParams for projectId
      5. Verify App.tsx has Route for /projects/:projectId with lazy-loaded BoardPage
      6. Verify Sidebar.tsx highlights Projects icon on both / and /projects/* paths
    </verify>
    <done>
      Zustand project store manages project CRUD via IPC.
      ProjectsPage shows interactive project list with create form and project cards.
      Clicking a project navigates to /projects/:projectId (board shell page).
      Sidebar Projects icon stays active on board routes.
      Complete data pipeline verified: UI → Zustand → IPC → DB.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Zustand's create() works without provider (standard Zustand pattern)
      - window.electronAPI is available when Zustand actions execute (preload has run)
      - useNavigate works inside event handlers in React 19
      - React Router v7 useParams returns typed params correctly
      - line-clamp-2 utility works in Tailwind CSS 4 (built-in, no plugin needed)
    </assumptions>
  </task>
</phase>
