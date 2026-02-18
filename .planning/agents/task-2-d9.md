# Task 2 (Plan D.9) -- Projects Page Dark Mode Visibility Fixes

## Status: COMPLETE

## File Modified
- `src/renderer/components/ProjectsModern.tsx`

## Changes Applied

1. **Project card hover shadow** -- Replaced `dark:hover:shadow-primary-900/10` with `dark:hover:shadow-lg dark:hover:shadow-primary-950/30` for a visible shadow on hover in dark mode.

2. **Dropdown menu background** -- Changed the dropdown container from `dark:bg-surface-900` to `dark:bg-surface-800` so it visually separates from the project card background.

3. **Dropdown menu item hover** -- Changed 4 dropdown menu items (Rename, Plan with AI, Duplicate, Archive) from `dark:hover:bg-surface-800` to `dark:hover:bg-surface-700` to contrast against the new surface-800 dropdown background. The Delete item uses red-themed hover and was left unchanged.

4. **Dropdown divider** -- Changed from `dark:bg-surface-800` to `dark:bg-surface-700` so the divider is visible against the surface-800 dropdown background.

5. **Unpinned star icon** -- Changed from `dark:text-surface-600` to `dark:text-surface-500` for better visibility when the star is not active.

6. **Search input focus ring** -- Added `dark:focus:ring-primary-500/40` after `focus:ring-primary-500/20` for a more visible focus ring in dark mode.

## Verification
- TypeScript (`npx tsc --noEmit`): Pass -- zero errors
- Tests (`npm test`): Pass -- 150/150 tests passing
