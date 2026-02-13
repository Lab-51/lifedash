# Phase 6 — Plan 1 of 3: Idea Repository — Service, Store & UI

## Coverage
- **R12: Idea Repository** (5 pts) — idea capture, tagging, status management, effort/impact, convert to project/card

## Plan Overview
Phase 6 covers R10 (AI Brainstorming Agent, 8 pts) + R12 (Idea Repository, 5 pts).

Plan 6.1 delivers the full Idea Repository feature — backend through UI:
- **Task 1**: Shared types + ideaService.ts + IPC handlers + preload bridge
- **Task 2**: ideaStore.ts (Zustand) + IdeasPage.tsx (grid, quick-add, filters, search)
- **Task 3**: IdeaDetailModal.tsx (edit all fields, tags editor, convert to project/card)

## Architecture Decisions for Plan 6.1

1. **Ideas schema already exists** — `ideas` + `idea_tags` tables were created in Phase 1.
   No new schema files or migrations needed.

2. **Tags managed through service** — createIdea/updateIdea accept a `tags: string[]` parameter.
   The service handles the junction table (delete-all + re-insert pattern) rather than
   exposing add/remove tag IPC calls. Simpler API surface.

3. **Convert to Project** — Creates a new project with idea title/description, then links idea
   to project via projectId. Marks idea status as 'active'.

4. **Convert to Card** — Uses the same project → board → column selection wizard pattern from
   ConvertActionModal (Phase 5). Creates a card in the selected column with idea title/description.
   Marks idea status as 'active'.

5. **No AI in this plan** — AI-assisted idea analysis (feasibility/effort/impact scoring) is
   deferred to Plan 6.3. This plan delivers the manual repository management.

---

