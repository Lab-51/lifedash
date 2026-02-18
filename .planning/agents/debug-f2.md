# Debug Report: Focus Time Tracking page not showing sessions

**Issue:** After completing a focus session, the Focus Time Tracking page (/focus) shows no sessions in the table, even though the session was saved to the database.

**Root Cause:** Two bugs in `src/renderer/pages/FocusPage.tsx`:

1. **Stale data after session completion.** The `useEffect` that fetches the time report only depended on `[startDate, endDate, projectId]`. When a user starts a focus session while already on /focus, the overlay takes over. After completing, the overlay disappears but none of the dependencies changed, so the effect never re-fires. The pre-session (stale) data persists.

2. **UTC date shift in `toISO()`.** The helper `toISO(d)` used `d.toISOString().slice(0, 10)`, which converts to UTC before extracting the date. For users in positive UTC offsets (e.g., UTC+5), at the start of their local day the UTC date is still the previous day. This shifts the entire query range by -1 day, excluding today's sessions.

**Status:** Fixed

## Evidence

- **Bug 1:** `useEffect` at line 89 had dependency array `[startDate, endDate, projectId]` -- no dependency on focus session lifecycle. The `focusMode` state in `focusStore.ts` transitions `idle -> focus -> break -> completed -> idle`, but nothing in FocusPage listened to it.

- **Bug 2:** `toISOString()` returns UTC (e.g., `2026-02-17T21:00:00.000Z` for local Feb 18 02:00 UTC+5). Slicing the first 10 chars gives `2026-02-17` instead of the correct local date `2026-02-18`.

## Fixes Applied

### File: `src/renderer/pages/FocusPage.tsx`

**Fix 1 -- Refetch on session completion:**
- Added `const focusMode = useFocusStore(s => s.mode);` (line 88)
- Added early return `if (focusMode !== 'idle') return;` inside the useEffect (line 94)
- Added `focusMode` to the dependency array: `[startDate, endDate, projectId, focusMode]` (line 102)
- `useFocusStore` was already imported at line 8 -- no new import needed

**Fix 2 -- Use local date in `toISO()`:**
- Replaced: `return d.toISOString().slice(0, 10);`
- With: `` return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; ``

## Verification

- `npx tsc --noEmit` passes with zero errors
- `useFocusStore` is imported at line 8
- `toISO` no longer uses `toISOString()`
- The `focusMode` guard prevents unnecessary fetches during active focus/break/completed states
- When `focusMode` returns to `'idle'` (after session save), the effect re-fires and fetches fresh data

## Prevention

- Date formatting helpers should always use local date parts (`getFullYear`, `getMonth`, `getDate`) unless UTC is explicitly required. Consider creating a shared `toLocalISODate()` utility.
- Any page that displays data which can be mutated by overlays/modals should subscribe to the relevant store state to trigger refetches.
