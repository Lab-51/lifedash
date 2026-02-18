<phase n="F.3" name="Focus Session Management — Edit, Delete, and Chart Improvements">
  <context>
    Plan F.2 built the Focus Time Tracking page at /focus. User feedback:
    1. The activity chart only shows days up to "today" for This Week (e.g., 4 bars if it's Thu).
       User wants full 7-day weeks + more period options (Last Week, Last 7 Days).
    2. Sessions are read-only — user wants to edit the project and note of existing sessions.
       When a session's project changes, the project breakdown/chart/stats should update dynamically.
    3. No way to delete sessions — user wants delete functionality.

    Current state:
    - FocusPage.tsx: 305 lines with period selector (4 options), project filter, summary stats,
      project breakdown, activity chart, session list with date grouping + CSV export
    - focusService.ts: getTimeReport() with 4-way LEFT JOIN (sessions → cards → columns → boards → projects)
    - focus_sessions schema: id, cardId (FK cards), durationMinutes, note, completedAt
    - Project info is currently derived ONLY from the card chain (no direct project link on sessions)
    - XP is awarded on save via gamificationService.awardXP() — NOT reversed on delete (by design)

    Key approach: Add a `project_id` column to focus_sessions so users can directly assign
    a project to a session (overriding the card-chain-derived project). Use COALESCE in queries
    to prefer direct projectId over card-chain projectId.

    Drizzle ORM v0.45.1 — supports aliasedTable() from 'drizzle-orm' for self-joins.

    @src/renderer/pages/FocusPage.tsx
    @src/main/services/focusService.ts
    @src/main/ipc/focus.ts
    @src/preload/domains/focus.ts
    @src/shared/types/focus.ts
    @src/shared/types/electron-api.ts
    @src/main/db/schema/focus.ts
    @src/renderer/stores/focusStore.ts
  </context>

  <task type="auto" n="1">
    <n>Activity chart period options + full-week display</n>
    <files>
      src/renderer/pages/FocusPage.tsx
    </files>
    <action>
      **Part A — New period options:**
      Add "Last Week" and "Last 7 Days" to the PERIODS array:
      - PERIODS becomes: This Week | Last Week | Last 7 Days | This Month | Last Month | Custom
      - Period type: add 'lastWeek' | 'last7Days' to the Period union

      Update `periodRange()` function:
      - 'thisWeek': Mon of current week → **Sunday** of current week (always 7 days,
        even if today is mid-week — future days will show 0-value bars in the chart)
      - 'lastWeek': Mon of previous week → Sun of previous week (always 7 days)
      - 'last7Days': 6 days ago → today (always 7 days)
      - 'thisMonth' and 'lastMonth': unchanged
      - 'custom': unchanged

      Helper function `getSunday(mon: Date)`: returns the Sunday of the same week.

      **Part B — Activity chart day-of-week labels:**
      When the selected period is exactly 7 days (thisWeek, lastWeek, last7Days),
      show abbreviated day-of-week labels (Mon, Tue, Wed, ...) under each bar instead
      of the numeric date labels. Use `weekday: 'short'` from toLocaleDateString.

      For other periods, keep the existing numeric date label logic.

      **Part C — Chart footer label:**
      The footer currently says "{N}-Day Activity". For 7-day periods,
      show "Weekly Activity" instead. For other lengths, keep "{N}-Day Activity".

      WHY: Users expect full-week charts like other productivity tools (Toggl, RescueTime).
      "This Week" showing 4 bars on Thursday feels incomplete. Adding "Last Week" and "Last 7 Days"
      gives proper comparison options for time tracking.
    </action>
    <verify>
      - npx tsc --noEmit passes
      - PERIODS array has 6 entries (was 4)
      - Period type includes 'lastWeek' and 'last7Days'
      - periodRange returns Mon-Sun for 'thisWeek' (7 days even on Monday)
      - periodRange returns previous Mon-Sun for 'lastWeek'
      - Activity chart label is "Weekly Activity" for 7-day periods
    </verify>
    <done>6 period options, full-week chart display, day-of-week labels for weekly views</done>
    <confidence>HIGH</confidence>
  </task>

  <task type="auto" n="2">
    <n>Backend — session update/delete + direct project assignment</n>
    <files>
      src/main/db/schema/focus.ts
      src/main/services/focusService.ts
      src/main/ipc/focus.ts
      src/preload/domains/focus.ts
      src/shared/types/focus.ts
      src/shared/types/electron-api.ts
    </files>
    <action>
      **Part A — Schema migration:**
      Add `projectId` column to focus_sessions:
      ```
      projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
      ```
      Import `projects` from './projects' in focus.ts schema.
      Run `npx drizzle-kit generate` to create migration 0015.

      **Part B — Update getTimeReport queries:**
      The key change: session's effective project = COALESCE(direct projectId, card-chain projectId).

      Use `aliasedTable` from 'drizzle-orm' to create a second reference to `projects`:
      ```typescript
      import { aliasedTable } from 'drizzle-orm';
      const directProject = aliasedTable(projects, 'dp');
      ```

      In the session list query:
      - Add: `.leftJoin(directProject, eq(focusSessions.projectId, directProject.id))`
      - Change selected project fields to use COALESCE:
        ```
        projectId: sql`COALESCE(${directProject.id}, ${projects.id})`,
        projectName: sql`COALESCE(${directProject.name}, ${projects.name})`,
        projectColor: sql`COALESCE(${directProject.color}, ${projects.color})`,
        ```

      In the project breakdown query: same aliasedTable join + COALESCE,
      GROUP BY the COALESCE'd values.

      In the summary query (when projectId filter is active):
      filter by `COALESCE(dp.id, p.id) = projectId`.

      In getDailyDataForRange: same aliasedTable pattern when projectId filter is active.

      **Part C — New service functions:**

      `updateSession(id, input)`:
      ```typescript
      export async function updateSession(
        id: string,
        input: { projectId?: string | null; note?: string | null }
      ): Promise<void> {
        const db = getDb();
        const updates: Record<string, unknown> = {};
        if ('projectId' in input) updates.projectId = input.projectId || null;
        if ('note' in input) updates.note = input.note || null;
        await db.update(focusSessions).set(updates).where(eq(focusSessions.id, id));
      }
      ```

      `deleteSession(id)`:
      ```typescript
      export async function deleteSession(id: string): Promise<void> {
        const db = getDb();
        await db.delete(focusSessions).where(eq(focusSessions.id, id));
      }
      ```
      Note: XP is NOT reversed on delete. The XP was earned when the session was completed;
      deleting corrects time tracking, not gamification.

      **Part D — IPC handlers:**
      - 'focus:update-session': calls focusService.updateSession(id, input)
      - 'focus:delete-session': calls focusService.deleteSession(id)

      **Part E — Preload bridge + types:**
      Add to focusBridge:
      - focusUpdateSession: (id: string, input: { projectId?: string | null; note?: string | null })
      - focusDeleteSession: (id: string)

      Add to ElectronAPI interface:
      - focusUpdateSession: same signature → Promise<void>
      - focusDeleteSession: (id: string) → Promise<void>

      WHY: Direct project assignment is cleaner than forcing users to pick cards.
      COALESCE-based queries mean existing sessions (with card-chain projects) continue
      working unchanged. New edits set projectId directly.
    </action>
    <verify>
      - npx drizzle-kit generate creates migration 0015 with ALTER TABLE
      - npx tsc --noEmit passes
      - focusSessions schema has projectId column
      - focusService exports updateSession + deleteSession
      - IPC handlers registered for focus:update-session and focus:delete-session
      - Preload bridge has focusUpdateSession + focusDeleteSession
      - ElectronAPI type includes both new methods
    </verify>
    <done>Schema migration, COALESCE-based queries, update/delete service + IPC ready</done>
    <confidence>MEDIUM — aliasedTable API needs verification during implementation</confidence>
  </task>

  <task type="auto" n="3">
    <n>Session edit + delete UI in FocusPage</n>
    <files>
      src/renderer/pages/FocusPage.tsx
      src/renderer/stores/focusStore.ts
    </files>
    <action>
      **Part A — Session row actions:**
      Add hover-reveal action buttons to each session row (right side):
      - Pencil icon (edit) — toggles inline edit form
      - Trash2 icon (delete) — triggers delete with undo toast

      Icons: import { Pencil, Trash2 } from 'lucide-react'
      Buttons appear on hover via `opacity-0 group-hover:opacity-100` on the row.

      **Part B — Inline edit form:**
      When edit is clicked, the session row expands to show:
      1. Project dropdown: "No project" + all active projects (same as the page filter dropdown)
         - Pre-selected to current session projectId (or empty if none)
         - Show project color dot next to each option
      2. Note textarea: single-line input, pre-filled with current note
      3. Save button (emerald, Check icon) + Cancel button (surface, X icon)

      State: `editingSessionId: string | null` + `editProject: string` + `editNote: string`

      On save:
      - Call `window.electronAPI.focusUpdateSession(id, { projectId, note })`
      - Bump `lastSavedAt` in focusStore to trigger report re-fetch
      - Clear editing state
      - The re-fetch automatically updates project breakdown, chart, and stats

      **Part C — Delete with undo:**
      Follow the existing undo pattern from card deletion (Plan 15.2):
      - Click trash → session visually removed from list immediately (optimistic)
      - Show toast: "Session deleted" with "Undo" button, 5s timeout
      - After 5s: call `window.electronAPI.focusDeleteSession(id)` + bump lastSavedAt
      - Undo: restore session to UI, cancel the pending delete

      State: `pendingDelete: { id: string; timeout: ReturnType<typeof setTimeout> } | null`

      Use the existing toast() system from '@/stores/toastStore' with action button support.

      **Part D — focusStore additions:**
      Add to focusStore:
      - `updateSession(id, input)`: calls IPC + bumps lastSavedAt
      - `deleteSession(id)`: calls IPC + bumps lastSavedAt

      These are thin wrappers that the FocusPage calls after its local UI updates.

      WHY: Inline editing is faster than a modal for simple field changes. The undo pattern
      prevents accidental data loss while keeping the flow smooth. Bumping lastSavedAt
      triggers the existing useEffect re-fetch, which dynamically updates ALL derived data
      (project breakdown, chart, stats) without extra code.
    </action>
    <verify>
      - npx tsc --noEmit passes
      - Session rows show edit + delete icons on hover
      - Clicking edit expands inline form with project dropdown + note input
      - Saving triggers re-fetch (project breakdown updates)
      - Delete shows undo toast, commits after 5s
      - npx vitest run — all 150 tests pass
    </verify>
    <done>Full session edit (project + note) and delete with undo in FocusPage</done>
    <confidence>HIGH</confidence>
  </task>
</phase>
