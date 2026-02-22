# Plan J.1 — Card Agent Side Panel

<phase n="J.1" name="Card Agent Side Panel">
  <context>
    The Card Agent (Plan E.1 backend + E.2 UI) currently lives as a tab inside
    CardDetailModal. The user switches between "Details" and "AI Agent" tabs,
    losing visibility of card details while chatting with the agent.

    This plan moves the agent to a **side-by-side layout**: card details on the
    left, agent panel sliding in on the right. The modal widens from max-w-3xl
    to max-w-[90vw] (capped at ~1400px) when the agent panel is open, giving
    both views full visibility simultaneously.

    Key design decisions:
    - Remove the tab system entirely — details are always visible
    - Add "Ask AI Agent" button in the modal header (Bot icon + label)
    - When clicked, modal expands rightward with the agent panel
    - Agent panel has its own header bar with close (collapse) button
    - Smooth CSS transition on width change (300ms)
    - CardAgentPanel component stays unchanged — just its container changes

    Current implementation:
    - CardDetailModal.tsx (809 lines): tab system at line 168, tab bar at 412-441,
      agent render at 793-803
    - CardAgentPanel.tsx (448 lines): standalone chat component, takes cardId prop
    - cardAgentStore.ts (173 lines): Zustand store, messageCount used for badge

    @src/renderer/components/CardDetailModal.tsx
    @src/renderer/components/CardAgentPanel.tsx
    @src/renderer/stores/cardAgentStore.ts
  </context>

  <task type="auto" n="1">
    <n>Remove tab system and implement side-by-side layout</n>
    <files>
      src/renderer/components/CardDetailModal.tsx
    </files>
    <action>
      ## Remove tab system

      1. Remove the `activeTab` state (line 168) — no longer needed.
      2. Remove the entire tab bar JSX block (lines 412-441).
      3. Remove the `activeTab === 'details'` conditional wrapper around details
         content (line 443) — details are now always visible.
      4. Remove the `activeTab === 'agent'` conditional block (lines 793-803).
      5. Remove the conditional flex/overflow class switching based on activeTab
         (line 379-381).

      ## Add agent panel toggle

      6. Add `showAgent` boolean state (default false).
      7. In the modal header (line 383-410), add an "Ask AI Agent" button between
         the title and the close button:
         - Bot icon (size 16) + "AI Agent" text
         - When agentMessageCount > 0, show the emerald count badge (reuse existing)
         - onClick toggles `showAgent`
         - Active state: emerald bg/text styling when showAgent is true
         - Inactive: ghost button with surface colors

      ## Side-by-side layout

      8. The outer modal container class changes based on showAgent:
         - Default: `max-w-3xl` (current behavior, details only)
         - Agent open: `max-w-[90vw] xl:max-w-7xl` (expanded, capped)
         - Add `transition-all duration-300` for smooth width animation

      9. Inside the modal content area (below header), use a flex row layout:
         ```
         <div class="flex flex-1 min-h-0 overflow-hidden">
           <!-- Left: Details (always visible) -->
           <div class="flex-1 overflow-y-auto min-w-0 pr-1">
             {/* existing details content */}
           </div>

           <!-- Right: Agent panel (conditional) -->
           {showAgent && (
             <div class="w-[420px] shrink-0 border-l flex flex-col">
               <div class="agent-header">
                 <span>AI Agent</span>
                 <button onClick={() => setShowAgent(false)}>
                   <PanelRightClose icon />
                 </button>
               </div>
               <div class="flex-1 min-h-0">
                 <Suspense fallback={spinner}>
                   <CardAgentPanel cardId={card.id} />
                 </Suspense>
               </div>
             </div>
           )}
         </div>
         ```

      10. The modal itself needs to be `flex flex-col` always (not just in agent
          tab mode). Set: `flex flex-col max-h-[85vh]` — the header is shrink-0,
          the content flex row takes flex-1.

      ## Agent panel header

      11. The agent panel's right column has a small header bar:
          - "AI Agent" label (bold, sm text)
          - Message count badge if > 0
          - PanelRightClose (or X) icon button to close the panel
          - Border-bottom, same surface styling as the card header

      ## State management

      12. Keep the existing cardAgentStore integration:
          - loadMessageCount on mount (already done)
          - reset on modal close (already done)
          - agentMessageCount subscription for badge (already done)
          Just remove any tab-specific logic.

      ## Dark/light mode

      13. All new elements follow existing patterns:
          - Border: `border-surface-200 dark:border-surface-700`
          - Agent panel bg: `bg-surface-50 dark:bg-surface-800/50` (subtle differentiation)
          - Button hover states with `dark:` variants
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - CardDetailModal opens with details visible (no tabs)
      - "AI Agent" button visible in header with Bot icon
      - Clicking the button expands modal and shows agent panel on the right
      - Card details remain scrollable on the left
      - Agent panel has its own header with close button
      - Closing agent panel shrinks modal back to normal width
      - Both dark and light modes render correctly
      - Message count badge shows on the button when messages exist
    </verify>
    <done>
      Tab system replaced with side-by-side layout. Details always visible on left.
      Agent panel opens/closes via header button with smooth width transition.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - CardAgentPanel works unchanged as a child component (just needs cardId prop)
      - 420px is sufficient width for the agent chat panel
      - 90vw / max-w-7xl provides enough room for both panels
      - CSS transition on max-width works smoothly in Electron's Chromium
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Polish — transitions, responsive behavior, keyboard shortcut</n>
    <files>
      src/renderer/components/CardDetailModal.tsx
      src/renderer/globals.css (if animation needed)
    </files>
    <action>
      ## Smooth panel entrance

      1. Instead of a hard show/hide, animate the agent panel entrance:
         - Always render the panel wrapper div when showAgent changes
         - Use CSS transition: panel slides in from right (translate-x + opacity)
         - Or use a width transition: 0 → 420px with overflow-hidden
         - Keep it simple — CSS transitions, no animation library

      2. The modal width transition should feel smooth:
         - `transition-[max-width] duration-300 ease-out` on the modal container
         - The modal content reflows naturally as space opens up

      ## Agent panel close behavior

      3. When the card modal is closed (Escape or overlay click), the agent panel
         should also close gracefully — the existing reset() call on unmount
         already handles state cleanup.

      4. If the user presses Escape:
         - If agent panel is open, close the agent panel first (not the whole modal)
         - Second Escape closes the modal
         - Update the Escape keydown handler to check showAgent state

      ## Visual refinements

      5. Add a subtle vertical divider between details and agent panel:
         - The border-l on the agent panel already handles this
         - Ensure proper spacing: details have pr-4, agent panel has no pl

      6. The "Ask AI Agent" button should have a visual state change when active:
         - Active: `bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400`
         - Inactive: `text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200`
         - Transition between states

      7. When agent panel is open and has no messages, the starter prompts
         (2x2 grid in CardAgentPanel) should be immediately visible — verify
         the panel height is sufficient for this.

      ## Width optimization

      8. On smaller screens (< 1200px viewport), the agent panel could be slightly
         narrower (360px instead of 420px). Use responsive Tailwind:
         `w-[360px] xl:w-[420px]`
    </action>
    <verify>
      - Modal width transitions smoothly when agent panel opens/closes (no jank)
      - Escape key closes agent panel first, then modal on second press
      - Agent panel slides in smoothly (not a hard pop)
      - "Ask AI Agent" button shows active emerald state when panel is open
      - On narrow screens, panel is 360px; on wider screens, 420px
      - Starter prompts are fully visible when panel opens with no messages
      - All transitions work in both dark and light modes
      - No visual glitches during transition (no content reflow jank)
    </verify>
    <done>
      Side panel has polished transitions, proper Escape handling (close panel first),
      responsive widths, and active button state. UX feels smooth and intentional.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - CSS max-width transitions work smoothly in Electron Chromium
      - 300ms is a good duration for the expand/collapse feel
      - Two-stage Escape (panel → modal) is the expected UX pattern
    </assumptions>
  </task>
</phase>
