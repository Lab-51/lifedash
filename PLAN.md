# Plan C.1 — Card Checklists / Subtasks (Phase C: Task Management Power)

<phase n="C.1" name="Card Checklists / Subtasks">
  <context>
    Phase C from SELF-IMPROVE-NEW.md: Card Checklists (F4), Recurring Cards (F8),
    Card Templates (F12), Focus Mode (E2). This plan covers F4 only — the highest
    priority Phase C feature.

    Phase A complete: Pin/Star, AI Card Descriptions, Quick Capture, Standup, Pulse.
    Phase B complete: Splash Screen, Transcript Search, Meeting Export, AI Usage Dashboard.

    Card checklists add persistent subtask lists to cards. Items can be added, checked,
    reordered, and deleted. KanbanCard shows progress badge ("3/7"). AI task breakdown
    (TaskBreakdownSection) can populate checklists with one click.

    **Architecture pattern (from codebase exploration):**
    The checklist follows the exact child-entity pattern used by cardComments,
    cardActivities, and cardAttachments:
    1. DB table with cardId FK + cascade delete → schema/cards.ts
    2. IPC handlers for CRUD → ipc/cards.ts
    3. Preload bridge → preload/domains/card-details.ts
    4. Store slice → stores/cardDetailStore.ts (loaded via loadCardDetails)
    5. Section component → components/ChecklistSection.tsx → rendered in CardDetailModal

    **Single-table design:** One `card_checklist_items` table (not two tables).
    Each card has one flat checklist. This keeps the schema simple and matches the
    feature description. If named checklists are needed later, add a `checklistName`
    grouping field.

    @PROJECT.md @STATE.md @SELF-IMPROVE-NEW.md
    @src/main/db/schema/cards.ts (cards, cardComments, cardActivities, cardAttachments tables)
    @src/main/db/schema/index.ts (re-exports all schema)
    @src/main/ipc/cards.ts (card CRUD + child entity handlers)
    @src/preload/domains/card-details.ts (comments, relationships, activities, attachments bridge)
    @src/shared/types/projects.ts (Card, CardComment, CardAttachment types)
    @src/shared/types/electron-api.ts (ElectronAPI interface)
    @src/shared/validation/schemas.ts (Zod validation schemas)
    @src/renderer/stores/cardDetailStore.ts (selectedCard*, loadCardDetails, clearCardDetails)
    @src/renderer/components/CardDetailModal.tsx (sections: Attachments, Comments, Relationships, Activity, TaskBreakdown)
    @src/renderer/components/KanbanCard.tsx (badges: labels, due date, dependency count)
    @src/renderer/components/TaskBreakdownSection.tsx (AI breakdown → creates cards in column)
    @src/renderer/stores/boardStore.ts (cards state, cards:list-by-board fetching)
    @drizzle.config.ts (migration output dir)
    @drizzle/meta/_journal.json (9 migrations: 0000-0008)
  </context>

  <task type="auto" n="1">
    <n>Schema, migration, IPC handlers, and preload bridge for checklist items</n>
    <files>
      src/main/db/schema/cards.ts
      src/main/db/schema/index.ts
      src/main/ipc/cards.ts
      src/preload/domains/card-details.ts
      src/shared/types/projects.ts
      src/shared/types/electron-api.ts
      src/shared/validation/schemas.ts
      drizzle/ (generated migration)
    </files>
    <action>
      Create the data layer for card checklist items. This follows the exact pattern
      used by cardComments and cardAttachments — a child table with cascading delete.

      **1. Schema (src/main/db/schema/cards.ts):**
      Add `cardChecklistItems` table after the existing cardAttachments table:
      ```ts
      export const cardChecklistItems = pgTable('card_checklist_items', {
        id:        uuid('id').defaultRandom().primaryKey(),
        cardId:    uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
        title:     varchar('title', { length: 500 }).notNull(),
        completed: boolean('completed').default(false).notNull(),
        position:  integer('position').default(0).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
      });
      ```

      **2. Schema index (src/main/db/schema/index.ts):**
      Export `cardChecklistItems` from the barrel file (it may auto-export if using `export *`).

      **3. TypeScript types (src/shared/types/projects.ts):**
      Add interface:
      ```ts
      export interface CardChecklistItem {
        id: string;
        cardId: string;
        title: string;
        completed: boolean;
        position: number;
        createdAt: string;
      }
      ```

      **4. Validation schemas (src/shared/validation/schemas.ts):**
      Add Zod schemas:
      ```ts
      export const addChecklistItemSchema = z.object({
        cardId: uuid,
        title: z.string().min(1).max(500),
      });

      export const updateChecklistItemSchema = z.object({
        id: uuid,
        title: z.string().min(1).max(500).optional(),
        completed: z.boolean().optional(),
      });

      export const reorderChecklistItemsSchema = z.object({
        cardId: uuid,
        itemIds: z.array(uuid),  // ordered list of IDs in new position order
      });
      ```

      **5. IPC handlers (src/main/ipc/cards.ts):**
      Add 5 new handlers following the exact cardComments pattern:

      a) `card:getChecklistItems` — SELECT where cardId, ORDER BY position ASC
      b) `card:addChecklistItem` — INSERT with position = count of existing items
         (same pattern as cards:create position computation)
      c) `card:updateChecklistItem` — UPDATE title and/or completed by item ID
      d) `card:deleteChecklistItem` — DELETE by item ID
      e) `card:reorderChecklistItems` — Accept array of item IDs in new order,
         UPDATE position for each. Use a transaction:
         ```ts
         await db.transaction(async (tx) => {
           for (let i = 0; i < itemIds.length; i++) {
             await tx.update(cardChecklistItems)
               .set({ position: i })
               .where(eq(cardChecklistItems.id, itemIds[i]));
           }
         });
         ```

      Also add a **batch add** handler for TaskBreakdown integration:
      f) `card:addChecklistItemsBatch` — Accept cardId + array of title strings.
         Insert all with sequential positions starting from current max position.
         Validation: `z.object({ cardId: uuid, titles: z.array(z.string().min(1).max(500)).min(1).max(50) })`

      **6. Preload bridge (src/preload/domains/card-details.ts):**
      Expose all 6 new methods following the existing pattern (ipcRenderer.invoke).

      **7. ElectronAPI interface (src/shared/types/electron-api.ts):**
      Add all 6 method signatures to the ElectronAPI interface.

      **8. Generate migration:**
      Run `npm run db:generate` (drizzle-kit generate) to create the migration file.
      Verify the generated SQL creates the `card_checklist_items` table with the
      correct FK constraint and cascade delete.

      WHY: The data layer must exist before the UI can be built. Following the
      exact child-entity pattern (comments, attachments) ensures consistency and
      reduces implementation risk.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes — all types and IPC signatures compile
      2. `npx vitest run` — all 150 existing tests still pass
      3. Migration file exists in drizzle/ directory with correct CREATE TABLE SQL
      4. Schema exports cardChecklistItems from index.ts
      5. All 6 IPC handlers are registered (grep for "card:getChecklistItems" etc.)
      6. Preload bridge exposes all 6 methods
      7. ElectronAPI interface includes all 6 method signatures
    </verify>
    <done>
      card_checklist_items table defined in schema with migration generated.
      6 IPC handlers (get, add, update, delete, reorder, batch-add) registered.
      Preload bridge and ElectronAPI types updated. TypeScript compiles, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - PGlite supports transactions (standard PostgreSQL feature, used elsewhere in codebase)
      - Single flat checklist per card is sufficient (no named sub-checklists)
      - drizzle-kit generate will create the correct migration from the schema diff
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>ChecklistSection UI component in CardDetailModal</n>
    <files>
      src/renderer/stores/cardDetailStore.ts
      src/renderer/components/ChecklistSection.tsx (new)
      src/renderer/components/CardDetailModal.tsx
    </files>
    <action>
      Build the interactive checklist UI and wire it into the card detail view.
      This is the primary user-facing feature — add, check, edit, reorder, delete items.

      **1. Store slice (src/renderer/stores/cardDetailStore.ts):**
      Add to the store state:
      ```ts
      selectedCardChecklistItems: CardChecklistItem[];
      ```

      Add actions:
      ```ts
      loadChecklistItems: (cardId: string) => Promise<void>;
      addChecklistItem: (cardId: string, title: string) => Promise<void>;
      updateChecklistItem: (id: string, updates: { title?: string; completed?: boolean }) => Promise<void>;
      deleteChecklistItem: (id: string) => Promise<void>;
      reorderChecklistItems: (cardId: string, itemIds: string[]) => Promise<void>;
      ```

      Wire `loadChecklistItems` into the existing `loadCardDetails` function
      (add to the Promise.all/Promise.allSettled array). Wire cleanup into
      `clearCardDetails` (set to empty array).

      Each action is optimistic: update local state first, then call IPC.
      On failure, reload from server (call loadChecklistItems again).

      **2. ChecklistSection component (new file):**
      Create `src/renderer/components/ChecklistSection.tsx`:

      Props: `{ cardId: string }`

      Layout:
      ```
      ┌──────────────────────────────────────┐
      │ ☑ Checklist                    2/5   │  ← header with count
      ├──────────────────────────────────────┤
      │ [✓] Completed item (strikethrough)   │  ← checked items
      │ [ ] Pending item                  ✕  │  ← unchecked items with delete
      │ [ ] Another pending item          ✕  │
      │                                      │
      │ [+ Add an item...              ]     │  ← input at bottom
      └──────────────────────────────────────┘
      ```

      Features:
      a) **Header:** CheckSquare icon + "Checklist" label + "N/M" count badge.
         Show a thin progress bar under the header (emerald-500 fill, proportional width).

      b) **Items list:** Map over selectedCardChecklistItems (sorted by position).
         Each item row has:
         - Checkbox (checked = completed). Toggle calls updateChecklistItem.
         - Title text. Completed items show line-through + text-slate-400.
         - Click title to edit inline (same pattern as column rename: click → input,
           Enter/blur saves, Escape cancels). Call updateChecklistItem with new title.
         - X button on hover to delete (calls deleteChecklistItem).
         - Drag handle (GripVertical icon) for reordering.

      c) **Drag reorder:** Use pragmatic-drag-and-drop (already in the project) for
         item reordering. On drop, compute new item order and call reorderChecklistItems.
         Follow the pattern from KanbanCard/BoardColumn drag setup.

      d) **Add input:** Text input at the bottom. Enter adds item (calls addChecklistItem).
         Clear input after successful add. Auto-focus stays on input for rapid entry
         (user can type → Enter → type → Enter for quick batch creation).

      e) **Empty state:** When no items, show just the add input with placeholder
         "Add a checklist item..." and a subtle hint text.

      Styling: Match existing section styles (CommentsSection, AttachmentsSection).
      Use slate-700/slate-600 borders, rounded-lg containers, hover states.

      **3. CardDetailModal integration:**
      Import ChecklistSection. Render it BEFORE AttachmentsSection (after the
      description/TipTap editor area, before the other sections). This puts checklists
      in a prominent position since they're the most interactive section.

      Position in render order: Description → **Checklist** → Attachments → Comments →
      Relationships → Activity → TaskBreakdown.

      WHY: Checklists are the most-interacted-with card feature in tools like Trello.
      Placing them prominently and making them fast to use (rapid entry, inline edit,
      one-click check) maximizes adoption.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes
      2. `npx vitest run` — all existing tests pass
      3. Manual: open a card detail → see empty Checklist section with add input
      4. Add 3 items rapidly (type → Enter × 3) — items appear in order
      5. Check/uncheck items — line-through toggles, count updates
      6. Click title to edit inline — Enter saves, Escape cancels
      7. Hover item → X button appears → click deletes item
      8. Drag items to reorder — new order persists after closing and reopening card
      9. Close and reopen card — checklist items reload correctly
    </verify>
    <done>
      ChecklistSection component renders in CardDetailModal with full CRUD:
      add items, check/uncheck, inline title edit, delete, drag-to-reorder.
      Progress bar and count badge in header. TypeScript compiles, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - pragmatic-drag-and-drop works for list reordering (same lib used for card drag)
      - Inline edit pattern (click → input → Enter/blur) matches existing column rename UX
      - Optimistic updates provide instant feedback; IPC calls happen in background
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>KanbanCard checklist badge and TaskBreakdown checklist integration</n>
    <files>
      src/main/ipc/cards.ts
      src/shared/types/projects.ts
      src/renderer/components/KanbanCard.tsx
      src/renderer/stores/boardStore.ts
      src/renderer/components/TaskBreakdownSection.tsx
    </files>
    <action>
      Add checklist progress visibility on the board and connect AI task breakdown
      to checklists. These are the two integration points that make checklists powerful.

      **Part A: KanbanCard checklist progress badge**

      1. **Extend board card query (src/main/ipc/cards.ts):**
         In the `cards:list-by-board` handler, add a subquery or post-fetch query
         to get checklist progress for each card. Two approaches:

         Option A (recommended — single extra query): After fetching cards, run one
         batch query:
         ```ts
         const checklistCounts = await db
           .select({
             cardId: cardChecklistItems.cardId,
             total: count(),
             done: count(sql`CASE WHEN ${cardChecklistItems.completed} THEN 1 END`),
           })
           .from(cardChecklistItems)
           .where(inArray(cardChecklistItems.cardId, cardIds))
           .groupBy(cardChecklistItems.cardId);
         ```
         Merge counts into the card objects before returning.

         Option B (per-card subquery): Less efficient but simpler.

         Use Option A. Add `checklistTotal` and `checklistDone` to the returned
         card objects (default 0 for cards without checklists).

      2. **Extend Card type (src/shared/types/projects.ts):**
         Add optional fields to the Card interface:
         ```ts
         checklistTotal?: number;
         checklistDone?: number;
         ```
         Optional so existing code that creates Card objects doesn't break.

      3. **KanbanCard badge (src/renderer/components/KanbanCard.tsx):**
         In the bottom badge row (alongside labels, due date, dependency count),
         add a checklist progress indicator when `card.checklistTotal > 0`:

         ```tsx
         {card.checklistTotal > 0 && (
           <span className="flex items-center gap-1 text-xs text-slate-400"
                 title={`${card.checklistDone}/${card.checklistTotal} completed`}>
             <CheckSquare className="w-3.5 h-3.5" />
             <span className={card.checklistDone === card.checklistTotal
               ? 'text-emerald-400' : ''}>
               {card.checklistDone}/{card.checklistTotal}
             </span>
           </span>
         )}
         ```

         Position: after the due date badge, before the dependency badge.
         When all items are complete (done === total), show in emerald-400.

      4. **Refresh board after checklist changes (src/renderer/stores/boardStore.ts):**
         The boardStore fetches cards via `cards:list-by-board`. When checklist items
         change in the CardDetailModal, the board badges need to refresh. Add a
         `refreshBoardCards` action that re-fetches cards for the current board,
         or call existing `loadBoardData` after closing CardDetailModal.

         Simplest approach: in cardDetailStore's `updateChecklistItem` and
         `deleteChecklistItem` actions, after the IPC call, also call
         `boardStore.getState().loadBoardCards(boardId)` to refresh badge counts.
         BUT: this requires knowing the boardId from the checklist context.

         Better approach: when CardDetailModal closes (in BoardPage), call
         `loadCards(boardId)` to refresh. This already happens for comments
         and other changes — verify and reuse the pattern.

      **Part B: TaskBreakdown → Checklist integration**

      5. **TaskBreakdownSection (src/renderer/components/TaskBreakdownSection.tsx):**
         Currently, when the user clicks "Apply" on selected breakdown subtasks,
         it creates new Kanban cards in the same column (lines 88-122).

         Add a second action button: "Add to Checklist" (ListChecks icon).
         This button:
         - Calls `window.electronAPI.addChecklistItemsBatch(cardId, titles)` where
           titles is the array of selected subtask titles
         - Then calls `cardDetailStore.getState().loadChecklistItems(cardId)` to
           refresh the checklist section
         - Shows a toast: "Added N items to checklist"

         The "Apply" button remains for creating full cards. Label it "Create as Cards"
         to distinguish from "Add to Checklist". Both buttons sit side by side.
         Only show "Add to Checklist" when breakdown has results.

         This closes the loop: AI generates a task breakdown → user reviews →
         one click adds all subtasks as trackable checklist items on the current card.

      WHY: Checklist progress on KanbanCard gives at-a-glance visibility without
      opening each card. TaskBreakdown integration makes AI-generated subtasks
      actionable instead of throwaway suggestions.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes
      2. `npx vitest run` — all existing tests pass
      3. Manual: add checklist items to a card → close card detail → KanbanCard
         shows "2/5" badge (or whatever the actual counts are)
      4. Complete all checklist items → badge turns emerald green ("5/5")
      5. Card with no checklist items → no badge shown
      6. Run AI task breakdown on a card → click "Add to Checklist" → items
         appear in the ChecklistSection
      7. "Create as Cards" button still works (existing behavior preserved)
      8. Verify board refreshes correctly when checklist changes are made
    </verify>
    <done>
      KanbanCard shows "N/M" checklist progress badge with emerald highlight when
      all items are complete. TaskBreakdownSection has "Add to Checklist" button
      that batch-adds AI subtasks as checklist items. TypeScript compiles, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - PGlite supports conditional COUNT (CASE WHEN ... THEN 1 END) — standard SQL
      - Batch checklist query per board is efficient enough (one extra query per board load)
      - Board card refresh on modal close is sufficient (no real-time badge updates needed)
      - "Add to Checklist" and "Create as Cards" are clear enough labels for users
    </assumptions>
  </task>

</phase>
