# Phase 2 — Plan 3 of 3: Rich Text + Polish

## Coverage
- **R3: Project Dashboard** (final ~25% — card detail modal, TipTap editor, labels, search/filter)

## Plan Overview
Phase 2 delivers the full project dashboard (R3). It requires 3 plans:

- **Plan 2.1** (done): Data layer — types, IPC CRUD, preload bridge, Zustand store, project list UI.
- **Plan 2.2** (done): Kanban board — board store, column layout, card rendering, drag-and-drop.
- **Plan 2.3** (this plan): Rich text + polish — card detail modal with TipTap editor,
  labels management, board search and filter.

## Design Decisions for This Plan

1. **Card detail modal** — centered overlay (max-w-2xl) that opens on card click.
   Contains title editing, TipTap rich text editor for description, priority selector,
   labels, and timestamps. Overlay click or Escape to close.
2. **TipTap editor** — uses `useEditor` + `EditorContent` pattern from @tiptap/react v3.19.
   StarterKit for basic formatting (bold, italic, headings, lists, code, blockquote).
   Placeholder extension for empty state. Auto-save description on editor blur.
3. **Labels** — project-level labels (shared across all cards in a project). IPC handlers
   already exist. Add label state + actions to boardStore. Label management in card detail modal
   (attach/detach + create new inline).
4. **Search/filter** — client-side filtering of the cards array in BoardPage. Search by title,
   filter by priority and labels. Applied before grouping cards into columns.
5. **boardStore fix** — `updateCard` and `moveCard` currently replace the entire card object
   with the IPC response, which doesn't include labels. Fix to spread-merge so labels are preserved.

---

