# Task 1 — Close-During-Recording Guard

## Status: COMPLETE

## Change
Added a confirmation dialog when the user tries to close the app during an active recording session to prevent data loss.

## Files Created
- `src/main/services/recordingState.ts`: Shared boolean flag module to track recording state in the main process, extracted to avoid circular dependency between main.ts and IPC handlers.

## Files Modified
- `src/main/main.ts`: Added `dialog` import, imported `getIsRecording`/`setIsRecording` from the new shared module, replaced the close handler with an async version that checks recording state and shows a warning dialog before closing.
- `src/main/ipc/window-controls.ts`: Added `recording:set-state` IPC handler that calls `setIsRecording()` from the shared module.
- `src/preload/domains/window.ts`: Added `recordingSetState()` bridge method (invokes `recording:set-state`) and `onRecordingForceStop()` listener (listens for `recording:force-stop` event from main).
- `src/shared/types/electron-api.ts`: Added `recordingSetState` and `onRecordingForceStop` to the `ElectronAPI` interface.
- `src/renderer/stores/recordingStore.ts`: Calls `recordingSetState(true)` after successful recording start, `recordingSetState(false)` at the beginning of stop. Added force-stop listener in `initListener()` that triggers `stopRecording()` when main process sends the force-stop signal. Combined both cleanup functions into a single returned cleanup function.

## Design Decisions
- **Extracted `recordingState.ts` to avoid circular dependency**: `main.ts` imports from `./ipc/index.ts` which imports `window-controls.ts`. If `window-controls.ts` imported back from `main.ts`, it would create a circular dependency. The shared module breaks this cycle cleanly.
- **2-second timeout before force close**: Gives the renderer enough time to gracefully stop audio capture and save the WAV file before the window actually closes.
- **"Keep Recording" is default button (index 0)**: Prevents accidental data loss from hitting Enter.
- **`recordingSetState(false)` called early in `stopRecording()`**: Ensures the main process flag is cleared immediately so the close guard doesn't re-trigger during the async stop sequence.

## Verification
- TypeScript: PASS (zero errors)
- Tests: PASS (99/99)
