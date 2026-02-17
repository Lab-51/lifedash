# Plan C.2 — Recurring Cards + DB-backed Card Templates

<phase n="C.2" name="Recurring Cards + DB-backed Card Templates">
  <context>
    Phase C: Task Management Power, features F8 (Recurring Cards) and F12 (Card Templates).
    Plan C.1 (Card Checklists) is COMPLETE.

    Current state:
    - Cards schema in src/main/db/schema/cards.ts has: id, columnId, title, description, position,
      priority, dueDate, completed, archived, createdAt, updatedAt
    - Card has a `completed` boolean — toggled via checkbox in CardDetailModal (line 483-503)
    - No recurrence columns exist on cards
    - "Apply Template" in CardDetailModal (lines 339-375) uses hardcoded CARD_TEMPLATES constant
      (5 built-in templates: bug, feature, action, note, research)
    - No card_templates DB table exists
    - Latest migration is 0009 (card_checklist_items)
    - Card update IPC: cards:update in src/main/ipc/cards.ts
    - Preload bridge pattern: domain-specific files in src/preload/domains/
    - ElectronAPI types in src/shared/types/electron-api.ts
    - Zod schemas in src/shared/validation/schemas.ts
    - Toast system: useToastStore + toast() function

    Design decisions:
    - Recurrence triggers on `completed = true` (not "done column" detection).
      Avoids needing isDoneColumn on columns table. Clear, predictable trigger point.
    - varchar for recurrenceType (not enum) — simpler migrations for future values.
    - Card templates: DB-backed table + keep 5 built-in templates as hardcoded fallback.
    - Label matching in templates by name (best-effort, skip missing labels).

    @PROJECT.md @STATE.md @SELF-IMPROVE-NEW.md
    @src/main/db/schema/cards.ts
    @src/main/ipc/cards.ts
    @src/renderer/components/CardDetailModal.tsx
    @src/renderer/components/KanbanCard.tsx
    @src/renderer/stores/boardStore.ts
    @src/shared/types/projects.ts
    @src/shared/types/cards.ts
    @src/shared/types/electron-api.ts
    @src/shared/validation/schemas.ts
    @src/preload/domains/card-details.ts
    @src/preload/domains/projects.ts
  </context>

  <task type="auto" n="1">
    <n>Schema + migration + IPC handlers for recurring cards and card templates</n>
    <files>
      src/main/db/schema/cards.ts
      src/shared/types/projects.ts
      src/shared/types/cards.ts
      src/shared/types/electron-api.ts
      src/shared/validation/schemas.ts
      src/preload/domains/card-details.ts
      src/main/ipc/cards.ts
      drizzle/ (generated migration 0010)
    </files>
    <action>
      ## Recurring Cards — Schema Changes

      **WHY:** Cards need recurrence metadata so the system can auto-create the next occurrence
      when a recurring card is marked complete. Triggering on `completed = true` is simpler and
      more reliable than "done column" detection (avoids needing isDoneColumn on columns table).

      1. Add columns to `cards` table in src/main/db/schema/cards.ts:
         - `recurrenceType` — varchar('recurrence_type', { length: 20 }), nullable.
           Values: 'daily' | 'weekly' | 'biweekly' | 'monthly' | null (no recurrence).
         - `recurrenceEndDate` — timestamp('recurrence_end_date', { withTimezone: true }), nullable.
           If set, stop generating new occurrences after this date.
         - `sourceRecurringId` — uuid('source_recurring_id'), nullable.
           Points to the original recurring card that spawned this one (for lineage tracking).
           Do NOT add a FK constraint (self-referencing FKs with cascade can be tricky).

      2. Add recurrence fields to Card interface in src/shared/types/projects.ts:
         - `recurrenceType?: string | null;`
         - `recurrenceEndDate?: string | null;`
         - `sourceRecurringId?: string | null;`

      3. Add to UpdateCardInput in src/shared/types/projects.ts:
         - `recurrenceType?: string | null;`
         - `recurrenceEndDate?: string | null;`

      4. Update `updateCardInputSchema` in src/shared/validation/schemas.ts:
         - `recurrenceType: z.enum(['daily','weekly','biweekly','monthly']).nullable().optional()`
         - `recurrenceEndDate: z.string().nullable().optional()`

      ## Card Templates — Schema

      5. Create `cardTemplates` table in src/main/db/schema/cards.ts:
         ```ts
         export const cardTemplates = pgTable('card_templates', {
           id:          uuid('id').defaultRandom().primaryKey(),
           projectId:   uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
           name:        varchar('name', { length: 200 }).notNull(),
           description: text('description'),
           priority:    cardPriorityEnum('priority').default('medium').notNull(),
           labelNames:  text('label_names'),  // JSON array of label name strings
           createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
           updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
         });
         ```
         Import `projects` from the boards schema file for the FK reference.

      6. Add CardTemplate type to src/shared/types/cards.ts:
         ```ts
         export interface CardTemplate {
           id: string;
           projectId: string | null;
           name: string;
           description: string | null;
           priority: CardPriority;
           labelNames: string[] | null;
           createdAt: string;
           updatedAt: string;
         }
         ```
         Import CardPriority from projects.ts if needed.

      7. Add Zod schemas in src/shared/validation/schemas.ts:
         ```ts
         export const createCardTemplateSchema = z.object({
           projectId: uuid.nullable().optional(),
           name: z.string().min(1).max(200),
           description: z.string().max(5000).nullable().optional(),
           priority: cardPrioritySchema.optional(),
           labelNames: z.array(z.string().max(100)).max(20).nullable().optional(),
         });
         ```

      ## Recurring Cards — Auto-Spawn Logic

      8. Create utility function `spawnRecurringCard` in src/main/ipc/cards.ts:
         - Input: the completed card's full data (including recurrenceType, dueDate, etc.)
         - Calculate next due date based on recurrenceType:
           daily → +1 day, weekly → +7 days, biweekly → +14 days, monthly → +1 month (use Date)
         - If recurrenceEndDate is set and next date exceeds it → return null (no spawn)
         - If original card had no dueDate → spawn with no dueDate (recurrence still works, just unscheduled)
         - Create new card in the SAME column with:
           title (same), description (same), priority (same), recurrenceType (same),
           recurrenceEndDate (same), sourceRecurringId (point to completed card's id),
           dueDate (calculated next date or null), completed: false, position: 0 (top of column)
         - Does NOT copy: checklist items, comments, relationships, attachments
         - Return the newly created card (or null)

      9. Hook spawn logic into `cards:update` IPC handler:
         - BEFORE the update: fetch the card's current `completed` value from DB
         - After update: if completed changed from false → true AND card has recurrenceType,
           call spawnRecurringCard
         - Return shape: `{ card: Card; spawnedCard: Card | null }`
         - IMPORTANT: This changes the IPC response contract. ALL callers of updateCard
           must be updated to destructure `{ card }` from the response.
         - Search for all usages of `window.electronAPI.updateCard` in the renderer and
           `cards:update` invocations. Update each caller.

      ## Card Templates — IPC Handlers

      10. Add IPC handlers (can go in src/main/ipc/cards.ts or a new card-templates.ts):
          - `card-templates:list` — takes optional projectId (string | undefined).
            Returns templates where projectId matches OR projectId IS NULL (global).
            Order by name ASC.
          - `card-templates:create` — validates with createCardTemplateSchema, inserts, returns.
          - `card-templates:delete` — deletes by id.
          - `card-templates:save-from-card` — takes a cardId + optional name override.
            Reads the card (join with labels), creates a template with: card's description,
            priority, and label names. Name defaults to card title.
            Returns the created template.

      ## Wiring

      11. Add to preload bridge (src/preload/domains/card-details.ts):
          - `getCardTemplates: (projectId?: string) => ipcRenderer.invoke('card-templates:list', projectId)`
          - `createCardTemplate: (input) => ipcRenderer.invoke('card-templates:create', input)`
          - `deleteCardTemplate: (id: string) => ipcRenderer.invoke('card-templates:delete', id)`
          - `saveCardAsTemplate: (cardId: string, name?: string) => ipcRenderer.invoke('card-templates:save-from-card', cardId, name)`

      12. Add to ElectronAPI interface (src/shared/types/electron-api.ts):
          - Import CardTemplate type
          - `getCardTemplates: (projectId?: string) => Promise<CardTemplate[]>`
          - `createCardTemplate: (input: { ... }) => Promise<CardTemplate>`
          - `deleteCardTemplate: (id: string) => Promise<void>`
          - `saveCardAsTemplate: (cardId: string, name?: string) => Promise<CardTemplate>`
          - Update `updateCard` return type to `Promise<{ card: Card; spawnedCard: Card | null }>`

      13. Export cardTemplates from src/main/db/schema/index.ts (if not auto-exported).

      14. Run `npx drizzle-kit generate` to create migration 0010.
          Verify the SQL adds 3 columns to cards + creates card_templates table.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx drizzle-kit generate` creates migration SQL
      3. `npx vitest run` — all 150 tests pass
      4. Verify migration SQL has: ALTER TABLE cards ADD recurrence_type, recurrence_end_date,
         source_recurring_id; CREATE TABLE card_templates
    </verify>
    <done>
      Cards table has recurrenceType, recurrenceEndDate, sourceRecurringId columns.
      card_templates table exists with CRUD IPC handlers.
      spawnRecurringCard utility creates next occurrence when card completes.
      cards:update returns { card, spawnedCard } and handles auto-spawn.
      All preload + types wired. tsc clean, tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - drizzle-kit generate works with added columns (proven pattern from 9 prior migrations)
      - varchar for recurrenceType (not enum) avoids ALTER TYPE migration complexity
      - Spawn on completed=true (not on column move) keeps it simple
      - Changing updateCard response shape requires updating all callers — manageable
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Recurring Cards UI — CardDetailModal + KanbanCard + boardStore integration</n>
    <files>
      src/renderer/components/CardDetailModal.tsx
      src/renderer/components/KanbanCard.tsx
      src/renderer/stores/boardStore.ts
    </files>
    <action>
      **WHY:** Users need to configure recurrence on cards and see which cards are recurring.
      When a recurring card is completed, the spawned card should appear on the board immediately.

      ## CardDetailModal — Recurrence Section

      1. Add a "Repeat" section between the Due Date section (line ~535) and
         ChecklistSection (line ~542). Layout:

         ```
         ┌──────────────────────────────────────────────────┐
         │ 🔄 Repeat                                       │
         │ [None ▾]  ← select dropdown                     │
         │                                                  │
         │ (when recurrence is active + due date exists:)   │
         │ Next: Wed, Feb 25, 2026                          │
         │                                                  │
         │ (when recurrence is active, no due date:)        │
         │ ⚠ Set a due date for auto-scheduling            │
         │                                                  │
         │ End repeat: [date input]  [Clear]                │
         └──────────────────────────────────────────────────┘
         ```

         - Label: "Repeat" with RefreshCw icon (lucide-react)
         - Select dropdown options: None, Daily, Weekly, Bi-weekly, Monthly
         - Auto-save on change: `onUpdate(card.id, { recurrenceType: value || null })`
         - When recurrence is set and dueDate exists, show "Next: [calculated date]"
           using the same date math as spawnRecurringCard (daily +1d, weekly +7d, etc.)
         - When recurrence is set but no dueDate, show amber hint text
         - "End repeat" date picker: only visible when recurrence != None.
           Uses datetime-local input. Clearing removes the end date.
         - When recurrence is None, only the dropdown is shown (compact).

      ## KanbanCard — Recurring Badge

      2. Add a RefreshCw icon badge in the bottom row (after checklist, before dependency):
         - Only shown when `card.recurrenceType` is truthy
         - `<RefreshCw className="w-3.5 h-3.5" />`
         - text-blue-400, with title tooltip showing recurrence type (e.g. "Repeats weekly")
         - Capitalize the type for display: "Daily", "Weekly", etc.

      ## boardStore — Handle Spawn on Complete

      3. Update boardStore.updateCard action:
         - The IPC now returns `{ card: Card; spawnedCard: Card | null }` (from Task 1)
         - Destructure the response: `const { card, spawnedCard } = await window.electronAPI.updateCard(...)`
         - Update the cards array with the updated card (existing logic)
         - If spawnedCard exists, add it to the cards array
         - Show toast: `toast({ type: 'success', message: 'Recurring card created: ${spawnedCard.title}' })`
         - Import toast from the toast store

      4. Update ALL other callers of updateCard in the renderer:
         - Search for `updateCard(` and `electronAPI.updateCard(` across all renderer files
         - Each caller now gets `{ card, spawnedCard }` — most just need `{ card }`
         - Common pattern: `const { card } = await window.electronAPI.updateCard(id, data)`
         - Key files to check: CardDetailModal (onUpdate prop), boardStore, any inline calls
         - The CardDetailModal's `onUpdate` callback in BoardPage.tsx likely wraps
           boardStore.updateCard — if so, only boardStore needs the change.

      5. When user toggles completed=true on a recurring card in CardDetailModal:
         - The boardStore handles the spawn (step 3)
         - Card detail modal stays open on the current (now-completed) card
         - User sees the toast about the new card
    </action>
    <verify>
      1. `npx tsc --noEmit` passes
      2. `npx vitest run` — all tests pass
      3. Manual: Create card → set due date → set recurrence "Weekly" → shows "Next: [+7 days]"
      4. Manual: Mark card as completed → toast shows "Recurring card created" → new card
         appears in same column with due date +7 days and recurrenceType=weekly
      5. KanbanCard shows blue RefreshCw badge on recurring cards
      6. Set recurrence without due date → amber hint shown
      7. Set end date → spawn stops after end date
      8. No duplicate spawns: marking an already-completed card as completed again doesn't spawn
    </verify>
    <done>
      CardDetailModal has Recurrence section with dropdown + end date + next occurrence preview.
      KanbanCard shows recurring badge (blue RefreshCw).
      Completing a recurring card auto-spawns next occurrence via boardStore.
      Toast confirms spawn. All callers of updateCard updated for new response shape.
      tsc clean, tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - RefreshCw icon is available in lucide-react (standard icon, verified)
      - Toast system (useToastStore/toast) available and working
      - boardStore.updateCard is the main entry point for card updates from the UI
      - Changing IPC response shape is the cleanest approach (vs separate channel)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>DB-backed Card Templates — replace hardcoded templates + Save as Template</n>
    <files>
      src/renderer/components/CardDetailModal.tsx
      src/renderer/components/BoardColumn.tsx
    </files>
    <action>
      **WHY:** The existing "Apply Template" dropdown uses 5 hardcoded templates. Users need
      to save their own templates from existing cards and access them during card creation.
      DB-backed templates make the feature useful across sessions and projects.

      ## CardDetailModal — Enhanced Template System

      1. Replace the hardcoded template dropdown with a combined list:
         - On dropdown open, fetch templates via `window.electronAPI.getCardTemplates(projectId)`
           (projectId from card → column → board → project context, already available in the modal)
         - Show two groups with a small divider label:
           "Your Templates" (DB templates, from the fetch) at the top
           "Built-in" (the existing 5 CARD_TEMPLATES: bug, feature, action, note, research) below
         - If no custom templates exist, just show "Built-in" without a group header
         - Each DB template row: name + small delete button (X) on hover
         - Clicking a DB template applies it: set description (via editor.commands.setContent),
           set priority (via onUpdate). For labelNames: fetch project labels, match by name,
           attach matching ones via attachLabel.
         - Clicking a built-in template: same behavior as current (existing code).

      2. Add "Save as Template" button:
         - Position: next to the existing "Apply Template" button (group them together)
         - Icon: BookmarkPlus from lucide-react, small button with title="Save as template"
         - On click: show a small inline name input (pre-filled with card title, max 200 chars)
           with Save/Cancel. Or use window.prompt for simplicity (matches existing patterns
           like column rename which uses inline input).
         - Calls `window.electronAPI.saveCardAsTemplate(cardId, name)`
         - On success: `toast({ type: 'success', message: 'Saved template: [name]' })`
         - Template captures: description, priority, label names from the current card

      ## BoardColumn — Template in Card Creation

      3. Enhance the "Add card" form in BoardColumn.tsx:
         - Below the title input (in the addingCard form), add a small clickable text:
           "From template ▾" (text-xs, text-surface-400, cursor-pointer)
         - Clicking opens a compact dropdown listing available templates
           (project-scoped + global, fetched via getCardTemplates)
         - Include built-in templates in the list too
         - Selecting a template: pre-fills a `selectedTemplate` state variable
         - When "Add" is clicked with a template selected:
           1. Create the card with the user's title + template's priority
           2. Then update it with the template's description
           3. Then attempt to attach matching labels
           The card title always comes from user input (not template).
         - Show a small badge next to the input when a template is selected:
           "Using: [template name]" with an X to clear selection
         - If no templates are available (no DB templates exist), hide "From template" link

      ## Cleanup

      4. Keep the CARD_TEMPLATES constant in CardDetailModal (or move to a shared constants
         file). These are the built-in defaults that always exist regardless of DB state.
         Mark them clearly with a comment: `// Built-in templates (always available)`.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes
      2. `npx vitest run` — all tests pass
      3. Manual: Open card → "Save as Template" → enter name → template saved → toast shown
      4. Manual: Open card → "Apply Template" dropdown shows "Your Templates" + "Built-in"
      5. Manual: Click a custom template → description + priority applied to card
      6. Manual: Delete a custom template via X button → removed from dropdown
      7. Manual: BoardColumn → type title → "From template" → select template →
         "Add" → card created with title + template's description/priority
      8. Built-in templates (bug, feature, etc.) still work as before
    </verify>
    <done>
      Hardcoded templates supplemented with DB-backed user templates.
      "Save as Template" button creates templates from existing cards.
      Templates available in CardDetailModal dropdown and BoardColumn creation flow.
      Built-in templates preserved as always-available defaults.
      tsc clean, tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - 5 built-in templates kept as hardcoded fallback (not migrated to DB — always available)
      - Label matching by name is best-effort (skip if label doesn't exist in target project)
      - window.electronAPI.getCardTemplates returns both project-scoped + global templates
      - BookmarkPlus icon available in lucide-react
    </assumptions>
  </task>
</phase>
