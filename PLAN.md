# Plan 7.2: Advanced Card Features — Comments, Relationships & Activity UI

## Coverage
- **R16: Advanced Card Features** (UI) — Comments UI, relationships UI, activity log, card templates

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| **7.2** | **R16 (UI)** | **Comments UI, relationships UI, activity log, card templates in CardDetailModal** |
| 7.3 | R15 | Database backup/restore (pg_dump), JSON/CSV export, backup UI |
| 7.4 | R11 | Task structuring AI service — project planning, pillars, task breakdown |
| 7.5 | R11 (UI) | Task structuring UI — planning wizard, templates, milestone view |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| 7.7 | R13 | Meeting templates, analytics, speaker diarization |
| 7.8 | R17 | Notifications service, desktop/tray notifications, reminders |

## Plan 7.2 Overview

This plan builds the UI for R16's card features on top of Plan 7.1's backend:
- **Task 1**: CommentsSection + ActivityLog standalone components
- **Task 2**: RelationshipsSection + CardDetailModal integration (wire all sections,
  load/clear card details, expand modal layout)
- **Task 3**: Card template presets + template selector in CardDetailModal

## Architecture Decisions for Plan 7.2

1. **Extract sections as standalone components** — CommentsSection, RelationshipsSection,
   and ActivityLog are each their own files. This keeps CardDetailModal manageable
   (currently 322 lines) and follows the pattern used in MeetingDetailModal (BriefSection,
   ActionItemList are separate components).

2. **Components use boardStore directly** — Each section component calls `useBoardStore()`
   to access state and actions. This avoids prop-drilling and matches the existing pattern
   where CardDetailModal already imports `useBoardStore`.

3. **Relationship card picker uses same-board cards** — The target card dropdown shows
   all non-archived cards on the current board (from `boardStore.cards`). Cross-board
   relationships are possible via IPC but we scope the picker to current board for simplicity.

4. **Card templates as hardcoded presets** — 5 built-in templates (Bug Report, Feature
   Request, Meeting Action, Quick Note, Research Task). Applied via TipTap `setContent()`.
   No DB storage for templates — custom templates can be added later if needed.

5. **Relative timestamps everywhere** — Use a shared `timeAgo()` helper for comments,
   activities, and relationships. Shows "2m ago", "3h ago", "5d ago" etc.

---

