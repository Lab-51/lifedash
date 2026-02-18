<phase n="D.8" name="Achievement Banner">
  <context>
    The gamification system has 84 achievements across 7 categories. When an achievement unlocks,
    the flow is: gamificationService.checkAndUnlockAchievements() → IPC → gamificationStore.awardXP()
    → toast("Achievement Unlocked: {name}"). Currently this uses the same plain text toast system
    as all other notifications (bottom-right corner, small, dismisses in 5s).

    The user wants a dramatic top-center banner with a "rare item found" visual effect — something
    that feels celebratory and special, not just another toast.

    Achievement data structure: { id, name, description, icon (Lucide name), category }
    Categories: focus, cards, projects, meetings, ideas, brainstorm, cross

    @src/renderer/stores/gamificationStore.ts (lines 66-75, 91-95 — current toast logic)
    @src/renderer/components/ToastContainer.tsx (current toast rendering)
    @src/renderer/components/AchievementsModal.tsx (ICON_MAP for Lucide icon mapping)
    @src/renderer/App.tsx (global layout — where to mount the banner)
    @src/renderer/styles/globals.css (for CSS keyframe animations)
    @src/shared/types/gamification.ts (Achievement type, ACHIEVEMENTS array)
  </context>

  <task type="auto" n="1">
    <n>AchievementBanner component + store + CSS animations</n>
    <files>
      src/renderer/components/AchievementBanner.tsx (NEW)
      src/renderer/styles/globals.css
    </files>
    <action>
      Create a new AchievementBanner component that renders a dramatic "rare item found" banner
      at the top center of the screen when an achievement is unlocked.

      **1. Internal Zustand store (inside the component file)**

      Simple store managing a queue of achievements to display:

      ```ts
      interface BannerState {
        queue: Achievement[];
        current: Achievement | null;
        push: (achievement: Achievement) => void;
        next: () => void;
        clear: () => void;
      }
      ```

      Export a convenience function: `showAchievementBanner(achievement: Achievement)` that calls
      `push()`. This is what gamificationStore will call instead of `toast()`.

      When `push()` is called:
      - Add achievement to queue
      - If no `current`, immediately pop from queue and set as `current`

      When `next()` is called:
      - If queue has items, pop next and set as `current`
      - If queue is empty, set `current` to null

      Auto-dismiss: When `current` changes to a non-null value, start a 6-second timer.
      After 6s, call `next()`. Clear timer on unmount.

      **2. Component visual design**

      The banner should feel like finding a rare item in a video game. Key elements:

      a) **Container:** Fixed position top-center, z-[60] (above everything). Width ~420px, centered.
         Pointer-events-none on the wrapper, pointer-events-auto on the banner itself.

      b) **Entrance animation:** Slide down from above + scale up slightly + fade in.
         Duration 600ms, ease-out. Use CSS class toggling with a `visible` state that
         flips after a requestAnimationFrame tick (same pattern as FocusOverlay).

      c) **Exit animation:** Slide up + fade out. Duration 400ms. Trigger 400ms before
         `next()` so exit completes before the next banner appears.

      d) **Banner layout:**
         - Outer glow: category-colored box-shadow that pulses (CSS animation)
         - Background: gradient from category color (left, subtle) to surface-900/white
         - Left side: Large icon (40px) in a circle with category-colored bg + shimmer
         - Center: "ACHIEVEMENT UNLOCKED" label (uppercase, tracking-widest, tiny, category-colored),
           achievement name (text-lg font-bold), description (text-sm text-surface-400)
         - Right side: small X dismiss button

      e) **Sparkle/particle effect:** Use CSS pseudo-elements with a shimmer animation on the
         banner border. A horizontal shimmer line that sweeps across the banner once on entrance.
         Use `@keyframes achievement-shimmer` with a background-gradient that translates from
         left to right.

      f) **Category colors** (reuse from AchievementsModal's ACHIEVEMENT_CATEGORY_CLASS):

         | Category | Color accent |
         |----------|-------------|
         | focus | emerald-400 |
         | cards | blue-400 |
         | projects | purple-400 |
         | meetings | amber-400 |
         | ideas | pink-400 |
         | brainstorm | cyan-400 |
         | cross | yellow-400 |

      g) **Light mode support:** Use `dark:` variant pattern. In light mode: white bg with
         subtle category-colored border/glow. In dark mode: surface-900 bg with stronger glow.

      **3. Icon rendering**

      Copy the ICON_MAP approach from AchievementsModal.tsx — import the same Lucide icons and
      map achievement.icon to a component. BUT to avoid duplicating 84 icon imports, instead
      accept the icon as a prop OR use a shared ICON_MAP. Simplest approach: import only the
      most commonly used ~20 icons and use `Award` as fallback. The banner only shows one
      achievement at a time so this is fine.

      Actually, the cleanest approach: create a small shared utility file is overkill for this.
      Instead, import the ICON_MAP from AchievementsModal directly (it's already exported as a
      const). If it's not exported, export it. Then use it: `const Icon = ICON_MAP[achievement.icon] || Award`.

      **4. CSS animations (globals.css)**

      Add these keyframes:

      ```css
      @keyframes achievement-enter {
        from {
          opacity: 0;
          transform: translateY(-100%) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes achievement-exit {
        from {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateY(-100%) scale(0.95);
        }
      }

      @keyframes achievement-glow {
        0%, 100% {
          box-shadow: 0 0 15px var(--achievement-glow-color, rgba(250, 204, 21, 0.3)),
                      0 0 30px var(--achievement-glow-color, rgba(250, 204, 21, 0.1));
        }
        50% {
          box-shadow: 0 0 25px var(--achievement-glow-color, rgba(250, 204, 21, 0.5)),
                      0 0 50px var(--achievement-glow-color, rgba(250, 204, 21, 0.2));
        }
      }

      @keyframes achievement-shimmer {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(100%);
        }
      }
      ```

      **5. Sound (skip for now)**
      No audio — keep this purely visual. Can be added later.

      **WHY this approach:**
      - Dedicated store (not toast store) because the banner has different lifecycle (queue, animations, longer display)
      - CSS keyframes over JS animations for performance (GPU-accelerated transforms)
      - Category colors give each achievement a distinct feel without needing a "rarity" system
      - The shimmer sweep + pulsing glow creates the "rare item" feel seen in games like Diablo/Destiny
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no type errors
      2. Verify the component file exists and exports `showAchievementBanner` + default component
      3. Verify CSS keyframes are added to globals.css
      4. The component should be self-contained — rendering it with no queue should show nothing
    </verify>
    <done>
      AchievementBanner component renders a dramatic top-center banner with category-colored glow,
      shimmer effect, slide-in/out animations, and a queue system for multiple achievements.
      All CSS animations are GPU-accelerated. Component is fully self-contained with its own store.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - The ICON_MAP in AchievementsModal is importable (may need to export it)
      - CSS @keyframes in globals.css works alongside existing keyframes
      - z-[60] is sufficient to be above all other UI (FocusOverlay is z-40, modals are z-50)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Integration — wire banner into gamification flow + render in App.tsx</n>
    <files>
      src/renderer/stores/gamificationStore.ts
      src/renderer/App.tsx
      src/renderer/components/AchievementsModal.tsx (export ICON_MAP if needed)
    </files>
    <action>
      **1. Export ICON_MAP from AchievementsModal (if not already exported)**

      Check if ICON_MAP in AchievementsModal.tsx is exported. If not, add `export` to it.
      The AchievementBanner needs to map icon names to Lucide components.

      **2. Replace toast calls with banner calls in gamificationStore**

      In `gamificationStore.ts`, replace the achievement toast logic with the banner:

      ```ts
      import { showAchievementBanner } from '../components/AchievementBanner';
      ```

      In `awardXP()` (around lines 66-75), replace:
      ```ts
      result.newAchievements.forEach((a: Achievement, i: number) => {
        setTimeout(() => {
          toast(`Achievement Unlocked: ${a.name} — ${a.description}`, 'success', undefined, 5000);
        }, i * 500);
      });
      ```

      With:
      ```ts
      result.newAchievements.forEach((a: Achievement) => {
        showAchievementBanner(a);
      });
      ```

      No need for setTimeout staggering — the banner's queue system handles sequential display.

      Do the same replacement in `refreshStats()` (around lines 91-95).

      Keep the `+XP toast` as-is — only achievement notifications move to the banner.

      **3. Add AchievementBanner to App.tsx**

      Import and render the AchievementBanner component in the App layout, ABOVE ToastContainer:

      ```tsx
      import AchievementBanner from './components/AchievementBanner';
      // ...
      <StatusBar />
      <AchievementBanner />
      <ToastContainer />
      ```

      Since AchievementBanner uses fixed positioning, the DOM order doesn't matter for layout,
      but placing it before ToastContainer keeps the code organized.

      **4. Verify the full flow**

      The complete flow after this change:
      - User does something → store calls awardXP()
      - Main process checks achievements → returns newAchievements[]
      - gamificationStore calls showAchievementBanner(achievement) for each
      - Banner store queues them, displays one at a time with 6s per banner
      - Banner appears at top-center with dramatic entrance, glow, shimmer
      - Auto-dismisses or user clicks X
      - Next queued achievement appears

      **WHY:** The banner provides a distinct, celebratory visual for achievements that stands
      apart from regular operational toasts (+XP, errors, confirmations). This makes achievements
      feel special and rewarding — a key gamification principle.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no type errors
      2. Run `npm test` — all 150 tests pass
      3. Start the app with `npm start`
      4. Trigger an achievement (e.g., create a card if you haven't created 5 yet, or create a
         new focus session). Verify the banner appears at top center with:
         - Slide-down entrance animation
         - Category-colored glow and shimmer
         - Achievement icon, name, and description
         - Auto-dismiss after ~6 seconds
      5. Verify the banner works in both dark and light mode
      6. Verify regular +XP toasts still appear in the bottom-right corner
      7. Verify clicking X dismisses the banner immediately
    </verify>
    <done>
      Achievement banners replace achievement toasts. The full flow works end-to-end: unlock →
      banner queue → dramatic top-center display. Regular XP toasts still use ToastContainer.
      Both dark and light mode supported.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - AchievementBanner component from Task 1 works correctly
      - The ICON_MAP export from AchievementsModal doesn't cause circular dependencies
      - showAchievementBanner can be called from a store (non-React context) because it uses
        Zustand's getState() internally
    </assumptions>
  </task>
</phase>
