# Phase 2 — Plan 2 of 3: Kanban Board

## Coverage
- **R3: Project Dashboard** (next ~45% — board layout, columns, card rendering, card CRUD, drag-and-drop)

## Plan Overview
Phase 2 delivers the full project dashboard (R3). It requires 3 plans:

- **Plan 2.1** (done): Data layer — types, IPC CRUD, preload bridge, Zustand store, project list UI.
- **Plan 2.2** (this plan): Kanban board — board store, column layout, card rendering,
  card CRUD inline forms, and drag-and-drop card movement via pragmatic-drag-and-drop.
- **Plan 2.3** (next): Rich text + polish — TipTap card description editor, labels UI,
  search/filter, board sidebar.

## Design Decisions for This Plan

1. **One board per project for v1.** When navigating to a project with no boards,
   auto-create a default board (the IPC handler already creates 3 default columns).
   Multiple boards can be added in a future version.
2. **Board store** — new Zustand store (boardStore) manages the active board, its columns,
   and all cards. Separate from projectStore to keep concerns isolated.
3. **Component structure:**
   ```
   BoardPage (page — owns store, loads data)
   ├── BoardHeader (project name, back link, "+ Add Column" button)
   ├── ColumnList (horizontal flex container)
   │   └── KanbanColumn (single column — header, card list, add card form)
   │       └── KanbanCard (single card — title, priority badge, label dots)
   ```
4. **pragmatic-drag-and-drop integration** — headless library, uses useRef + useEffect.
   Import from `@atlaskit/pragmatic-drag-and-drop/element/adapter` (NOT the root package).
   Verified API: `draggable()`, `dropTargetForElements()`, `monitorForElements()`,
   `combine()` from `/combine`, `reorder()` from `/reorder`.

---

