# Task 3 (Plan D.9) -- Card Detail Modal Dark Mode Depth & Contrast

## Status: COMPLETE

## Changes Made

File: `src/renderer/components/CardDetailModal.tsx`

### 1. Modal overlay opacity
- `dark:bg-black/50` -> `dark:bg-black/60` (line 369)
- Better contrast between modal and page background

### 2. Modal container border
- `dark:border-surface-700` -> `dark:border-surface-600` (line 371)
- More defined modal edge in dark mode

### 3. Priority active states (both modes)
- Background opacity `/20` -> `/30` and ring opacity `/40` -> `/50` for all 4 priorities (lines 37-40)
- emerald, blue, amber, red -- all updated
- These are NOT dark:-prefixed; they improve contrast in both light and dark modes

### 4. Template & label dropdown borders
- Template dropdown: `dark:border-surface-700` -> `dark:border-surface-600` (line 431)
- Label dropdown: `dark:border-surface-700` -> `dark:border-surface-600` (line 537)
- Better separation from surface-900 modal background

### 5. Action link hover brightness
- "Apply Template", "Save as Template", "Generate with AI" links
- `hover:text-surface-200` -> `hover:text-surface-100` (lines 424, 477, 487)
- Brighter hover contrast in dark mode

### 6. Label color picker ring
- `ring-white/50` -> `ring-white/70` (line 581)
- Better visibility of selected color swatch

## Verification
- TypeScript: PASS (zero errors)
- Tests: PASS (150/150)
