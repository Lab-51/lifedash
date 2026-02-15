# Plan 11.3 — UX Quick Wins & Documentation Reconciliation

<phase n="11.3" name="UX Quick Wins & Documentation Reconciliation">
  <context>
    Plans 11.1 and 11.2 addressed the top 4 review priorities (close-during-recording
    guard, markdown rendering, command palette loading, test extraction). This plan
    tackles the remaining "Immediate" quick wins and review priority #5 (outdated docs).

    From REVIEW.md "Quick Wins" — already done:
    - Card count badges on columns (already in BoardColumn.tsx:177)
    - Textarea auto-resize in brainstorm (already in BrainstormPage.tsx:442-450)
    - Close-during-recording guard (Plan 11.1)
    - Command palette loading (Plan 11.1)
    - Brainstorm markdown rendering (Plan 11.1)

    Remaining quick wins addressed in this plan:
    - "Show Archived" toggle on ProjectsPage (REVIEW.md quick win #5)
    - Sorting on IdeasPage and MeetingsPage (REVIEW.md quick win #4)

    Plus review priority #5: Reconcile outdated documentation.

    Key patterns to follow:
    - BrainstormPage has the archive toggle pattern: useState(false), checkbox UI,
      sessions.filter(s => s.status === 'active'), conditional render when archived exist
    - ProjectsPage currently does: `projects.filter(p => !p.archived)` with no toggle
    - Projects use `archived: boolean` field (not status enum)
    - IdeasPage and MeetingsPage have status filter tabs + search, but no sort controls

    @src/renderer/pages/ProjectsPage.tsx
    @src/renderer/pages/IdeasPage.tsx
    @src/renderer/pages/MeetingsPage.tsx
    @src/renderer/pages/BrainstormPage.tsx (pattern reference for archive toggle)
    @PROJECT.md
    @REQUIREMENTS.md
    @ROADMAP.md
    @CHEATSHEET.md
  </context>

  <task type="auto" n="1">
    <n>Add "Show Archived" toggle to ProjectsPage</n>
    <files>
      src/renderer/pages/ProjectsPage.tsx
    </files>
    <action>
      Add a toggle to show/hide archived projects on the ProjectsPage, following
      the BrainstormPage pattern.

      **Changes to ProjectsPage.tsx:**

      1. Add state: `const [showArchived, setShowArchived] = useState(false);`

      2. Change the filter logic from:
         ```ts
         const activeProjects = projects.filter(p => !p.archived);
         ```
         to:
         ```ts
         const filteredProjects = showArchived ? projects : projects.filter(p => !p.archived);
         const hasArchivedProjects = projects.some(p => p.archived);
         ```

      3. Add a checkbox toggle near the page header (next to the "New Project" button
         or in the filter area), conditionally shown only when archived projects exist.
         Follow BrainstormPage style:
         ```tsx
         {hasArchivedProjects && (
           <label className="flex items-center gap-2 text-xs text-surface-400 cursor-pointer">
             <input
               type="checkbox"
               checked={showArchived}
               onChange={(e) => setShowArchived(e.target.checked)}
               className="rounded border-surface-600"
             />
             Show archived
           </label>
         )}
         ```

      4. In the project grid rendering, use `filteredProjects` instead of `activeProjects`.

      5. Add visual distinction for archived projects — apply `opacity-50` class to
         archived project cards (same as BrainstormPage line 257).

      6. For archived projects shown in the list, add an "Unarchive" button (or replace
         the Archive button with Unarchive). Use the existing `updateProject` function:
         `await updateProject(id, { archived: false })`.

      **WHY:** Archiving is currently one-way with no recovery path. Users who
      accidentally archive a project have no way to get it back without DB access.
      The BrainstormPage already has this pattern, so ProjectsPage should match.
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all 150 existing tests still pass
      - Visually: when no projects are archived, no checkbox appears
      - Visually: when a project is archived, checkbox appears and toggles visibility
      - Archived projects show with reduced opacity
      - Unarchive action restores the project to full visibility
    </verify>
    <done>
      ProjectsPage has a "Show archived" checkbox that reveals archived projects
      with reduced opacity and an unarchive action. Pattern matches BrainstormPage.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Projects use `archived: boolean` field (confirmed in ProjectsPage filter)
      - The existing `updateProject(id, { archived: false })` call works for unarchiving
      - useState import is already present in ProjectsPage
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Add sort controls to IdeasPage and MeetingsPage</n>
    <files>
      src/renderer/pages/IdeasPage.tsx
      src/renderer/pages/MeetingsPage.tsx
    </files>
    <action>
      Add a sort dropdown to both IdeasPage and MeetingsPage. Both pages currently
      render items in database order with no sort option.

      **For IdeasPage:**

      1. Add state: `const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');`

      2. Add sort logic after the existing filter:
         ```ts
         const sortedIdeas = [...filteredIdeas].sort((a, b) => {
           if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
           if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
           return a.title.localeCompare(b.title);
         });
         ```

      3. Add a sort dropdown in the filter bar area (next to the search box):
         ```tsx
         <select
           value={sortBy}
           onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
           className="bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5 text-xs text-surface-300 focus:outline-none focus:border-primary-500"
         >
           <option value="newest">Newest first</option>
           <option value="oldest">Oldest first</option>
           <option value="title">Title A-Z</option>
         </select>
         ```

      4. Use `sortedIdeas` instead of `filteredIdeas` in the grid rendering.

      **For MeetingsPage:**

      Same pattern but with meeting-appropriate sort options:

      1. Add state: `const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');`

      2. Add sort logic after filter (meetings have `createdAt` and `title`):
         ```ts
         const sortedMeetings = [...filteredMeetings].sort((a, b) => {
           if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
           if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
           return a.title.localeCompare(b.title);
         });
         ```

      3. Add dropdown in the filter area (same styling as IdeasPage).

      4. Use `sortedMeetings` in the grid rendering.

      **Styling note:** Use the same select styling on both pages for consistency.
      The dark-theme select styling (`bg-surface-800 border border-surface-700`) matches
      the existing search input styling.

      **WHY:** Sorting is a basic UX expectation for any list view. Both pages have
      50+ potential items but no way to find recent or alphabetical entries. The review
      called this out as quick win #4.
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all 150 tests still pass
      - IdeasPage: sort dropdown appears, "Newest first" is default, all 3 options work
      - MeetingsPage: sort dropdown appears, "Newest first" is default, all 3 options work
      - Sort persists while filtering (sort + search work together)
    </verify>
    <done>
      Both IdeasPage and MeetingsPage have a sort dropdown with newest/oldest/title
      options. Default is "Newest first". Sort works in combination with existing
      status filters and search.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Both pages have `createdAt` (string ISO date) and `title` fields on their entities
      - The existing `filteredIdeas` / `filteredMeetings` variables are arrays that can
        be spread and sorted without side effects
      - The select element styling matches the dark theme without additional CSS
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Reconcile outdated documentation</n>
    <files>
      PROJECT.md
      REQUIREMENTS.md
      ROADMAP.md
      CHEATSHEET.md
    </files>
    <action>
      Fix the 5 specific outdated references identified in REVIEW.md:

      **1. PROJECT.md line 29:** Change
         `"Database: PostgreSQL (local via Docker)"`
         → `"Database: PGlite (embedded WASM PostgreSQL — no Docker required)"`

      **2. PROJECT.md line 38:** Change
         `"Docker required for PostgreSQL"`
         → `"Fully standalone — no Docker or external services required"`

      **3. PROJECT.md Constraints section:** Also update the constraint
         `"Privacy-conscious — local PostgreSQL, local Whisper option"`
         → `"Privacy-conscious — embedded PGlite database, local Whisper option"`

      **4. REQUIREMENTS.md:** Find the reference to `@kutalia/whisper-node-addon`
         and change to `@fugood/whisper.node v1.0.16 (NAPI native addon)`

      **5. ROADMAP.md:** Mark all Phase 1-9 deliverable checkboxes as `[x]` (complete).
         Phases 10-11 are in progress / not in the roadmap yet, which is fine.

      **6. CHEATSHEET.md line ~116:** Find the architecture diagram that mentions
         "Framer Motion" and remove it (removed in Plan 10.2, commit d32a112).

      **WHY:** Outdated docs mislead future contributors and the user themselves.
      PROJECT.md saying "Docker required" is actively wrong — the app has been
      fully standalone since Phase 9's PGlite migration. These are small text fixes
      but high-impact for accuracy.
    </action>
    <verify>
      - PROJECT.md no longer mentions Docker as a requirement
      - PROJECT.md mentions PGlite as the database
      - REQUIREMENTS.md references @fugood/whisper.node (not @kutalia)
      - ROADMAP.md Phase 1-7 checkboxes are all [x]
      - CHEATSHEET.md no longer mentions Framer Motion
      - `grep -r "Docker required" PROJECT.md` returns nothing
      - `grep -r "kutalia" REQUIREMENTS.md` returns nothing
      - `grep -r "Framer Motion" CHEATSHEET.md` returns nothing
    </verify>
    <done>
      All 5 outdated documentation references fixed. PROJECT.md reflects PGlite
      and standalone operation. REQUIREMENTS.md has correct Whisper package.
      ROADMAP.md checkboxes marked complete. CHEATSHEET.md architecture updated.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - The specific line numbers from the review are approximate (files may have
        shifted slightly) — search for content, not line numbers
      - No other outdated Docker references exist beyond the 2 in PROJECT.md
    </assumptions>
  </task>
</phase>
