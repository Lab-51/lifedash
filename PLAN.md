# Plan 7.1: Advanced Card Features — Comments, Relationships & Activity Log

## Coverage
- **R16: Advanced Card Features** (partial) — Card comments, card relationships, activity log

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| 7.2 | R16 (UI) | Comments UI, relationships UI, card templates in CardDetailModal |
| 7.3 | R15 | Database backup/restore (pg_dump), JSON/CSV export, backup UI |
| 7.4 | R11 | Task structuring AI service — project planning, pillars, task breakdown |
| 7.5 | R11 (UI) | Task structuring UI — planning wizard, templates, milestone view |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| 7.7 | R13 | Meeting templates, analytics, speaker diarization |
| 7.8 | R17 | Notifications service, desktop/tray notifications, reminders |

## Plan 7.1 Overview

This plan adds the backend infrastructure for R16's card enhancement features:
- **Task 1**: Schema for 3 new tables (card_comments, card_relationships, card_activities)
  + 2 new enums + Drizzle migration + shared types + ElectronAPI signatures
- **Task 2**: IPC handlers for comments (4 channels), relationships (3 channels),
  activities (1 channel) + logCardActivity helper + preload bridge (8 methods)
- **Task 3**: Auto-log activity in existing card handlers + boardStore extensions
  (comments, relationships, activities state + 7 new actions)

## Architecture Decisions for Plan 7.1

1. **IPC-inline pattern for comments/relationships** — Follows existing cards.ts pattern
   (card CRUD is inline in IPC handlers, not in a separate service). Keeps related
   code together in one file. If cards.ts grows too large, extraction can happen later.

2. **logCardActivity helper** — A simple function in cards.ts that inserts an activity
   record. Called from existing card handlers (create, update, move, archive) and
   from new handlers (comment, relationship). This is a fire-and-forget insert, not
   awaited to avoid slowing down primary operations.

3. **Card relationships as directed edges** — sourceCardId → targetCardId with type
   ('blocks', 'depends_on', 'related_to'). The UI can display both directions
   (e.g., "blocks X" and "blocked by Y") by querying both sourceCardId and targetCardId.

4. **Activity details as JSON text** — The `details` column stores a JSON string with
   context-specific data (e.g., `{"from":"Todo","to":"Done"}` for moves). This avoids
   adding many nullable columns to the activities table.

---