<phase n="2.3" name="Rich Text + Polish">
  <context>
    Plan 2.2 is complete. The app now has:
    - boardStore (Zustand) managing board, columns, cards via IPC
    - BoardPage with horizontal column layout, drag-and-drop
    - BoardColumn component with drop target behavior
    - KanbanCard with priority border/badge, label dots, inline editing, drag support
    - All label IPC handlers (list, create, update, delete, attach, detach)
    - TipTap packages installed: @tiptap/react, @tiptap/starter-kit, @tiptap/extension-placeholder (v3.19.0)

    Bug to fix: boardStore.updateCard and boardStore.moveCard replace the entire card with
    the IPC response. The IPC response is the raw DB card which does NOT include the `labels`
    field (labels is a relation fetched separately in cards:list-by-board). So after any
    updateCard or moveCard call, the card's labels array is lost from state. Fix: use
    `{ ...existingCard, ...updatedFields }` to preserve labels.

    IPC methods available for labels:
    - getLabels(projectId) → Label[]
    - createLabel({ projectId, name, color }) → Label
    - updateLabel(id, { name?, color? }) → Label
    - deleteLabel(id) → void
    - attachLabel(cardId, labelId) → void
    - detachLabel(cardId, labelId) → void

    TipTap API (v3.19.0, verified from installed types):
    - import { useEditor, EditorContent } from '@tiptap/react';
    - import StarterKit from '@tiptap/starter-kit';
    - import Placeholder from '@tiptap/extension-placeholder';
    - useEditor({ extensions: [...], content: string, onUpdate?, onBlur?, immediatelyRender? })
    - EditorContent component with `editor` prop and optional `className`
    - editor.getHTML() returns HTML string
    - editor.commands.setContent(html) to set content programmatically

    Existing design patterns:
    - bg-surface-900 main bg, bg-surface-800 card bg, border-surface-700
    - text-surface-100 headings, text-surface-400 body, text-surface-500 muted
    - bg-primary-600 buttons, hover:bg-primary-500
    - Input: bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-sm
    - Modal overlay: fixed inset-0 bg-black/50 z-50
    - lucide-react for icons

    @src/renderer/stores/boardStore.ts
    @src/renderer/pages/BoardPage.tsx
    @src/renderer/components/KanbanCard.tsx
    @src/renderer/components/BoardColumn (inline in BoardPage.tsx)
    @src/renderer/styles/globals.css
    @src/shared/types.ts
    @src/main/ipc/cards.ts
    @src/preload/preload.ts
  </context>

  <task type="auto" n="1">
    <n>Card detail modal with TipTap rich text editor</n>
    <files>
      src/renderer/components/CardDetailModal.tsx (create — modal component)
      src/renderer/styles/globals.css (modify — add TipTap editor styles)
      src/renderer/stores/boardStore.ts (modify — fix updateCard/moveCard label preservation)
      src/renderer/components/KanbanCard.tsx (modify — add onClick prop)
      src/renderer/pages/BoardPage.tsx (modify — add selectedCardId state, render modal, pass onClick through BoardColumn)
    </files>
    <action>
      Create a card detail modal and wire it into the board UI. Fix a bug where labels are
      lost on card update.

      WHY: Users need to view and edit full card details including rich text descriptions.
      The card on the board is compact — the modal provides the full editing experience.
      The TipTap editor enables structured content (headings, lists, bold/italic, code).

      Steps:

      1. Fix boardStore.ts — preserve labels on updateCard and moveCard:

         Current (BROKEN):
         ```typescript
         updateCard: async (id, data) => {
           const updated = await window.electronAPI.updateCard(id, data);
           set({ cards: get().cards.map(c => (c.id === id ? updated : c)) });
         },
         moveCard: async (id, columnId, position) => {
           const updated = await window.electronAPI.moveCard(id, columnId, position);
           set({ cards: get().cards.map(c => (c.id === id ? updated : c)) });
         },
         ```

         Fixed (PRESERVES LABELS):
         ```typescript
         updateCard: async (id, data) => {
           const updated = await window.electronAPI.updateCard(id, data);
           set({ cards: get().cards.map(c => (c.id === id ? { ...c, ...updated } : c)) });
         },
         moveCard: async (id, columnId, position) => {
           const updated = await window.electronAPI.moveCard(id, columnId, position);
           set({ cards: get().cards.map(c => (c.id === id ? { ...c, ...updated } : c)) });
         },
         ```

         WHY: The IPC response contains only the cards table columns (no labels).
         Spreading `updated` over `c` updates DB fields while keeping the `labels` array
         intact because `updated` does not have a `labels` property.

      2. Add TipTap editor styles to globals.css:

         Add at the end of globals.css:
         ```css
         /* TipTap rich text editor styles */
         .tiptap-editor .ProseMirror {
           outline: none;
           min-height: 120px;
           padding: 0.75rem;
           color: var(--color-surface-100);
           font-size: 0.875rem;
           line-height: 1.625;
         }
         .tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
           content: attr(data-placeholder);
           color: var(--color-surface-500);
           float: left;
           height: 0;
           pointer-events: none;
         }
         .tiptap-editor .ProseMirror h1 { font-size: 1.25rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
         .tiptap-editor .ProseMirror h2 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
         .tiptap-editor .ProseMirror h3 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
         .tiptap-editor .ProseMirror ul { list-style: disc; padding-left: 1.5rem; margin: 0.5rem 0; }
         .tiptap-editor .ProseMirror ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
         .tiptap-editor .ProseMirror li { margin: 0.125rem 0; }
         .tiptap-editor .ProseMirror blockquote {
           border-left: 3px solid var(--color-surface-600);
           padding-left: 1rem;
           color: var(--color-surface-400);
           margin: 0.5rem 0;
         }
         .tiptap-editor .ProseMirror code {
           background: var(--color-surface-800);
           border-radius: 0.25rem;
           padding: 0.125rem 0.375rem;
           font-size: 0.8125rem;
           font-family: ui-monospace, monospace;
         }
         .tiptap-editor .ProseMirror pre {
           background: var(--color-surface-800);
           border-radius: 0.5rem;
           padding: 0.75rem;
           margin: 0.5rem 0;
           overflow-x: auto;
         }
         .tiptap-editor .ProseMirror pre code {
           background: none;
           padding: 0;
         }
         ```

      3. Create src/renderer/components/CardDetailModal.tsx:

         A modal overlay component for viewing and editing full card details.

         Props:
         ```typescript
         interface CardDetailModalProps {
           card: Card;
           onUpdate: (id: string, data: UpdateCardInput) => Promise&lt;void&gt;;
           onClose: () => void;
         }
         ```

         Layout (centered overlay):
         ```
         ┌─────────────────────────────────────────────────┐
         │ [Title - click to edit]                    [X]  │
         │                                                 │
         │  Priority: [LOW] [MED] [HIGH] [URG]             │
         │                                                 │
         │  Description                                    │
         │  ┌───────────────────────────────────────────┐  │
         │  │ TipTap editor...                          │  │
         │  │ (rich text with formatting)               │  │
         │  │                                           │  │
         │  └───────────────────────────────────────────┘  │
         │                                                 │
         │  Labels (Task 2 adds this section)              │
         │                                                 │
         │  Created: Jan 15, 2026 · Updated: Jan 16, 2026 │
         └─────────────────────────────────────────────────┘
         ```

         Structure:
         - Overlay: `fixed inset-0 z-50 flex items-center justify-center bg-black/50`
           Click overlay (not modal content) to close.
         - Modal: `bg-surface-900 rounded-xl border border-surface-700 w-full max-w-2xl
           max-h-[80vh] overflow-y-auto mx-4 p-6`
         - Close on Escape (useEffect with keydown listener)
         - Close button: X icon in top-right

         Title section:
         - Click title text to enter edit mode
         - Input: same styling as board forms
         - Enter to save (call onUpdate with { title }), Escape to cancel
         - Text display: `text-xl font-bold text-surface-100`

         Priority section:
         - 4 buttons in a row: LOW / MED / HIGH / URG
         - Use the same PRIORITY_CONFIG color scheme from KanbanCard
         - Active button has filled background, others have outline
         - Click to change priority (call onUpdate with { priority })

         Description section:
         - Label: "Description" in text-sm text-surface-400
         - TipTap editor setup:
           ```typescript
           import { useEditor, EditorContent } from '@tiptap/react';
           import StarterKit from '@tiptap/starter-kit';
           import Placeholder from '@tiptap/extension-placeholder';

           const editor = useEditor({
             extensions: [
               StarterKit,
               Placeholder.configure({ placeholder: 'Add a description...' }),
             ],
             content: card.description || '',
             immediatelyRender: true,
             onBlur: ({ editor }) => {
               const html = editor.getHTML();
               // Only save if content changed (compare with card.description)
               const isEmpty = html === '&lt;p&gt;&lt;/p&gt;' || html === '';
               const newDesc = isEmpty ? null : html;
               if (newDesc !== card.description) {
                 onUpdate(card.id, { description: newDesc });
               }
             },
           });
           ```
         - Editor container: `bg-surface-800/50 rounded-lg border border-surface-700`
         - Wrap EditorContent in a div with className `tiptap-editor` (targets our CSS styles)

         Timestamps:
         - Footer showing "Created: [date] · Updated: [date]"
         - Use same formatDate helper as ProjectsPage
         - `text-xs text-surface-500`

         IMPORTANT:
         - Do NOT add labels section yet — that's Task 2
         - Do NOT add delete button — deletion is already on KanbanCard
         - Keep the component under 200 lines
         - Use lucide-react icons: X for close button

      4. Modify KanbanCard.tsx — add onClick prop:

         Add to KanbanCardProps:
         ```typescript
         onClick?: () => void;
         ```

         Add click handler on the card root div:
         ```typescript
         onClick={onClick}
         ```

         The click handler should NOT fire during inline editing or when clicking action buttons.
         Use `e.stopPropagation()` on the edit input, edit/delete buttons to prevent bubbling.
         Add stopPropagation to: the edit input's onClick, the Pencil button's onClick,
         the Trash2 button's onClick, and the "Delete?" button's onClick.

      5. Modify BoardPage.tsx — add modal state and render:

         In BoardPage:
         - Add state: `const [selectedCardId, setSelectedCardId] = useState&lt;string | null&gt;(null);`
         - Derive selectedCard: `const selectedCard = selectedCardId ? cards.find(c =&gt; c.id === selectedCardId) ?? null : null;`
         - Render modal at end of return (after column container):
           ```tsx
           {selectedCard &amp;&amp; (
             &lt;CardDetailModal
               card={selectedCard}
               onUpdate={updateCard}
               onClose={() =&gt; setSelectedCardId(null)}
             /&gt;
           )}
           ```
         - Import CardDetailModal
         - Pass `onCardClick` prop through BoardColumn to KanbanCard

         In BoardColumnProps, add:
         ```typescript
         onCardClick: (cardId: string) =&gt; void;
         ```

         In BoardColumn's KanbanCard rendering:
         ```tsx
         &lt;KanbanCard
           key={card.id}
           card={card}
           onUpdate={updateCard}
           onDelete={deleteCard}
           onClick={() =&gt; onCardClick(card.id)}
         /&gt;
         ```

         In BoardPage's column rendering, pass the new prop:
         ```tsx
         onCardClick={(cardId) =&gt; setSelectedCardId(cardId)}
         ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify CardDetailModal.tsx exists with:
         - TipTap editor setup (useEditor, EditorContent, StarterKit, Placeholder)
         - Title editing on click
         - Priority button group with 4 options
         - Auto-save description on blur
         - Overlay click and Escape to close
         - Timestamps display
      3. Verify globals.css has .tiptap-editor .ProseMirror styles
      4. Verify KanbanCard.tsx has onClick prop with stopPropagation on interactive elements
      5. Verify BoardPage.tsx has selectedCardId state and renders CardDetailModal
      6. Verify boardStore.ts updateCard and moveCard use spread merge pattern
    </verify>
    <done>
      Card detail modal opens on card click. Shows editable title, priority selector,
      TipTap rich text description editor with auto-save on blur, and timestamps.
      Labels preserved across card updates (boardStore fix). Editor styled for dark theme.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - TipTap v3.19.0 useEditor + EditorContent API is stable and works in Electron renderer
      - immediatelyRender: true is correct for client-side rendering in Electron
      - onBlur fires reliably when clicking outside the editor
      - Card click and drag do not conflict (pragmatic-dnd does not fire click after drag)
      - e.stopPropagation() on action buttons prevents card onClick from firing
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Labels management in card detail + board store</n>
    <files>
      src/renderer/stores/boardStore.ts (modify — add labels state and label actions)
      src/renderer/components/CardDetailModal.tsx (modify — add labels section)
    </files>
    <preconditions>
      - Task 1 completed (CardDetailModal exists, boardStore has label-preserving updateCard)
    </preconditions>
    <action>
      Add label management to the board store and card detail modal. Labels are project-level
      (shared across all cards in a project). Users can create labels, then attach/detach them
      from individual cards.

      WHY: Labels provide visual categorization at a glance (the colored dots on KanbanCard
      already render them). Users need a way to create labels and assign them to cards.

      Steps:

      1. Modify boardStore.ts — add label state and actions:

         Add to BoardStore interface:
         ```typescript
         labels: Label[];
         loadLabels: () => Promise&lt;void&gt;;
         createLabel: (name: string, color: string) => Promise&lt;Label&gt;;
         deleteLabel: (id: string) => Promise&lt;void&gt;;
         attachLabel: (cardId: string, labelId: string) => Promise&lt;void&gt;;
         detachLabel: (cardId: string, labelId: string) => Promise&lt;void&gt;;
         ```

         Add imports: `Label, CreateLabelInput` from shared types.

         Add to store initial state: `labels: []`

         In loadBoard action, after loading columns and cards, also load labels:
         ```typescript
         const labels = await window.electronAPI.getLabels(projectId);
         set({ project, board, columns, cards, labels, loading: false });
         ```

         Implement actions:

         loadLabels:
         ```typescript
         loadLabels: async () => {
           const { project } = get();
           if (!project) return;
           const labels = await window.electronAPI.getLabels(project.id);
           set({ labels });
         },
         ```

         createLabel:
         ```typescript
         createLabel: async (name, color) => {
           const { project, labels } = get();
           if (!project) throw new Error('No project loaded');
           const label = await window.electronAPI.createLabel({
             projectId: project.id, name, color,
           });
           set({ labels: [...labels, label] });
           return label;
         },
         ```

         deleteLabel:
         ```typescript
         deleteLabel: async (id) => {
           await window.electronAPI.deleteLabel(id);
           set({
             labels: get().labels.filter(l => l.id !== id),
             // Also remove from all cards' labels arrays
             cards: get().cards.map(c => ({
               ...c,
               labels: c.labels?.filter(l => l.id !== id),
             })),
           });
         },
         ```

         attachLabel:
         ```typescript
         attachLabel: async (cardId, labelId) => {
           await window.electronAPI.attachLabel(cardId, labelId);
           const label = get().labels.find(l => l.id === labelId);
           if (!label) return;
           set({
             cards: get().cards.map(c => {
               if (c.id !== cardId) return c;
               const existing = c.labels ?? [];
               if (existing.some(l => l.id === labelId)) return c;
               return { ...c, labels: [...existing, label] };
             }),
           });
         },
         ```

         detachLabel:
         ```typescript
         detachLabel: async (cardId, labelId) => {
           await window.electronAPI.detachLabel(cardId, labelId);
           set({
             cards: get().cards.map(c => {
               if (c.id !== cardId) return c;
               return { ...c, labels: c.labels?.filter(l => l.id !== labelId) };
             }),
           });
         },
         ```

      2. Modify CardDetailModal.tsx — add labels section:

         Add a labels section between the description editor and the timestamps.

         The labels section:
         ```
         Labels
         [label1 ×] [label2 ×]  [+ Add]

         When "+ Add" is clicked, show a dropdown:
         ┌────────────────────────┐
         │ Search labels...       │
         │ ● Bug (red)        [+] │
         │ ● Feature (green)  [+] │
         │ ● Docs (blue)      [+] │
         │ ─────────────────────  │
         │ Create new label       │
         │ [name] [color] [Add]   │
         └────────────────────────┘
         ```

         Implementation:
         - Import `useBoardStore` to get labels, createLabel, attachLabel, detachLabel
         - Add to component props (or just use the store directly):
           Not needed in props — get labels + actions from useBoardStore
         - Local state: `showLabelDropdown` (boolean), `newLabelName` (string),
           `newLabelColor` (string, from PRESET_COLORS)

         Attached labels display:
         - Row of label pills: colored dot + label name + X button to detach
         - Pill: `inline-flex items-center gap-1.5 bg-surface-800 rounded-full px-2.5 py-1 text-xs`
         - Colored dot: `w-2 h-2 rounded-full` with label.color
         - X button: click calls detachLabel(card.id, label.id)

         Label dropdown:
         - Position: below the "+ Add" button or inline
         - List all project labels not yet attached to this card
         - Each row: colored dot + label name + "+" button to attach
         - Click "+" calls attachLabel(card.id, label.id) and removes from dropdown
         - Create new label section at bottom:
           - Text input for name + color picker (preset colors as small circles)
           - "Add" button calls createLabel then attachLabel

         PRESET_COLORS for labels (same 6 from ProjectsPage):
         ```typescript
         const LABEL_COLORS = [
           '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
         ];
         ```

         IMPORTANT:
         - The card prop will reflect updated labels because boardStore updates
           the cards array in attachLabel/detachLabel.
         - Close the dropdown when clicking outside (useEffect with click listener
           on document, check if click target is outside dropdown ref)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify boardStore.ts has labels state, loadLabels, createLabel, deleteLabel,
         attachLabel, detachLabel actions
      3. Verify labels are loaded in loadBoard action
      4. Verify CardDetailModal.tsx has:
         - Attached labels display with remove (×) buttons
         - "+ Add" button opening a label dropdown
         - Dropdown lists unattached project labels with attach button
         - Create new label form (name + color)
      5. Verify detachLabel updates both cardLabels DB and local card state
      6. Verify deleteLabel cleans up labels from all cards in local state
    </verify>
    <done>
      Labels can be created for a project (with name + color). Labels can be attached to
      and detached from cards in the card detail modal. Attached labels show as pills with
      remove buttons. Unattached labels available in dropdown. Label dots on KanbanCard
      reflect changes immediately via Zustand state.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - attachLabel IPC handler uses onConflictDoNothing (verified in cards.ts:183)
      - detachLabel IPC handler deletes the specific cardLabels row (verified in cards.ts:189)
      - Labels loaded at board level are sufficient (no per-card label fetching needed after initial load)
      - useBoardStore can be called in CardDetailModal without issues (Zustand works anywhere in React tree)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Search and filter cards on the board</n>
    <files>
      src/renderer/pages/BoardPage.tsx (modify — add search input, filter dropdowns, filtering logic)
    </files>
    <preconditions>
      - Task 1 completed (BoardPage has card detail modal)
      - Task 2 completed (boardStore has labels state)
    </preconditions>
    <action>
      Add search and filter functionality to the board header. Filtering is client-side
      since all cards are already loaded in the board store.

      WHY: As boards accumulate cards, users need to quickly find specific cards by title
      or narrow down the view by priority or label. Client-side filtering is instant since
      we already have all card data in memory.

      Steps:

      1. Add filter state to BoardPage:

         ```typescript
         const [searchQuery, setSearchQuery] = useState('');
         const [priorityFilter, setPriorityFilter] = useState&lt;CardPriority[]&gt;([]);
         const [labelFilter, setLabelFilter] = useState&lt;string[]&gt;([]);
         ```

         Import `CardPriority` from shared types.
         Get `labels` from useBoardStore (add to destructured values).

      2. Add filtering logic:

         ```typescript
         const filteredCards = cards.filter(card => {
           // Search: check title (case-insensitive)
           if (searchQuery) {
             const query = searchQuery.toLowerCase();
             const matchesTitle = card.title.toLowerCase().includes(query);
             const matchesDesc = card.description?.toLowerCase().includes(query) ?? false;
             if (!matchesTitle &amp;&amp; !matchesDesc) return false;
           }
           // Priority filter (if any selected, card must match one)
           if (priorityFilter.length > 0 &amp;&amp; !priorityFilter.includes(card.priority)) {
             return false;
           }
           // Label filter (if any selected, card must have at least one matching label)
           if (labelFilter.length > 0) {
             const cardLabelIds = card.labels?.map(l => l.id) ?? [];
             if (!labelFilter.some(id => cardLabelIds.includes(id))) return false;
           }
           return true;
         });
         ```

         Pass `filteredCards` instead of `cards` to column rendering:
         ```tsx
         columnCards={getCardsByColumn(filteredCards, column.id)}
         ```

         Also use `filteredCards` for the drag monitor's position calculation.

      3. Add search/filter UI to the board header:

         Expand the header area. Current header:
         ```
         [←] Project Name
         ```

         New header layout:
         ```
         [←] Project Name                    [Search...] [Priority ▾] [Labels ▾]
         ```

         Or if filters are active, show below the header line:
         ```
         [←] Project Name
         [Search...] [Priority ▾] [Labels ▾]  [Clear filters]  (X results)
         ```

         Recommended approach: Add a second row to the header when filters exist
         or always show the search bar. Keep it simple.

         Search input:
         - Right side of header: `flex-1 max-w-xs` input
         - Icon: Search from lucide-react as left adornment
         - `bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-3 py-1.5 text-sm`
         - Debounce NOT needed — filtering is client-side and instant
         - Clear button (X) inside input when query is non-empty

         Priority filter dropdown:
         - Button: "Priority" + chevron icon (ChevronDown)
         - Dropdown: 4 checkboxes (Low, Medium, High, Urgent) with colored dots
         - Toggle individual priorities on/off
         - Multi-select: clicking a priority adds/removes it from priorityFilter array
         - Badge on button showing count of active filters

         Label filter dropdown:
         - Button: "Labels" + chevron icon
         - Dropdown: list all project labels with checkboxes
         - Toggle individual labels on/off
         - Multi-select: clicking a label adds/removes it from labelFilter array
         - Badge on button showing count of active filters
         - If no labels exist, show "No labels" text

         Clear filters button:
         - Only visible when any filter is active
         - Resets searchQuery, priorityFilter, and labelFilter to defaults

         Active filter indicator:
         - When filters are active, show "Showing X of Y cards" text
         - `text-xs text-surface-500`

         Dropdown implementation:
         - Use local state: `showPriorityDropdown`, `showLabelDropdown`
         - Position: absolute below the trigger button
         - Close on click outside (same pattern as label dropdown in Task 2)
         - Dropdown: `absolute top-full mt-1 bg-surface-800 border border-surface-700
           rounded-lg shadow-lg p-2 min-w-[180px] z-40`

         Icons: Search, ChevronDown, X from lucide-react

      IMPORTANT:
      - Filtering must not break drag-and-drop. The monitor's onDrop should still use
        the full `cards` array for position calculation, not filteredCards.
        Wait — actually, the position should be relative to the target column's cards.
        But if we're filtering, the visible cards are a subset. When dropping a card,
        we want to append it to the END of the target column (all cards, not just filtered).
        So the drag monitor should use the unfiltered `cards` from the store, not filteredCards.
        The current monitor already references `cards` from the store destructuring,
        so this should work correctly — just make sure not to change it to filteredCards.
      - Keep the board layout responsive — don't let the header grow too tall
      - Filter state resets when navigating away (component unmounts)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify BoardPage.tsx has:
         - searchQuery, priorityFilter, labelFilter state
         - filteredCards computed from cards with all 3 filters applied
         - filteredCards passed to getCardsByColumn in column rendering
         - Search input in header with clear button
         - Priority filter dropdown with 4 priority options
         - Label filter dropdown showing project labels
         - "Clear filters" button visible when filters active
         - Active filter indicator (X of Y cards)
      3. Verify drag-and-drop still uses unfiltered cards for position calculation
      4. Verify dropdowns close on outside click
    </verify>
    <done>
      Board header has search input and filter dropdowns (priority + labels).
      Cards are filtered client-side in real-time. Active filters show indicator
      and "Clear filters" button. Drag-and-drop works correctly with filtered views.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Client-side filtering is fast enough for v1 (single-user, typical board has &lt;100 cards)
      - Search checks title and description (HTML content — searches raw HTML strings, which
        is imperfect but acceptable for v1. A future improvement could strip HTML tags.)
      - Filtering doesn't affect drag-and-drop because the monitor uses unfiltered store cards
      - Dropdowns don't need complex positioning — simple absolute below trigger works
    </assumptions>
  </task>
</phase>