<phase n="6.1" name="Idea Repository — Service, Store & UI">
  <context>
    Phase 5 is complete. The ideas table and idea_tags junction table already exist in the schema:

    Schema (src/main/db/schema/ideas.ts):
    - ideas: id, projectId (FK→projects, nullable), title, description, status (enum: new|exploring|active|archived),
      effort (enum: trivial|small|medium|large|epic, nullable), impact (enum: minimal|low|medium|high|critical, nullable),
      createdAt, updatedAt
    - idea_tags: ideaId (FK→ideas), tag (varchar 100) — composite PK on (ideaId, tag)

    Enum names in schema: ideaStatusEnum('idea_status'), effortEnum('effort_level'), impactEnum('impact_level')

    Existing patterns to follow:
    - meetingIntelligenceService.ts: row mapper pattern (Drizzle $inferSelect → serialized types)
    - meetingService.ts: CRUD pattern (getAll, getById, create, update, delete)
    - meeting-intelligence.ts IPC handler pattern: registerXHandlers() function
    - preload.ts: ipcRenderer.invoke('channel:action', ...args) pattern
    - meetingStore.ts: Zustand store with loading/error/data + async actions
    - MeetingsPage.tsx: page with filter tabs + search + card grid + detail modal

    Key files to reference:
    @src/main/db/schema/ideas.ts (ideas + ideaTags table definitions)
    @src/main/db/schema/index.ts (barrel export — already exports ideas.ts)
    @src/main/services/meetingService.ts (CRUD service pattern)
    @src/main/ipc/meetings.ts (IPC handler pattern)
    @src/main/ipc/index.ts (registration point — add registerIdeaHandlers)
    @src/preload/preload.ts (bridge methods)
    @src/shared/types.ts (add idea types + ElectronAPI extensions)
    @src/renderer/stores/meetingStore.ts (Zustand store pattern)
    @src/renderer/pages/MeetingsPage.tsx (page pattern with filters/search/grid)
    @src/renderer/components/MeetingDetailModal.tsx (modal pattern)
    @src/renderer/components/ConvertActionModal.tsx (convert wizard pattern for Task 3)
    @src/renderer/stores/projectStore.ts (projects list for convert flow)

    UI conventions:
    - Primary action: bg-primary-600 hover:bg-primary-500 text-white rounded-lg px-3 py-1.5
    - Section bg: bg-surface-800/50 border border-surface-700 rounded-lg p-3
    - Status badges: inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full
    - Loading: Loader2 from lucide-react with animate-spin, text-amber-400
    - Icons: lucide-react (all standard icons available)
    - Escape + overlay click to close modals
    - Empty states: centered icon + text + subtitle
  </context>

  <task type="auto" n="1">
    <n>Create idea types, ideaService, IPC handlers, and preload bridge</n>
    <files>
      src/shared/types.ts (modify — add idea types + ElectronAPI extensions)
      src/main/services/ideaService.ts (create)
      src/main/ipc/ideas.ts (create)
      src/main/ipc/index.ts (modify — register idea handlers)
      src/preload/preload.ts (modify — add idea bridge methods)
    </files>
    <preconditions>
      - Phase 5 complete, all TypeScript compiles clean
      - ideas + idea_tags schema tables exist and are exported from schema/index.ts
      - Drizzle ORM connection available via getDb()
    </preconditions>
    <action>
      Create the full backend data layer for ideas. This follows the exact same patterns
      used for meetings (meetingService.ts + meetings.ts IPC + preload bridge).

      WHY: The ideas table already exists but has no service layer, IPC handlers, or
      renderer bridge. We need the full pipeline before the UI can function.

      ## 1. Shared Types (src/shared/types.ts)

      Add after the Whisper types section, before the ElectronAPI interface:

      ```typescript
      // === IDEA TYPES ===

      export type IdeaStatus = 'new' | 'exploring' | 'active' | 'archived';
      export type EffortLevel = 'trivial' | 'small' | 'medium' | 'large' | 'epic';
      export type ImpactLevel = 'minimal' | 'low' | 'medium' | 'high' | 'critical';

      export interface Idea {
        id: string;
        projectId: string | null;
        title: string;
        description: string | null;
        status: IdeaStatus;
        effort: EffortLevel | null;
        impact: ImpactLevel | null;
        tags: string[];
        createdAt: string;
        updatedAt: string;
      }

      export interface CreateIdeaInput {
        title: string;
        description?: string;
        projectId?: string;
        tags?: string[];
      }

      export interface UpdateIdeaInput {
        title?: string;
        description?: string | null;
        projectId?: string | null;
        status?: IdeaStatus;
        effort?: EffortLevel | null;
        impact?: ImpactLevel | null;
        tags?: string[];
      }

      export interface ConvertIdeaToCardInput {
        ideaId: string;
        columnId: string;
      }

      export interface ConvertIdeaToProjectResult {
        idea: Idea;
        projectId: string;
      }

      export interface ConvertIdeaToCardResult {
        idea: Idea;
        cardId: string;
      }
      ```

      Add to the ElectronAPI interface (after the Meeting Intelligence section):

      ```typescript
      // Ideas
      getIdeas: () => Promise<Idea[]>;
      getIdea: (id: string) => Promise<Idea | null>;
      createIdea: (data: CreateIdeaInput) => Promise<Idea>;
      updateIdea: (id: string, data: UpdateIdeaInput) => Promise<Idea>;
      deleteIdea: (id: string) => Promise<void>;
      convertIdeaToProject: (id: string) => Promise<ConvertIdeaToProjectResult>;
      convertIdeaToCard: (ideaId: string, columnId: string) => Promise<ConvertIdeaToCardResult>;
      ```

      ## 2. ideaService.ts (src/main/services/ideaService.ts, ~180-220 lines)

      Follow the meetingService.ts / meetingIntelligenceService.ts patterns.

      File header:
      ```typescript
      // === FILE PURPOSE ===
      // Idea repository service — CRUD operations for ideas, tag management,
      // and idea-to-project/card conversion.
      //
      // === DEPENDENCIES ===
      // drizzle-orm, DB schema (ideas, ideaTags, projects, cards), connection
      //
      // === LIMITATIONS ===
      // - No AI analysis in this service (deferred to Plan 6.3)
      // - Tags are replaced wholesale on update (not individually added/removed)
      //
      // === VERIFICATION STATUS ===
      // - DB schema: verified from ideas.ts source
      // - Shared types: updated in types.ts
      ```

      Imports:
      ```typescript
      import { eq, desc, asc, count, and, inArray } from 'drizzle-orm';
      import { getDb } from '../db/connection';
      import { ideas, ideaTags, projects, cards } from '../db/schema';
      import type {
        Idea,
        CreateIdeaInput,
        UpdateIdeaInput,
        IdeaStatus,
        EffortLevel,
        ImpactLevel,
      } from '../../shared/types';
      ```

      Row mapper (ideas table + joined tags → Idea type):
      ```typescript
      function toIdea(
        row: typeof ideas.$inferSelect,
        tags: string[],
      ): Idea {
        return {
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          description: row.description,
          status: row.status as IdeaStatus,
          effort: row.effort as EffortLevel | null,
          impact: row.impact as ImpactLevel | null,
          tags,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }
      ```

      Helper to load tags for one or multiple ideas:
      ```typescript
      async function loadTagsForIdeas(ideaIds: string[]): Promise<Record<string, string[]>> {
        if (ideaIds.length === 0) return {};
        const db = getDb();
        const rows = await db
          .select()
          .from(ideaTags)
          .where(inArray(ideaTags.ideaId, ideaIds));
        const tagMap: Record<string, string[]> = {};
        for (const row of rows) {
          if (!tagMap[row.ideaId]) tagMap[row.ideaId] = [];
          tagMap[row.ideaId].push(row.tag);
        }
        return tagMap;
      }
      ```

      Helper to replace tags for an idea:
      ```typescript
      async function replaceTags(ideaId: string, tags: string[]): Promise<void> {
        const db = getDb();
        // Delete existing tags
        await db.delete(ideaTags).where(eq(ideaTags.ideaId, ideaId));
        // Insert new tags (if any)
        if (tags.length > 0) {
          await db.insert(ideaTags).values(
            tags.map(tag => ({ ideaId, tag: tag.trim().toLowerCase() }))
          );
        }
      }
      ```

      Exported functions:

      **getIdeas()** — Returns all ideas ordered by createdAt desc, with tags loaded:
      ```typescript
      export async function getIdeas(): Promise<Idea[]> {
        const db = getDb();
        const rows = await db.select().from(ideas).orderBy(desc(ideas.createdAt));
        const tagMap = await loadTagsForIdeas(rows.map(r => r.id));
        return rows.map(row => toIdea(row, tagMap[row.id] ?? []));
      }
      ```

      **getIdea(id)** — Returns single idea with tags, or null:
      ```typescript
      export async function getIdea(id: string): Promise<Idea | null> {
        const db = getDb();
        const [row] = await db.select().from(ideas).where(eq(ideas.id, id));
        if (!row) return null;
        const tagMap = await loadTagsForIdeas([id]);
        return toIdea(row, tagMap[id] ?? []);
      }
      ```

      **createIdea(data)** — Inserts idea + tags, returns Idea:
      ```typescript
      export async function createIdea(data: CreateIdeaInput): Promise<Idea> {
        const db = getDb();
        const [row] = await db.insert(ideas).values({
          title: data.title,
          description: data.description ?? null,
          projectId: data.projectId ?? null,
          status: 'new',
        }).returning();
        const tags = data.tags ?? [];
        if (tags.length > 0) {
          await replaceTags(row.id, tags);
        }
        return toIdea(row, tags.map(t => t.trim().toLowerCase()));
      }
      ```

      **updateIdea(id, data)** — Dynamic update (only set provided fields) + optional tag replace:
      ```typescript
      export async function updateIdea(id: string, data: UpdateIdeaInput): Promise<Idea> {
        const db = getDb();
        const updateObj: Record<string, unknown> = { updatedAt: new Date() };
        if (data.title !== undefined) updateObj.title = data.title;
        if (data.description !== undefined) updateObj.description = data.description;
        if (data.projectId !== undefined) updateObj.projectId = data.projectId;
        if (data.status !== undefined) updateObj.status = data.status;
        if (data.effort !== undefined) updateObj.effort = data.effort;
        if (data.impact !== undefined) updateObj.impact = data.impact;

        const [row] = await db.update(ideas).set(updateObj).where(eq(ideas.id, id)).returning();
        if (!row) throw new Error(`Idea not found: ${id}`);

        // Replace tags if provided
        if (data.tags !== undefined) {
          await replaceTags(id, data.tags);
        }

        const tagMap = await loadTagsForIdeas([id]);
        return toIdea(row, tagMap[id] ?? []);
      }
      ```

      **deleteIdea(id)** — Deletes idea (cascade deletes tags via FK):
      ```typescript
      export async function deleteIdea(id: string): Promise<void> {
        const db = getDb();
        await db.delete(ideas).where(eq(ideas.id, id));
      }
      ```

      **convertIdeaToProject(id)** — Creates project from idea, links idea, marks active:
      ```typescript
      export async function convertIdeaToProject(id: string): Promise<{ idea: Idea; projectId: string }> {
        const db = getDb();
        const idea = await getIdea(id);
        if (!idea) throw new Error(`Idea not found: ${id}`);

        // Create project with idea title + description
        const [project] = await db.insert(projects).values({
          name: idea.title.slice(0, 100),
          description: idea.description,
        }).returning();

        // Link idea to project and mark as active
        const [updatedRow] = await db.update(ideas).set({
          projectId: project.id,
          status: 'active',
          updatedAt: new Date(),
        }).where(eq(ideas.id, id)).returning();

        const tagMap = await loadTagsForIdeas([id]);
        return {
          idea: toIdea(updatedRow, tagMap[id] ?? []),
          projectId: project.id,
        };
      }
      ```

      **convertIdeaToCard(ideaId, columnId)** — Creates card from idea, marks active:
      ```typescript
      export async function convertIdeaToCard(
        ideaId: string,
        columnId: string,
      ): Promise<{ idea: Idea; cardId: string }> {
        const db = getDb();
        const idea = await getIdea(ideaId);
        if (!idea) throw new Error(`Idea not found: ${ideaId}`);

        // Count cards in target column for position
        const [{ value: cardCount }] = await db
          .select({ value: count() })
          .from(cards)
          .where(eq(cards.columnId, columnId));

        // Create card
        const [card] = await db.insert(cards).values({
          columnId,
          title: idea.title.slice(0, 100),
          description: idea.description,
          priority: 'medium',
          position: cardCount,
        }).returning();

        // Mark idea as active
        const [updatedRow] = await db.update(ideas).set({
          status: 'active',
          updatedAt: new Date(),
        }).where(eq(ideas.id, ideaId)).returning();

        const tagMap = await loadTagsForIdeas([ideaId]);
        return {
          idea: toIdea(updatedRow, tagMap[ideaId] ?? []),
          cardId: card.id,
        };
      }
      ```

      ## 3. IPC Handlers (src/main/ipc/ideas.ts, ~40-50 lines)

      ```typescript
      // === FILE PURPOSE ===
      // IPC handlers for idea repository operations.

      import { ipcMain } from 'electron';
      import * as ideaService from '../services/ideaService';

      export function registerIdeaHandlers(): void {
        ipcMain.handle('ideas:list', async () => {
          return ideaService.getIdeas();
        });
        ipcMain.handle('ideas:get', async (_event, id: string) => {
          return ideaService.getIdea(id);
        });
        ipcMain.handle('ideas:create', async (_event, data: any) => {
          return ideaService.createIdea(data);
        });
        ipcMain.handle('ideas:update', async (_event, id: string, data: any) => {
          return ideaService.updateIdea(id, data);
        });
        ipcMain.handle('ideas:delete', async (_event, id: string) => {
          return ideaService.deleteIdea(id);
        });
        ipcMain.handle('ideas:convert-to-project', async (_event, id: string) => {
          return ideaService.convertIdeaToProject(id);
        });
        ipcMain.handle('ideas:convert-to-card', async (_event, ideaId: string, columnId: string) => {
          return ideaService.convertIdeaToCard(ideaId, columnId);
        });
      }
      ```

      ## 4. Register in ipc/index.ts

      Add import:
      ```typescript
      import { registerIdeaHandlers } from './ideas';
      ```

      Add call inside registerIpcHandlers():
      ```typescript
      registerIdeaHandlers();
      ```

      ## 5. Preload Bridge (src/preload/preload.ts)

      Add after the Meeting Intelligence section:
      ```typescript
      // Ideas
      getIdeas: () => ipcRenderer.invoke('ideas:list'),
      getIdea: (id: string) => ipcRenderer.invoke('ideas:get', id),
      createIdea: (data: any) => ipcRenderer.invoke('ideas:create', data),
      updateIdea: (id: string, data: any) => ipcRenderer.invoke('ideas:update', id, data),
      deleteIdea: (id: string) => ipcRenderer.invoke('ideas:delete', id),
      convertIdeaToProject: (id: string) => ipcRenderer.invoke('ideas:convert-to-project', id),
      convertIdeaToCard: (ideaId: string, columnId: string) =>
        ipcRenderer.invoke('ideas:convert-to-card', ideaId, columnId),
      ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. src/shared/types.ts: exports Idea, CreateIdeaInput, UpdateIdeaInput, IdeaStatus, EffortLevel, ImpactLevel,
         ConvertIdeaToCardInput, ConvertIdeaToProjectResult, ConvertIdeaToCardResult
      3. src/shared/types.ts: ElectronAPI includes getIdeas, getIdea, createIdea, updateIdea, deleteIdea,
         convertIdeaToProject, convertIdeaToCard methods
      4. src/main/services/ideaService.ts: exports getIdeas, getIdea, createIdea, updateIdea, deleteIdea,
         convertIdeaToProject, convertIdeaToCard
      5. ideaService: toIdea mapper includes tags array from junction table
      6. ideaService: createIdea inserts tags via replaceTags helper
      7. ideaService: updateIdea only sets provided fields + replaces tags if provided
      8. ideaService: convertIdeaToProject creates project and links idea
      9. ideaService: convertIdeaToCard creates card at correct position in column
      10. src/main/ipc/ideas.ts: exports registerIdeaHandlers with 7 handlers
      11. src/main/ipc/index.ts: calls registerIdeaHandlers()
      12. src/preload/preload.ts: includes 7 idea bridge methods
    </verify>
    <done>
      Full idea data pipeline created: 7 shared types added, ideaService.ts with 7 exported
      functions + tag management helpers, IPC handlers for 7 channels, registered in index,
      preload bridge with 7 methods. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - ideas + idea_tags tables already exist in schema and have been migrated (Phase 1)
      - Drizzle's inArray function works with string[] for ideaTags.ideaId query
      - ideas.status enum values match IdeaStatus type: 'new' | 'exploring' | 'active' | 'archived'
      - Tag normalization: trim + lowercase. Duplicate tags prevented by composite PK on (ideaId, tag)
      - convertIdeaToProject uses project table's default color (null) — user can customize later
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create idea store and replace IdeasPage with full UI</n>
    <files>
      src/renderer/stores/ideaStore.ts (create)
      src/renderer/pages/IdeasPage.tsx (replace stub)
    </files>
    <preconditions>
      - Task 1 complete (ideaService, IPC, preload, types all in place)
      - ElectronAPI has getIdeas, getIdea, createIdea, updateIdea, deleteIdea, convertIdeaToProject, convertIdeaToCard
      - Idea type includes tags: string[], status, effort, impact fields
    </preconditions>
    <action>
      Create the Zustand store for ideas and replace the IdeasPage stub with a full-featured
      idea browsing and capture interface.

      WHY: The IdeasPage is currently a stub placeholder. Users need to browse, create, filter,
      and search ideas. The store provides the reactive state layer between IPC and UI.

      ## 1. ideaStore.ts (src/renderer/stores/ideaStore.ts, ~100-130 lines)

      Follow the exact meetingStore.ts pattern:

      ```typescript
      // === FILE PURPOSE ===
      // Zustand store for idea repository state and CRUD actions.

      import { create } from 'zustand';
      import type { Idea, CreateIdeaInput, UpdateIdeaInput } from '../../shared/types';

      interface IdeaStore {
        // State
        ideas: Idea[];
        selectedIdea: Idea | null;
        loading: boolean;
        error: string | null;

        // Actions
        loadIdeas: () => Promise<void>;
        loadIdea: (id: string) => Promise<void>;
        createIdea: (data: CreateIdeaInput) => Promise<Idea>;
        updateIdea: (id: string, data: UpdateIdeaInput) => Promise<void>;
        deleteIdea: (id: string) => Promise<void>;
        clearSelectedIdea: () => void;
        convertToProject: (id: string) => Promise<string>;     // returns projectId
        convertToCard: (ideaId: string, columnId: string) => Promise<string>;  // returns cardId
      }

      export const useIdeaStore = create<IdeaStore>((set, get) => ({
        ideas: [],
        selectedIdea: null,
        loading: false,
        error: null,

        loadIdeas: async () => {
          set({ loading: true, error: null });
          try {
            const ideas = await window.electronAPI.getIdeas();
            set({ ideas, loading: false });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to load ideas',
              loading: false,
            });
          }
        },

        loadIdea: async (id: string) => {
          try {
            const idea = await window.electronAPI.getIdea(id);
            set({ selectedIdea: idea });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to load idea',
            });
          }
        },

        createIdea: async (data: CreateIdeaInput) => {
          const idea = await window.electronAPI.createIdea(data);
          set({ ideas: [idea, ...get().ideas] });
          return idea;
        },

        updateIdea: async (id: string, data: UpdateIdeaInput) => {
          const updated = await window.electronAPI.updateIdea(id, data);
          set({
            ideas: get().ideas.map(i => i.id === id ? updated : i),
            selectedIdea: get().selectedIdea?.id === id ? updated : get().selectedIdea,
          });
        },

        deleteIdea: async (id: string) => {
          await window.electronAPI.deleteIdea(id);
          set({
            ideas: get().ideas.filter(i => i.id !== id),
            selectedIdea: get().selectedIdea?.id === id ? null : get().selectedIdea,
          });
        },

        clearSelectedIdea: () => set({ selectedIdea: null }),

        convertToProject: async (id: string) => {
          const result = await window.electronAPI.convertIdeaToProject(id);
          set({
            ideas: get().ideas.map(i => i.id === id ? result.idea : i),
            selectedIdea: get().selectedIdea?.id === id ? result.idea : get().selectedIdea,
          });
          return result.projectId;
        },

        convertToCard: async (ideaId: string, columnId: string) => {
          const result = await window.electronAPI.convertIdeaToCard(ideaId, columnId);
          set({
            ideas: get().ideas.map(i => i.id === ideaId ? result.idea : i),
            selectedIdea: get().selectedIdea?.id === ideaId ? result.idea : get().selectedIdea,
          });
          return result.cardId;
        },
      }));
      ```

      ## 2. IdeasPage.tsx (src/renderer/pages/IdeasPage.tsx, ~250-300 lines)

      Replace the entire stub. Follow MeetingsPage.tsx patterns for layout and interaction.

      Structure:
      ```
      ┌────────────────────────────────────────────────┐
      │ Ideas                                          │
      │ Capture and organize your ideas                │
      │                                                │
      │ [Quick-add: title input] [+ Add Idea]          │
      │                                                │
      │ [All] [New] [Exploring] [Active] [Archived]    │
      │                                  [🔍 Search...] │
      │                                                │
      │ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
      │ │ Idea 1  │ │ Idea 2  │ │ Idea 3  │           │
      │ │ #tag    │ │ #tag    │ │         │           │
      │ │ ●New    │ │ ●Active │ │ ●Explor │           │
      │ └─────────┘ └─────────┘ └─────────┘           │
      └────────────────────────────────────────────────┘
      ```

      Imports:
      ```typescript
      import { useState, useEffect } from 'react';
      import { Lightbulb, Plus, Search, X, Tag, Zap, Target } from 'lucide-react';
      import { useIdeaStore } from '../stores/ideaStore';
      import type { IdeaStatus, EffortLevel, ImpactLevel } from '../../shared/types';
      ```

      State:
      ```typescript
      const { ideas, loading, error, loadIdeas, createIdea } = useIdeaStore();
      const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
      const [searchQuery, setSearchQuery] = useState('');
      const [newTitle, setNewTitle] = useState('');
      const [creating, setCreating] = useState(false);
      const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
      ```

      useEffect: Load ideas on mount.

      Quick-add form:
      - Single row: text input + button
      - Input: bg-surface-800 border border-surface-700 rounded-lg text-sm, placeholder "What's your idea?"
      - Button: bg-primary-600 hover:bg-primary-500 text-white rounded-lg, Plus icon + "Add"
      - On submit: call createIdea({ title: newTitle }), clear input, show loading
      - Disabled when newTitle.trim() is empty or creating

      Filter tabs:
      - Tabs: All | New | Exploring | Active | Archived
      - Active tab: bg-surface-700 text-surface-100, inactive: text-surface-400 hover:text-surface-200
      - Same row has search input on the right (same pattern as MeetingsPage)

      Filtering logic:
      ```typescript
      const filteredIdeas = ideas.filter(idea => {
        if (filter !== 'all' && idea.status !== filter) return false;
        if (searchQuery.trim()) {
          const query = searchQuery.trim().toLowerCase();
          const matchesTitle = idea.title.toLowerCase().includes(query);
          const matchesTags = idea.tags.some(t => t.includes(query));
          if (!matchesTitle && !matchesTags) return false;
        }
        return true;
      });
      ```

      Idea card component (inline or extracted):
      - Container: bg-surface-800 border border-surface-700 rounded-xl p-4 cursor-pointer
        hover:border-surface-600 transition-colors
      - Title: text-sm font-medium text-surface-100 line-clamp-2
      - Description preview: text-xs text-surface-400 line-clamp-2 mt-1 (if description exists)
      - Tags row: flex flex-wrap gap-1 mt-2
        - Each tag: bg-surface-700 text-surface-300 text-xs px-2 py-0.5 rounded-full
      - Bottom row: flex items-center justify-between mt-3
        - Status badge (colored):
          - new: bg-blue-500/20 text-blue-400
          - exploring: bg-amber-500/20 text-amber-400
          - active: bg-emerald-500/20 text-emerald-400
          - archived: bg-surface-600/50 text-surface-400
        - Effort indicator (if set): Zap icon + effort label, text-xs text-surface-500
        - Impact indicator (if set): Target icon + impact label, text-xs text-surface-500
        - Date: text-xs text-surface-500, relative or formatted date
      - onClick: setSelectedIdeaId(idea.id)

      Grid layout: grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3

      Empty states:
      - With search: "No matching ideas" + "Try a different search term"
      - Without ideas: Lightbulb icon + "No ideas yet" + "Add your first idea above"
      - With filter active: "No {filter} ideas" + "Try a different filter"

      Loading state: centered Loader2 spinner

      Error state: red text with error message

      Selected idea: When selectedIdeaId is set, render IdeaDetailModal (Task 3).
      For now, just add the conditional render placeholder:
      ```tsx
      {selectedIdeaId && (
        <IdeaDetailModal
          ideaId={selectedIdeaId}
          onClose={() => setSelectedIdeaId(null)}
        />
      )}
      ```
      Import IdeaDetailModal from '../components/IdeaDetailModal'. This will cause a
      TypeScript error until Task 3 creates the file — that's acceptable. Note this in
      the verify step. Alternatively, comment out the import and JSX until Task 3.

      IMPORTANT: To keep TypeScript clean between tasks, comment out the IdeaDetailModal
      import and JSX render with `// TODO: Uncomment after Task 3 creates IdeaDetailModal`
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors (IdeaDetailModal commented out)
      2. ideaStore.ts: exports useIdeaStore hook
      3. ideaStore.ts: has loadIdeas, loadIdea, createIdea, updateIdea, deleteIdea,
         clearSelectedIdea, convertToProject, convertToCard actions
      4. IdeasPage.tsx: renders page header with title and subtitle
      5. IdeasPage.tsx: quick-add form with title input and Add button
      6. IdeasPage.tsx: filter tabs (All, New, Exploring, Active, Archived)
      7. IdeasPage.tsx: search input with icon and clear button
      8. IdeasPage.tsx: idea cards in responsive grid with title, tags, status badge, effort/impact
      9. IdeasPage.tsx: filtering works by status AND search query (title + tags)
      10. IdeasPage.tsx: loading, error, and empty states all handled
      11. IdeasPage.tsx: clicking a card sets selectedIdeaId state (modal render commented out for now)
    </verify>
    <done>
      ideaStore.ts created with Zustand state and 8 CRUD/convert actions. IdeasPage.tsx replaced
      with full page: quick-add form, filter tabs, search input, responsive card grid with
      status badges/tags/effort/impact, loading/error/empty states. TypeScript compiles clean
      (IdeaDetailModal commented out pending Task 3).
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - lucide-react includes Zap and Target icons (standard lucide icons)
      - Responsive grid cols (1/2/3) work well for idea cards at typical dashboard sizes
      - Client-side filtering is sufficient for idea list (hundreds of ideas, not thousands)
      - line-clamp-2 Tailwind utility is available (requires @tailwindcss/line-clamp or Tailwind v3.3+
        which includes it natively). Tailwind CSS 4 should support it.
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Create IdeaDetailModal with edit, tags, and conversion</n>
    <files>
      src/renderer/components/IdeaDetailModal.tsx (create)
      src/renderer/pages/IdeasPage.tsx (modify — uncomment IdeaDetailModal import + render)
    </files>
    <preconditions>
      - Task 1 complete (all types, service, IPC, preload working)
      - Task 2 complete (ideaStore, IdeasPage with commented-out modal)
      - useIdeaStore has loadIdea, updateIdea, deleteIdea, convertToProject, convertToCard
      - ConvertActionModal.tsx exists as pattern reference (3-step wizard)
    </preconditions>
    <action>
      Create the idea detail modal for viewing, editing, and converting ideas. Then wire it
      into IdeasPage.

      WHY: Users need to view full idea details, edit all fields (title, description, status,
      effort, impact, tags), and convert ideas into projects or cards. This completes the
      Idea Repository feature.

      ## 1. IdeaDetailModal.tsx (src/renderer/components/IdeaDetailModal.tsx, ~350-400 lines)

      Props:
      ```typescript
      interface IdeaDetailModalProps {
        ideaId: string;
        onClose: () => void;
      }
      ```

      The modal loads the idea from the store and manages local edit state.

      Imports:
      ```typescript
      import { useState, useEffect, useRef } from 'react';
      import {
        X, Trash2, Loader2, Tag, Plus, Zap, Target,
        FolderPlus, ArrowRightCircle, ChevronLeft, Check,
      } from 'lucide-react';
      import { useIdeaStore } from '../stores/ideaStore';
      import type {
        Idea, IdeaStatus, EffortLevel, ImpactLevel,
        Project, Board, Column,
      } from '../../shared/types';
      ```

      State:
      ```typescript
      const { selectedIdea, loadIdea, updateIdea, deleteIdea, clearSelectedIdea,
              convertToProject, convertToCard } = useIdeaStore();
      const [title, setTitle] = useState('');
      const [description, setDescription] = useState('');
      const [status, setStatus] = useState<IdeaStatus>('new');
      const [effort, setEffort] = useState<EffortLevel | ''>('');
      const [impact, setImpact] = useState<ImpactLevel | ''>('');
      const [tagInput, setTagInput] = useState('');
      const [tags, setTags] = useState<string[]>([]);
      const [saving, setSaving] = useState(false);
      const [deleting, setDeleting] = useState(false);
      const [confirmDelete, setConfirmDelete] = useState(false);

      // Convert state
      const [convertMode, setConvertMode] = useState<'none' | 'project' | 'card'>('none');
      const [convertStep, setConvertStep] = useState<1 | 2 | 3>(1);
      const [projects, setProjects] = useState<Project[]>([]);
      const [boards, setBoards] = useState<Board[]>([]);
      const [columns, setColumns] = useState<Column[]>([]);
      const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
      const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
      const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
      const [converting, setConverting] = useState(false);
      ```

      Load idea on mount:
      ```typescript
      useEffect(() => {
        loadIdea(ideaId);
        return () => clearSelectedIdea();
      }, [ideaId]);

      // Sync local state when selectedIdea loads
      useEffect(() => {
        if (selectedIdea) {
          setTitle(selectedIdea.title);
          setDescription(selectedIdea.description ?? '');
          setStatus(selectedIdea.status);
          setEffort(selectedIdea.effort ?? '');
          setImpact(selectedIdea.impact ?? '');
          setTags(selectedIdea.tags);
        }
      }, [selectedIdea]);
      ```

      Save handler (auto-save on blur or debounced — use onBlur for simplicity):
      ```typescript
      const handleSave = async () => {
        if (!selectedIdea || saving) return;
        setSaving(true);
        try {
          await updateIdea(selectedIdea.id, {
            title: title.trim() || selectedIdea.title,
            description: description.trim() || null,
            status,
            effort: effort || null,
            impact: impact || null,
            tags,
          });
        } finally {
          setSaving(false);
        }
      };
      ```

      Tag management:
      ```typescript
      const addTag = () => {
        const tag = tagInput.trim().toLowerCase();
        if (tag && !tags.includes(tag)) {
          setTags([...tags, tag]);
          setTagInput('');
        }
      };
      const removeTag = (tag: string) => {
        setTags(tags.filter(t => t !== tag));
      };
      // Add on Enter key in tag input
      ```

      Delete handler:
      ```typescript
      const handleDelete = async () => {
        if (!selectedIdea || deleting) return;
        setDeleting(true);
        try {
          await deleteIdea(selectedIdea.id);
          onClose();
        } finally {
          setDeleting(false);
        }
      };
      ```

      Convert to project handler:
      ```typescript
      const handleConvertToProject = async () => {
        if (!selectedIdea) return;
        setConverting(true);
        try {
          await convertToProject(selectedIdea.id);
          onClose();
        } finally {
          setConverting(false);
        }
      };
      ```

      Convert to card flow (same pattern as ConvertActionModal):
      - When convertMode === 'card', show inline project → board → column wizard
      - Load projects on entering card mode
      - Auto-skip board step if project has 1 board
      - On final step, call convertToCard(ideaId, columnId) and close

      Layout:
      ```
      ┌──────────────────────────────────────────────────┐
      │ [Title input - editable]              [X] close  │
      │                                                  │
      │ Status: [dropdown]  Effort: [dropdown]           │
      │ Impact: [dropdown]                               │
      │                                                  │
      │ Description:                                     │
      │ [Textarea - editable]                            │
      │                                                  │
      │ Tags:                                            │
      │ [tag1] [tag2] [tag3]  [+ input] [Add]            │
      │                                                  │
      │ ─────────────────────────────────────            │
      │ Convert:                                         │
      │ [📁 Create Project] [📋 Add as Card]             │
      │ (if card mode: project → board → column wizard)  │
      │                                                  │
      │ ─────────────────────────────────────            │
      │ [Save]                          [🗑 Delete]      │
      └──────────────────────────────────────────────────┘
      ```

      Overlay: fixed inset-0 z-50 flex items-center justify-center bg-black/50
      Modal: bg-surface-900 rounded-xl border border-surface-700 w-full max-w-lg mx-4
             max-h-[85vh] overflow-y-auto p-5

      Status dropdown options: new, exploring, active, archived
      Effort dropdown options: (empty), trivial, small, medium, large, epic
      Impact dropdown options: (empty), minimal, low, medium, high, critical

      Dropdowns: styled as `<select>` elements with
        bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 px-2 py-1.5

      Tag input: inline text input with Enter to add, small Add button
      Tags displayed as removable pills: bg-surface-700 text-surface-300 text-xs px-2 py-0.5
        rounded-full with X button to remove

      Convert section:
      - Two buttons side by side:
        - "Create Project": FolderPlus icon, border border-surface-700 rounded-lg p-3,
          hover:border-primary-500 hover:bg-primary-500/10
        - "Add as Card": ArrowRightCircle icon, same style
      - When "Add as Card" is clicked, show inline wizard below (project list → board → column)
        using the same radio-button list pattern from ConvertActionModal
      - Step indicator dots (same as ConvertActionModal)
      - Back button to go back steps, Cancel to exit convert mode
      - Convert button on final step

      Escape key and overlay click to close (save on close if dirty).

      ## 2. Uncomment IdeaDetailModal in IdeasPage.tsx

      Uncomment the IdeaDetailModal import and the conditional render JSX that was
      commented out in Task 2:
      ```typescript
      import IdeaDetailModal from '../components/IdeaDetailModal';
      ```
      ```tsx
      {selectedIdeaId && (
        <IdeaDetailModal
          ideaId={selectedIdeaId}
          onClose={() => {
            setSelectedIdeaId(null);
            loadIdeas(); // refresh list after edits
          }}
        />
      )}
      ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. IdeaDetailModal.tsx: exports default component accepting { ideaId, onClose }
      3. IdeaDetailModal: loads idea from store on mount, syncs to local state
      4. IdeaDetailModal: title is editable (input field, saves onBlur)
      5. IdeaDetailModal: description is editable (textarea, saves onBlur)
      6. IdeaDetailModal: status dropdown with 4 options (new, exploring, active, archived)
      7. IdeaDetailModal: effort dropdown with 6 options (empty + 5 levels)
      8. IdeaDetailModal: impact dropdown with 6 options (empty + 5 levels)
      9. IdeaDetailModal: tags display as removable pills
      10. IdeaDetailModal: tag input with Enter-to-add and Add button
      11. IdeaDetailModal: "Create Project" button calls convertToProject and closes
      12. IdeaDetailModal: "Add as Card" opens inline project → board → column wizard
      13. IdeaDetailModal: convert wizard loads projects/boards/columns via electronAPI
      14. IdeaDetailModal: delete button with confirmation
      15. IdeaDetailModal: Save button calls updateIdea with all current field values
      16. IdeaDetailModal: Escape + overlay click close modal
      17. IdeasPage.tsx: IdeaDetailModal import uncommented and renders when selectedIdeaId is set
      18. IdeasPage.tsx: onClose refreshes ideas list
    </verify>
    <done>
      IdeaDetailModal.tsx created (~350-400 lines) with full edit capabilities: editable title,
      description, status/effort/impact dropdowns, tags editor (add/remove), convert to project
      (one-click) or convert to card (3-step wizard). Delete with confirmation. Save on blur or
      explicit Save button. IdeasPage wired to open modal on card click and refresh on close.
      Plan 6.1 delivers complete R12: Idea Repository functionality (minus AI analysis, deferred
      to Plan 6.3). TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - ConvertActionModal.tsx pattern (3-step wizard) is proven and can be adapted for
        the inline convert-to-card flow within IdeaDetailModal
      - electronAPI.getBoards(projectId) and getColumns(boardId) are available and fast
      - Select elements style correctly with Tailwind on Electron (no custom dropdown needed)
      - 350-400 lines is acceptable since the modal has complex functionality (edit + tags + convert).
        The convert wizard is inline rather than a separate modal to reduce component count.
      - Save-on-blur provides good UX without needing debounce (each field triggers one save)
    </assumptions>
  </task>
</phase>