<phase n="2.2" name="Kanban Board">
  <context>
    Plan 2.1 is complete. The app now has:
    - 24 IPC handlers (projects, boards, columns, cards, labels CRUD)
    - Preload bridge exposing all methods to renderer
    - Zustand projectStore for project list
    - Interactive ProjectsPage with create form and project grid
    - BoardPage placeholder at /projects/:projectId
    - All Phase 2 deps installed (zustand, pragmatic-dnd, tiptap, framer-motion)

    IPC methods available for boards/columns/cards:
    - getBoards(projectId) → Board[]
    - createBoard({ projectId, name }) → Board (auto-creates 3 default columns)
    - getColumns(boardId) → Column[]
    - createColumn({ boardId, name }) → Column
    - updateColumn(id, { name?, position? }) → Column
    - deleteColumn(id) → void
    - reorderColumns(boardId, columnIds[]) → void
    - getCardsByBoard(boardId) → Card[] (with labels)
    - createCard({ columnId, title, description?, priority? }) → Card
    - updateCard(id, { title?, description?, priority?, columnId?, position? }) → Card
    - deleteCard(id) → void
    - moveCard(id, columnId, position) → Card

    Types available in shared/types.ts:
    - Board, Column, Card, Label, CardPriority
    - CreateBoardInput, CreateColumnInput, CreateCardInput
    - UpdateColumnInput, UpdateCardInput

    pragmatic-drag-and-drop API (v1.7.7, verified from installed types):
    - Import: `@atlaskit/pragmatic-drag-and-drop/element/adapter`
      → draggable({ element, getInitialData, onDragStart, onDrop })
      → dropTargetForElements({ element, getData, canDrop, getIsSticky, onDragEnter, onDragLeave, onDrop })
      → monitorForElements({ canMonitor, onDrop })
    - Import: `@atlaskit/pragmatic-drag-and-drop/combine` → combine(...cleanupFns)
    - Import: `@atlaskit/pragmatic-drag-and-drop/reorder` → reorder({ list, startIndex, finishIndex })
    - All functions return CleanupFn (call in useEffect return)
    - Headless: uses useRef + useEffect, no React wrappers/hooks

    Existing design patterns:
    - bg-surface-900 main bg, bg-surface-800 card bg, border-surface-700
    - text-surface-100 headings, text-surface-400 body, text-surface-500 muted
    - bg-primary-600 buttons, hover:bg-primary-500
    - lucide-react for icons

    @src/shared/types.ts
    @src/renderer/pages/BoardPage.tsx
    @src/renderer/stores/projectStore.ts
    @src/main/ipc/projects.ts
    @src/main/ipc/cards.ts
    @src/preload/preload.ts
    @src/renderer/App.tsx
    @src/renderer/components/Sidebar.tsx
    @src/renderer/components/LoadingSpinner.tsx
    @package.json
  </context>

  <task type="auto" n="1">
    <n>Board store + BoardPage layout with columns</n>
    <files>
      src/renderer/stores/boardStore.ts (create — Zustand store for board state)
      src/renderer/pages/BoardPage.tsx (modify — replace placeholder with full board layout)
    </files>
    <action>
      Create the Zustand board store and replace the BoardPage placeholder with a functional
      board layout showing columns.

      WHY: The board store is the data backbone for the entire Kanban view. It manages the
      active board, columns, and cards in one place, providing reactive state that all
      board components consume. The column layout must be in place before cards can be added.

      Steps:

      1. Create src/renderer/stores/boardStore.ts:

         The store manages:
         - project: Project | null (the current project)
         - board: Board | null (the active board — first board of the project)
         - columns: Column[] (ordered by position)
         - cards: Card[] (all cards for the board, grouped by columnId in selectors)
         - loading / error states

         Actions:
         - loadBoard(projectId: string): Loads the project, its first board (or auto-creates
           one via createBoard), then loads columns and cards for that board.
           Flow:
           1. getProjects() → find project by ID
           2. getBoards(projectId) → if empty, createBoard({ projectId, name: 'Board' })
           3. getColumns(boardId) → store in columns
           4. getCardsByBoard(boardId) → store in cards
         - addColumn(name: string): Creates a column via IPC, appends to columns state
         - updateColumn(id, data): Updates column via IPC, updates columns state
         - deleteColumn(id): Deletes column via IPC, removes from columns state
         - reorderColumns(columnIds: string[]): Reorders via IPC, updates local state
         - addCard(columnId, title, priority?): Creates card via IPC, appends to cards
         - updateCard(id, data): Updates card via IPC, updates cards state
         - deleteCard(id): Deletes card via IPC, removes from cards state
         - moveCard(id, columnId, position): Moves card via IPC, updates cards state

         Helper selector (not in store, exported separately):
         ```typescript
         /** Group cards by columnId for rendering */
         export function getCardsByColumn(cards: Card[], columnId: string): Card[] {
           return cards
             .filter(c => c.columnId === columnId)
             .sort((a, b) => a.position - b.position);
         }
         ```

         Pattern to follow (from projectStore.ts):
         ```typescript
         import { create } from 'zustand';
         import type { ... } from '../../shared/types';

         interface BoardStore {
           // State
           project: Project | null;
           board: Board | null;
           columns: Column[];
           cards: Card[];
           loading: boolean;
           error: string | null;
           // Actions
           loadBoard: (projectId: string) => Promise&lt;void&gt;;
           addColumn: (name: string) => Promise&lt;void&gt;;
           updateColumn: (id: string, data: UpdateColumnInput) => Promise&lt;void&gt;;
           deleteColumn: (id: string) => Promise&lt;void&gt;;
           reorderColumns: (columnIds: string[]) => Promise&lt;void&gt;;
           addCard: (columnId: string, title: string, priority?: CardPriority) => Promise&lt;void&gt;;
           updateCard: (id: string, data: UpdateCardInput) => Promise&lt;void&gt;;
           deleteCard: (id: string) => Promise&lt;void&gt;;
           moveCard: (id: string, columnId: string, position: number) => Promise&lt;void&gt;;
         }

         export const useBoardStore = create&lt;BoardStore&gt;((set, get) => ({ ... }));
         ```

         IMPORTANT implementation detail for loadBoard:
         - If getBoards returns empty array, call createBoard({ projectId, name: 'Board' })
           to auto-create a default board with 3 columns.
         - Then reload boards to get the created board's ID.
         - Use the first board (boards[0]) as the active board.

      2. Replace src/renderer/pages/BoardPage.tsx:

         Replace the entire placeholder with the full board layout:

         Component structure:
         ```
         BoardPage
         ├── Header bar (back arrow + project name + "+ Add Column" button)
         └── Column container (flex horizontal, overflow-x-auto, gap-4)
             └── For each column:
                 ├── Column header (name + card count + delete button)
                 ├── Card list area (flex-col, gap-2, min-h-[200px])
                 │   └── (empty for now — cards added in Task 2)
                 └── Add card form (inline, toggle with "+" button)
         ```

         Layout details:
         - The board fills the available space: `flex-1 flex flex-col`
         - Header: `flex items-center gap-3 px-6 pt-6 pb-4 shrink-0`
         - Column container: `flex-1 flex gap-4 overflow-x-auto px-6 pb-6`
         - Each column: `w-72 shrink-0 flex flex-col bg-surface-800/50 rounded-lg`
         - Column header: `px-3 py-3 flex items-center justify-between`
         - Column name: `font-semibold text-sm text-surface-200`
         - Card count badge: `text-xs text-surface-500 bg-surface-700 px-1.5 py-0.5 rounded`
         - Column body: `flex-1 px-2 pb-2 overflow-y-auto` (scrollable if many cards)
         - Column delete: X icon, only shown on hover of column header, with confirmation

         Add Column form:
         - Last item in the column container (after all columns)
         - A dashed-border card `w-72 shrink-0 border-2 border-dashed border-surface-700`
         - Click to show inline input for column name
         - Enter to create, Escape to cancel

         Add Card form (bottom of each column):
         - Toggle with "+ Add card" button at bottom of card list area
         - When visible: text input for card title + Enter to create, Escape to cancel
         - New cards get default priority 'medium'
         - After creation, clear input and keep form open for rapid entry

         Loading state: Show LoadingSpinner centered while loadBoard runs
         Error state: Show error message with retry button

         Icons (lucide-react): ArrowLeft, Plus, X, GripVertical (for future drag handles)

         IMPORTANT:
         - Do NOT add drag-and-drop yet — that's Task 3
         - Do NOT render cards inside columns yet — that's Task 2
         - This task establishes the layout, store, column management, and add-card input
         - Actually, we SHOULD add basic card creation here since the form is part of the
           column component. But card RENDERING (the KanbanCard component) is Task 2.
         - So: the add-card form calls addCard, but the card list area just shows a count
           or placeholder text until Task 2 adds the card components.

         Wait — actually, for a cleaner split: Task 1 creates the store with ALL actions
         (including card CRUD) and the board layout with columns. But the card list area
         in each column should show a simple unformatted list (just title text) as a
         temporary placeholder. Task 2 replaces that with proper KanbanCard components.

         Revised approach: Task 1 does EVERYTHING FUNCTIONAL:
         - Board store with all actions
         - BoardPage with columns rendered
         - Add column form
         - Add card form (bottom of each column)
         - Simple card rendering: just card titles in a list within each column
         - Delete column (with confirmation)

         Then Task 2 upgrades card rendering to proper KanbanCard components with
         priority badges, label dots, edit/delete, and creates them as reusable components.
         Task 3 adds drag-and-drop on top.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify src/renderer/stores/boardStore.ts exports useBoardStore and getCardsByColumn
      3. Verify BoardPage.tsx:
         - Imports useBoardStore
         - Calls loadBoard(projectId) on mount
         - Renders horizontal column layout
         - Has "Add Column" form
         - Has "Add Card" form per column
         - Shows card titles in each column
         - Shows loading/error states
      4. Read files to verify column delete and add-card functionality exist
    </verify>
    <done>
      Zustand boardStore manages board, columns, and cards via IPC.
      BoardPage shows horizontal column layout with column headers, card titles,
      add-column form, add-card form, and column delete. Auto-creates a board
      for projects that don't have one yet.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Zustand create() works without provider (confirmed from projectStore)
      - window.electronAPI methods work as typed (confirmed from Plan 2.1)
      - overflow-x-auto with flex children creates a horizontal scrollable area
      - Tailwind CSS 4 supports all used utilities (w-72, shrink-0, line-clamp, etc.)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>KanbanCard component with priority, labels, and card actions</n>
    <files>
      src/renderer/components/KanbanCard.tsx (create — card component)
      src/renderer/pages/BoardPage.tsx (modify — use KanbanCard in columns)
    </files>
    <preconditions>
      - Task 1 completed (boardStore exists, BoardPage renders columns)
    </preconditions>
    <action>
      Create a polished KanbanCard component and integrate it into the board columns,
      replacing the simple title list from Task 1.

      WHY: Cards are the primary interactive element in the Kanban board. Users need to
      see card priority at a glance, view label indicators, and edit/delete cards.
      Extracting KanbanCard as a separate component keeps BoardPage manageable and
      makes the card reusable for the drag-and-drop layer (Task 3).

      Steps:

      1. Create src/renderer/components/KanbanCard.tsx:

         A compact card component displaying:
         - Priority indicator: left border color based on priority
           - low: border-l-emerald-500
           - medium: border-l-blue-500
           - high: border-l-amber-500
           - urgent: border-l-red-500
         - Card title: text-sm text-surface-100, truncate to 2 lines (line-clamp-2)
         - Label dots: row of small colored circles (w-2 h-2 rounded-full) if card has labels
         - Action buttons (visible on hover):
           - Edit (Pencil icon) — inline title editing
           - Delete (Trash2 icon) — delete with confirmation
         - Priority badge: small text badge in top-right corner
           - "LOW" "MED" "HIGH" "URG"
           - bg-emerald-500/20 text-emerald-400, bg-blue-500/20 text-blue-400, etc.

         Props:
         ```typescript
         interface KanbanCardProps {
           card: Card;
           onUpdate: (id: string, data: UpdateCardInput) => Promise&lt;void&gt;;
           onDelete: (id: string) => Promise&lt;void&gt;;
         }
         ```

         Card styling:
         - bg-surface-800 rounded-md p-3 border-l-2 cursor-pointer
         - hover:bg-surface-750 (use hover:bg-surface-700/50 if 750 doesn't exist)
         - group class for hover-reveal of action buttons
         - Transition for smooth hover effects

         Inline title editing:
         - Double-click on title to enter edit mode
         - Show input with current title, Enter to save, Escape to cancel
         - Call onUpdate with new title
         - Use local state for edit mode (isEditing, editTitle)

         Delete confirmation:
         - Click delete icon → show "Delete?" text replacing the icon for 2 seconds
         - Click "Delete?" text to confirm, or it auto-dismisses
         - This is simpler than a modal for card deletion

      2. Update BoardPage.tsx:

         In the column card list area, replace the simple title list with KanbanCard:

         ```tsx
         {getCardsByColumn(cards, column.id).map(card => (
           &lt;KanbanCard
             key={card.id}
             card={card}
             onUpdate={updateCard}
             onDelete={deleteCard}
           /&gt;
         ))}
         ```

         Import KanbanCard and pass the store's updateCard and deleteCard actions.

      IMPORTANT:
      - Do NOT add drag-related props or refs to KanbanCard — that's Task 3
      - The card component should be a self-contained presentational + interactive component
      - Keep it under 150 lines — it's a focused component
      - Use lucide-react icons: Pencil, Trash2
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify src/renderer/components/KanbanCard.tsx exists with:
         - KanbanCardProps interface
         - Priority-based left border colors
         - Priority badge
         - Label dots rendering
         - Inline title editing on double-click
         - Delete with confirmation
         - Hover-reveal action buttons
      3. Verify BoardPage.tsx imports and renders KanbanCard in each column
      4. Verify cards are rendered via getCardsByColumn helper
    </verify>
    <done>
      KanbanCard component renders cards with priority border, priority badge,
      label dots, hover actions (edit/delete), and inline title editing.
      Cards are displayed in the correct column based on columnId.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - line-clamp-2 works in Tailwind CSS 4 (built-in, confirmed from Plan 2.1)
      - Double-click handler works reliably on card titles in React 19
      - The card component will receive a ref in Task 3 — design it to accept forwardRef
        OR Task 3 wraps it in a div with ref. Either approach works.
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Drag-and-drop cards between columns with pragmatic-drag-and-drop</n>
    <files>
      src/renderer/components/KanbanCard.tsx (modify — add draggable behavior)
      src/renderer/pages/BoardPage.tsx (modify — add drop targets and monitor)
    </files>
    <preconditions>
      - Task 1 completed (boardStore with moveCard action)
      - Task 2 completed (KanbanCard component rendered in columns)
    </preconditions>
    <action>
      Integrate @atlaskit/pragmatic-drag-and-drop to enable card dragging between columns
      and reordering within columns.

      WHY: Drag-and-drop is the core UX of a Kanban board. Users expect to drag cards
      between columns to update status. pragmatic-drag-and-drop is headless and lightweight,
      giving us full control over the visual feedback.

      VERIFIED API (from installed package v1.7.7 type definitions):
      ```typescript
      // Core functions — import from element/adapter (NOT root package)
      import {
        draggable,
        dropTargetForElements,
        monitorForElements,
      } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
      import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
      ```

      Steps:

      1. Update src/renderer/components/KanbanCard.tsx — make cards draggable:

         Add a ref to the card's root div and set up `draggable()` in a useEffect:

         ```typescript
         import { useEffect, useRef, useState } from 'react';
         import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

         function KanbanCard({ card, onUpdate, onDelete }: KanbanCardProps) {
           const cardRef = useRef&lt;HTMLDivElement&gt;(null);
           const [isDragging, setIsDragging] = useState(false);

           useEffect(() => {
             const el = cardRef.current;
             if (!el) return;

             return draggable({
               element: el,
               getInitialData: () => ({
                 type: 'card',
                 cardId: card.id,
                 sourceColumnId: card.columnId,
                 sourcePosition: card.position,
               }),
               onDragStart: () => setIsDragging(true),
               onDrop: () => setIsDragging(false),
             });
           }, [card.id, card.columnId, card.position]);

           return (
             &lt;div
               ref={cardRef}
               className={`... ${isDragging ? 'opacity-40' : ''}`}
             &gt;
               {/* existing card content */}
             &lt;/div&gt;
           );
         }
         ```

         The isDragging state reduces opacity to give visual feedback that the card
         is being dragged.

      2. Update BoardPage.tsx — make columns drop targets and add a board-level monitor:

         For each column, wrap or modify the column card-list container to be a drop target:

         ```typescript
         import { useEffect, useRef, useState } from 'react';
         import {
           dropTargetForElements,
           monitorForElements,
         } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
         import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
         ```

         Each column needs:
         - A ref on the card list container (the droppable area)
         - dropTargetForElements with:
           - canDrop: only accept items with type === 'card'
           - getData: return { columnId: column.id }
           - getIsSticky: () => true (prevents flicker when dragging over cards)
           - onDragEnter/onDragLeave: set/clear highlight state

         Visual feedback for columns during drag:
         - Track which column is being dragged over: `dragOverColumnId` state
         - When a column is a drag target, add a subtle highlight:
           `border-2 border-dashed border-primary-500/50` (or similar)
         - Reset on drag leave and drop

         Board-level monitor:
         - Use monitorForElements to handle the actual drop logic centrally
         - On drop, read source.data (cardId, sourceColumnId) and
           location.current.dropTargets[0].data (target columnId)
         - Calculate new position (append to end of target column for simplicity)
         - Call boardStore.moveCard(cardId, targetColumnId, newPosition)

         Drop handling logic:
         ```typescript
         monitorForElements({
           canMonitor: ({ source }) => source.data.type === 'card',
           onDrop: ({ source, location }) => {
             const dropTargets = location.current.dropTargets;
             if (dropTargets.length === 0) return; // Dropped outside any column

             const targetColumnId = dropTargets[0].data.columnId as string;
             const cardId = source.data.cardId as string;
             const sourceColumnId = source.data.sourceColumnId as string;

             if (!targetColumnId || !cardId) return;

             // Calculate position: append to end of target column
             const targetCards = getCardsByColumn(cards, targetColumnId);
             const newPosition = sourceColumnId === targetColumnId
               ? targetCards.length - 1  // Same column: move to end
               : targetCards.length;      // Different column: append

             moveCard(cardId, targetColumnId, newPosition);
             setDragOverColumnId(null);
           },
         });
         ```

         IMPORTANT: The monitor must be set up once at the board level (not per column).
         Use a useEffect with combine() to clean up both the monitor and all drop targets.

         Since column components are rendered in a map, the simplest approach is to
         extract a ColumnDropTarget wrapper or use inline useEffect per column.

         Recommended approach: Extract a `BoardColumn` component from the column rendering
         in BoardPage. This component:
         - Receives column, cards, store actions as props
         - Sets up dropTargetForElements in its own useEffect
         - Manages its own dragOver state
         - Renders KanbanCard components

         The monitor stays in BoardPage (parent level).

      3. Test the complete drag flow:
         - Drag card from Column A → hover over Column B (highlight) → drop
         - Card should appear in Column B, disappear from Column A
         - Position should be updated in the database via moveCard IPC

      IMPORTANT NOTES:
      - Import from '@atlaskit/pragmatic-drag-and-drop/element/adapter' NOT the root
      - Import combine from '@atlaskit/pragmatic-drag-and-drop/combine'
      - All setup functions return cleanup functions — return them from useEffect
      - getIsSticky: () => true is important for nested drop targets (cards inside columns)
      - The monitor's onDrop fires AFTER individual drop target handlers
      - Cards within the same column can be reordered too (same logic, different position calc)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify KanbanCard.tsx:
         - Has useRef and draggable() setup in useEffect
         - getInitialData attaches card type, cardId, sourceColumnId
         - isDragging state reduces opacity during drag
      3. Verify BoardPage.tsx:
         - Has monitorForElements setup with canMonitor and onDrop
         - Each column has dropTargetForElements with canDrop, getData, getIsSticky
         - dragOverColumnId state provides visual feedback
         - Drop handler calls moveCard with correct parameters
         - All useEffect cleanups return the cleanup functions from combine/draggable/dropTarget
      4. Verify the import paths use '/element/adapter' and '/combine' (not root)
    </verify>
    <done>
      Cards are draggable between columns via pragmatic-drag-and-drop.
      Columns highlight when a card is dragged over them.
      Dropping a card moves it to the target column and persists via moveCard IPC.
      Cards within the same column can be reordered.
      All drag state is managed with React state + useRef (no external state library needed).
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - @atlaskit/pragmatic-drag-and-drop v1.7.7 API matches the verified type definitions
      - draggable() works with React 19 refs and useEffect cleanup
      - getIsSticky prevents drop target flickering when dragging over child elements
      - monitorForElements onDrop fires after drop target onDrop handlers
      - Native browser drag events work correctly in Electron's Chromium renderer
      - combine() correctly merges multiple cleanup functions
    </assumptions>
  </task>
</phase>