<phase n="7.2" name="Advanced Card Features — Comments, Relationships & Activity UI">
  <context>
    Plan 7.1 completed the backend: 3 DB tables, 8 IPC handlers, 8 preload bridge
    methods, logCardActivity helper, and boardStore extensions (4 state fields + 7 actions).
    This plan adds the renderer UI.

    Existing infrastructure:
    @src/renderer/components/CardDetailModal.tsx — 322 lines, has title editing, priority
      selector, TipTap description editor, labels management, timestamps. Uses useBoardStore.
    @src/renderer/stores/boardStore.ts — 308 lines, has selectedCardComments,
      selectedCardRelationships, selectedCardActivities, loadingCardDetails state +
      loadCardDetails, clearCardDetails, addComment, updateComment, deleteComment,
      addRelationship, deleteRelationship actions.
    @src/renderer/pages/BoardPage.tsx — 590 lines, manages selectedCardId state,
      renders CardDetailModal with card + onUpdate + onClose props.
    @src/shared/types.ts — CardComment, CardRelationship, CardActivity, CardRelationshipType,
      CardActivityAction, CreateCardCommentInput, CreateCardRelationshipInput types.

    UI patterns established:
    - Dark theme: bg-surface-900, border-surface-700, text-surface-100/400/500
    - Section headers: text-sm text-surface-400 block mb-2
    - Buttons: primary (bg-primary-600 hover:bg-primary-500) or ghost (text-surface-400 hover:text-surface-200)
    - Icons: lucide-react, size 14-16 for inline, 20 for header actions
    - Modal: z-50, max-w-2xl, bg-black/50 overlay, Escape + overlay click close

    Relative time helper pattern (from MeetingDetailModal):
    - Uses simple date math: seconds → "Xm ago", hours → "Xh ago", days → "Xd ago"
  </context>

  <task type="auto" n="1">
    <n>CommentsSection + ActivityLog Components</n>
    <files>
      src/renderer/components/CommentsSection.tsx (new, ~180 lines)
      src/renderer/components/ActivityLog.tsx (new, ~140 lines)
    </files>
    <preconditions>
      - Plan 7.1 complete (boardStore has card detail state + actions)
      - TypeScript compiles clean
    </preconditions>
    <action>
      ## WHY
      Comments and activity log are core card detail features that need dedicated UI
      components. Extracting them keeps CardDetailModal at a manageable size.

      ## WHAT

      ### 0. timeAgo helper

      Both components need relative timestamps. Create a shared helper. Add this
      function at the top of CommentsSection.tsx (and import/reuse in ActivityLog.tsx,
      or duplicate — it's a small 10-line function):

      ```typescript
      function timeAgo(dateStr: string): string {
        const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (seconds &lt; 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes &lt; 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours &lt; 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days &lt; 30) return `${days}d ago`;
        return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      ```

      ### 1. CommentsSection.tsx

      Props: `cardId: string`

      Uses `useBoardStore()` to get:
      - `selectedCardComments` — the comments array (newest first)
      - `addComment` — to create new comments
      - `updateComment` — to edit existing comments
      - `deleteComment` — to remove comments

      UI structure:

      ```
      ┌─ Comments (3) ──────────────────────┐
      │                                      │
      │  [textarea: Write a comment...]      │
      │  [Add Comment button]                │
      │                                      │
      │  ┌─ Comment ───────────────────────┐ │
      │  │ Comment text content here...     │ │
      │  │ 2h ago  · [Edit] [Delete]        │ │
      │  └──────────────────────────────────┘ │
      │                                      │
      │  ┌─ Comment ───────────────────────┐ │
      │  │ Earlier comment text...          │ │
      │  │ 5d ago  · [Edit] [Delete]        │ │
      │  └──────────────────────────────────┘ │
      └──────────────────────────────────────┘
      ```

      State:
      - `newComment: string` — textarea value for adding
      - `editingId: string | null` — which comment is being edited
      - `editContent: string` — edit textarea value

      Behavior:
      - **Add**: textarea + "Add Comment" button (disabled if empty). On submit, call
        `addComment({ cardId, content: newComment })`, clear textarea.
      - **Edit**: Click "Edit" → replace comment text with textarea pre-filled with
        content. Save/Cancel buttons. On save, call `updateComment(id, editContent)`.
        On cancel or Escape, exit edit mode.
      - **Delete**: Click "Delete" → call `deleteComment(id)`. No confirmation needed
        (single action, easily re-created).
      - **Empty state**: "No comments yet" in muted text.

      Styling:
      - Section header: `text-sm text-surface-400` with count badge
        `bg-surface-800 text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-1.5`
      - Textarea: `bg-surface-800 border border-surface-700 rounded-lg p-3 text-sm
        text-surface-100 placeholder:text-surface-500 resize-none`
      - Add button: `bg-primary-600 hover:bg-primary-500 text-white text-sm px-3 py-1.5
        rounded-lg disabled:opacity-40`
      - Comment card: `bg-surface-800/50 rounded-lg px-3 py-2.5` with content as
        `text-sm text-surface-200` and footer as `text-xs text-surface-500`
      - Edit/Delete buttons: `text-xs text-surface-500 hover:text-surface-300`
      - Icons: MessageSquare for header (from lucide-react), Pencil for edit, Trash2 for delete

      ### 2. ActivityLog.tsx

      Props: `cardId: string`

      Uses `useBoardStore()` to get:
      - `selectedCardActivities` — the activities array (newest first, max 50)
      - `loadingCardDetails` — for loading state

      This is a **read-only** component. No add/edit/delete.

      UI structure:

      ```
      ┌─ Activity ─────────────────────────┐
      │                                     │
      │  ● Card created               2h ago│
      │  ● Priority updated            1h ago│
      │  ● Moved to "In Progress"     45m ago│
      │  ● Comment added              30m ago│
      │  ● Relationship added          5m ago│
      │                                     │
      └─────────────────────────────────────┘
      ```

      For each activity, render:
      - **Icon** per action type (from lucide-react):
        - `created` → PlusCircle (green)
        - `updated` → Pencil (blue)
        - `moved` → ArrowRight (amber)
        - `commented` → MessageSquare (purple)
        - `archived` → Archive (red)
        - `restored` → RotateCcw (green)
        - `relationship_added` → Link (blue)
        - `relationship_removed` → Unlink (red)
      - **Description text** from action + parsed details JSON:
        - `created` → "Card created" (+ title from details if available)
        - `updated` → "Updated " + fields list from details.fields
        - `moved` → "Moved card" (details has columnId but we don't have column name easily, keep simple)
        - `commented` → "Comment added"
        - `archived` → "Card archived"
        - `restored` → "Card restored"
        - `relationship_added` → "Linked to card" (+ type from details)
        - `relationship_removed` → "Unlinked from card"
      - **Relative timestamp** from `timeAgo(activity.createdAt)`

      Styling:
      - Section header: `text-sm text-surface-400` with Activity icon
      - Each entry: flex row with icon (size 14, colored per type), description
        `text-sm text-surface-300`, timestamp `text-xs text-surface-500 ml-auto`
      - Timeline connector: `border-l-2 border-surface-700` left of entries
      - Empty state: "No activity yet" in muted text
      - Max display: show all (already limited to 50 by backend)
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. CommentsSection.tsx exists with: add textarea, comment list, edit mode, delete
      3. ActivityLog.tsx exists with: icon per action type, description from details, relative timestamps
      4. Both components import from useBoardStore (no prop-drilling of state)
      5. timeAgo helper produces correct relative strings
    </verify>
    <done>
      CommentsSection (~180 lines) with add/edit/delete and ActivityLog (~140 lines)
      with action-typed timeline. Both standalone, using boardStore state directly.
      TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - lucide-react has all named icons: MessageSquare, Pencil, Trash2, PlusCircle,
        ArrowRight, Archive, RotateCcw, Link, Unlink (all standard lucide icons)
      - boardStore actions handle IPC calls and local state updates (verified in Plan 7.1)
      - selectedCardActivities.details is a JSON string or null (parse with try/catch)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>RelationshipsSection + CardDetailModal Integration</n>
    <files>
      src/renderer/components/RelationshipsSection.tsx (new, ~200 lines)
      src/renderer/components/CardDetailModal.tsx (modify — add load/clear lifecycle, 3 sections, wider modal)
    </files>
    <preconditions>
      - Task 1 complete (CommentsSection + ActivityLog exist)
      - boardStore has card detail state + actions (from Plan 7.1)
    </preconditions>
    <action>
      ## WHY
      The relationships section needs a card picker from the current board's cards,
      making it slightly more complex than comments. The CardDetailModal integration
      wires all 3 new sections into the existing modal and adds the load/clear lifecycle.

      ## WHAT

      ### 1. RelationshipsSection.tsx

      Props: `cardId: string`

      Uses `useBoardStore()` to get:
      - `cards` — all cards on current board (for the target picker)
      - `selectedCardRelationships` — relationships array
      - `addRelationship` — to create new relationships
      - `deleteRelationship` — to remove relationships

      UI structure:

      ```
      ┌─ Relationships (2) ────────────────────┐
      │                                         │
      │  [Card picker dropdown ▼] [Type ▼] [+]  │
      │                                         │
      │  Blocks                                 │
      │  ├── "Setup CI pipeline"          [×]   │
      │                                         │
      │  Depends on                             │
      │  ├── "Design mockups"             [×]   │
      │                                         │
      │  Related to                             │
      │  (none)                                 │
      └─────────────────────────────────────────┘
      ```

      State:
      - `selectedTargetId: string` — selected card from dropdown (default '')
      - `selectedType: CardRelationshipType` — relationship type (default 'related_to')
      - `showAddForm: boolean` — whether the add row is expanded (default false)

      **Relationship type display mapping:**
      For this card as source:
      - `blocks` → "Blocks" (shows targetCardTitle)
      - `depends_on` → "Depends on" (shows targetCardTitle)
      - `related_to` → "Related to" (shows targetCardTitle)

      For this card as target (inverse display):
      - `blocks` → "Blocked by" (shows sourceCardTitle)
      - `depends_on` → "Depended on by" (shows sourceCardTitle)
      - `related_to` → "Related to" (shows sourceCardTitle)

      Group relationships for display:
      1. Parse each relationship: if `sourceCardId === cardId`, it's "outgoing"
         (use type as-is, show targetCardTitle). If `targetCardId === cardId`, it's
         "incoming" (use inverse label, show sourceCardTitle).
      2. Group into: Blocks, Blocked by, Depends on, Depended on by, Related to.
      3. Only show groups that have entries.

      **Add relationship:**
      - "Add Relationship" button → toggles `showAddForm`
      - Card picker: `&lt;select&gt;` dropdown listing `cards.filter(c => c.id !== cardId &amp;&amp; !c.archived)`
        displaying card titles. Default option "Select a card..."
      - Type selector: `&lt;select&gt;` with options: Blocks, Depends on, Related to
      - Add button (Plus icon): calls `addRelationship({ sourceCardId: cardId, targetCardId: selectedTargetId, type: selectedType })`
      - Reset form after adding

      **Delete relationship:**
      - Each relationship row has an X button → calls `deleteRelationship(id)`

      **Empty state:** "No relationships" in muted text.

      **Styling:**
      - Section header: same pattern as CommentsSection with Link2 icon + count badge
      - Add form: `bg-surface-800/50 rounded-lg p-3` with flex row of select + select + button
      - Select inputs: `bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5
        text-sm text-surface-100`
      - Group labels: `text-xs uppercase tracking-wider text-surface-500 font-medium mt-3 mb-1`
      - Relationship row: flex with card title `text-sm text-surface-200` + delete button
      - Icons: Link2 for header, Plus for add, X for delete

      ### 2. CardDetailModal.tsx modifications

      **a) Add lifecycle hooks for card details:**

      Add `useEffect` to call `loadCardDetails(card.id)` on mount and
      `clearCardDetails()` on unmount:

      ```typescript
      const {
        labels, createLabel, attachLabel, detachLabel,
        loadCardDetails, clearCardDetails,
        loadingCardDetails,
      } = useBoardStore();

      useEffect(() => {
        loadCardDetails(card.id);
        return () => clearCardDetails();
      }, [card.id, loadCardDetails, clearCardDetails]);
      ```

      **b) Import and render new sections:**

      Add imports:
      ```typescript
      import CommentsSection from './CommentsSection';
      import RelationshipsSection from './RelationshipsSection';
      import ActivityLog from './ActivityLog';
      ```

      Add between Labels section and Timestamps, in this order:
      1. `&lt;CommentsSection cardId={card.id} /&gt;` — with mb-5
      2. `&lt;RelationshipsSection cardId={card.id} /&gt;` — with mb-5
      3. `&lt;ActivityLog cardId={card.id} /&gt;` — with mb-5

      **c) Expand modal width:**

      Change `max-w-2xl` to `max-w-3xl` to accommodate the extra sections.

      **d) Add loading indicator:**

      If `loadingCardDetails` is true, show a subtle spinner or "Loading..." text
      in the area where the new sections will appear. Something like:
      ```typescript
      {loadingCardDetails ? (
        &lt;div className="text-sm text-surface-500 py-4 text-center"&gt;Loading details...&lt;/div&gt;
      ) : (
        &lt;&gt;
          &lt;CommentsSection cardId={card.id} /&gt;
          &lt;RelationshipsSection cardId={card.id} /&gt;
          &lt;ActivityLog cardId={card.id} /&gt;
        &lt;/&gt;
      )}
      ```

      **e) Update file header comment** to reflect new scope.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. RelationshipsSection.tsx exists with: card picker dropdown, type selector, add/delete
      3. Relationships display grouped by type with correct directional labels
      4. CardDetailModal calls loadCardDetails on mount, clearCardDetails on unmount
      5. Modal renders CommentsSection, RelationshipsSection, ActivityLog between labels and timestamps
      6. Modal width is max-w-3xl
      7. Loading state shown while card details are being fetched
    </verify>
    <done>
      RelationshipsSection with card picker and grouped display. CardDetailModal
      integrates all 3 sections with load/clear lifecycle and wider layout.
      TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - boardStore.cards contains all non-archived cards for current board (verified in boardStore.ts)
      - CardRelationship type from backend includes sourceCardTitle and targetCardTitle (verified in Plan 7.1 IPC)
      - Multiple useEffect hooks in CardDetailModal are fine (already has 2 for Escape + label dropdown)
      - Expanding to max-w-3xl doesn't break the layout on standard screens (1280px+ displays)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Card Template Presets + Template Selector</n>
    <files>
      src/renderer/components/CardDetailModal.tsx (modify — add template dropdown)
    </files>
    <preconditions>
      - Task 2 complete (CardDetailModal has all 3 sections integrated)
      - TipTap editor exists in CardDetailModal (for setContent)
    </preconditions>
    <action>
      ## WHY
      Card templates save time when creating common card types. Instead of writing
      the same description structure repeatedly, users can apply a preset that fills
      in a structured description and sets an appropriate priority.

      ## WHAT

      ### 1. Define template presets

      Add a `CARD_TEMPLATES` array near the top of CardDetailModal.tsx (after PRIORITY_OPTIONS):

      ```typescript
      interface CardTemplate {
        id: string;
        name: string;
        icon: string; // emoji for visual identification
        priority: CardPriority;
        description: string; // HTML for TipTap
      }

      const CARD_TEMPLATES: CardTemplate[] = [
        {
          id: 'bug',
          name: 'Bug Report',
          icon: '🐛',
          priority: 'high',
          description: '&lt;h2&gt;Steps to Reproduce&lt;/h2&gt;&lt;ol&gt;&lt;li&gt;&lt;/li&gt;&lt;/ol&gt;&lt;h2&gt;Expected Behavior&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Actual Behavior&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Environment&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;',
        },
        {
          id: 'feature',
          name: 'Feature Request',
          icon: '✨',
          priority: 'medium',
          description: '&lt;h2&gt;User Story&lt;/h2&gt;&lt;p&gt;As a [user], I want [goal] so that [benefit].&lt;/p&gt;&lt;h2&gt;Acceptance Criteria&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;&lt;/li&gt;&lt;/ul&gt;&lt;h2&gt;Notes&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;',
        },
        {
          id: 'action',
          name: 'Meeting Action',
          icon: '📋',
          priority: 'medium',
          description: '&lt;h2&gt;Meeting&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Action Required&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Assignee&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Due Date&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;',
        },
        {
          id: 'note',
          name: 'Quick Note',
          icon: '📝',
          priority: 'low',
          description: '&lt;p&gt;&lt;/p&gt;',
        },
        {
          id: 'research',
          name: 'Research Task',
          icon: '🔍',
          priority: 'medium',
          description: '&lt;h2&gt;Topic&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Key Questions&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;&lt;/li&gt;&lt;/ul&gt;&lt;h2&gt;Findings&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;&lt;h2&gt;Next Steps&lt;/h2&gt;&lt;p&gt;&lt;/p&gt;',
        },
      ];
      ```

      **IMPORTANT**: The HTML in the description strings must be actual HTML, not
      HTML entities. The &lt;/&gt; above are XML escapes for this plan document.
      In the actual code, write real HTML tags: `<h2>Steps to Reproduce</h2>` etc.

      ### 2. Add template selector UI

      Add a template dropdown between the Priority section and the Description section
      in CardDetailModal. Use a relative-positioned button that toggles a dropdown:

      State: `showTemplateDropdown: boolean` (default false)

      ```
      ┌─ Apply Template ──────────────┐
      │  🐛 Bug Report                │
      │  ✨ Feature Request            │
      │  📋 Meeting Action             │
      │  📝 Quick Note                 │
      │  🔍 Research Task              │
      └───────────────────────────────┘
      ```

      - Button: `text-xs text-surface-400 hover:text-surface-200` with FileText icon
        from lucide-react + "Apply Template" text
      - Dropdown: `absolute top-full left-0 mt-1 bg-surface-800 border border-surface-700
        rounded-lg shadow-lg py-1 min-w-[200px] z-40`
      - Each option: `flex items-center gap-2 px-3 py-1.5 text-sm text-surface-200
        hover:bg-surface-700 cursor-pointer` with emoji + name
      - Close dropdown on outside click (use ref + useEffect, same pattern as label dropdown)

      ### 3. Apply template handler

      ```typescript
      const applyTemplate = (template: CardTemplate) => {
        // Set description via TipTap
        if (editor) {
          editor.commands.setContent(template.description);
          // Trigger save (same as blur)
          const html = template.description;
          onUpdate(card.id, { description: html });
        }
        // Set priority
        if (template.priority !== card.priority) {
          onUpdate(card.id, { priority: template.priority });
        }
        setShowTemplateDropdown(false);
      };
      ```

      If the description is not empty (not null and not just `<p></p>`), the template
      still applies — it replaces the content. No confirmation dialog needed since
      the user explicitly chose to apply a template, and Ctrl+Z in TipTap can undo.

      ### 4. Close template dropdown on outside click

      Add a ref `templateDropdownRef` and a useEffect similar to the existing
      `labelDropdownRef` pattern.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. 5 card templates defined with correct HTML descriptions
      3. "Apply Template" button visible between Priority and Description
      4. Clicking a template fills TipTap editor with template HTML
      5. Clicking a template also updates card priority
      6. Dropdown closes on outside click
      7. Template descriptions use proper HTML (h2, ol, ul, li, p tags from StarterKit)
    </verify>
    <done>
      5 card template presets with template selector dropdown in CardDetailModal.
      Applying a template fills description (via TipTap setContent) and sets priority.
      TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - TipTap editor.commands.setContent() is available (standard TipTap API, used by StarterKit)
      - StarterKit includes heading, orderedList, bulletList, listItem, paragraph nodes
        (all standard StarterKit extensions)
      - Two onUpdate calls in sequence (description + priority) are fine — they're
        independent database updates via IPC
      - Emojis render correctly in Electron's Chromium (standard for modern browsers)
    </assumptions>
  </task>
</phase>
