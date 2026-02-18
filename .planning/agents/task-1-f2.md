# Task 1-F2: Cleanup + Project-Aware Time Tracking Backend

## Implementation Complete

**Change:** Removed UI clutter (Focus History buttons, Timer settings button) and added project-aware time tracking backend (getTimeReport with JOIN chain through cards -> columns -> boards -> projects).

## Part A: UI Cleanup

### Files Modified

- `src/renderer/components/SidebarModern.tsx`: Removed Focus History button (lines 133-140) and `History` import from lucide-react.
- `src/renderer/components/FocusStatsWidget.tsx`: Removed Timer settings button from header (lines 183-191) and `useFocusStore` import (no longer needed). Kept `Timer` import since it is used in ICON_MAP.
- `src/renderer/App.tsx`: Removed `FocusHistoryModal` lazy import, `showHistoryModal` selector from AppShell, and `<FocusHistoryModal>` render in Suspense block.
- `src/renderer/stores/focusStore.ts`: Removed `showHistoryModal` state property, `setShowHistoryModal` action from interface, initial state value, and implementation.
- `src/renderer/components/FocusOverlay.tsx`: Removed History button from today stats row and `History` import from lucide-react.
- `src/renderer/components/FocusStartModal.tsx`: Removed "View Focus History" CTA button and `History` import from lucide-react (found during grep verification -- this file also referenced `setShowHistoryModal`).

### Note
- `FocusHistoryModal.tsx` file was NOT deleted (as instructed -- will be replaced in Task 2).

## Part B: Enhanced Backend

### Files Modified

- `src/shared/types/focus.ts`: Added 4 new types: `FocusTimeReportOptions`, `FocusSessionFull`, `FocusProjectTime`, `FocusTimeReport`.
- `src/main/services/focusService.ts`:
  - Updated imports: added `lte`, `and` from drizzle-orm; added `columns`, `boards`, `projects` from schema; added new focus types.
  - Added `getTimeReport()` function: performs 4-way LEFT JOIN (focusSessions -> cards -> columns -> boards -> projects) to get project-aware session data. Returns sessions list, per-project breakdown, summary stats, and daily data.
  - Added `getDailyDataForRange()` helper: generates gap-filled daily data for arbitrary date ranges with optional project filter.
- `src/main/ipc/focus.ts`: Added `focus:get-time-report` IPC handler.
- `src/preload/domains/focus.ts`: Added `focusGetTimeReport` to preload bridge.
- `src/shared/types/electron-api.ts`: Added `FocusTimeReport` to focus type import and `focusGetTimeReport` method to ElectronAPI interface.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS (zero errors) |
| `showHistoryModal` in SidebarModern | 0 matches (confirmed removed) |
| `setShowHistoryModal` in entire src/ | 0 matches (confirmed fully removed) |
| `focus:get-time-report` IPC handler registered | Confirmed in focus.ts line 47 |
| New types exported from focus.ts | Confirmed: FocusTimeReportOptions, FocusSessionFull, FocusProjectTime, FocusTimeReport |

## Additional Fix

During verification, discovered `FocusStartModal.tsx` also referenced `setShowHistoryModal` (line 214) and imported `History` from lucide-react. Removed both to prevent runtime errors, since the store method no longer exists.
