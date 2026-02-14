# Task 3 (Plan 9.2) - Project-aware action item conversion with batch push

## Status: COMPLETE

## What Changed

### 1. `src/renderer/components/ConvertActionModal.tsx`
- Made `actionItem` prop optional (was required)
- Added `actionItems?: Array<{ id: string; text: string }>` prop for batch conversion
- Added `preselectedProjectId?: string` prop — when provided, skips step 1 (project selection) and starts at step 2 (board selection)
- Added `preselectedProjectName?: string` prop — shown in a "Project: [name]" header with "Change project" link
- When preselected and user clicks "Change project" or "Back", resets to step 1 and sets `projectOverridden` flag so the preselect header hides
- Batch mode: shows "Converting X action items" summary instead of single item description
- Batch conversion loops sequentially through items, showing progress "Converting 2 of 5..."
- Convert button text changes to "Convert N items" in batch mode
- Escape key and overlay click disabled during conversion to prevent accidental close
- Auto-skip logic preserved: if preselected project has 1 board, auto-skips to column selection

### 2. `src/renderer/components/ActionItemList.tsx`
- Added `meetingProjectId?: string` prop — enables batch push UI when set
- Added `meetingProjectName?: string` prop — displayed in push button label
- Added `onBatchConvert?: (items: Array<{ id: string; text: string }>) => void` callback prop
- When all three are set and there are pushable items (pending/approved), shows:
  - Checkboxes on each pending/approved action item row
  - "Select All" / "Deselect All" toggle button
  - "Push X items to [Project Name]" button (disabled when none selected)
- Pushable items = pending or approved status (not dismissed/converted)
- Existing individual Convert button (arrow icon) preserved for one-off conversions
- Added `Send` icon from lucide-react for the batch push button

### 3. `src/renderer/components/MeetingDetailModal.tsx`
- Added `batchConvertItems` state for tracking batch conversion items
- Resolves `linkedProjectName` from `useProjectStore().projects` using `meeting.projectId`
- Passes `meetingProjectId`, `meetingProjectName`, and `onBatchConvert` to ActionItemList
- Single-item ConvertActionModal now receives `preselectedProjectId` and `preselectedProjectName` when meeting is linked to a project
- Batch ConvertActionModal rendered when `batchConvertItems` is non-null, with same preselected project props

## Verification
- TypeScript: PASS (zero errors)
- Tests: PASS (99/99)
- Build: not run (not requested)

## Data Flow

```
MeetingDetailModal
  |-- meeting.projectId -> resolves linkedProjectName from projectStore
  |-- ActionItemList
  |     |-- shows checkboxes on pending/approved items when projectId set
  |     |-- "Push N items" button -> calls onBatchConvert([{id, text}])
  |
  |-- onBatchConvert -> setBatchConvertItems(items)
  |-- batchConvertItems -> ConvertActionModal (batch mode)
  |     |-- preselectedProjectId skips step 1
  |     |-- loops through items calling convertActionToCard sequentially
  |
  |-- convertingAction -> ConvertActionModal (single mode)
        |-- also receives preselectedProjectId when meeting linked
```