<phase n="7.1" name="Advanced Card Features — Comments, Relationships & Activity Log">
  <context>
    Phase 7 starts with R16: Advanced Card Features. This plan builds the backend
    (schema, IPC, types, store) for comments, relationships, and activity log.
    Plan 7.2 will add the UI.

    Existing infrastructure:
    @src/main/db/schema/cards.ts — cards + cardLabels + cardPriorityEnum; columns in boards.ts
    @src/main/db/schema/index.ts — barrel exports from all schema files
    @src/main/ipc/cards.ts — 10 inline IPC handlers (cards CRUD + labels CRUD + attach/detach)
    @src/main/ipc/index.ts — registerAllHandlers() calls each feature's register function
    @src/preload/preload.ts — ~50 bridge methods grouped by feature
    @src/shared/types.ts — Card (11 fields), CreateCardInput, UpdateCardInput, ElectronAPI
    @src/renderer/stores/boardStore.ts — useBoardStore with card/column/label state + actions

    Pattern reference:
    - cards.ts IPC: inline handlers using getDb() + drizzle-orm (no separate service file)
    - ideaService.ts: separate service with helper functions (for more complex logic)
    - boardStore.ts: Zustand store with cards array, loads via window.electronAPI

    DB pattern:
    - UUID primary keys via gen_random_uuid()
    - pgEnum for constrained string types
    - Timestamps with timezone via timestamp('...', { withTimezone: true })
    - Foreign keys with cascade delete
    - drizzle-kit generate for migrations, drizzle-kit migrate to apply
  </context>

  <task type="auto" n="1">
    <n>Schema, Migration & Shared Types</n>
    <files>
      src/main/db/schema/cards.ts (add card_comments, card_relationships, card_activities tables + enums)
      src/main/db/schema/index.ts (already re-exports cards.ts, no change needed)
      src/shared/types.ts (add CardComment, CardRelationship, CardActivity types + ElectronAPI methods)
    </files>
    <preconditions>
      - Phase 6 complete, TypeScript compiles clean
      - PostgreSQL running via Docker (for migration)
      - Existing cards table with UUID id, CASCADE-ready
    </preconditions>
    <action>
      ## WHY
      R16 requires card comments, relationships, and activity tracking. These need
      database tables before any service or UI code can be built.

      ## WHAT

      ### 1. cards.ts — Add 2 new enums + 3 new tables

      Add after the existing cardLabels table definition:

      ```typescript
      // --- Card Relationships ---

      export const cardRelationshipTypeEnum = pgEnum('card_relationship_type', [
        'blocks', 'depends_on', 'related_to',
      ]);

      export const cardRelationships = pgTable('card_relationships', {
        id: uuid('id').primaryKey().defaultRandom(),
        sourceCardId: uuid('source_card_id').notNull()
          .references(() => cards.id, { onDelete: 'cascade' }),
        targetCardId: uuid('target_card_id').notNull()
          .references(() => cards.id, { onDelete: 'cascade' }),
        type: cardRelationshipTypeEnum('type').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      });

      // --- Card Comments ---

      export const cardComments = pgTable('card_comments', {
        id: uuid('id').primaryKey().defaultRandom(),
        cardId: uuid('card_id').notNull()
          .references(() => cards.id, { onDelete: 'cascade' }),
        content: text('content').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      });

      // --- Card Activity Log ---

      export const cardActivityActionEnum = pgEnum('card_activity_action', [
        'created', 'updated', 'moved', 'commented',
        'archived', 'restored', 'relationship_added', 'relationship_removed',
      ]);

      export const cardActivities = pgTable('card_activities', {
        id: uuid('id').primaryKey().defaultRandom(),
        cardId: uuid('card_id').notNull()
          .references(() => cards.id, { onDelete: 'cascade' }),
        action: cardActivityActionEnum('action').notNull(),
        details: text('details'), // JSON string with context-specific data
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      });
      ```

      Import `text` from drizzle-orm/pg-core if not already imported (check existing imports).
      The schema file already imports `pgTable`, `uuid`, `varchar`, `integer`, `boolean`,
      `timestamp`, `pgEnum` — verify and add `text` if missing.

      ### 2. Generate and apply migration

      Run:
      ```bash
      npx drizzle-kit generate
      npx drizzle-kit migrate
      ```

      This creates a new SQL migration file in the `drizzle/` folder. Verify the migration
      creates the 2 enums and 3 tables with correct foreign keys.

      ### 3. types.ts — Add shared types

      Add after existing Card-related types:

      ```typescript
      // --- Advanced Card Types (R16) ---

      export type CardRelationshipType = 'blocks' | 'depends_on' | 'related_to';

      export interface CardComment {
        id: string;
        cardId: string;
        content: string;
        createdAt: string;
        updatedAt: string;
      }

      export interface CardRelationship {
        id: string;
        sourceCardId: string;
        targetCardId: string;
        type: CardRelationshipType;
        createdAt: string;
        // Joined titles for display
        sourceCardTitle?: string;
        targetCardTitle?: string;
      }

      export type CardActivityAction =
        | 'created' | 'updated' | 'moved' | 'commented'
        | 'archived' | 'restored' | 'relationship_added' | 'relationship_removed';

      export interface CardActivity {
        id: string;
        cardId: string;
        action: CardActivityAction;
        details: string | null;
        createdAt: string;
      }

      // Input types
      export interface CreateCardCommentInput {
        cardId: string;
        content: string;
      }

      export interface CreateCardRelationshipInput {
        sourceCardId: string;
        targetCardId: string;
        type: CardRelationshipType;
      }
      ```

      Add to ElectronAPI interface (after existing card methods):
      ```typescript
      // Card comments
      getCardComments: (cardId: string) => Promise<CardComment[]>;
      addCardComment: (input: CreateCardCommentInput) => Promise<CardComment>;
      updateCardComment: (id: string, content: string) => Promise<CardComment>;
      deleteCardComment: (id: string) => Promise<void>;
      // Card relationships
      getCardRelationships: (cardId: string) => Promise<CardRelationship[]>;
      addCardRelationship: (input: CreateCardRelationshipInput) => Promise<CardRelationship>;
      deleteCardRelationship: (id: string) => Promise<void>;
      // Card activity log
      getCardActivities: (cardId: string) => Promise<CardActivity[]>;
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. Migration file exists in drizzle/ folder with correct CREATE TYPE and CREATE TABLE
      3. Migration applied successfully (drizzle-kit migrate completes)
      4. Schema exports: cardComments, cardRelationships, cardActivities, cardRelationshipTypeEnum, cardActivityActionEnum
      5. types.ts exports: CardComment, CardRelationship, CardActivity, CardActivityAction, CardRelationshipType, CreateCardCommentInput, CreateCardRelationshipInput
      6. ElectronAPI has 8 new method signatures
    </verify>
    <done>
      3 new tables (card_comments, card_relationships, card_activities) + 2 enums created
      and migrated. Shared types and ElectronAPI signatures defined. TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - drizzle-orm/pg-core exports `text` (standard, used in other schema files like meetings.ts)
      - pgEnum values are string arrays (same pattern as existing enums)
      - UUID references with cascade delete work for self-referencing cards table
      - drizzle-kit generate/migrate work with Docker PostgreSQL running
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>IPC Handlers, Preload Bridge & Activity Logger</n>
    <files>
      src/main/ipc/cards.ts (add 8 new IPC handlers + logCardActivity helper)
      src/preload/preload.ts (add 8 bridge methods)
    </files>
    <preconditions>
      - Task 1 complete (schema tables exist, types defined)
      - Migration applied (tables available in database)
    </preconditions>
    <action>
      ## WHY
      The schema and types from Task 1 need IPC handlers so the renderer can interact
      with comments, relationships, and activities. The logCardActivity helper enables
      auto-logging in Task 3.

      ## WHAT

      ### 1. cards.ts — Add logCardActivity helper

      Add at the top of registerCardHandlers (or as a module-level function):

      ```typescript
      /**
       * Fire-and-forget activity log insertion.
       * Does not throw — activity logging should never break primary operations.
       */
      function logCardActivity(
        cardId: string,
        action: string,
        details?: Record<string, unknown>,
      ): void {
        const db = getDb();
        db.insert(cardActivities)
          .values({
            cardId,
            action: action as typeof cardActivityActionEnum.enumValues[number],
            details: details ? JSON.stringify(details) : null,
          })
          .catch((err) => console.error('Activity log error:', err));
      }
      ```

      Add `cardComments`, `cardRelationships`, `cardActivities`, `cardActivityActionEnum`
      to the schema import at the top of the file. Also add `desc` to the drizzle-orm import.

      ### 2. cards.ts — Add comment handlers (4 channels)

      Inside registerCardHandlers(), after the existing label handlers:

      ```typescript
      // --- Card Comments ---

      ipcMain.handle('card:getComments', async (_event, cardId: string) => {
        const db = getDb();
        const rows = await db.select().from(cardComments)
          .where(eq(cardComments.cardId, cardId))
          .orderBy(desc(cardComments.createdAt));
        return rows;
      });

      ipcMain.handle('card:addComment', async (_event, input: { cardId: string; content: string }) => {
        const db = getDb();
        const [comment] = await db.insert(cardComments)
          .values({ cardId: input.cardId, content: input.content })
          .returning();
        logCardActivity(input.cardId, 'commented', { commentId: comment.id });
        return comment;
      });

      ipcMain.handle('card:updateComment', async (_event, id: string, content: string) => {
        const db = getDb();
        const [comment] = await db.update(cardComments)
          .set({ content, updatedAt: new Date() })
          .where(eq(cardComments.id, id))
          .returning();
        return comment;
      });

      ipcMain.handle('card:deleteComment', async (_event, id: string) => {
        const db = getDb();
        await db.delete(cardComments).where(eq(cardComments.id, id));
      });
      ```

      ### 3. cards.ts — Add relationship handlers (3 channels)

      ```typescript
      // --- Card Relationships ---

      ipcMain.handle('card:getRelationships', async (_event, cardId: string) => {
        const db = getDb();
        // Get relationships where this card is source or target
        const asSource = await db.select().from(cardRelationships)
          .where(eq(cardRelationships.sourceCardId, cardId));
        const asTarget = await db.select().from(cardRelationships)
          .where(eq(cardRelationships.targetCardId, cardId));

        // Enrich with card titles
        const all = [...asSource, ...asTarget];
        const enriched = [];
        for (const rel of all) {
          const [sourceCard] = await db.select({ title: cards.title })
            .from(cards).where(eq(cards.id, rel.sourceCardId));
          const [targetCard] = await db.select({ title: cards.title })
            .from(cards).where(eq(cards.id, rel.targetCardId));
          enriched.push({
            ...rel,
            sourceCardTitle: sourceCard?.title ?? 'Unknown',
            targetCardTitle: targetCard?.title ?? 'Unknown',
          });
        }
        return enriched;
      });

      ipcMain.handle('card:addRelationship', async (_event, input: {
        sourceCardId: string; targetCardId: string; type: string;
      }) => {
        const db = getDb();
        const [rel] = await db.insert(cardRelationships)
          .values({
            sourceCardId: input.sourceCardId,
            targetCardId: input.targetCardId,
            type: input.type as typeof cardRelationshipTypeEnum.enumValues[number],
          })
          .returning();
        logCardActivity(input.sourceCardId, 'relationship_added', {
          targetCardId: input.targetCardId, type: input.type,
        });
        return rel;
      });

      ipcMain.handle('card:deleteRelationship', async (_event, id: string) => {
        const db = getDb();
        // Get the relationship first for activity logging
        const [rel] = await db.select().from(cardRelationships)
          .where(eq(cardRelationships.id, id));
        await db.delete(cardRelationships).where(eq(cardRelationships.id, id));
        if (rel) {
          logCardActivity(rel.sourceCardId, 'relationship_removed', {
            targetCardId: rel.targetCardId, type: rel.type,
          });
        }
      });
      ```

      ### 4. cards.ts — Add activity handler (1 channel)

      ```typescript
      // --- Card Activities ---

      ipcMain.handle('card:getActivities', async (_event, cardId: string) => {
        const db = getDb();
        return db.select().from(cardActivities)
          .where(eq(cardActivities.cardId, cardId))
          .orderBy(desc(cardActivities.createdAt))
          .limit(50);
      });
      ```

      ### 5. preload.ts — Add 8 bridge methods

      Add to the Cards section (or create a new "Card Details" subsection):
      ```typescript
      // Card comments
      getCardComments: (cardId: string) => ipcRenderer.invoke('card:getComments', cardId),
      addCardComment: (input: { cardId: string; content: string }) =>
        ipcRenderer.invoke('card:addComment', input),
      updateCardComment: (id: string, content: string) =>
        ipcRenderer.invoke('card:updateComment', id, content),
      deleteCardComment: (id: string) => ipcRenderer.invoke('card:deleteComment', id),
      // Card relationships
      getCardRelationships: (cardId: string) =>
        ipcRenderer.invoke('card:getRelationships', cardId),
      addCardRelationship: (input: { sourceCardId: string; targetCardId: string; type: string }) =>
        ipcRenderer.invoke('card:addRelationship', input),
      deleteCardRelationship: (id: string) =>
        ipcRenderer.invoke('card:deleteRelationship', id),
      // Card activities
      getCardActivities: (cardId: string) => ipcRenderer.invoke('card:getActivities', cardId),
      ```

      ### 6. Update cards.ts file header

      Update LIMITATIONS comment:
      ```
      // === LIMITATIONS ===
      // - cards:list-by-board fetches labels per card in a loop (N+1 queries)
      // - card:getRelationships fetches titles per relationship (N+1, acceptable for small counts)
      // - card:getActivities limited to most recent 50 entries
      // - No pagination on list queries yet
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. 8 new IPC handlers registered: card:getComments, card:addComment, card:updateComment,
         card:deleteComment, card:getRelationships, card:addRelationship, card:deleteRelationship,
         card:getActivities
      3. logCardActivity helper exists and is fire-and-forget (uses .catch, not await)
      4. card:addComment calls logCardActivity('commented')
      5. card:addRelationship calls logCardActivity('relationship_added')
      6. card:deleteRelationship calls logCardActivity('relationship_removed')
      7. card:getRelationships returns both source and target relationships with enriched titles
      8. card:getActivities limits to 50 entries, ordered by createdAt desc
      9. Preload bridge has 8 new methods matching the ElectronAPI signatures
    </verify>
    <done>
      8 IPC handlers for comments/relationships/activities + logCardActivity helper +
      8 preload bridge methods. TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - drizzle-orm `desc` is importable (already used in other files like brainstormService)
      - The cardRelationshipTypeEnum.enumValues pattern works for type casting (same as other enums)
      - fire-and-forget .catch() pattern is acceptable for activity logging (non-critical)
      - N+1 queries in getRelationships are acceptable (typically &lt;10 relationships per card)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Activity Auto-Logging + boardStore Extensions</n>
    <files>
      src/main/ipc/cards.ts (add logCardActivity calls to existing handlers)
      src/renderer/stores/boardStore.ts (add comments, relationships, activities state + actions)
    </files>
    <preconditions>
      - Task 2 complete (logCardActivity helper exists, IPC handlers work)
      - boardStore.ts exists with card/column state
    </preconditions>
    <action>
      ## WHY
      Activity auto-logging makes the activity log useful without manual effort — every
      card create, update, move, and archive automatically gets logged. The boardStore
      extensions let the renderer load and manage comments/relationships/activities.

      ## WHAT

      ### 1. cards.ts — Wire logCardActivity into existing handlers

      Modify existing handlers to call logCardActivity. These are small additions.

      **cards:create** — After the insert, add:
      ```typescript
      logCardActivity(card.id, 'created', { title: data.title });
      ```

      **cards:update** — After the update, add:
      ```typescript
      // Log 'archived' or 'restored' if archived field changed, otherwise 'updated'
      if (data.archived === true) {
        logCardActivity(id, 'archived');
      } else if (data.archived === false) {
        logCardActivity(id, 'restored');
      } else {
        logCardActivity(id, 'updated', {
          fields: Object.keys(data).filter(k => k !== 'updatedAt'),
        });
      }
      ```

      **cards:move** — After the update, add:
      ```typescript
      logCardActivity(id, 'moved', { columnId, position });
      ```

      **cards:delete** — Before the delete (so we still have the cardId), add:
      ```typescript
      // Note: Activities cascade-delete with the card, so this is for
      // completeness. If we ever soft-delete, these logs will persist.
      ```
      (Actually, skip logging for delete since activities cascade-delete with the card.)

      ### 2. boardStore.ts — Add comments, relationships, activities state + actions

      Add to the import section:
      ```typescript
      import type {
        // ... existing imports
        CardComment,
        CardRelationship,
        CardActivity,
        CreateCardCommentInput,
        CreateCardRelationshipInput,
      } from '../../shared/types';
      ```

      Add to the BoardStore interface:
      ```typescript
      // Card detail state (loaded when viewing a specific card)
      selectedCardComments: CardComment[];
      selectedCardRelationships: CardRelationship[];
      selectedCardActivities: CardActivity[];
      loadingCardDetails: boolean;

      // Card detail actions
      loadCardDetails: (cardId: string) => Promise<void>;
      clearCardDetails: () => void;
      addComment: (input: CreateCardCommentInput) => Promise<void>;
      updateComment: (id: string, content: string) => Promise<void>;
      deleteComment: (id: string) => Promise<void>;
      addRelationship: (input: CreateCardRelationshipInput) => Promise<void>;
      deleteRelationship: (id: string) => Promise<void>;
      ```

      Add initial state:
      ```typescript
      selectedCardComments: [],
      selectedCardRelationships: [],
      selectedCardActivities: [],
      loadingCardDetails: false,
      ```

      Add actions:
      ```typescript
      loadCardDetails: async (cardId: string) => {
        set({ loadingCardDetails: true });
        try {
          const [comments, relationships, activities] = await Promise.all([
            window.electronAPI.getCardComments(cardId),
            window.electronAPI.getCardRelationships(cardId),
            window.electronAPI.getCardActivities(cardId),
          ]);
          set({
            selectedCardComments: comments,
            selectedCardRelationships: relationships,
            selectedCardActivities: activities,
            loadingCardDetails: false,
          });
        } catch (error) {
          console.error('Failed to load card details:', error);
          set({ loadingCardDetails: false });
        }
      },

      clearCardDetails: () => set({
        selectedCardComments: [],
        selectedCardRelationships: [],
        selectedCardActivities: [],
      }),

      addComment: async (input: CreateCardCommentInput) => {
        const comment = await window.electronAPI.addCardComment(input);
        set({
          selectedCardComments: [comment, ...get().selectedCardComments],
        });
      },

      updateComment: async (id: string, content: string) => {
        const updated = await window.electronAPI.updateCardComment(id, content);
        set({
          selectedCardComments: get().selectedCardComments.map(
            c => c.id === id ? updated : c,
          ),
        });
      },

      deleteComment: async (id: string) => {
        await window.electronAPI.deleteCardComment(id);
        set({
          selectedCardComments: get().selectedCardComments.filter(c => c.id !== id),
        });
      },

      addRelationship: async (input: CreateCardRelationshipInput) => {
        const rel = await window.electronAPI.addCardRelationship(input);
        set({
          selectedCardRelationships: [...get().selectedCardRelationships, rel],
        });
      },

      deleteRelationship: async (id: string) => {
        await window.electronAPI.deleteCardRelationship(id);
        set({
          selectedCardRelationships: get().selectedCardRelationships.filter(r => r.id !== id),
        });
      },
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. cards:create handler calls logCardActivity('created')
      3. cards:update handler calls logCardActivity('archived'/'restored'/'updated') based on data
      4. cards:move handler calls logCardActivity('moved')
      5. boardStore has selectedCardComments/Relationships/Activities state
      6. loadCardDetails uses Promise.all to fetch comments, relationships, activities in parallel
      7. clearCardDetails resets all three arrays
      8. addComment prepends new comment to list (newest first)
      9. addRelationship appends to relationships list
      10. deleteComment and deleteRelationship filter from local state
    </verify>
    <done>
      Activity auto-logging wired into card create/update/move handlers. boardStore
      extended with card details state (comments, relationships, activities) + 7 new
      actions. TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - data.archived is a boolean field in UpdateCardInput (verified: cards.ts line 101 checks data.dueDate !== undefined, similar pattern)
      - Object.keys(data) returns meaningful field names for the 'updated' activity log
      - Promise.all for loading card details is safe (all 3 queries are independent)
      - Comments ordered newest-first (desc) matches UI expectation (newest on top)
      - 50-entry limit on activities is sufficient for most cards
    </assumptions>
  </task>
</phase>
