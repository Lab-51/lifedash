# Plan I.1 — Billable Time Tracking

<phase n="I.1" name="Billable Time Tracking for Entrepreneurs">
  <context>
    The Focus Time Tracking feature (Plans F.1-F.3) is a solid personal productivity tool
    but lacks billing-oriented features that entrepreneurs need:
    - No way to mark sessions as billable vs. non-billable
    - No hourly rate on projects (can't compute cost)
    - No cost columns in reports or CSV export
    - No billable hours summary or utilization metrics

    This plan adds a lean billing layer on top of the existing focus system:
    billable flag on sessions, hourly rate on projects, cost calculations in reports,
    and billing-aware UI (filters, stats, export).

    The approach is modular — billing data is optional. Existing sessions default to
    billable=true (entrepreneurs' most common case). Projects without a rate simply
    show time without cost. No invoice generation or payment integration (out of scope).

    @src/main/db/schema/focus.ts
    @src/main/db/schema/projects.ts
    @src/shared/types/focus.ts
    @src/main/services/focusService.ts
    @src/main/ipc/focus.ts
    @src/preload/domains/focus.ts
    @src/renderer/pages/FocusPage.tsx
    @src/renderer/components/FocusCompleteModal.tsx
    @src/renderer/components/FocusStartModal.tsx
    @src/renderer/stores/focusStore.ts
  </context>

  <task type="auto" n="1">
    <n>Schema + backend — billable sessions and project hourly rates</n>
    <files>
      src/main/db/schema/focus.ts
      src/main/db/schema/projects.ts
      drizzle/0018_billable_time.sql
      src/shared/types/focus.ts
      src/shared/types/project.ts
      src/main/services/focusService.ts
      src/main/ipc/focus.ts
      src/main/ipc/projects.ts
      src/preload/domains/focus.ts
      src/shared/types/electron-api.ts
    </files>
    <action>
      ## Schema changes

      1. **focus_sessions** — add `billable` boolean column (default true, not null).
         Default true because most entrepreneur sessions are billable; they opt-out
         for internal/admin work.

      2. **projects** — add `hourlyRate` real column (nullable).
         Null means "no rate set" — time is tracked but cost isn't computed.
         Real (float) is sufficient for hourly rates (no sub-cent precision needed).

      3. Generate migration 0018_billable_time.sql:
         ```sql
         ALTER TABLE "focus_sessions" ADD COLUMN "billable" boolean DEFAULT true NOT NULL;
         ALTER TABLE "projects" ADD COLUMN "hourly_rate" real;
         ```
         IMPORTANT: Check drizzle/meta/_journal.json for the last `when` timestamp
         and ensure 0018's timestamp is strictly greater (PGlite monotonic requirement).

      ## Type changes

      4. **FocusSession** — add `billable: boolean`
      5. **FocusSessionFull** — add `billable: boolean` + `hourlyRate: number | null`
         (hourlyRate comes from the joined project)
      6. **FocusProjectTime** — add `cost: number | null`
         (computed as minutes/60 * hourlyRate, null if no rate)
      7. **FocusTimeReport.summary** — add:
         - `billableMinutes: number`
         - `billableCost: number` (sum of billable session costs)
      8. Add to project types (CreateProjectInput / Project): `hourlyRate?: number | null`

      ## Service changes (focusService.ts)

      9. **getTimeReport()** — update queries:
         - Session query: SELECT billable flag + project hourlyRate
         - Project breakdown: compute cost = SUM(minutes) / 60 * hourlyRate for billable sessions
         - Summary: add billableMinutes (SUM where billable=true) and billableCost
         - Accept optional `billableOnly?: boolean` filter in FocusTimeReportOptions
         - When billableOnly=true, add WHERE billable = true to all queries

      10. **saveSession()** — accept `billable?: boolean` in input (default true)

      11. **updateSession()** — accept `billable?: boolean` in update input

      ## IPC + preload

      12. Update focus:save-session to pass billable field
      13. Update focus:update-session to pass billable field
      14. Update projects IPC — pass hourlyRate on create/update
      15. Update preload bridge types if needed
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - Migration 0018 SQL file exists with correct ALTER statements
      - Migration journal timestamp is monotonically greater than 0017
      - FocusTimeReport type includes billableMinutes and billableCost
      - focusService.getTimeReport returns cost data in projectBreakdown
    </verify>
    <done>
      Schema has billable + hourlyRate columns, types updated, service computes costs,
      IPC passes all new fields. All existing sessions default to billable=true.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - PGlite handles ALTER TABLE ADD COLUMN with DEFAULT correctly (verified in prior migrations)
      - Float precision is acceptable for hourly rates (no accounting-grade decimals needed)
      - Existing sessions defaulting to billable=true is the right UX for entrepreneurs
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>FocusPage billing UI — filters, cost stats, and enhanced export</n>
    <files>
      src/renderer/pages/FocusPage.tsx
    </files>
    <action>
      ## Billable filter toggle

      1. Add a billable filter to the controls bar (next to project dropdown):
         Three-way select: "All" | "Billable" | "Non-billable"
         - Pass billableOnly flag to getTimeReport when "Billable" selected
         - When "Non-billable" selected, pass billableOnly=false
         - Default: "All" (shows everything)

      ## Summary stats enhancement

      2. When any project in the report has an hourly rate, show a 5th stat card
         (shift from 4-col to 5-col grid):
         - "Billable Amount" showing formatted cost (e.g. "$1,250.00")
         - DollarSign icon with emerald accent
         - Only visible when there's actual cost data (billableCost > 0)

      3. Add a small "billable" sub-stat under Total Time:
         e.g. "12h 30m (10h 15m billable)" — only when billable filter is "All"
         and there are non-billable sessions

      ## Project breakdown enhancement

      4. In the project breakdown bars, append cost to the right side:
         "ProjectName  ████████  4h 30m  12 sessions  $675.00"
         Only show cost when the project has an hourly rate set.

      ## Session list enhancement

      5. Add a small billable indicator on each session row:
         - Green DollarSign icon (size 12) for billable sessions
         - Gray minus icon for non-billable
         - Placed before the project color dot

      6. In the inline edit form, add a billable checkbox toggle

      ## CSV export enhancement

      7. Add columns to CSV export:
         - "Billable" (Yes/No)
         - "Hourly Rate" (number or empty)
         - "Cost" (calculated, or empty if no rate)
         Keep existing columns intact, append new ones at the end.
    </action>
    <verify>
      - `npx tsc --noEmit` passes
      - FocusPage renders without errors
      - Billable filter select is visible in controls bar
      - When a project has an hourlyRate, cost appears in breakdown and summary
      - CSV export includes Billable, Hourly Rate, Cost columns
      - Session rows show billable indicator
      - Inline edit includes billable toggle
    </verify>
    <done>
      FocusPage shows billing data throughout: filter, stats, breakdown, session list,
      and CSV export. All billing UI is conditional — hidden when no rates are set.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - 5-column stat grid fits in the existing max-w-6xl layout
      - Billable filter can reuse the same getTimeReport IPC (just adds a WHERE clause)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Session flow — billable toggle in modals + project hourly rate editing</n>
    <files>
      src/renderer/components/FocusCompleteModal.tsx
      src/renderer/components/FocusStartModal.tsx
      src/renderer/stores/focusStore.ts
      src/renderer/pages/ProjectsPage.tsx
    </files>
    <action>
      ## FocusCompleteModal — billable toggle

      1. Add a small toggle/checkbox below the accomplishment textarea:
         "Mark as billable" — checked by default
         Pass the billable value to saveSession()

      2. When the focused card's project has an hourly rate, show a subtle
         cost preview: "~$12.50 (30 min @ $25/hr)" below the duration display.
         This gives immediate feedback on what they're billing.

      ## FocusStartModal — rate context

      3. When a card is selected and its project has an hourly rate, show a small
         info line: "$150/hr — ProjectName"
         This reminds the user which rate will apply before they start.

      ## focusStore — carry billable flag

      4. Add `billable: boolean` to the store state (default true).
         FocusCompleteModal reads/sets it; saveSession passes it to IPC.

      ## Project hourly rate editing

      5. Add hourly rate editing to ProjectsPage:
         - On project card hover (where Pencil/Trash/Star already live), add a
           DollarSign icon button that opens a small inline input.
         - OR: Add hourly rate as an editable field in the project card itself
           (e.g. small "$0/hr" text that becomes an input on click, like rename).
         - Save via existing projects:update IPC with the new hourlyRate field.
         - Show the rate on the card when set: "$150/hr" badge.

      ## Dark/light mode

      6. Ensure all new UI elements have proper dark: variants following
         the existing pattern in these components.
    </action>
    <verify>
      - `npx tsc --noEmit` passes
      - FocusCompleteModal shows billable toggle (default checked)
      - When project has hourlyRate, cost preview appears in completion modal
      - FocusStartModal shows rate info when card's project has a rate
      - focusStore carries billable field through save flow
      - Project hourly rate can be set and persisted from ProjectsPage
      - Rate badge visible on project cards
      - Light and dark mode both render correctly
    </verify>
    <done>
      Complete billable workflow: set rate on project → start focus → see rate context →
      complete session → toggle billable → see cost → data flows to FocusPage reports.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Project card hover actions can accommodate one more icon button
      - focusStore.saveSession already calls the IPC — just needs the extra field
      - Card → project resolution for rate display reuses existing project store data
    </assumptions>
  </task>
</phase>
