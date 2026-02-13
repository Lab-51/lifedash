# Plan 7.8 Summary — Card Attachments, Due Date UI & KanbanCard Enhancements

## Date: 2026-02-13
## Status: COMPLETE (3/3 tasks)

## What Changed
Implemented remaining R16 items — card file attachments (full stack: schema → service → IPC → UI), due date picker in CardDetailModal, and due date/overdue badges on KanbanCard. Files stored in app data directory. Native HTML date input with dark mode support. Color-coded overdue badges on board cards.

### Task 1: Card Attachments Backend
**Status:** COMPLETE | **Confidence:** HIGH

- Added `cardAttachments` table (id, cardId, fileName, filePath, fileSize, mimeType, createdAt)
- Created attachmentService.ts (~120 lines: MIME lookup map, file dialog, copy with collision handling, disk+DB cleanup, shell.openPath)
- Added CardAttachment type + 4 ElectronAPI methods to types.ts
- 4 IPC handlers with activity logging (attachment_added/attachment_removed)
- 4 preload bridge methods
- Migration 0006 generated

### Task 2: Due Date UI
**Status:** COMPLETE | **Confidence:** HIGH

- CardDetailModal: datetime-local input, toDateTimeLocalValue helper, getDueDateBadge helper
- Status badges: Overdue (red), Due today (amber), Due in Nd (amber/blue), formatted date (neutral)
- Clear button to remove due date
- KanbanCard: Clock icon + compact due date badge in footer row
- `[color-scheme:dark]` for native dark mode date picker

### Task 3: Attachments UI
**Status:** COMPLETE | **Confidence:** HIGH

- boardStore: selectedCardAttachments state, parallel fetch in loadCardDetails, clearCardDetails reset
- 3 store actions: addAttachment (opens dialog, prepends result), deleteAttachment (removes from state + DB), openAttachment (OS default app)
- Created AttachmentsSection.tsx (~140 lines: MIME-based file icons, size formatting, timeAgo, add/open/delete with inline confirmation)
- Integrated in CardDetailModal as first section inside loading guard

## Files Created (2)
- `src/main/services/attachmentService.ts` (~120 lines)
- `src/renderer/components/AttachmentsSection.tsx` (~140 lines)

## Files Modified (7)
- `src/main/db/schema/cards.ts` (cardAttachments table)
- `src/shared/types.ts` (CardAttachment type + 4 API methods)
- `src/main/ipc/cards.ts` (4 IPC handlers + import)
- `src/preload/preload.ts` (4 bridge methods)
- `src/renderer/stores/boardStore.ts` (attachment state + actions)
- `src/renderer/components/CardDetailModal.tsx` (due date picker + AttachmentsSection)
- `src/renderer/components/KanbanCard.tsx` (due date badge)

## Migration
- `drizzle/0006_organic_colleen_wing.sql` — CREATE TABLE card_attachments

## Verification
- `npx tsc --noEmit`: PASS (zero errors after all 3 tasks)
- No new dependencies added
- Backward compatible: existing cards unaffected

## Phase 7 Complete
Plan 7.8 is the final plan of Phase 7. All 8 plans (24 tasks) are complete.
All v2 features (R11, R13, R14, R15, R16, R17) delivered.

## What's Next
1. `/nexus:git` to commit all uncommitted Plan 7.1-7.8 changes
2. Phase 7 complete — project ready for final review
