# Task 1 — Plan D.9: Board Column & Kanban Card Dark Mode Contrast Fixes

## Summary
Applied 10 targeted dark mode contrast improvements across two Kanban board components. All changes exclusively modify `dark:` Tailwind utility classes to improve visibility and contrast against the solid surface-900 column background.

## Files Modified

### src/renderer/components/BoardColumnModern.tsx (6 changes)
1. **Column container bg**: Removed `/50` opacity from `dark:bg-surface-900/50` and `dark:border-surface-800/50` for a solid, opaque column background
2. **Column count badge**: Changed `dark:bg-surface-800` to `dark:bg-surface-700` and `dark:text-surface-400` to `dark:text-surface-300` so the badge stands out from the now-solid column bg
3. **Empty column dashed border**: Changed `dark:border-surface-800` to `dark:border-surface-700` for better visibility against surface-900
4. **Card input focus ring**: Added `dark:focus:ring-primary-500/40` for a stronger focus ring in dark mode
5. **Add Card button hover bg**: Changed `dark:hover:bg-surface-800` to `dark:hover:bg-surface-800/80` for a subtler hover state
6. **Drag-over state**: Changed `dark:bg-primary-900/10` to `dark:bg-primary-900/20` for a more visible drop target indicator

### src/renderer/components/KanbanCardModern.tsx (4 changes)
1. **Hover action toolbar border**: Changed `dark:border-surface-700` to `dark:border-surface-600` for clearer toolbar separation
2. **Link count badge**: Added `dark:text-surface-400` for better text contrast in dark mode
3. **Checkbox border**: Changed `dark:border-surface-600` to `dark:border-surface-500` for more visible unchecked checkboxes
4. **Card hover border**: Changed `dark:hover:border-primary-700` to `dark:hover:border-primary-600` for a brighter hover glow

## Verification
- TypeScript: Pass (zero errors)
- Tests: Pass (150/150)
- Build: N/A (visual changes only)
