<phase n="G.1" name="Achievement Banner Visual Overhaul — Dark & Light Mode">
  <context>
    The AchievementBanner component (src/renderer/components/AchievementBanner.tsx, 329 lines)
    displays a slide-down notification when achievements are unlocked. Current issues:

    1. Uses runtime `isDark` check instead of Tailwind's `dark:` variant pattern
    2. Visual design is basic — flat card with icon + text, minimal celebration feel
    3. Light mode treatment is an afterthought (subtle gradient, weak depth)
    4. Animation inline style object is overly complex (50+ lines of ternaries)
    5. No countdown/progress indicator for auto-dismiss

    The component has a solid Zustand store (queue system, push/next/clear) and good
    animation keyframes in globals.css. The redesign keeps the store and replaces the
    rendering with a much more polished visual treatment.

    Achievement data shape (from gamification.ts):
    ```typescript
    interface Achievement {
      id: string;
      name: string;
      description: string;
      icon: string;       // Lucide icon name → looked up via ICON_MAP
      category: string;   // focus|cards|projects|meetings|ideas|brainstorm|cross
      unlockedAt: string | null;
    }
    ```

    ICON_MAP is exported from AchievementsModal.tsx (84 entries).
    7 category color configs already defined in the component (CATEGORY_STYLES).

    The banner renders in App.tsx at z-[60], fixed top-center.
    Auto-dismiss after 6s with 400ms exit animation.

    @src/renderer/components/AchievementBanner.tsx
    @src/renderer/styles/globals.css
    @src/renderer/components/AchievementsModal.tsx (ICON_MAP export)
    @src/shared/types/gamification.ts (Achievement type)
  </context>

  <task type="auto" n="1">
    <n>Redesign banner layout + proper dark: variant classes</n>
    <files>
      src/renderer/components/AchievementBanner.tsx (REWRITE render)
    </files>
    <action>
      **WHY:** The current render uses `isDark` runtime checks with conditional class strings
      in ~15 places, making it hard to maintain and inconsistent with the rest of the codebase
      which uses Tailwind's `dark:` variant. The visual layout is also flat and underwhelming.

      **Part A — Remove isDark runtime check**

      Delete the `const isDark = ...` line and ALL conditional expressions that use it.
      Replace every `isDark ? X : Y` with proper Tailwind `dark:` classes.

      Example transformation:
      ```
      // Before
      ${isDark ? cats.iconBgDark : cats.iconBgLight}
      ${isDark ? cats.iconTextDark : cats.iconTextLight}

      // After — use light classes as base, dark: for dark mode
      ${cats.iconBgLight} dark:${cats.iconBgDark}
      ${cats.iconTextLight} dark:${cats.iconTextDark}
      ```

      Apply this pattern to ALL themed elements: container bg/border, gradient, icon circle,
      label text, title text, description text, dismiss button hover.

      NOTE: The `glowColor` for the CSS variable `--achievement-glow-color` cannot use
      `dark:` since it's an inline style. For this ONE case, keep a runtime check BUT
      refactor it to use a CSS-only approach: define two CSS variables and use the
      Tailwind `dark:` variant in globals.css:
      ```css
      .achievement-banner {
        --achievement-glow-color: var(--glow-light);
      }
      :where(.dark) .achievement-banner {
        --achievement-glow-color: var(--glow-dark);
      }
      ```
      Set both `--glow-light` and `--glow-dark` inline from the category config.

      **Part B — Redesign visual layout**

      New layout with more visual weight and celebration feel:

      ```
      ┌──────────────────────────────────────────────────┐
      │ ┌──────┐                                     [×] │
      │ │      │  ACHIEVEMENT UNLOCKED                    │
      │ │ Icon │  Achievement Name             +25 XP    │
      │ │      │  Description text                        │
      │ └──────┘                                          │
      │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░░░░░ │ ← countdown bar
      └──────────────────────────────────────────────────┘
      ```

      Changes from current:
      1. **Wider banner**: w-[480px] (up from 420px)
      2. **Larger icon**: w-12 h-12 (up from w-10 h-10), icon size 26 (up from 22)
      3. **XP badge**: Show "+N XP" badge to the right of the name (gold/amber pill).
         The Achievement type doesn't include XP — add a simple XP_BY_CATEGORY lookup:
         ```typescript
         const XP_LABEL: Record<string, string> = {
           focus: 'Focus', cards: 'Cards', projects: 'Projects',
           meetings: 'Meetings', ideas: 'Ideas', brainstorm: 'Brainstorm', cross: 'Special',
         };
         ```
         Show the category label as a pill next to the "Achievement Unlocked" text.
      4. **Countdown progress bar**: 3px tall bar at the bottom of the banner that
         shrinks from 100% to 0% over DISPLAY_MS using CSS transition.
         Color: category accent color. Use a `<div>` with `transition: width` and
         width toggled from '100%' to '0%' via a state change after mount.
      5. **Shadow depth**:
         - Dark: `shadow-2xl shadow-black/30` + glow animation (existing)
         - Light: `shadow-xl shadow-surface-300/50` + subtle `ring-1 ring-surface-200/60`
      6. **Typography hierarchy**:
         - "ACHIEVEMENT UNLOCKED": text-[10px] uppercase tracking-[0.2em] font-bold (bolder)
         - Name: text-base font-bold (down from text-lg — better proportion)
         - Description: text-xs (down from text-sm — let name be hero)

      **Part C — Simplify animation inline styles**

      The current animation ternary tree (lines 214-264) is 50 lines of inline styles.
      Replace with CSS classes in globals.css:
      ```css
      .achievement-banner-enter {
        animation: achievement-enter 600ms ease-out forwards,
                   achievement-glow 2s ease-in-out 600ms infinite;
      }
      .achievement-banner-exit {
        animation: achievement-exit 400ms ease-in forwards;
      }
      .achievement-banner-hidden {
        opacity: 0;
        transform: translateY(-100%) scale(0.95);
      }
      ```
      Then in the component, just apply the appropriate class based on state:
      ```typescript
      const animClass = exiting
        ? 'achievement-banner-exit'
        : visible
          ? 'achievement-banner-enter'
          : 'achievement-banner-hidden';
      ```
      This eliminates the massive inline style object entirely.

      **Part D — Light mode specific treatment**

      Light mode needs different depth treatment since glow effects are invisible
      on white backgrounds:
      - Container: `bg-white` with `ring-1 ring-black/[0.04]` for subtle edge
      - Shadow: `shadow-[0_8px_30px_-4px_rgba(0,0,0,0.12)]` for floating depth
      - Gradient: softer `from-{color}-50/80` tint (more visible on white)
      - Icon circle: slightly more opaque background (`bg-{color}-100` vs `/15`)
      - Text: darker values (surface-800/surface-600 vs surface-100/surface-400)
      - Shimmer: reduce opacity to 0.08 (less harsh on white)

      Update CATEGORY_STYLES to include light-mode icon bg as `bg-{color}-100`
      (solid Tailwind class) instead of the current `bg-{color}-500/15` (translucent).
    </action>
    <verify>
      - npx tsc --noEmit passes
      - No `isDark` variable remains in the component (grep for it)
      - All themed elements use `dark:` Tailwind variant
      - Banner class is `achievement-banner` (for CSS glow variable)
      - globals.css has `.achievement-banner-enter`, `.achievement-banner-exit`, `.achievement-banner-hidden`
      - Countdown bar div exists with transition-based width animation
      - Width increased to 480px
      - Icon size increased to w-12 h-12
    </verify>
    <done>
      Banner renders with proper dark: variants, improved layout with larger icon,
      category label, countdown bar, better shadows, and simplified animation classes.
      No runtime isDark checks remain.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Tailwind's dark: variant works with dynamically composed class strings
        (it does — same pattern used across all other components)
      - color-mix() supported in Electron's Chromium (yes — Chrome 111+)
      - ICON_MAP export from AchievementsModal remains available
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Celebration particle effects + icon entrance animation</n>
    <files>
      src/renderer/components/AchievementBanner.tsx (ADD particles)
      src/renderer/styles/globals.css (ADD keyframes)
    </files>
    <action>
      **WHY:** The single shimmer sweep is too subtle — achievement unlocks should feel
      rewarding. Adding lightweight CSS-only particle/sparkle effects creates the "wow"
      moment without any external libraries. This is the difference between "notification"
      and "celebration."

      **Part A — Star burst particles (CSS-only)**

      Add 6-8 small star/sparkle elements that burst outward from the icon on entrance.
      These are absolutely positioned `<span>` elements inside the icon circle container,
      animated via CSS keyframes.

      In globals.css, add a `@keyframes achievement-particle` animation:
      ```css
      @keyframes achievement-particle {
        0% {
          opacity: 1;
          transform: translate(0, 0) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(var(--px), var(--py)) scale(0);
        }
      }
      ```

      Each particle `<span>` gets unique `--px` and `--py` CSS variables for direction,
      plus a staggered `animation-delay`. The particles are 4-6px circles using the
      category accent color.

      Generate particle positions in the component:
      ```typescript
      const PARTICLES = [
        { x: '-20px', y: '-24px', delay: '0ms', size: 5 },
        { x: '22px',  y: '-18px', delay: '50ms', size: 4 },
        { x: '-16px', y: '20px',  delay: '100ms', size: 3 },
        { x: '24px',  y: '16px',  delay: '75ms', size: 5 },
        { x: '-8px',  y: '-28px', delay: '25ms', size: 4 },
        { x: '12px',  y: '24px',  delay: '125ms', size: 3 },
      ];
      ```

      Render particles only when `visible && !exiting`:
      ```jsx
      {visible && !exiting && PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            '--px': p.x,
            '--py': p.y,
            width: p.size,
            height: p.size,
            backgroundColor: 'currentColor',
            animation: `achievement-particle 700ms ease-out ${p.delay} forwards`,
            top: '50%',
            left: '50%',
          } as React.CSSProperties}
        />
      ))}
      ```

      The particles inherit `currentColor` from the icon circle's text color class,
      so they automatically match the category color in both light and dark mode.

      **Part B — Icon bounce entrance**

      Add a bounce-scale animation to the icon circle on entrance:
      ```css
      @keyframes achievement-icon-bounce {
        0% { transform: scale(0); }
        50% { transform: scale(1.2); }
        70% { transform: scale(0.9); }
        100% { transform: scale(1); }
      }
      ```

      Apply to the icon circle when `visible && !exiting`:
      ```
      style={{ animation: visible && !exiting ? 'achievement-icon-bounce 500ms ease-out 200ms both' : undefined }}
      ```

      The 200ms delay means the icon pops AFTER the banner slides in, creating a
      staggered entrance sequence: banner slides → icon bounces → particles burst.

      **Part C — Subtle ring pulse in light mode**

      In light mode, the glow animation is invisible on white backgrounds. Add an
      alternative "ring pulse" effect for light mode:
      ```css
      @keyframes achievement-ring-pulse {
        0%, 100% {
          box-shadow: 0 8px 30px -4px rgba(0,0,0,0.1);
        }
        50% {
          box-shadow: 0 8px 30px -4px rgba(0,0,0,0.1),
                      0 0 0 3px var(--achievement-glow-color);
        }
      }
      ```

      Use this animation in light mode instead of `achievement-glow`:
      ```css
      .achievement-banner-enter {
        animation: achievement-enter 600ms ease-out forwards,
                   achievement-glow 2s ease-in-out 600ms infinite;
      }
      :where(:not(.dark)) .achievement-banner-enter {
        animation: achievement-enter 600ms ease-out forwards,
                   achievement-ring-pulse 2s ease-in-out 600ms infinite;
      }
      ```

      This way dark mode gets the existing outer glow, and light mode gets a subtle
      colored ring pulse that's visible on white backgrounds.
    </action>
    <verify>
      - npx tsc --noEmit passes
      - npm test passes (150/150)
      - globals.css has @keyframes: achievement-particle, achievement-icon-bounce, achievement-ring-pulse
      - Particle spans render only during visible && !exiting state
      - Particles use currentColor (no hardcoded colors)
      - Icon bounce has 200ms delay (staggered after banner entrance)
      - Light mode uses achievement-ring-pulse instead of achievement-glow
      - No new npm dependencies added (pure CSS animations)
    </verify>
    <done>
      Achievement banner has celebration particle burst around icon, bouncing icon
      entrance, and light-mode-appropriate ring pulse animation. All CSS-only,
      no external libraries.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - CSS custom properties (--px, --py) work with transform in Electron's Chromium (yes)
      - 6-8 extra DOM elements for particles have negligible performance impact
      - currentColor inheritance works through absolute positioning (yes — color is inherited)
    </assumptions>
  </task>
</phase>
