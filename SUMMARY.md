# Plan 8.2 Summary — README, Within-Column Card Reordering, and UI Polish

## Date: 2026-02-13
## Status: COMPLETE (3/3 tasks)

## What Changed
Addressed review findings #3 (no README) and #5 (missing within-column card reordering), plus three quick UI polish fixes (padding, code dedup, safety confirmation).

### Task 1: Create README.md with project overview and developer quick start
**Status:** COMPLETE | **Confidence:** HIGH

- Created README.md at project root with 9 sections
- All 12 script names verified against package.json
- All technology versions verified against package.json dependencies
- Project structure tree verified against actual directories
- 100+ IPC channels documented (counted via grep across 17 handler files)
- .env.example variables documented (DB_PASSWORD, DATABASE_URL)
- Honest license statement (no LICENSE file exists)

### Task 2: Implement within-column card reordering via drag-and-drop
**Status:** COMPLETE | **Confidence:** MEDIUM

- Installed @atlaskit/pragmatic-drag-and-drop-hitbox for edge detection
- KanbanCard: registered as both draggable source AND drop target
- KanbanCard: closestEdge state + blue indicator lines (top/bottom)
- BoardPage: replaced drag monitor for same-column + cross-column handling
- BoardPage: removed the `if (sourceColumnId === targetColumnId) return;` blocker
- cards:move IPC: full reorder (query siblings, splice, update changed positions)
- boardStore: optimistic UI (instant local position update before IPC response)

### Task 3: UI polish batch
**Status:** COMPLETE | **Confidence:** HIGH

- **BrainstormPage padding:** Added `p-6` to wrapper, adjusted height calc (10rem → 13rem)
- **getDueDateBadge extraction:** Created shared `src/renderer/utils/date-utils.ts`, removed duplicates from KanbanCard.tsx and CardDetailModal.tsx
- **Restore confirmation:** Added inline confirmation dialog to "Restore from File..." button in BackupSection (amber-themed, matching existing pattern)

## Files Created (2)
- `README.md` (122 lines)
- `src/renderer/utils/date-utils.ts` (~20 lines)

## Files Modified (7)
- `src/renderer/components/KanbanCard.tsx` (drop target + shared import)
- `src/renderer/pages/BoardPage.tsx` (drag monitor rewrite)
- `src/main/ipc/cards.ts` (cards:move reorder handler)
- `src/renderer/stores/boardStore.ts` (optimistic moveCard)
- `src/renderer/pages/BrainstormPage.tsx` (p-6 padding)
- `src/renderer/components/CardDetailModal.tsx` (shared import)
- `src/renderer/components/settings/BackupSection.tsx` (restore confirmation)

## Dependencies Added (1)
- `@atlaskit/pragmatic-drag-and-drop-hitbox`

## Verification
- `npx tsc --noEmit`: PASS (zero errors)
- `npm test`: 2 files, 12 tests, all passed

## What's Next
1. `/nexus:git` to commit Plan 8.2 changes
2. `/nexus:plan 8.3` for IPC validation with Zod, structured logging, component refactoring
