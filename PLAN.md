# Phase 5 — Plan 2 of 2: Meeting Intelligence UI

## Coverage
- **R6: Meeting Intelligence — AI Brief & Actions** (frontend UI for brief display, action item management, convert-to-card, search)

## Plan Overview
Plan 5.1 delivered the backend: meetingIntelligenceService.ts, IPC handlers, types, preload bridge, and store extensions. All 6 IPC channels are working and the meetingStore already has `generateBrief`, `generateActionItems`, `updateActionItemStatus`, and `convertActionToCard` actions.

Plan 5.2 builds the UI on top of this foundation:

- **Task 1**: Brief section + action item list components (standalone, reusable)
- **Task 2**: Convert-to-card modal + MeetingDetailModal integration (wire everything together)
- **Task 3**: Meeting history search on MeetingsPage + polish

## Architecture Decisions for Plan 5.2

1. **Component decomposition** — The MeetingDetailModal is already 263 lines. Rather than
   bloating it further, we extract BriefSection and ActionItemList as standalone components
   that receive data and callbacks as props. The modal orchestrates them.

2. **ConvertActionModal** — A 3-step flow (project → board → column) in a small overlay modal.
   Uses `window.electronAPI.getBoards(projectId)` and `window.electronAPI.getColumns(boardId)`
   directly for lightweight data fetching (no need to load full boardStore which carries cards/labels).

3. **Search** — Client-side filtering on MeetingsPage. Filters by title and brief summary text.
   No backend search needed since meeting lists are already fully loaded in the store.

4. **No new store changes** — All state management was completed in Plan 5.1 Task 3. The UI
   components use the existing meetingStore actions directly.

---

