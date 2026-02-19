# Plan G.1 — Achievement Banner Visual Overhaul (Dark & Light Mode)

## Date: 2026-02-19
## Status: COMPLETE (2/2 tasks)

## What Was Built

Complete visual overhaul of the AchievementBanner component — replaced runtime isDark checks with Tailwind dark: variants, redesigned layout with celebration effects, and improved light/dark mode treatments.

### Task 1: Redesign banner layout + proper dark: variant classes (4f70dd5)
- **Removed all isDark runtime checks** — 15+ conditional expressions replaced with Tailwind `dark:` variants
- `dark:` prefix baked into CATEGORY_STYLES values for Tailwind CSS 4 scanner compatibility
- **Wider banner** (480px, up from 420px), **larger icon** (w-12 h-12, up from w-10 h-10)
- **Category label pill** next to "Achievement Unlocked" text
- **Countdown progress bar** — 3px bar at bottom depletes over 5.6s via CSS transition
- **Animation simplification** — 50+ lines of inline style ternaries → 3 CSS classes (enter/exit/hidden)
- **Light mode depth** — bg-white, ring-1, shadow-xl, from-{color}-50/80, solid bg-{color}-100 icons
- **Dark mode** unchanged — bg-surface-900, shadow-2xl, glow animation
- CSS glow variable via `.achievement-banner` + `:where(.dark)` override in globals.css
- Shimmer unified to single `.achievement-shimmer` class

### Task 2: Celebration particle effects + icon entrance animation (28ff382)
- **6 sparkle particles** burst from icon on entrance (CSS-only, no dependencies)
- Particles use `currentColor` — auto-match category color in both modes
- **Icon bounce** animation (500ms, 200ms delay for staggered entrance)
- **Entrance sequence**: banner slides → icon bounces → particles burst
- **Light-mode ring pulse** replaces invisible-on-white glow animation
- `:where(:not(.dark))` override keeps dark glow separate from light ring-pulse

## Files Modified
- `src/renderer/components/AchievementBanner.tsx` (339 lines)
- `src/renderer/styles/globals.css` (+7 new CSS rules/keyframes)

## Verification
- TypeScript: clean (zero errors)
- Tests: 150/150 pass
- 2 atomic commits
- No new dependencies

## Next Step
TBD — user decides
