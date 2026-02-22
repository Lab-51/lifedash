# Plan J.1 — Card Agent Side Panel

## Date: 2026-02-22
## Status: COMPLETE (2/2 tasks)

## What Was Built

Replaced the tab system in CardDetailModal with a side-by-side layout. Card details are always visible on the left. The AI Agent panel slides in from the right when the user clicks the "AI Agent" button in the modal header.

### Task 1: Remove tab system + side-by-side layout (0f2845a)
- Removed activeTab state, tab bar JSX, and all tab-conditional rendering
- Added showAgent boolean state with "AI Agent" header button (Bot icon + emerald badge)
- Modal expands from max-w-3xl to max-w-[90vw]/xl:max-w-7xl when agent open
- Flex row layout: details always visible left, agent panel right
- Agent panel has its own header bar with close button (PanelRightClose)
- Dark/light mode support on all new elements

### Task 2: Polish transitions + behavior (0f2845a)
- Width-based panel animation (w-0 → w-[360px]/xl:w-[420px]) with transition-all 300ms
- Two-stage Escape: close agent panel first, then modal on second press
- Escape handler skips when focus is in input/textarea/contenteditable
- Border transitions via border-transparent (no flash on close)
- Active button state: emerald bg/text when panel open
- agentEverOpened flag preserves lazy loading of CardAgentPanel
- Responsive: 360px on <1280px, 420px on xl+

### Code Review Fixes
- Escape key input guard (prevent closing modal while editing title/description)
- Border-transparent transition (prevent flash during panel close animation)
- Stale "tab badge" comment → "agent button badge" in CardAgentPanel

## Files Modified
- `src/renderer/components/CardDetailModal.tsx` — Main layout refactor
- `src/renderer/components/CardAgentPanel.tsx` — Comment fix

## Verification
- TypeScript: clean (zero errors)
- 1 atomic commit

## Next Step
TBD — user decides
