<phase n="D.4" name="Satisfying 300-Level Visual Progression System">
  <context>
    The app currently has 8 static levels (Beginner→Transcendent, max XP 30,000) with simple
    emerald pills everywhere. The user wants a deep progression system with 300 levels where the
    visual presentation gets incrementally more impressive every 10 levels — making leveling up
    feel genuinely satisfying and aspirational.

    Design: Every 10 levels = a new "tier" with a distinct visual identity (30 tiers total).
    Six tier families of 5 tiers each, escalating in visual richness:
      1. Metal   (Lv 1-50):   Bronze → Iron → Steel → Silver → Gold
      2. Gem     (Lv 51-100): Emerald → Sapphire → Ruby → Amethyst → Diamond
      3. Cosmic  (Lv 101-150):Stellar → Nebula → Quasar → Pulsar → Nova
      4. Mythic  (Lv 151-200):Phoenix → Dragon → Titan → Oracle → Celestial
      5. Divine  (Lv 201-250):Ethereal → Immortal → Transcendent → Ascendant → Divine
      6. Ultimate(Lv 251-300):Apex → Supreme → Legendary → Infinite → Omega

    XP Curve Formula: xpForLevel(n) = floor(20 + n * 8) XP from level n to n+1.
    - Level 1→2: 28 XP | Level 10→11: 100 XP | Level 50→51: 420 XP | Level 100→101: 820 XP
    - Total at Lv 50: ~10,800 | Lv 100: ~41,600 | Lv 200: ~164,000 | Lv 300: ~365,000
    - At ~200 XP/day average: Lv 50 in ~2 months, Lv 100 in ~7 months, Lv 300 in ~5 years.

    Visual escalation per tier family:
    - Metal: Solid colored background, no glow
    - Gem: Colored bg + thin colored border ring
    - Cosmic: Gradient background + subtle glow ring
    - Mythic: Gradient bg + strong outer glow + bold text
    - Divine: Animated shimmer/pulse via CSS keyframes + strong glow
    - Ultimate: Multi-color gradient + animated glow pulse + special styling

    The level_5 achievement (currently "Reach Level 5 Master") should be updated to level_50
    since level 5 in a 300-level system is trivially easy.

    @src/shared/types/gamification.ts
    @src/main/services/gamificationService.ts
    @src/renderer/components/FocusStatsWidget.tsx
    @src/renderer/components/StatusBar.tsx
    @src/renderer/components/FocusCompleteModal.tsx
    @src/renderer/components/AchievementsModal.tsx
    @src/renderer/stores/gamificationStore.ts
  </context>

  <task type="auto" n="1">
    <n>300-Level System — Types, Formula, and Tier Definitions</n>
    <files>
      src/shared/types/gamification.ts (rewrite level system)
      src/main/services/gamificationService.ts (update achievement check for level_50)
    </files>
    <action>
      **WHY:** The current 8-level static system caps out too fast and has no visual progression.
      A 300-level formula-based system with named tiers creates a deep, long-term progression that
      makes every level-up feel meaningful.

      ## 1. Rewrite level system in `src/shared/types/gamification.ts`

      **Remove** the static `LEVEL_THRESHOLDS` array (8 entries).

      **Add** `LEVEL_TIERS` — array of 30 tier definitions, each covering 10 levels:
      ```ts
      interface LevelTier {
        tier: number;           // 1-30
        name: string;           // "Bronze", "Iron", etc.
        family: string;         // "metal", "gem", "cosmic", "mythic", "divine", "ultimate"
        startLevel: number;     // 1, 11, 21, ...
        endLevel: number;       // 10, 20, 30, ...
        // Visual properties for the LevelBadge component:
        colors: {
          bg: string;           // Tailwind bg class (e.g. 'bg-amber-700/20')
          text: string;         // Tailwind text class (e.g. 'text-amber-400')
          border: string;       // Tailwind border class
          glow: string;         // CSS box-shadow value ('' for none)
          gradient?: string;    // Optional CSS gradient for bg
        };
        animate: boolean;       // Whether to apply shimmer animation (Divine/Ultimate only)
      }
      ```

      Tier definitions (30 tiers):

      **Metal family** (tiers 1-5, Lv 1-50):
      - Tier 1: Bronze  (Lv 1-10) — bg-amber-900/20, text-amber-600, border-amber-700/30, no glow
      - Tier 2: Iron    (Lv 11-20) — bg-slate-600/20, text-slate-400, border-slate-500/30, no glow
      - Tier 3: Steel   (Lv 21-30) — bg-zinc-500/20, text-zinc-300, border-zinc-400/30, no glow
      - Tier 4: Silver  (Lv 31-40) — bg-gray-400/15, text-gray-300, border-gray-400/30, no glow
      - Tier 5: Gold    (Lv 41-50) — bg-yellow-500/15, text-yellow-400, border-yellow-500/30, faint glow

      **Gem family** (tiers 6-10, Lv 51-100):
      - Tier 6:  Emerald   (Lv 51-60) — bg-emerald-500/15, text-emerald-400, border-emerald-500/30, subtle glow
      - Tier 7:  Sapphire  (Lv 61-70) — bg-blue-500/15, text-blue-400, border-blue-500/30, subtle glow
      - Tier 8:  Ruby      (Lv 71-80) — bg-red-500/15, text-red-400, border-red-500/30, subtle glow
      - Tier 9:  Amethyst  (Lv 81-90) — bg-purple-500/15, text-purple-400, border-purple-500/30, subtle glow
      - Tier 10: Diamond   (Lv 91-100) — bg-sky-400/15, text-sky-300, border-sky-400/30, medium glow

      **Cosmic family** (tiers 11-15, Lv 101-150):
      - Tier 11: Stellar  — bg gradient indigo→violet, text-indigo-300, medium glow
      - Tier 12: Nebula   — bg gradient purple→pink, text-purple-300, medium glow
      - Tier 13: Quasar   — bg gradient cyan→blue, text-cyan-300, medium glow
      - Tier 14: Pulsar   — bg gradient teal→emerald, text-teal-300, medium glow
      - Tier 15: Nova     — bg gradient amber→orange, text-amber-300, strong glow

      **Mythic family** (tiers 16-20, Lv 151-200):
      - Tier 16: Phoenix   — bg gradient orange→red, text-orange-300, strong glow
      - Tier 17: Dragon    — bg gradient red→rose, text-red-300, strong glow
      - Tier 18: Titan     — bg gradient stone→amber, text-stone-300, strong glow
      - Tier 19: Oracle    — bg gradient violet→fuchsia, text-violet-300, strong glow
      - Tier 20: Celestial — bg gradient sky→indigo, text-sky-200, strong glow, bold text

      **Divine family** (tiers 21-25, Lv 201-250): animate=true
      - Tier 21: Ethereal     — bg gradient slate→blue with shimmer, text-blue-200
      - Tier 22: Immortal     — bg gradient emerald→teal with shimmer, text-emerald-200
      - Tier 23: Transcendent — bg gradient purple→violet with shimmer, text-purple-200
      - Tier 24: Ascendant    — bg gradient amber→yellow with shimmer, text-amber-200
      - Tier 25: Divine       — bg gradient white→gold with shimmer, text-yellow-100

      **Ultimate family** (tiers 26-30, Lv 251-300): animate=true
      - Tier 26: Apex      — bg gradient rose→pink with pulse, text-rose-200
      - Tier 27: Supreme   — bg gradient indigo→violet with pulse, text-indigo-200
      - Tier 28: Legendary — bg gradient amber→red with pulse, text-amber-100
      - Tier 29: Infinite  — bg gradient cyan→blue→purple (rainbow-ish) with pulse, text-white
      - Tier 30: Omega     — bg gradient gold→white with strong pulse, text-white, extra glow

      The exact Tailwind classes and CSS values should be chosen to look good on dark backgrounds.
      Use inline style for gradient and glow (Tailwind can't do arbitrary gradients well).

      **Add** `getTier(level: number): LevelTier` — returns the tier for a given level.
      `const tierIndex = Math.min(Math.floor((level - 1) / 10), 29);`

      **Replace** `calculateLevel(totalXp)` with a formula-based version:
      - XP to go FROM level n TO level n+1 = `Math.floor(20 + n * 8)`
      - Total XP at level n = sum from i=1 to n-1 of (20 + i*8) = `20*(n-1) + 4*(n-1)*n`
        (closed-form: `totalXpForLevel(n) = 20*(n-1) + 4*n*(n-1)`)
      - Max level: 300. Any XP beyond level 300 stays at level 300 with 100% progress.
      - calculateLevel(totalXp) → { level, levelName (tier name), xpProgress, xpNextLevel }
        levelName = getTier(level).name
        To find level from totalXp: solve the quadratic or iterate efficiently.
        Quadratic: totalXp = 20*(n-1) + 4*n*(n-1) = 4n^2 + 16n - 20
        So: 4n^2 + 16n - (20 + totalXp) = 0
        n = (-16 + sqrt(256 + 16*(20+totalXp))) / 8
        Then floor to get the level, clamp to [1, 300].

      **Keep** all existing exports unchanged (GamificationStats, Achievement, etc.)
      GamificationStats already has `level, levelName, xpProgress, xpNextLevel` — no interface change needed.

      **Export** `getTier` and `LevelTier` type (the LevelBadge component will need them).

      ## 2. Update `level_5` achievement → `level_50`

      In `ACHIEVEMENTS` array, change the `level_5` entry:
      - id: 'level_50' (was 'level_5')
      - name: 'Gold Achiever' (was 'Master Achiever')
      - description: 'Reach Level 50 (Gold tier)' (was 'Reach Level 5 (Master)')

      In `src/main/services/gamificationService.ts`, update the check:
      - `{ id: 'level_50', condition: counts.level >= 50 }` (was level >= 5)

      Note: Users who already unlocked level_5 will see a slightly different achievement.
      This is acceptable — the old ID won't match any definition, so it'll just be an orphan
      that doesn't display. New unlock uses level_50.
    </action>
    <verify>
      - `npx tsc --noEmit` passes
      - `npm test` passes (150 tests)
      - gamification.ts exports: LEVEL_TIERS (30 entries), getTier, calculateLevel (formula-based)
      - calculateLevel(0) returns { level: 1, levelName: 'Bronze' }
      - calculateLevel(100) returns level ~3-4 (Bronze tier)
      - calculateLevel(11000) returns ~level 50 (Gold tier)
      - calculateLevel(365000) returns level 300 (Omega tier)
      - LEVEL_THRESHOLDS static array no longer exists
      - ACHIEVEMENTS has level_50, not level_5
    </verify>
    <done>
      300-level formula-based system with 30 named tiers across 6 families.
      Each tier has color/glow/animation properties for visual rendering.
      calculateLevel() uses quadratic formula for O(1) level lookup.
      Achievement updated from level_5 to level_50. tsc + tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Quadratic formula for level lookup is precise enough (no floating-point issues)
      - 30 tiers with inline styles for gradients/glow won't cause performance issues
      - Renaming level_5 → level_50 doesn't break anything (DB stores string IDs)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>LevelBadge Component + Integration Across UI</n>
    <files>
      src/renderer/components/LevelBadge.tsx (new)
      src/renderer/components/FocusStatsWidget.tsx (use LevelBadge)
      src/renderer/components/StatusBar.tsx (use LevelBadge)
      src/renderer/components/FocusCompleteModal.tsx (use LevelBadge)
    </files>
    <action>
      **WHY:** The level badge is currently a plain emerald pill everywhere. With 30 tiers that
      are supposed to look progressively more impressive, we need a dedicated component that
      renders the badge with tier-appropriate styling — from humble Bronze to glorious Omega.

      ## 1. Create `src/renderer/components/LevelBadge.tsx`

      A standalone component that renders a level badge with tier-aware visual styling.

      ```ts
      interface LevelBadgeProps {
        level: number;
        size?: 'sm' | 'md' | 'lg';
        showName?: boolean;       // Show tier name next to level number (default: true)
        showXP?: boolean;         // Show total XP next to badge (default: false)
        totalXp?: number;         // Required if showXP=true
        className?: string;       // Additional classes
      }
      ```

      The component:
      1. Calls `getTier(level)` to get the tier definition
      2. Renders a pill/badge with the tier's visual properties:

      **Size variants:**
      - `sm`: h-5, text-[10px] — for StatusBar (compact)
      - `md`: h-6, text-xs — for widget header (default)
      - `lg`: h-8, text-sm — for FocusCompleteModal reward view

      **Visual layers (inner to outer):**
      - Background: either solid Tailwind class or inline gradient
      - Border: tier's border class (1px)
      - Text: "Lv.N" in tier's text color, optionally "TierName" after it
      - Glow: tier's glow value as box-shadow on the outer div (only if non-empty)
      - Animation: if tier.animate is true, apply a CSS shimmer animation

      **CSS shimmer animation (for Divine/Ultimate tiers):**
      Add a `@keyframes shimmer` animation using a pseudo-element or background-position trick:
      ```css
      @keyframes shimmer {
        0% { background-position: -200% center; }
        100% { background-position: 200% center; }
      }
      ```
      Apply via inline style: `{ backgroundSize: '200% 100%', animation: 'shimmer 3s ease infinite' }`

      For the CSS keyframe, either:
      (a) Inject a <style> tag in the component (simple, isolated), or
      (b) Use Tailwind's `animate-` class with an extension — but since we can't extend
          tailwind.config easily, option (a) is simpler.

      The shimmer creates a subtle light sweep across the badge — the higher the tier,
      the faster/brighter the shimmer.

      **Glow intensity progression:**
      - No glow (Metal tiers 1-4): box-shadow: none
      - Faint glow (Gold, tier 5): `0 0 6px rgba(color, 0.15)`
      - Subtle glow (Gem tiers 6-9): `0 0 8px rgba(color, 0.2)`
      - Medium glow (Diamond + Cosmic tiers 10-15): `0 0 12px rgba(color, 0.25)`
      - Strong glow (Mythic tiers 16-20): `0 0 16px rgba(color, 0.3)`
      - Strong + shimmer (Divine tiers 21-25): `0 0 20px rgba(color, 0.35)` + animation
      - Intense + pulse (Ultimate tiers 26-30): `0 0 24px rgba(color, 0.4)` + faster animation

      ## 2. Update FocusStatsWidget.tsx

      **Header:** Replace the inline emerald level pill with:
      ```tsx
      <LevelBadge level={stats.level} size="md" />
      ```

      **Level column (Column 3):** Replace the inline "Lv.N" + progress bar with:
      - `<LevelBadge level={stats.level} size="lg" showName />` at the top
      - Keep the progress bar below it, but color it dynamically using the tier's text color
        (get the tier via getTier(stats.level) and use its colors.text for the bar color)
      - "N XP to next" text stays

      ## 3. Update StatusBar.tsx

      Replace the inline "Lv.N LevelName" text with:
      ```tsx
      <LevelBadge level={stats.level} size="sm" />
      ```
      Keep the click handler (opens FocusStartModal). The LevelBadge should be wrapped
      in the existing button element.

      ## 4. Update FocusCompleteModal.tsx

      In the reward view, replace the inline "Level N: LevelName" + progress bar with:
      ```tsx
      <LevelBadge level={rewardStats.level} size="lg" showName />
      ```
      Then the progress bar below, colored by the tier's colors.
      Keep "N XP to next level" text.

      ## DESIGN PRINCIPLES:
      - The badge should be the hero — the visual center of attention
      - Low tiers should look clean and simple (not ugly)
      - Each tier family should feel like a meaningful visual upgrade from the previous
      - The transition from non-animated (Mythic) to animated (Divine) should feel like
        a prestige moment — the badge starts to *shimmer*
      - Ultimate tiers should look genuinely impressive — something to show off
      - Don't over-animate — subtle, tasteful effects only
    </action>
    <verify>
      - `npx tsc --noEmit` passes
      - `npm test` passes (150 tests)
      - Start app → dashboard widget shows tier-colored level badge (not plain emerald)
      - StatusBar shows compact tier-colored level badge
      - Focus complete → reward view shows large tier-colored level badge
      - Different level values render different tier visuals:
        - Level 1: Bronze (warm muted)
        - Level 50: Gold (golden warm glow)
        - Level 100: Diamond (brilliant blue glow)
        - Level 200: Celestial (strong glow, gradient)
        - Level 300: Omega (animated, intense glow)
    </verify>
    <done>
      LevelBadge component renders 30 distinct tier visuals with progressive impressiveness.
      Metal→Gem→Cosmic→Mythic→Divine→Ultimate families escalate from simple to spectacular.
      Integrated into FocusStatsWidget, StatusBar, and FocusCompleteModal. All existing
      tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Inline styles for gradient/glow/animation work in Electron's Chromium renderer
      - CSS shimmer animation via injected style tag is acceptable (no CSP issues in Electron)
      - 30 tier definitions don't noticeably impact bundle size
      - Progress bar color adaptation (dynamic tier color) can be done via inline style
    </assumptions>
  </task>
</phase>
