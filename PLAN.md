# Plan 9.2: Post-Recording UX — Processing State, Auto-Intelligence, Project-Aware Action Items

## Problem

Three UX gaps after stopping a recording:

1. **Dead UI after Stop**: Clicking Stop immediately resets the RecordingControls to idle ("New Recording" form). The user sees no feedback that audio is being saved and transcription is finalizing. It feels like nothing happened.

2. **Brief & Action Items invisible**: The AI brief and action items only generate when the user manually clicks buttons deep in the MeetingDetailModal. Most users never discover these features.

3. **Action Items disconnected from Projects**: Converting an action item to a project card requires a 3-step wizard (pick project → pick board → pick column) every time, even when the meeting is already linked to a project. There's no way to batch-push multiple items.

## Solution

1. Add a **"Processing..."** state in RecordingControls after Stop, then auto-open the MeetingDetailModal.
2. **Auto-generate** brief and action items when the modal opens for a freshly-completed meeting.
3. When a meeting has a linked project, **pre-select that project** in the convert flow and add a **batch push** option.

<phase n="9.2" name="Post-Recording UX — Processing, Auto-Intelligence, Project Push">
  <context>
    After clicking Stop, the recording UI immediately resets to idle while the main process
    is still saving the WAV file and flushing transcription. The user gets no feedback.

    Brief generation and action item extraction exist but are manual-only (button click in
    MeetingDetailModal). Users don't know these features exist.

    The ConvertActionModal is a 3-step wizard (project → board → column) that ignores
    the meeting's linked project. When a meeting already has a projectId, the flow should
    be streamlined.

    Key files to read:
    @src/renderer/stores/recordingStore.ts (133 lines — stop clears state immediately)
    @src/renderer/stores/meetingStore.ts (229 lines — generateBrief, generateActionItems)
    @src/renderer/components/RecordingControls.tsx (191 lines — 2 states: idle vs recording)
    @src/renderer/pages/MeetingsPage.tsx (269 lines — refreshes list on recording stop)
    @src/renderer/components/MeetingDetailModal.tsx (352 lines — brief/action sections)
    @src/renderer/components/ActionItemList.tsx (178 lines — per-item approve/dismiss/convert)
    @src/renderer/components/ConvertActionModal.tsx (317 lines — 3-step wizard)
    @src/renderer/components/BriefSection.tsx (brief display + generate button)
    @src/main/services/meetingIntelligenceService.ts (brief + action generation logic)
  </context>

  <task type="auto" n="1">
    <n>Add post-recording processing state and auto-open meeting detail</n>
    <files>
      src/renderer/stores/recordingStore.ts (add isProcessing + completedMeetingId)
      src/renderer/components/RecordingControls.tsx (third visual state: "Processing...")
      src/renderer/pages/MeetingsPage.tsx (auto-open modal when processing completes)
    </files>
    <action>
      **recordingStore.ts changes:**
      1. Add two new state fields:
         - `isProcessing: boolean` (true between clicking Stop and meeting reaching 'completed')
         - `completedMeetingId: string | null` (set when processing finishes, consumed by MeetingsPage)
      2. Add action: `clearCompletedMeetingId: () => void` (resets completedMeetingId to null)
      3. Modify `stopRecording()`:
         - At the start: capture `meetingId` from state, then set `isRecording: false, isProcessing: true`
           (keep meetingId in state — DON'T clear it yet)
         - Stop audio capture
         - Stop recording in main process (get audioPath)
         - Update meeting to 'completed'
         - Set: `isProcessing: false, meetingId: null, completedMeetingId: meetingId, elapsed: 0, lastTranscript: ''`
         - In catch: set `isProcessing: false, error: ...`

      **RecordingControls.tsx changes:**
      1. Import `isProcessing` from recordingStore
      2. Add a third UI state: when `isProcessing` is true:
         - Show amber pulsing dot (not red) + "Processing recording..."
         - Show a spinner (Loader2 from lucide-react)
         - Show "Saving audio and finalizing transcript..." text
         - No buttons (user just waits)
      3. Change the conditional rendering:
         - `isProcessing` → processing state
         - `isRecording` → recording state (red dot, stop button)
         - else → idle state (new recording form)

      **MeetingsPage.tsx changes:**
      1. Import `completedMeetingId` and `clearCompletedMeetingId` from recordingStore
      2. Add useEffect: when `completedMeetingId` changes from null to a value:
         - Refresh the meetings list (loadMeetings)
         - Set `selectedMeetingId` to the completed meeting ID (opens the modal)
         - Call `clearCompletedMeetingId()` to consume the event
      3. This auto-opens the MeetingDetailModal for the freshly-completed meeting

      WHY: The user needs visual feedback that the system is actively working after they
      click Stop. The processing state bridges the gap between "recording" and "ready to review".
      Auto-opening the modal ensures the user sees the brief/action items being generated.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero type errors
      2. `npx vitest run` — all existing tests pass
      3. Manual: Start a recording → Stop → verify "Processing recording..." appears with spinner
      4. Manual: After processing completes → verify MeetingDetailModal opens automatically
      5. Manual: Verify the idle "New Recording" form returns after modal is dismissed
    </verify>
    <done>
      After clicking Stop, the user sees "Processing recording..." with a spinner.
      When processing completes, the MeetingDetailModal opens automatically for the completed meeting.
      The idle recording form only appears after processing is fully complete.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - stopRecording() in main process takes 1-3 seconds (WAV save + transcription flush)
      - The existing initListener (onRecordingState) doesn't interfere — it only pushes
        isRecording/elapsed/lastTranscript, not isProcessing
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Auto-generate brief and action items when meeting detail opens post-recording</n>
    <files>
      src/renderer/components/MeetingDetailModal.tsx (auto-trigger generation)
    </files>
    <action>
      **MeetingDetailModal.tsx changes:**
      1. Add a new prop: `autoGenerate?: boolean` (defaults to false)
      2. Add a useEffect that runs when the modal opens:
         - Guard: only run if `autoGenerate` is true
         - Guard: only run if `meeting.status === 'completed'`
         - Guard: only run if `meeting.segments.length > 0` (has transcript data)
         - Guard: only run if `!meeting.brief` (brief not already generated)
         - Guard: only run if `!generatingBrief && !generatingActions` (not already in progress)
         - Call `generateBrief(meeting.id)` — this sets `generatingBrief: true` and shows spinner
         - Use a flag (useRef) to prevent double-triggering on re-renders
      3. Add a second useEffect that chains action items after brief completes:
         - Guard: `autoGenerate` is true
         - Guard: brief exists (just generated) AND `meeting.actionItems.length === 0`
         - Guard: `!generatingActions`
         - Call `generateActionItems(meeting.id)`
         - Use a flag (useRef) to prevent double-triggering
      4. If no AI provider is configured, the existing error handling in meetingStore will
         set the error message. Add a small info banner in the modal:
         - Check if there's an error after generation attempt
         - Show: "Configure an AI provider in Settings to generate meeting intelligence"

      **MeetingsPage.tsx changes:**
      1. Track whether the modal was auto-opened (vs manually clicked):
         - Add state: `autoOpenedMeetingId: string | null`
         - When completedMeetingId triggers the auto-open, also set autoOpenedMeetingId
         - Pass `autoGenerate={selectedMeetingId === autoOpenedMeetingId}` to MeetingDetailModal
         - Clear autoOpenedMeetingId when modal closes

      WHY: Users expect the app to automatically process the recording after it stops.
      The brief and action items are the core value proposition of meeting intelligence.
      Making them auto-generate removes a hidden manual step that most users never discover.
      The sequential generation (brief first, then actions) avoids overloading the AI provider.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero type errors
      2. `npx vitest run` — all existing tests pass
      3. Manual (with AI provider configured): Stop recording → modal opens → brief auto-generates
         → after brief completes, action items auto-generate
      4. Manual (no AI provider): Stop recording → modal opens → error message about configuring AI
      5. Manual (empty transcript): Stop recording with no audio → modal opens → no generation attempted
      6. Manual (re-open existing meeting): Click a completed meeting card → modal opens →
         no auto-generation (brief already exists or autoGenerate is false)
    </verify>
    <done>
      When the MeetingDetailModal auto-opens after recording, it automatically generates
      the AI brief (with spinner), then chains action item extraction. Manual opens of
      existing meetings do NOT trigger auto-generation. Missing AI provider shows a helpful message.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - At least one AI provider is configured (OpenAI/Anthropic/Ollama) for generation to work
      - The existing generateBrief and generateActionItems store actions handle errors gracefully
      - Brief generation takes 5-15 seconds depending on transcript length and AI provider
      - The sequential chain (brief → actions) won't cause race conditions because
        meetingStore uses separate boolean flags (generatingBrief, generatingActions)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Project-aware action item conversion with batch push</n>
    <files>
      src/renderer/components/ActionItemList.tsx (add batch select + "Push to Project" button)
      src/renderer/components/ConvertActionModal.tsx (accept preselectedProjectId prop)
      src/renderer/components/MeetingDetailModal.tsx (pass projectId to ActionItemList + ConvertActionModal)
    </files>
    <action>
      **ConvertActionModal.tsx changes:**
      1. Add optional prop: `preselectedProjectId?: string`
      2. When `preselectedProjectId` is provided:
         - Set `selectedProjectId` to it on mount
         - This triggers the existing useEffect that loads boards for that project
         - If exactly 1 board exists, auto-skips to column selection (existing logic)
         - Show a "Project: [name]" header so user knows which project is pre-selected
         - Still allow "Change project" link to go back to step 1 if they want a different project
      3. To support batch conversion, add optional props:
         - `actionItems?: ActionItem[]` (multiple items to convert)
         - When provided, show a summary "Converting X action items" instead of single description
         - On convert: loop through all items calling `onConvert(item.id, columnId)` sequentially
         - Show progress: "Converting 2 of 5..."

      **ActionItemList.tsx changes:**
      1. Add optional prop: `meetingProjectId?: string` (the meeting's linked project ID)
      2. Add optional prop: `meetingProjectName?: string`
      3. When `meetingProjectId` is set AND there are pending/approved items:
         - Show a "Push to [Project Name]" section below the items
         - Add checkboxes to each pending/approved action item row (not dismissed/converted)
         - Track selected items in local state: `selectedIds: Set<string>`
         - "Select All" / "Deselect All" toggle
         - "Push X items to [Project Name]" button (disabled when none selected)
         - Clicking this button calls `onBatchConvert(selectedItems)` (new callback prop)
      4. Keep existing individual Convert button (arrow icon) for one-off conversions

      **MeetingDetailModal.tsx changes:**
      1. Pass `meetingProjectId={meeting.projectId}` to ActionItemList
      2. Resolve project name from the projects list for `meetingProjectName`
      3. Add `onBatchConvert` handler that opens ConvertActionModal with:
         - `preselectedProjectId={meeting.projectId}`
         - `actionItems={selectedItems}` (the batch)
      4. Pass `preselectedProjectId={meeting.projectId}` to ConvertActionModal when converting
         individual items too (so even single converts skip project selection when linked)

      WHY: Meetings are often linked to projects. When a user records a planning meeting for
      "Project Alpha", they want to push action items directly to that project's board without
      re-selecting the project each time. Batch push handles the common case of 5-10 action
      items from a single meeting.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero type errors
      2. `npx vitest run` — all existing tests pass
      3. Manual: Create a meeting linked to a project → generate action items →
         verify checkboxes appear on pending items
      4. Manual: Select 3 items → click "Push to [Project]" → verify ConvertActionModal
         opens at board/column step (skips project selection)
      5. Manual: Verify batch converts all selected items and marks them as 'converted'
      6. Manual: Test individual Convert button → still works, pre-selects linked project
      7. Manual: Meeting with NO linked project → verify old behavior (no checkboxes,
         convert wizard starts at project selection)
      8. Manual: In ConvertActionModal with pre-selected project → click "Change project" →
         verify can go back to project selection
    </verify>
    <done>
      When a meeting is linked to a project:
      - Action items show checkboxes for batch selection
      - "Push to [Project Name]" button batch-converts selected items
      - ConvertActionModal pre-selects the linked project (skips step 1)
      - Individual convert still works, also pre-selecting the linked project
      When no project is linked: behavior unchanged (no checkboxes, full 3-step wizard).
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - The existing convertActionToCard IPC handler can be called multiple times sequentially
        without issues (it creates one card per call with correct position ordering)
      - Projects always have at least one board (created by default when project is created)
      - Batch conversion of 10+ items won't timeout (each convert is a quick DB insert)
      - The project name can be resolved from the projects already loaded in useProjectStore
    </assumptions>
  </task>
</phase>
