# Task 2 (Plan 9.2) -- Auto-generate brief and action items post-recording

## Status: COMPLETE

## What Changed

### 1. `src/renderer/components/MeetingDetailModal.tsx`

**New prop:** `autoGenerate?: boolean` (defaults to `false`)

**Auto-generate brief useEffect:**
- Guarded by: `autoGenerate === true`, `meeting.status === 'completed'`, `segments.length > 0`, `!meeting.brief`, `!generatingBrief && !generatingActions`
- Uses `autoGenerateBriefTriggered` useRef to prevent double-triggering
- Calls `generateBrief(meeting.id)` which sets `generatingBrief: true` and shows the existing spinner in BriefSection

**Chain action items useEffect:**
- Guarded by: `autoGenerate === true`, `meeting.brief` exists (just generated), `actionItems.length === 0`, `!generatingActions`
- Uses `autoGenerateActionsTriggered` useRef to prevent double-triggering
- Calls `generateActionItems(meeting.id)` after brief generation completes

**AI provider error banner:**
- Shown when `autoGenerate && error && !meeting.brief && !generatingBrief`
- Amber info banner: "Configure an AI provider in Settings to generate meeting intelligence."
- Uses `Info` icon from lucide-react (newly imported)

**Also added:** `error` destructured from `useMeetingStore()` for the banner condition.

### 2. `src/renderer/pages/MeetingsPage.tsx`

**New state:** `autoOpenedMeetingId: string | null` (tracks whether modal was auto-opened vs manually clicked)

**Auto-open useEffect updated:** When `completedMeetingId` fires, also sets `setAutoOpenedMeetingId(completedMeetingId)`

**MeetingDetailModal prop:** `autoGenerate={selectedMeetingId === autoOpenedMeetingId}` -- only true when the modal was auto-opened post-recording

**Modal close handler:** Clears `autoOpenedMeetingId` to `null` alongside `selectedMeetingId`

## Verification

- TypeScript (`npx tsc --noEmit`): PASS -- zero errors
- Tests (`npx vitest run`): PASS -- 99/99 tests across 5 files
- No files outside the two specified were modified
- No changes to recordingStore.ts

## Flow Summary

1. Recording finishes -> recordingStore sets `completedMeetingId`
2. MeetingsPage detects it -> sets both `selectedMeetingId` and `autoOpenedMeetingId`
3. MeetingDetailModal opens with `autoGenerate=true`
4. First useEffect fires `generateBrief()` (with ref guard)
5. Brief completes -> second useEffect fires `generateActionItems()` (with ref guard)
6. If AI provider not configured -> store sets error -> amber banner appears in modal
7. When modal closes -> both IDs cleared, `autoGenerate` becomes false for future manual opens
