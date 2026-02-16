# Task 1: Pin/Star Projects — Implementation Summary

## Change
Added pin/star capability to projects. Pinned projects float to the top of the Projects list and are visually prioritized on the Dashboard active projects section.

## Files Modified

### Schema + Migration
- `src/main/db/schema/projects.ts`: Added `pinned: boolean('pinned').default(false).notNull()` column after `archived`.
- `drizzle/0007_stormy_legion.sql`: Auto-generated migration — `ALTER TABLE "projects" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;`

### Shared Types + Validation
- `src/shared/types/projects.ts`: Added `pinned: boolean` to `Project` interface and `pinned?: boolean` to `UpdateProjectInput`.
- `src/shared/validation/schemas.ts`: Added `pinned: z.boolean().optional()` to `updateProjectInputSchema`.

### IPC Handler
- `src/main/ipc/projects.ts`: Changed `projects:list` ordering from `asc(projects.createdAt)` to `desc(projects.pinned), asc(projects.createdAt)`. Imported `desc` from drizzle-orm. The `projects:update` handler already spreads all validated input fields, so `pinned` flows through automatically.

### Renderer — ProjectsPage
- `src/renderer/pages/ProjectsPage.tsx`:
  - Imported `Star` from lucide-react.
  - Added a Star toggle button as the FIRST action in the project card hover actions. The star stays visible (not hidden) when the project is pinned.
  - Added a small filled star icon next to the project name when pinned, visible even without hovering.

### Renderer — DashboardPage
- `src/renderer/pages/DashboardPage.tsx`:
  - Imported `Star` from lucide-react.
  - Added a small filled star icon next to pinned project names in the Active Projects section.
  - Since `projects:list` now returns pinned first, pinned projects naturally appear at the top of the dashboard.

### Store
- `src/renderer/stores/projectStore.ts`: No changes needed — uses `UpdateProjectInput` from shared types (which now includes `pinned?: boolean`), and passes data through to IPC unchanged.

## Verification
- TypeScript (`npx tsc --noEmit`): Pass (zero errors)
- Tests (`npm test`): Pass (150/150)
- Migration (`npx drizzle-kit generate`): Generated `drizzle/0007_stormy_legion.sql`
