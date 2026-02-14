# Task 1 (Plan 9.2) -- Post-recording processing state and auto-open meeting detail

## Implementation Complete

**Change:** Added a post-recording processing UI state and auto-open behavior for the completed meeting detail modal.

### Files Modified

- `src/renderer/stores/recordingStore.ts`: Added `isProcessing` and `completedMeetingId` state fields, `clearCompletedMeetingId` action, and rewrote `stopRecording()` to transition through a processing state before completing.
- `src/renderer/components/RecordingControls.tsx`: Added a third conditional rendering branch for the processing state (amber pulsing dot + spinner + "Saving audio and finalizing transcript..." text, no buttons).
- `src/renderer/pages/MeetingsPage.tsx`: Imported `completedMeetingId` and `clearCompletedMeetingId` from recording store; added useEffect that auto-refreshes the meetings list and opens the MeetingDetailModal when a recording finishes processing.

### Verification

- TypeScript: Pass (zero errors)
- Tests: Pass (99/99)
- Lint: N/A (no lint script configured)
- Build: N/A (not requested)

### Details

**recordingStore.ts changes:**
- `stopRecording()` now captures `meetingId` before clearing state, sets `isRecording: false` and `isProcessing: true` immediately, then after all async work completes sets `isProcessing: false` and `completedMeetingId` to the captured ID.
- Error path also sets `isProcessing: false`.
- `clearCompletedMeetingId()` resets `completedMeetingId` to null (consumed by MeetingsPage).

**RecordingControls.tsx changes:**
- Rendering order: `isProcessing` (amber) -> `!isRecording` (idle form) -> recording (red dot + stop button).
- Processing state shows amber pulsing dot, Loader2 spinner, and descriptive text. No interactive controls.

**MeetingsPage.tsx changes:**
- New useEffect watches `completedMeetingId`. When it transitions from null to a value, it calls `loadMeetings()`, sets `selectedMeetingId` to auto-open the modal, and calls `clearCompletedMeetingId()` to consume the event.

### Notes
- No new dependencies added. Loader2 was already imported in RecordingControls.
- The `initListener` in recordingStore still syncs `isRecording`/`meetingId` from main process events -- the new `isProcessing` field is managed purely in the renderer store.
