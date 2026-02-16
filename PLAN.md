<phase n="A.1" name="Pin Projects, AI Card Description, Quick Capture">
  <context>
    Plan A.1 implements the top 3 features from SELF-IMPROVE-NEW.md Phase A (Quick Capture and Daily Habits).
    These are new feature additions, not polish/fixes.

    Features in this plan:
    - Q1: Pin/Star Projects (3h) — star toggle, pinned sort, dashboard priority
    - Q2: AI Generate Card Description (3h) — Sparkles button in CardDetailModal
    - F1: Quick Capture via Command Palette (4h) — capture mode when no search matches

    Deferred to Plan A.2: Q3 (Daily Standup Generator), E1 (Productivity Pulse)

    @PROJECT.md @STATE.md @SELF-IMPROVE-NEW.md
    @src/main/db/schema/projects.ts
    @src/main/ipc/projects.ts
    @src/renderer/pages/ProjectsPage.tsx
    @src/renderer/pages/DashboardPage.tsx
    @src/renderer/components/CardDetailModal.tsx
    @src/renderer/components/CommandPalette.tsx
    @src/main/ipc/cards.ts
    @src/main/services/ai-provider.ts
    @src/preload/domains/card-details.ts
    @src/preload/domains/projects.ts
  </context>

  <task type="auto" n="1">
    <n>Pin/Star projects with sort-to-top and dashboard priority</n>
    <files>
      src/main/db/schema/projects.ts
      drizzle/ (new migration)
      src/main/ipc/projects.ts
      src/shared/validation/schemas.ts
      src/shared/types.ts
      src/renderer/pages/ProjectsPage.tsx
      src/renderer/pages/DashboardPage.tsx
      src/renderer/stores/projectStore.ts
    </files>
    <action>
      Add a "pin" / star capability to projects. Pinned projects float to the top of the
      Projects list and are prioritized on the Dashboard active projects section.

      **A. Schema + Migration**

      1. In `src/main/db/schema/projects.ts`, add a `pinned` column:
         ```ts
         pinned: boolean('pinned').default(false).notNull(),
         ```
         Place it after the `archived` column.

      2. Generate migration: `npx drizzle-kit generate`
         This creates a new migration file in `drizzle/` that adds the column.

      **B. Shared types + validation**

      3. In `src/shared/types.ts`, find the `Project` type. If it maps from the schema
         (InferSelectModel), no change needed — the type auto-includes `pinned`. If it's
         manually defined, add `pinned: boolean`.

      4. In `src/shared/validation/schemas.ts`, find `updateProjectInputSchema`. Add
         `pinned: z.boolean().optional()` to the schema so the update IPC accepts it.

      **C. IPC handler update**

      5. In `src/main/ipc/projects.ts`, the `projects:list` handler currently orders by
         `createdAt ASC`. Change the ordering to sort pinned first:
         ```ts
         .orderBy(desc(projects.pinned), asc(projects.createdAt))
         ```
         Import `desc` from drizzle-orm if not already imported.

      6. The `projects:update` handler already accepts partial fields and updates them.
         Since we added `pinned` to the validation schema, it will flow through automatically.

      **D. Renderer — ProjectsPage star toggle**

      7. In `src/renderer/pages/ProjectsPage.tsx`, add a Star icon toggle to project cards.
         Import `Star` from lucide-react.

      8. In the project card hover actions area (where Archive, Pencil, Trash2, Copy icons
         are rendered), add a Star button as the FIRST action:
         ```tsx
         <button
           onClick={(e) => {
             e.stopPropagation();
             updateProject(project.id, { pinned: !project.pinned });
           }}
           className="p-1 rounded hover:bg-surface-700 transition-colors"
           title={project.pinned ? 'Unpin project' : 'Pin project'}
         >
           <Star
             size={14}
             className={project.pinned ? 'text-amber-400 fill-amber-400' : 'text-surface-400'}
           />
         </button>
         ```

      9. The star should ALSO be visible when not hovering if the project is pinned (always
         show filled star for pinned projects). Add a small star icon next to the project
         name in the card header for pinned projects:
         ```tsx
         {project.pinned && <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />}
         ```

      **E. Renderer — DashboardPage priority**

      10. In `src/renderer/pages/DashboardPage.tsx`, the `activeProjects` memo currently
          filters out archived and takes the first 6:
          ```ts
          const activeProjects = useMemo(
            () => projects.filter(p => !p.archived).slice(0, MAX_PROJECTS),
            [projects],
          );
          ```
          Since the `projects:list` IPC now returns pinned first, this already works —
          pinned projects will naturally appear first. No change needed here.

      11. Optionally, in the Dashboard "Active Projects" section, show a small star next to
          pinned project names for visual consistency with the Projects page.

      **F. Renderer — projectStore update**

      12. In `src/renderer/stores/projectStore.ts`, the updateProject action likely calls
          `window.electronAPI.updateProject(id, data)` and then refreshes. Verify it passes
          the `pinned` field through. If the store manually defines the update payload type,
          add `pinned?: boolean` to it.

      WHY: Users with 10+ projects waste time scrolling. Pinning 2-3 key projects brings them
      to immediate attention. The star pattern is universal (GitHub, browser bookmarks, file
      managers).
    </action>
    <verify>
      1. Run `npx drizzle-kit generate` — migration file created
      2. Run `npx tsc --noEmit` — zero type errors
      3. Run `npm test` — all 150 tests pass
      4. Manual: hover a project card → star icon appears in actions
      5. Manual: click star → star fills amber, project jumps to top of list
      6. Manual: navigate to Dashboard → pinned project appears first in Active Projects
      7. Manual: click star again → unpins, project returns to normal position
      8. Manual: pinned state persists across app restart (stored in DB)
    </verify>
    <done>
      Projects can be pinned/starred. Pinned projects sort to top of Projects list and
      Dashboard. Star icon visible on hover (all projects) and always (pinned projects).
      Schema migration created and applied on startup.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - drizzle-kit generate works for adding a column (confirmed pattern from prior phases)
      - The projects:update handler is generic enough to accept any column update via
        partial object spread (confirmed from research)
      - The projectStore.updateProject passes through arbitrary fields (need to verify)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>AI Generate Card Description from title</n>
    <files>
      src/main/ipc/cards.ts
      src/preload/domains/card-details.ts
      src/renderer/components/CardDetailModal.tsx
    </files>
    <action>
      Add a "Generate with AI" button in CardDetailModal that uses AI to generate a
      2-3 sentence description from the card title and project context.

      **A. New IPC handler (cards.ts)**

      1. In `src/main/ipc/cards.ts`, add a new handler at the bottom of the file:

         ```ts
         ipcMain.handle('card:generate-description', async (_event, cardId: string) => {
           const db = getDb();

           // Fetch the card
           const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
           if (!card) throw new Error('Card not found');

           // Get project name for context (card -> column -> board -> project)
           const [col] = await db.select().from(columns).where(eq(columns.id, card.columnId));
           const [board] = col ? await db.select().from(boards).where(eq(boards.id, col.boardId)) : [null];
           const [project] = board ? await db.select().from(projects).where(eq(projects.id, board.projectId)) : [null];

           // Get card labels for context
           const cardLabelRows = await db.select().from(cardLabels).where(eq(cardLabels.cardId, cardId));
           const labelIds = cardLabelRows.map(cl => cl.labelId);
           let labelNames: string[] = [];
           if (labelIds.length > 0) {
             const labelRows = await db.select().from(labels).where(inArray(labels.id, labelIds));
             labelNames = labelRows.map(l => l.name);
           }

           // Resolve AI provider
           const provider = await resolveTaskModel('card_description');
           if (!provider) throw new Error('No AI provider configured');

           const prompt = `Write a concise task description (2-3 sentences) for this card on a project board.

    Card title: ${card.title}
    Priority: ${card.priority}
    ${project ? `Project: ${project.name}` : ''}
    ${labelNames.length > 0 ? `Labels: ${labelNames.join(', ')}` : ''}

    Write a clear, actionable description that explains:
    - What needs to be done
    - Why it matters or what it enables
    - Any key considerations

    Format as a single HTML paragraph (<p> tag). Be specific and practical, not generic.`;

           const result = await generate({
             ...provider,
             taskType: 'card_description',
             prompt,
             temperature: 0.7,
             maxTokens: 200,
           });

           return { description: result.text };
         });
         ```

      2. Import `resolveTaskModel` and `generate` from '../services/ai-provider' at the top.
         Import `projects` and `boards` from the schema if not already imported.
         The `cards`, `columns`, `cardLabels`, `labels`, `inArray` should already be imported.

      **B. Preload bridge (card-details.ts)**

      3. In `src/preload/domains/card-details.ts`, add to the `cardDetailsBridge` object:
         ```ts
         // AI Description
         generateCardDescription: (cardId: string) =>
           ipcRenderer.invoke('card:generate-description', cardId),
         ```

      **C. CardDetailModal UI (CardDetailModal.tsx)**

      4. In `src/renderer/components/CardDetailModal.tsx`, import `Sparkles` from lucide-react.

      5. Add state for the generation loading:
         ```ts
         const [generatingDescription, setGeneratingDescription] = useState(false);
         ```

      6. Add the generate handler:
         ```ts
         const handleGenerateDescription = async () => {
           setGeneratingDescription(true);
           try {
             const result = await window.electronAPI.generateCardDescription(card.id);
             if (result?.description && editor) {
               editor.commands.setContent(result.description);
               onUpdate(card.id, { description: result.description });
             }
           } catch (err) {
             toast('Failed to generate description', 'error');
           } finally {
             setGeneratingDescription(false);
           }
         };
         ```

      7. Add the "Generate with AI" button next to the existing "Apply Template" button.
         Find the template selector div (around line 322). After the template dropdown button,
         add a separator and the generate button:
         ```tsx
         <button
           onClick={handleGenerateDescription}
           disabled={generatingDescription}
           className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
           title="Generate description from card title using AI"
         >
           <Sparkles size={14} className={generatingDescription ? 'animate-spin' : ''} />
           {generatingDescription ? 'Generating...' : 'Generate with AI'}
         </button>
         ```
         Place both buttons in a flex container:
         ```tsx
         <div className="mb-5 flex items-center gap-4">
           {/* Template selector (existing) */}
           <div className="relative" ref={templateDropdownRef}>
             ...existing template button and dropdown...
           </div>

           {/* AI Generate button (new) */}
           <button ...>Generate with AI</button>
         </div>
         ```

      8. Import `toast` from '../hooks/useToast' if not already imported.

      WHY: Users create cards quickly (meeting action items, brainstorm saves) with just a
      title. AI drafts a starting description in 2 seconds, saving manual typing. This
      leverages existing AI infrastructure with minimal new code.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: open a card → see "Generate with AI" button next to "Apply Template"
      4. Manual: click "Generate with AI" → button shows "Generating..." with spinner
      5. Manual: after 2-3 seconds, description appears in TipTap editor
      6. Manual: description is relevant to card title and project context
      7. Manual: if no AI provider configured, shows error toast
      8. Manual: generate again → new description replaces the old one
    </verify>
    <done>
      CardDetailModal has "Generate with AI" button that calls the AI provider to
      generate a card description from the title, priority, project, and labels.
      New IPC handler card:generate-description with proper AI resolution.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - The ai-provider's generate() function works with taskType 'card_description'
        (resolveTaskModel falls back to first enabled provider if no specific mapping)
      - The preload bridge exposes the window.electronAPI namespace (confirmed pattern)
      - TipTap's editor.commands.setContent() replaces the editor content
      - The card → column → board → project chain is traversable via foreign keys
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Quick Capture mode in Command Palette</n>
    <files>
      src/renderer/components/CommandPalette.tsx
      src/renderer/stores/ideaStore.ts
      src/renderer/stores/boardStore.ts
    </files>
    <action>
      Enhance the Command Palette to serve as a quick capture tool. When the user types text
      that doesn't match any existing entity, show "Quick Capture" options to create a new
      entity from the typed text. This leverages the existing Ctrl+Shift+Space global shortcut
      (which opens the command palette from any app) to make the Living Dashboard a universal
      capture inbox.

      **A. Add Quick Capture items to search results (CommandPalette.tsx)**

      1. In `src/renderer/components/CommandPalette.tsx`, import additional icons:
         ```ts
         import { ..., PlusCircle, Zap } from 'lucide-react';
         ```

      2. In the `results` useMemo (around line 100), after computing matchedPages,
         matchedActions, and matchedData, add quick capture items when the query has text
         but matches are sparse (fewer than 3 data items matched):

         ```ts
         // Quick Capture: when user types text with few/no matches, offer to create entities
         const captureItems: CommandItem[] = [];
         if (trimmed.length >= 2 && matchedData.length < 3) {
           // Get most recent active project for "Create card" option
           const activeProject = projects.find(p => !p.archived);

           captureItems.push({
             id: 'capture-idea',
             label: `Create idea: "${trimmed}"`,
             icon: Zap,
             category: 'Quick Capture',
             action: () => {
               createIdea(trimmed);
               onClose();
             },
           });

           if (activeProject) {
             captureItems.push({
               id: 'capture-card',
               label: `Create card in ${activeProject.name}: "${trimmed}"`,
               icon: PlusCircle,
               category: 'Quick Capture',
               action: () => {
                 createCardInFirstColumn(activeProject.id, trimmed);
                 onClose();
               },
             });
           }

           captureItems.push({
             id: 'capture-brainstorm',
             label: `Start brainstorm: "${trimmed}"`,
             icon: MessageSquare,
             category: 'Quick Capture',
             action: () => {
               go(`/brainstorm?newSession=${encodeURIComponent(trimmed)}`);
             },
           });
         }

         return [...matchedPages, ...matchedActions, ...matchedData, ...captureItems];
         ```

      3. Truncate the display text in capture items to prevent overflow. If `trimmed` is
         longer than 40 chars, show first 40 + "...":
         ```ts
         const displayText = trimmed.length > 40 ? trimmed.slice(0, 40) + '...' : trimmed;
         ```
         Use `displayText` in the labels instead of `trimmed`.

      **B. Create idea from command palette**

      4. Import `useIdeaStore` (already imported). Access `createIdea`:
         ```ts
         const storeCreateIdea = useIdeaStore(s => s.createIdea);
         ```

      5. Create a helper function inside the component:
         ```ts
         const createIdea = useCallback(async (title: string) => {
           try {
             await storeCreateIdea({ title, description: '', tags: [] });
             toast(`Idea created: "${title}"`, 'success');
           } catch {
             toast('Failed to create idea', 'error');
           }
         }, [storeCreateIdea]);
         ```

      6. Import `toast` from '../hooks/useToast'.

      **C. Create card in first column from command palette**

      7. This requires a new helper. The boardStore has `loadBoards(projectId)` and after
         loading, we can access columns and create a card. However, we need to keep it simple.

         Add a new convenience function. In the CommandPalette component:
         ```ts
         const createCardInFirstColumn = useCallback(async (projectId: string, title: string) => {
           try {
             // Load boards for the project to find the first column
             const boards = await window.electronAPI.getBoards(projectId);
             if (boards.length === 0) {
               toast('No board found for this project', 'error');
               return;
             }
             const boardColumns = await window.electronAPI.getColumns(boards[0].id);
             if (boardColumns.length === 0) {
               toast('No columns in this board', 'error');
               return;
             }
             // Create card in first column at position 0
             await window.electronAPI.createCard({
               columnId: boardColumns[0].id,
               title,
               description: null,
               priority: 'medium',
               position: 0,
             });
             // Refresh allCards in boardStore
             loadAllCards();
             toast(`Card created in ${boardColumns[0].name}`, 'success');
           } catch {
             toast('Failed to create card', 'error');
           }
         }, [loadAllCards]);
         ```

      8. Access `loadAllCards` from boardStore:
         ```ts
         const loadAllCards = useBoardStore(s => s.loadAllCards);
         ```

      **D. Brainstorm session from command palette**

      9. The brainstorm capture action navigates to `/brainstorm?newSession=<title>`.
         In BrainstormPage.tsx, this param should trigger creating a new session. BUT to
         keep this task simple, we'll navigate to `/brainstorm` and let the user see the
         title pre-filled. Actually, the simplest approach: navigate to the brainstorm page.
         The user can then create a session there. Use the existing flow:
         ```ts
         go('/brainstorm');
         ```
         (The user will see the brainstorm page and can start a new session. Pre-filling
         is a nice-to-have for a future iteration.)

      WHY: The Command Palette already has a global shortcut (Ctrl+Shift+Space) that works
      from any application. Adding quick capture transforms it from "search and navigate" into
      "search, navigate, OR capture." When the user types something that doesn't match existing
      data, the capture options appear naturally. Zero new infrastructure needed.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: open command palette (Ctrl+K or Ctrl+Shift+Space)
      4. Manual: type "Fix login redirect bug" → if no match, see Quick Capture section:
         - "Create idea: Fix login redirect bug"
         - "Create card in [Project Name]: Fix login redirect bug"
         - "Start brainstorm: Fix login redirect bug"
      5. Manual: click "Create idea" → idea created, toast confirms, palette closes
      6. Manual: click "Create card" → card created in first column of most recent project
      7. Manual: navigate to Ideas page → new idea appears with the typed title
      8. Manual: navigate to the project board → new card appears in first column
      9. Manual: type something that DOES match existing data → Quick Capture section
         does NOT appear (or appears below matches)
      10. Manual: from another app, Ctrl+Shift+Space → type text → capture works
    </verify>
    <done>
      Command Palette shows "Quick Capture" options when typed text has few/no matches.
      Users can create ideas, cards (in most recent project), or navigate to brainstorm
      directly from the command palette. Works via global shortcut from any application.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - ideaStore.createIdea accepts { title, description, tags } (standard pattern)
      - window.electronAPI.getBoards, getColumns, createCard are exposed via preload bridge
        (confirmed from existing ActionItemList.tsx which does the same card creation flow)
      - boardStore.loadAllCards exists and refreshes the allCards array
      - The "first active project" heuristic is good enough for Quick Capture. Users who
        want a specific project can use the full card creation flow instead.
      - BrainstormPage can handle a simple navigation without a query param for now
    </assumptions>
  </task>
</phase>
