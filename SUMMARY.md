# Summary: Plan 11.1 — Critical UX Fixes & Data Loss Prevention

## Date: 2026-02-15
## Status: COMPLETE (3/3 tasks, sequential execution)

## What Changed

Three high-impact UX fixes identified by the project review (REVIEW.md). Focus: data loss prevention, feature discoverability, and visual polish.

### Task 1: Close-during-recording guard
**Status:** COMPLETE | **Confidence:** HIGH | **Commit:** baaf733

- New `src/main/services/recordingState.ts` — shared boolean flag module (avoids circular deps)
- Main process tracks recording state via `recording:set-state` IPC channel
- Window close handler shows `dialog.showMessageBox` when recording is active:
  - "Keep Recording" (default, safe) — dialog closes, recording continues
  - "Stop & Close" — sends `recording:force-stop` to renderer, 2-second grace period, then closes
- Renderer's `recordingStore` calls `recordingSetState(true/false)` on start/stop
- Force-stop listener in store triggers graceful `stopRecording()` from main process signal
- macOS hide-to-tray behavior preserved when not recording
- 6 files changed (1 new), 76 insertions

### Task 2: Eager entity loading for command palette
**Status:** COMPLETE | **Confidence:** HIGH | **Commit:** 6d982ee

- Added `useEffect` in `App.tsx` (AppShell component) that loads all entity stores on mount
- Uses `getState()` pattern to avoid unnecessary re-renders
- Loads: projects, meetings, ideas, brainstorm sessions
- Board cards not pre-loaded (require projectId parameter)
- CommandPalette already shows "No results found" for empty searches — no change needed
- 1 file changed, 13 insertions

### Task 3: react-markdown + remark-gfm for brainstorm chat
**Status:** COMPLETE | **Confidence:** HIGH | **Commit:** 4c9e1c6

- Installed `react-markdown` + `remark-gfm` dependencies
- Removed `formatInline()` and `renderMarkdown()` regex functions (~110 lines deleted)
- Added `ReactMarkdown` component with 13 custom Tailwind-styled overrides:
  - Headings (h1-h3), paragraphs, lists (ul/ol/li), code (inline + block)
  - Pre, links, tables (table/th/td), blockquotes, horizontal rules
- User messages remain plain text with `whitespace-pre-wrap`
- ChatMessage.tsx: 238 → 109 lines (net -129 lines)
- 3 files changed, 1567 insertions (mostly package-lock.json), 227 deletions

## Files Modified (10 total, 1 new)

**Task 1 — 6 files (1 new):**
- NEW: `src/main/services/recordingState.ts`
- MOD: `src/main/main.ts`, `src/main/ipc/window-controls.ts`, `src/preload/domains/window.ts`, `src/shared/types/electron-api.ts`, `src/renderer/stores/recordingStore.ts`

**Task 2 — 1 file:**
- MOD: `src/renderer/App.tsx`

**Task 3 — 3 files:**
- MOD: `src/renderer/components/ChatMessage.tsx`, `package.json`, `package-lock.json`

## Verification
- `npx tsc --noEmit`: PASS (zero errors, verified after each task)
- `npx vitest run`: 99/99 tests pass (verified after each task)

## What's Next
- Plan 11.1 is complete
- Remaining review items from REVIEW.md: test coverage expansion, architecture documentation
- Push to GitHub when ready