<phase n="5.2" name="Meeting Intelligence UI">
  <context>
    Plan 5.1 is complete. The backend and store layer are fully implemented:

    - meetingIntelligenceService.ts: 8 exports (generateBrief, generateActionItems, getBrief,
      getActionItems, updateActionItemStatus, convertActionToCard, deleteActionItem, resolveTaskModel)
    - 6 IPC channels: meetings:generate-brief, meetings:generate-actions, meetings:get-brief,
      meetings:get-actions, meetings:update-action-status, meetings:convert-action-to-card
    - meetingStore: generatingBrief, generatingActions state flags + 4 new actions
    - MeetingWithTranscript: includes brief (MeetingBrief | null) and actionItems (ActionItem[])
    - ActionItemStatus: 'pending' | 'approved' | 'dismissed' | 'converted'
    - ElectronAPI: getBoards(projectId), getColumns(boardId) available for convert flow

    Key files to reference:
    @src/renderer/stores/meetingStore.ts (all store actions already implemented)
    @src/renderer/components/MeetingDetailModal.tsx (263 lines — needs integration)
    @src/renderer/pages/MeetingsPage.tsx (218 lines — needs search)
    @src/renderer/stores/projectStore.ts (projects list for convert flow)
    @src/renderer/stores/boardStore.ts (pattern reference, but NOT used directly)
    @src/shared/types.ts (MeetingBrief, ActionItem, ActionItemStatus, Board, Column)
    @src/renderer/components/CardDetailModal.tsx (modal pattern reference)
    @src/renderer/components/MeetingCard.tsx (card pattern reference)

    UI conventions from existing code:
    - Primary action: bg-primary-600 hover:bg-primary-500 text-white rounded-lg px-3 py-1.5
    - Section bg: bg-surface-800/50 border border-surface-700 rounded-lg p-3
    - Status badges: inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full
    - Loading: Loader2 from lucide-react with animate-spin, text-amber-400
    - Icons: lucide-react (X, Clock, Trash2, Plus, Check, XCircle, ArrowRight, Search, Loader2, etc.)
    - Escape + overlay click to close modals
    - Outside-click detection for dropdowns via useRef + mousedown listener
  </context>

  <task type="auto" n="1">
    <n>Create BriefSection and ActionItemList components</n>
    <files>
      src/renderer/components/BriefSection.tsx (create)
      src/renderer/components/ActionItemList.tsx (create)
    </files>
    <preconditions>
      - Plan 5.1 complete (meetingStore has generateBrief, generateActionItems, updateActionItemStatus)
      - MeetingWithTranscript includes brief and actionItems
      - All shared types defined (MeetingBrief, ActionItem, ActionItemStatus)
    </preconditions>
    <action>
      Create two standalone components for displaying meeting intelligence data. These
      will be integrated into MeetingDetailModal in Task 2.

      WHY: Keeping these as separate components prevents MeetingDetailModal from growing
      beyond 500 lines and makes each component focused and testable.

      ## Component 1: BriefSection.tsx (~80-100 lines)

      Props interface:
      ```typescript
      interface BriefSectionProps {
        meetingId: string;
        brief: MeetingBrief | null;
        isCompleted: boolean;         // only show generate button for completed meetings
        generatingBrief: boolean;
        onGenerate: () => void;
      }
      ```

      Layout:
      - Section header: "Brief" label with styled heading (text-sm font-medium text-surface-300)
      - If `generatingBrief` is true:
        - Show loading state: Loader2 icon (animate-spin) + "Generating brief..." text in amber-400
      - If `brief` exists:
        - Container: bg-surface-800/50 border border-surface-700 rounded-lg p-3
        - Render brief.summary as text content. The summary contains markdown-like formatting
          (## headings, - bullet points). Parse it simply:
          - Split by newlines
          - Lines starting with "## " → render as bold text-surface-200 (h4-like, font-semibold mt-3 mb-1)
          - Lines starting with "- " → render as bullet items (ml-4 text-surface-300 with bullet marker)
          - Other non-empty lines → render as paragraph text (text-surface-300)
        - Below summary: timestamp "Generated {relative time or date}" in text-xs text-surface-500
      - If `brief` is null AND `isCompleted` AND NOT generating:
        - Show "Generate Brief" button: Sparkles icon + text
        - Button style: text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5
        - onClick calls onGenerate
      - If `brief` is null AND NOT completed:
        - Show info text: "Complete the recording to generate a brief" in text-sm text-surface-500

      Imports: React, Loader2 + Sparkles from lucide-react, MeetingBrief type

      ## Component 2: ActionItemList.tsx (~120-150 lines)

      Props interface:
      ```typescript
      interface ActionItemListProps {
        meetingId: string;
        actionItems: ActionItem[];
        isCompleted: boolean;
        generatingActions: boolean;
        onGenerate: () => void;
        onUpdateStatus: (id: string, status: ActionItemStatus) => void;
        onConvert: (actionItem: ActionItem) => void;  // opens convert modal (handled by parent)
      }
      ```

      Layout:
      - Section header: "Action Items" with count badge if items exist
        - "Action Items" text-sm font-medium text-surface-300
        - Badge: bg-surface-700 text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-2
      - If `generatingActions` is true:
        - Loading state: Loader2 animate-spin + "Extracting action items..." in amber-400
      - If `actionItems.length > 0`:
        - Container: space-y-2
        - Each action item rendered as a row:
          - Container: bg-surface-800/50 border border-surface-700 rounded-lg p-3 flex items-start gap-3
          - Left: status indicator icon (circle)
            - pending: empty circle outline (text-surface-500)
            - approved: CheckCircle2 (text-emerald-400)
            - dismissed: XCircle (text-surface-500, opacity-50)
            - converted: ArrowRightCircle (text-primary-400)
          - Center (flex-1):
            - Description text: text-sm text-surface-200 (or text-surface-500 line-through if dismissed)
            - If converted and cardId exists: small "Converted to card" label in text-xs text-primary-400
          - Right: action buttons (only show for actionable statuses)
            - If status is 'pending':
              - Approve button: Check icon (size 14), text-emerald-400 hover:text-emerald-300
                onClick → onUpdateStatus(item.id, 'approved')
              - Dismiss button: X icon (size 14), text-surface-500 hover:text-red-400
                onClick → onUpdateStatus(item.id, 'dismissed')
              - Convert button: ArrowRight icon (size 14), text-primary-400 hover:text-primary-300
                onClick → onConvert(item)
            - If status is 'approved':
              - Convert button only (ArrowRight icon)
              - Already approved indicator visible from left icon
            - If status is 'dismissed' or 'converted':
              - No action buttons (final states)
          - Button container: flex items-center gap-1
          - Each button: p-1 rounded hover:bg-surface-700 transition-colors
      - If `actionItems.length === 0` AND `isCompleted` AND NOT generating:
        - "Generate Action Items" button (same style as BriefSection generate button, use ListChecks icon)
      - If `actionItems.length === 0` AND NOT completed:
        - Info text: "Complete the recording to extract action items" in text-sm text-surface-500

      Imports: React, Check, X, Loader2, ArrowRight, ListChecks, CheckCircle2, XCircle, ArrowRightCircle
      from lucide-react, ActionItem + ActionItemStatus types
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. BriefSection.tsx: exports default component, accepts BriefSectionProps
      3. BriefSection: renders brief.summary with basic markdown parsing (headings + bullets)
      4. BriefSection: shows generate button only when brief is null AND meeting is completed
      5. BriefSection: shows Loader2 spinner when generatingBrief is true
      6. ActionItemList.tsx: exports default component, accepts ActionItemListProps
      7. ActionItemList: renders each action item with status icon, description, and action buttons
      8. ActionItemList: pending items show approve/dismiss/convert buttons
      9. ActionItemList: approved items show only convert button
      10. ActionItemList: dismissed/converted items show no buttons
      11. ActionItemList: shows generate button when no items AND meeting is completed
    </verify>
    <done>
      Two standalone components created: BriefSection.tsx (~80-100 lines) renders meeting briefs
      with simple markdown formatting and generate button. ActionItemList.tsx (~120-150 lines)
      renders action items with status-colored icons, action buttons per status, and generate
      button. Both follow existing Tailwind conventions. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - lucide-react includes Sparkles, ListChecks, CheckCircle2, XCircle, ArrowRightCircle icons
        (these are standard lucide icons, verified available in lucide-react)
      - brief.summary follows the markdown-like format from the SUMMARIZATION_SYSTEM_PROMPT
        (## headings + - bullet points). Simple string splitting is sufficient.
      - ActionItem status transitions are enforced by the backend — UI only needs to show
        appropriate buttons per current status
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create ConvertActionModal and integrate intelligence UI into MeetingDetailModal</n>
    <files>
      src/renderer/components/ConvertActionModal.tsx (create)
      src/renderer/components/MeetingDetailModal.tsx (modify)
    </files>
    <preconditions>
      - Task 1 complete (BriefSection.tsx and ActionItemList.tsx exist)
      - meetingStore has convertActionToCard(actionItemId, columnId) action
      - ElectronAPI has getBoards(projectId) and getColumns(boardId) methods
      - projectStore has projects list
    </preconditions>
    <action>
      Create the convert-to-card modal and wire all intelligence components into MeetingDetailModal.

      WHY: The convert flow needs project/board/column selection which is a distinct interaction
      pattern (multi-step wizard). MeetingDetailModal is the integration point where brief and
      action items are displayed alongside the existing transcript.

      ## Component 1: ConvertActionModal.tsx (~150-180 lines)

      Props interface:
      ```typescript
      interface ConvertActionModalProps {
        actionItem: ActionItem;
        onConvert: (actionItemId: string, columnId: string) => Promise<string>;
        onClose: () => void;
      }
      ```

      State:
      ```typescript
      const [step, setStep] = useState<1 | 2 | 3>(1);
      const [projects, setProjects] = useState<Project[]>([]);
      const [boards, setBoards] = useState<Board[]>([]);
      const [columns, setColumns] = useState<Column[]>([]);
      const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
      const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
      const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
      const [loading, setLoading] = useState(false);
      const [converting, setConverting] = useState(false);
      ```

      Data loading:
      - On mount: load projects via `window.electronAPI.getProjects()`, set in state
      - When selectedProjectId changes (step 1 → 2): load boards via `window.electronAPI.getBoards(projectId)`
        - If exactly 1 board, auto-select it and auto-advance to step 3
        - If multiple boards, stay on step 2
      - When selectedBoardId changes (step 2 → 3): load columns via `window.electronAPI.getColumns(boardId)`
        - Auto-select first column if only 1 exists

      Layout:
      - Overlay: fixed inset-0 z-[60] (above MeetingDetailModal z-50) flex items-center justify-center bg-black/50
      - Modal: bg-surface-900 rounded-xl border border-surface-700 w-full max-w-md mx-4 p-5
      - Header: "Convert to Card" title + X close button
      - Below header: show truncated action description (text-sm text-surface-400, max 2 lines with line-clamp-2)
      - Step indicator: 3 dots/circles showing progress
        - Active step: bg-primary-500
        - Completed step: bg-primary-500/50
        - Upcoming step: bg-surface-700
        - Layout: flex items-center gap-2, centered, my-4
      - Step content area:
        - **Step 1 — Select Project:**
          - Label: "Choose a project" text-sm text-surface-300 mb-2
          - Radio-button list of projects (max-h-48 overflow-y-auto)
          - Each: rounded-lg p-2.5 cursor-pointer border transition
            - Selected: border-primary-500 bg-primary-500/10
            - Unselected: border-surface-700 hover:border-surface-600
          - Show project name + color dot
        - **Step 2 — Select Board:** (skipped if project has only 1 board)
          - Label: "Choose a board" text-sm text-surface-300 mb-2
          - Same radio-button list pattern for boards
          - Show board name
        - **Step 3 — Select Column:**
          - Label: "Choose a column" text-sm text-surface-300 mb-2
          - Same radio-button list pattern for columns
          - Show column name
      - Footer: flex items-center justify-between mt-4 pt-3 border-t border-surface-700
        - Left: Back button (hidden on step 1)
          - text-sm text-surface-400 hover:text-surface-200
        - Right: flex items-center gap-2
          - Cancel button: text-sm text-surface-400 hover:text-surface-200
          - Next/Convert button:
            - Steps 1-2: "Next" — disabled until selection made
            - Step 3: "Convert" — disabled until column selected, shows Loader2 when converting
            - Style: bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed
              text-white text-sm px-4 py-1.5 rounded-lg

      Convert handler:
      ```typescript
      const handleConvert = async () => {
        if (!selectedColumnId) return;
        setConverting(true);
        try {
          await onConvert(actionItem.id, selectedColumnId);
          onClose();
        } catch {
          // Error handled by meetingStore
        } finally {
          setConverting(false);
        }
      };
      ```

      Escape key and overlay click to close (same pattern as other modals).

      Imports: React (useState, useEffect), X, Loader2, ChevronLeft, ArrowRight from lucide-react,
      Project, Board, Column, ActionItem types from shared/types

      ## Component 2: MeetingDetailModal.tsx modifications

      The existing modal is 263 lines. We add BriefSection and ActionItemList between the
      project linking section and the transcript section.

      Changes:
      1. Add imports at the top:
         ```typescript
         import BriefSection from './BriefSection';
         import ActionItemList from './ActionItemList';
         import ConvertActionModal from './ConvertActionModal';
         import type { ActionItem } from '../../shared/types';
         ```

      2. Add store destructuring for intelligence state:
         ```typescript
         const {
           selectedMeeting, updateMeeting, deleteMeeting, clearSelectedMeeting,
           generateBrief, generateActionItems,
           generatingBrief, generatingActions,
           updateActionItemStatus, convertActionToCard,
         } = useMeetingStore();
         ```

      3. Add local state for convert modal:
         ```typescript
         const [convertingAction, setConvertingAction] = useState<ActionItem | null>(null);
         ```

      4. Insert BriefSection AFTER the project linking div (after line ~196), BEFORE transcript:
         ```tsx
         {/* AI Brief */}
         <div className="mb-5">
           <BriefSection
             meetingId={meeting.id}
             brief={meeting.brief}
             isCompleted={meeting.status === 'completed'}
             generatingBrief={generatingBrief}
             onGenerate={() => generateBrief(meeting.id)}
           />
         </div>
         ```

      5. Insert ActionItemList AFTER BriefSection, BEFORE transcript:
         ```tsx
         {/* Action Items */}
         <div className="mb-5">
           <ActionItemList
             meetingId={meeting.id}
             actionItems={meeting.actionItems}
             isCompleted={meeting.status === 'completed'}
             generatingActions={generatingActions}
             onGenerate={() => generateActionItems(meeting.id)}
             onUpdateStatus={updateActionItemStatus}
             onConvert={(item) => setConvertingAction(item)}
           />
         </div>
         ```

      6. Add ConvertActionModal INSIDE the component, after the main modal div (before closing
         fragment or at the end of the return):
         ```tsx
         {convertingAction && (
           <ConvertActionModal
             actionItem={convertingAction}
             onConvert={convertActionToCard}
             onClose={() => setConvertingAction(null)}
           />
         )}
         ```

      The total MeetingDetailModal will grow from ~263 to ~300 lines — well within limits since
      the heavy lifting is in the child components.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. ConvertActionModal.tsx: exports default, accepts ConvertActionModalProps
      3. ConvertActionModal: loads projects on mount via electronAPI
      4. ConvertActionModal: step 1 shows project list, step 2 boards, step 3 columns
      5. ConvertActionModal: auto-skips step 2 if project has exactly 1 board
      6. ConvertActionModal: Convert button calls onConvert(actionItemId, columnId) and closes on success
      7. ConvertActionModal: has z-[60] to stack above MeetingDetailModal
      8. MeetingDetailModal: imports and renders BriefSection between project linking and transcript
      9. MeetingDetailModal: imports and renders ActionItemList between BriefSection and transcript
      10. MeetingDetailModal: renders ConvertActionModal when convertingAction state is set
      11. MeetingDetailModal: passes correct store actions as callbacks to child components
    </verify>
    <done>
      ConvertActionModal.tsx created with 3-step wizard (project → board → column) using
      electronAPI for data loading. MeetingDetailModal updated to integrate BriefSection,
      ActionItemList, and ConvertActionModal. All intelligence UI is accessible from the
      meeting detail view. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Most projects have exactly 1 board (created automatically by boardStore.loadBoard).
        The step-2-skip optimization handles this common case while still supporting
        multi-board projects.
      - electronAPI.getBoards and getColumns are fast enough to call on step transitions
        (no caching needed — small data sets)
      - z-[60] is sufficient to stack above z-50. No other modals use z-[60].
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Add meeting history search to MeetingsPage</n>
    <files>
      src/renderer/pages/MeetingsPage.tsx (modify)
    </files>
    <preconditions>
      - Tasks 1-2 complete (intelligence UI integrated in MeetingDetailModal)
      - MeetingsPage currently has filter tabs (all/recording/completed) but no search
      - meetings array in store includes all loaded meetings
      - MeetingWithTranscript includes brief (available after loadMeeting, but Meeting list
        items don't include brief — search will be title-only on the list, which is fine for v1)
    </preconditions>
    <action>
      Add a search input to MeetingsPage that filters meetings by title.

      WHY: R6 includes "Meeting history view with search" as a deliverable. Users need to
      find past meetings quickly as the list grows. Title search covers the primary use case.

      ## Changes to MeetingsPage.tsx:

      ### 1. Add Search icon import:
      Add `Search, X as XIcon` to the lucide-react import. (X is already used in other files
      but not in MeetingsPage — rename to XIcon to avoid confusion if needed, or just add
      Search since X isn't currently imported in MeetingsPage.)

      Check the current imports: `Mic, Info` are imported. Add `Search` and `X`.

      ### 2. Add search state:
      ```typescript
      const [searchQuery, setSearchQuery] = useState('');
      ```

      ### 3. Add search input UI:
      Insert a search bar between the header and RecordingControls sections (or between
      RecordingControls and the filter tabs — pick the most natural position).

      Best placement: between filter tabs and the meeting cards grid, on the same row as
      the filter tabs.

      Modify the filter tabs row to include search:
      ```tsx
      {/* Filter tabs + Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          {FILTER_TABS.map(tab => (
            <button key={tab.value} ... >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-8 py-1.5
                       text-sm text-surface-200 placeholder:text-surface-500
                       focus:outline-none focus:border-primary-500 w-48"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      ```

      ### 4. Update filtering logic:
      Modify the `filteredMeetings` computation to include search:
      ```typescript
      const filteredMeetings = meetings.filter(m => {
        // Status filter
        if (filter === 'recording' && m.status !== 'recording') return false;
        if (filter === 'completed' && m.status !== 'completed') return false;

        // Search filter (case-insensitive title match)
        if (searchQuery.trim()) {
          const query = searchQuery.trim().toLowerCase();
          if (!m.title.toLowerCase().includes(query)) return false;
        }

        return true;
      });
      ```

      ### 5. Update empty state:
      When search is active and no results, show a search-specific empty state:
      ```tsx
      {filteredMeetings.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
          {searchQuery.trim() ? (
            <>
              <Search size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">No matching meetings</p>
              <p className="text-sm text-surface-500 mt-1">
                Try a different search term
              </p>
            </>
          ) : (
            <>
              <Mic size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">
                {filter === 'all' ? 'No meetings yet' : `No ${filter} meetings`}
              </p>
              <p className="text-sm text-surface-500 mt-1">
                {filter === 'all'
                  ? 'Start a recording to create your first meeting'
                  : 'Try a different filter'}
              </p>
            </>
          )}
        </div>
      ) : (
        /* existing grid */
      )}
      ```

      ### 6. Show result count when searching:
      Optionally add a count indicator above the grid when search is active:
      ```tsx
      {searchQuery.trim() && filteredMeetings.length > 0 && (
        <p className="text-xs text-surface-500 mb-2">
          {filteredMeetings.length} result{filteredMeetings.length !== 1 ? 's' : ''}
        </p>
      )}
      ```

      Total change: MeetingsPage grows from ~218 to ~260 lines — well within limits.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. MeetingsPage: search input renders with Search icon and clear button
      3. MeetingsPage: typing in search filters meetings by title (case-insensitive)
      4. MeetingsPage: clearing search shows all meetings again
      5. MeetingsPage: search works in combination with filter tabs
      6. MeetingsPage: search-specific empty state shows when no results match
      7. MeetingsPage: result count displays when search is active
      8. Verify Search and X icons are properly imported from lucide-react
    </verify>
    <done>
      MeetingsPage updated with search functionality. Search input on the filter row with
      icon, clear button, and placeholder. Client-side title filtering combined with existing
      status filter tabs. Search-specific empty state and result count. TypeScript compiles clean.
      Phase 5 (R6: Meeting Intelligence) is fully delivered.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Title-only search is sufficient for v1. Brief text search would require loading
        all briefs which isn't available on the meeting list items (only on detail load).
        This can be enhanced in a future phase if needed.
      - Meeting list will remain small enough for client-side filtering (hundreds, not thousands).
        No debounce or virtualization needed.
      - The Search icon from lucide-react is available (it's a standard lucide icon).
    </assumptions>
  </task>
</phase>
