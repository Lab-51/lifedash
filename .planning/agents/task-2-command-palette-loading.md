# Task 2 — Load all entity data for command palette on app mount

## Status: COMPLETE

## Change
Added eager loading of all entity data (projects, meetings, ideas, brainstorm sessions) on app mount so the command palette (Ctrl+K) always has data to search, even before the user visits corresponding pages.

## Files Modified
- `src/renderer/App.tsx`: Added imports for 4 stores (projectStore, meetingStore, ideaStore, brainstormStore) and a useEffect in AppShell that calls each store's load method on mount via `getState()`.

## Implementation Details
- Uses `useXxxStore.getState().loadXxx()` pattern to avoid unnecessary React re-renders in AppShell itself
- The stores update internally; CommandPalette (which subscribes via hooks) picks up the data reactively
- Board cards are NOT pre-loaded because `loadBoard()` requires a `projectId` -- cards appear once the user visits a specific board
- CommandPalette already handles empty results gracefully with a "No results found" message (line 166) -- no changes needed there

## Verification
- TypeScript: Pass (zero errors)
- Tests: Pass (99/99)
- Build: N/A (not required by task)
