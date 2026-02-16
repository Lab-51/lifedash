<phase n="B.1" name="App Startup Loading Animation">
  <context>
    The user reports a noticeable delay (a couple of seconds) when launching the app,
    with no visual feedback during that time. Currently:

    1. Main process creates a hidden BrowserWindow (show: false, backgroundColor: '#020617')
    2. PGlite connects + runs 8 migrations (async, 100-300ms)
    3. Renderer loads HTML + JS bundle
    4. `ready-to-show` fires → window.show() — FIRST VISIBLE MOMENT
    5. React mounts → 5 parallel IPC calls hydrate stores (projects, meetings, ideas, etc.)
    6. Lazy route loads DashboardPage → PageSkeleton shown during chunk fetch
    7. Dashboard renders with data

    Between steps 4 and 7, the user may see a blank/empty state. There is no splash
    screen, no loading animation, no indication the app is starting up.

    Approach: CSS-only splash screen embedded in index.html. This renders INSTANTLY
    when the renderer loads (before any JS), then React removes it once the app is
    mounted and stores are hydrated. No extra BrowserWindow needed.

    CSP allows inline styles: `style-src 'self' 'unsafe-inline'`
    Window uses `show: false` + `ready-to-show` — splash is visible from the moment
    the window appears.

    @src/renderer/index.html
    @src/renderer/App.tsx
    @src/main/main.ts (lines 58-137 — window creation + ready-to-show)
    @src/renderer/components/PageSkeleton.tsx (existing skeleton pattern)
  </context>

  <task type="auto" n="1">
    <n>Add CSS splash screen to index.html</n>
    <files>src/renderer/index.html</files>
    <action>
      Add an inline splash screen to index.html that shows immediately when the
      renderer loads. This appears BEFORE React mounts — pure HTML + CSS, no JS.

      1. Add a `<div id="splash">` element BEFORE `<div id="root">` in the body.
         This splash should:
         - Cover the full viewport with the same dark background (#020617 = surface-950)
         - Show the app name "Living Dashboard" in a clean, centered layout
         - Display a subtle animated loading indicator (CSS-only pulse/spinner)
         - Match the app's design language (surface colors, modern feel)

      2. Add a `<style>` block in `<head>` with the splash CSS:
         - Full-screen overlay: position fixed, inset 0, z-index 9999, flex centering
         - Background: #020617 (matches BrowserWindow backgroundColor)
         - App title: light text, tracking-wide, clean sans-serif font
         - Loading animation: a simple 3-dot pulse or a CSS spinner
           Use @keyframes for the animation — pure CSS, no JS
         - Fade-out transition class (.splash-hidden): opacity 0, pointer-events none
           with a 300ms ease-out transition, so removal feels smooth

      3. The body should have `background: #020617` to prevent any white flash
         between window show and splash render.

      WHY: The splash screen in index.html renders before ANY JavaScript loads.
      This means the user sees branded loading feedback from the very first frame
      the window is visible. No React, no Tailwind, no bundle needed.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors (no TS changes in this task)
      2. Open index.html in browser directly — splash should be visible
      3. App start: splash visible immediately when window appears
      4. Splash stays visible until React removes it (Task 2)
    </verify>
    <done>
      index.html contains a CSS-only splash screen with app branding and loading
      animation that renders before any JS executes.
    </done>
    <confidence>HIGH</confidence>
  </task>

  <task type="auto" n="2">
    <n>Remove splash screen after React app is ready</n>
    <files>src/renderer/App.tsx</files>
    <preconditions>
      - Task 1 completed (splash div exists in index.html)
    </preconditions>
    <action>
      Make React dismiss the splash screen once the app shell and initial data are
      loaded, with a smooth fade-out transition.

      1. In App.tsx's AppShell component, add a state + effect that tracks when the
         initial store hydration is complete. The existing useEffect on line 78-83
         fires 5 parallel IPC calls. We need to know when they're done.

         Approach: Add an `appReady` state. In a useEffect, call all 5 store load
         functions and use Promise.all (or Promise.allSettled for resilience) to
         wait for all of them. Once resolved, set appReady = true.

         ```ts
         const [appReady, setAppReady] = useState(false);

         useEffect(() => {
           Promise.allSettled([
             useProjectStore.getState().loadProjects(),
             useMeetingStore.getState().loadMeetings(),
             useIdeaStore.getState().loadIdeas(),
             useBrainstormStore.getState().loadSessions(),
             useBoardStore.getState().loadAllCards(),
           ]).then(() => setAppReady(true));
         }, []);
         ```

         This replaces the existing fire-and-forget useEffect on lines 78-83.

      2. When appReady becomes true, fade out and remove the splash:
         ```ts
         useEffect(() => {
           if (!appReady) return;
           const splash = document.getElementById('splash');
           if (!splash) return;
           splash.classList.add('splash-hidden');
           // Remove from DOM after fade-out transition completes
           setTimeout(() => splash.remove(), 400);
         }, [appReady]);
         ```

      3. IMPORTANT: Do NOT show the main app content until appReady is true.
         Wrap the app shell's children in a conditional:
         - While !appReady: render nothing (or minimal skeleton) — splash covers everything
         - When appReady: render the full app

         This prevents the flash of empty-state UI that currently appears while
         stores are hydrating.

      WHY: Promise.allSettled ensures the splash stays visible during ALL async
      initialization, not just React mount. The user sees: splash → smooth fade →
      fully-loaded dashboard. No empty state flash. allSettled (not all) ensures
      the app still loads even if one store fails (e.g. DB not ready yet).
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all 150 tests pass
      3. App start: splash visible → stores load → splash fades out → dashboard visible
      4. Splash fade-out is smooth (300ms transition, not abrupt)
      5. No empty-state flash between splash and dashboard
      6. If DB is slow/fails: splash still dismisses (allSettled resilience)
      7. All existing functionality works after splash dismissal
    </verify>
    <done>
      React waits for all store hydration, then smoothly fades out the splash screen.
      No empty-state flash. App appears fully loaded when the splash lifts.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - All 5 store load functions return Promises (they do — async functions)
      - document.getElementById('splash') works in Electron renderer (standard DOM API)
      - 400ms timeout is enough for the CSS transition to complete
      - Promise.allSettled is available (ES2020 — supported in Electron's V8)
    </assumptions>
  </task>
</phase>
