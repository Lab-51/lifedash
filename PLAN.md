<phase n="D.6" name="Immersive Full-Screen Focus Overlay">
  <context>
    The current focus mode hides the sidebar and shows a small timer in the StatusBar, but the user
    still sees their regular page content (dashboard, project boards, etc.) — it's not immersive.

    The user wants a full-screen takeover experience with:
    - Large circular progress ring with big countdown numbers (~8rem)
    - Level badge + XP (top-left), streak counter (top-right)
    - Today's focus stats (sessions, minutes, XP earned)
    - Rotating motivational quotes
    - Minimal controls (pause/resume, stop)
    - Different visual treatment for focus (emerald) vs break (amber)
    - Dark ambient background with breathing gradient animation

    Key existing architecture:
    - focusStore: mode ('idle'|'focus'|'break'|'completed'), timeRemaining, isPaused, focusedCardTitle
    - gamificationStore.stats: todayXp, focusTodaySessions, focusTodayMinutes, currentStreak, level, levelName, totalXp
    - AppLayout hides sidebar when mode is 'focus' or 'break'
    - StatusBar shows MM:SS timer with pause/stop controls
    - FocusStartModal: setup dialog (works well, keep as-is)
    - FocusCompleteModal: reward/XP view (works well, keep as-is)
    - LevelBadge component already exists with tier colors

    No new backend/IPC work needed — all data is already available in existing stores.

    @src/renderer/stores/focusStore.ts
    @src/renderer/stores/gamificationStore.ts
    @src/renderer/components/AppLayout.tsx
    @src/renderer/components/StatusBar.tsx
    @src/renderer/components/LevelBadge.tsx
    @src/renderer/components/FocusStartModal.tsx
    @src/renderer/components/FocusCompleteModal.tsx
    @src/renderer/App.tsx
    @src/shared/types/gamification.ts (GamificationStats interface, getTier, calculateLevel)
  </context>

  <task type="auto" n="1">
    <n>Create FocusOverlay full-screen component</n>
    <files>src/renderer/components/FocusOverlay.tsx</files>
    <action>
      Create a new FocusOverlay.tsx component that renders a full-screen immersive focus view.
      This is a pure presentation component that reads from focusStore and gamificationStore.

      === LAYOUT (top to bottom, centered vertically) ===

      1. TOP BAR — flex between left and right, absolute top of overlay:
         - Left: LevelBadge (size="sm") + "N XP" total
         - Right: Flame icon + "N day streak" (only if currentStreak > 0)

      2. CENTER — the main visual (vertically + horizontally centered):
         a. SVG circular progress ring:
            - 280px diameter circle with stroke-based progress
            - Background circle: dark gray (surface-800), strokeWidth 8
            - Progress circle: emerald-500 for focus, amber-500 for break
            - strokeDasharray / strokeDashoffset for progress (based on elapsed / total)
            - stroke-linecap: round for aesthetic
            - Smooth CSS transition on stroke-dashoffset (1s ease)
         b. Inside the ring (centered text):
            - Large countdown: MM:SS format, font-mono, text-8xl (focus) or text-7xl (break)
            - Color: emerald-400 for focus, amber-400 for break
            - Below timer: small label "FOCUS" or "BREAK TIME"
         c. Below the ring:
            - Card title (if focusedCardTitle exists): text-lg, text-surface-300, max-w-md truncate
            - If no card: empty (don't show placeholder text)

      3. TODAY'S STATS ROW — centered below card title, ~mt-8:
         - Three stat pills in a horizontal flex with gap-6:
           - Sessions: "N sessions" with Timer icon
           - Minutes: "N min" with Clock icon
           - XP: "+N XP" with Zap icon
         - Style: text-surface-400, text-sm, flex items-center gap-1.5
         - Data from gamificationStore.stats: focusTodaySessions, focusTodayMinutes, todayXp

      4. MOTIVATIONAL QUOTE — centered, ~mt-8:
         - Italic text, text-surface-500, text-sm, max-w-lg text-center
         - Quote selected randomly from a FOCUS_QUOTES array (see below)
         - Quote stays the same for the entire session (pick on mount, store in state)
         - Show quotes only in focus mode, not during break

      5. CONTROLS — centered at bottom, ~mb-12:
         - Two buttons in a flex row with gap-4:
           a. Pause/Resume: circular button (w-12 h-12), surface-800 bg, hover:surface-700
              - Pause icon when running, Play icon when paused
              - Calls focusStore.pause() / focusStore.resume()
           b. Stop: circular button (w-12 h-12), surface-800 bg, hover:red-600
              - Square icon
              - Calls focusStore.stop()
         - Show small text labels below each button: "Pause"/"Resume" and "Stop"

      === BREAK MODE VARIANT ===
      When focusStore.mode === 'break':
      - Progress ring stroke: amber-500 instead of emerald-500
      - Timer text: amber-400
      - Label below timer: "BREAK TIME" with Coffee icon
      - No motivational quote (show "Relax, you earned it" in its place)
      - Background gradient shifts to warm amber tones

      === BACKGROUND ===
      - Full viewport: fixed inset-0, z-40
      - Background color: bg-surface-950 (very dark)
      - Subtle breathing gradient animation via CSS keyframes:
        - For focus: radial-gradient that pulses from emerald-950/20 at center to transparent
        - For break: radial-gradient that pulses from amber-950/20 at center to transparent
        - Animation: 4s ease-in-out infinite alternate
      - Inject the keyframes via a module-level style injection (same pattern as LevelBadge shimmer)

      === QUOTES ARRAY ===
      Define FOCUS_QUOTES as a const array of ~15-20 strings inside FocusOverlay.tsx:
      - "The secret of getting ahead is getting started." — Mark Twain
      - "Focus on being productive instead of busy." — Tim Ferriss
      - "It's not that I'm so smart, it's just that I stay with problems longer." — Einstein
      - "Deep work is the ability to focus without distraction on a cognitively demanding task." — Cal Newport
      - "The successful warrior is the average man, with laser-like focus." — Bruce Lee
      - "Concentrate all your thoughts upon the work at hand." — Alexander Graham Bell
      - "You can't depend on your eyes when your imagination is out of focus." — Mark Twain
      - "Do every act of your life as though it were the last act of your life." — Marcus Aurelius
      - "Where focus goes, energy flows." — Tony Robbins
      - "The shorter way to do many things is to only do one thing at a time." — Mozart
      - "Starve your distractions, feed your focus." — Unknown
      - "It is during our darkest moments that we must focus to see the light." — Aristotle
      - "Lack of direction, not lack of time, is the problem." — Zig Ziglar
      - "I fear not the man who has practiced 10,000 kicks once, but the man who has practiced one kick 10,000 times." — Bruce Lee
      - "The main thing is to keep the main thing the main thing." — Stephen Covey

      === formatTime UTILITY ===
      Reuse the same MM:SS format: `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`

      WHY: The full-screen overlay creates an immersive distraction-free environment. The circular
      progress ring and large countdown give the user a clear sense of time passage. Stats and
      quotes provide motivational context without overwhelming the minimal design.
    </action>
    <verify>
      Run `npx tsc --noEmit` — should compile with no errors.
      Visually inspect: component renders a full-screen overlay with ring, timer, stats, quotes, controls.
    </verify>
    <done>FocusOverlay.tsx created with SVG progress ring, big countdown, level/streak header, today stats, quotes, controls, and focus/break variants.</done>
    <confidence>HIGH</confidence>
  </task>

  <task type="auto" n="2">
    <n>Integrate FocusOverlay into AppShell and hide StatusBar during focus</n>
    <files>
      src/renderer/App.tsx
      src/renderer/components/StatusBar.tsx
    </files>
    <action>
      Wire the new FocusOverlay into the app so it takes over the screen during focus/break modes.

      === App.tsx CHANGES ===

      1. Add lazy import for FocusOverlay:
         const FocusOverlay = lazy(() => import('./components/FocusOverlay'));

      2. In AppShell, render FocusOverlay alongside existing modals (inside the Suspense block):
         - Render when focusMode is 'focus' or 'break'
         - Place it BEFORE FocusCompleteModal so the completion modal renders on TOP (higher in DOM = lower z-index, so actually place it after — or use z-index):

         ```tsx
         <Suspense fallback={null}>
           <FocusStartModal
             isOpen={showStartModal}
             onClose={() => useFocusStore.getState().setShowStartModal(false)}
           />
           {(focusMode === 'focus' || focusMode === 'break') && <FocusOverlay />}
           <FocusCompleteModal
             isOpen={focusMode === 'completed'}
             onClose={() => useFocusStore.getState().stop()}
           />
         </Suspense>
         ```

         The FocusOverlay uses z-40. FocusCompleteModal already uses a modal overlay pattern
         (likely z-50). Verify z-index ordering: FocusOverlay (z-40) < FocusCompleteModal (z-50).

      === StatusBar.tsx CHANGES ===

      3. Hide the entire StatusBar when focus mode is active:
         - At the top of the StatusBar component, read focusMode from focusStore
         - If mode is 'focus' or 'break', return null (don't render)
         - This gives the overlay true full-screen immersion

         ```tsx
         const focusMode = useFocusStore(s => s.mode);
         if (focusMode === 'focus' || focusMode === 'break') return null;
         ```

         This also means the StatusBar's existing timer display code for focus/break modes
         becomes dead code. KEEP IT for now (no harm, and it serves as fallback documentation).
         Do NOT delete the focus timer logic from StatusBar — it's minimal code and might be
         useful if we ever add a "minimal mode" toggle.

      === AppLayout.tsx — NO CHANGES ===
      Keep the existing sidebar hiding logic in AppLayout. Even though the overlay covers
      everything, hiding the sidebar underneath means less rendering and no accidental interactions.

      WHY: The overlay must be rendered at the AppShell level (not inside routes) because it
      needs to cover the entire app including the status bar. Hiding the StatusBar gives true
      full-screen immersion. The z-index ordering ensures the completion modal appears above
      the overlay when a session ends.
    </action>
    <verify>
      Run `npx tsc --noEmit` — should compile with no errors.
      Run `npx vitest run` — all 150 tests should pass.
      Manual test: Start a focus session → full-screen overlay appears, StatusBar hidden.
      Manual test: Let timer complete → FocusCompleteModal appears above overlay.
      Manual test: Start break → overlay switches to amber break variant.
      Manual test: Stop session → overlay disappears, StatusBar returns.
    </verify>
    <done>FocusOverlay renders full-screen during focus/break. StatusBar hidden. FocusCompleteModal renders above overlay. All tests pass.</done>
    <confidence>HIGH</confidence>
  </task>

  <task type="auto" n="3">
    <n>Add fade transition and polish the overlay experience</n>
    <files>
      src/renderer/components/FocusOverlay.tsx
      src/renderer/components/AppLayout.tsx
    </files>
    <action>
      Polish the overlay with smooth transitions and minor UX improvements.

      === FADE-IN ANIMATION ===
      1. Add a mount animation to FocusOverlay:
         - On mount, the overlay should fade in from opacity-0 to opacity-100 over 500ms
         - Use a useEffect + useState pattern:
           ```tsx
           const [visible, setVisible] = useState(false);
           useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
           ```
         - Apply: `className={`... transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}`

         Note: Fade-OUT is not needed because when mode changes to 'completed' or 'idle',
         the overlay unmounts and the FocusCompleteModal or regular UI takes over immediately.
         A fade-out would require complex unmount delay logic with no real UX benefit.

      === PROGRESS RING PULSE ===
      2. When isPaused is true:
         - Add a gentle pulse animation to the progress ring (opacity oscillation)
         - Use CSS: `animate-pulse` (Tailwind built-in) on the SVG progress circle when paused
         - Also show "PAUSED" label below the timer instead of "FOCUS"/"BREAK TIME"

      === KEYBOARD HINT ===
      3. Add a small keyboard hint at the very bottom of the overlay:
         - "Ctrl+Shift+F to exit" — text-surface-600, text-xs
         - Positioned at the bottom center, mb-4

      === AppLayout TRANSITION ===
      4. In AppLayout, add a smooth width transition when sidebar appears/disappears:
         - The main content area already has `transition-colors duration-300`
         - This is fine — the overlay covers the transition anyway. No change needed here
           unless the sidebar pop-in is jarring when focus ends. If so, add:
           `transition-all duration-300` to the main element.

         Actually, leave AppLayout as-is. The overlay covers the transition, and the user
         sees the FocusCompleteModal before the sidebar reappears. No change needed.

      WHY: The fade-in prevents a jarring appearance. The paused state visual feedback makes it
      clear the timer isn't running. The keyboard hint reminds users how to exit without searching.
    </action>
    <verify>
      Run `npx tsc --noEmit` — should compile with no errors.
      Run `npx vitest run` — all 150 tests should pass.
      Manual test: Start focus → overlay fades in smoothly (500ms).
      Manual test: Pause → ring pulses, "PAUSED" label appears.
      Manual test: Keyboard hint visible at bottom.
    </verify>
    <done>Overlay fades in on mount. Paused state shows pulse + "PAUSED" label. Keyboard hint at bottom. All tests pass.</done>
    <confidence>HIGH</confidence>
  </task>
</phase>
