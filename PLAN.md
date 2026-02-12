# Phase 1 — Plan 3 of 3: Design System & Polish

## Coverage
- **R8: Navigation & Layout** (final 10% — design system foundation, responsive polish, 404 route)
- **R1: Electron App Shell** (final 5% — lifecycle polish)

## Plan Overview
This plan completes Phase 1 by delivering the design system foundation (Inter font bundling,
typography scale, custom scrollbar, focus rings, transitions) and layout completeness (404 route,
accessible focus management). After this plan, Phase 1 deliverables are 100% complete.

## Gap Analysis
What's missing to close Phase 1:
1. Inter font is referenced in CSS but never loaded — will fall back to system-ui silently
2. No typography scale defined beyond Tailwind defaults
3. No custom scrollbar styling (dark theme scrollbar will be browser default — ugly on dark bg)
4. No focus ring standards for keyboard accessibility
5. No catch-all 404 route for unknown paths
6. No base transition/animation patterns established

---

<phase n="1.3" name="Design System &amp; Polish">
  <context>
    Plans 1 and 2 are complete. The app has:
    - Electron Forge + Vite + React 19 + TypeScript + Tailwind CSS 4
    - Custom frameless window with TitleBar, system tray, IPC bridge
    - PostgreSQL via Docker + Drizzle ORM with 12-table schema
    - HashRouter with 5 routes, Sidebar navigation, AppLayout with ErrorBoundary + Suspense
    - StatusBar with DB connection indicator, keyboard shortcuts (Ctrl+1-5)
    - LoadingSpinner, PageSkeleton, ErrorBoundary components
    - Window min-size already set: 900x600

    Design system current state:
    - @theme defines: primary-50..950, surface-50..950, success, warning, error
    - --font-sans set to 'Inter' but Inter is NOT installed/bundled
    - No typography scale beyond Tailwind defaults
    - No custom scrollbar, focus ring, or transition patterns

    Current renderer file structure:
    ```
    src/renderer/
    ├── App.tsx (HashRouter + AppShell + Routes + StatusBar)
    ├── main.tsx (React root render)
    ├── index.html
    ├── styles/globals.css (@theme colors + font-sans)
    ├── components/
    │   ├── TitleBar.tsx
    │   ├── Sidebar.tsx
    │   ├── AppLayout.tsx (Sidebar + ErrorBoundary + Suspense + Outlet)
    │   ├── StatusBar.tsx
    │   ├── ErrorBoundary.tsx
    │   ├── LoadingSpinner.tsx
    │   └── PageSkeleton.tsx
    ├── hooks/
    │   ├── useDatabaseStatus.ts
    │   └── useKeyboardShortcuts.ts
    └── pages/
        ├── ProjectsPage.tsx
        ├── MeetingsPage.tsx
        ├── IdeasPage.tsx
        ├── BrainstormPage.tsx
        └── SettingsPage.tsx
    ```

    @src/renderer/styles/globals.css
    @src/renderer/App.tsx
    @src/renderer/components/AppLayout.tsx
    @package.json
  </context>

  <task type="auto" n="1">
    <n>Inter font bundling + design system globals</n>
    <files>
      package.json (modify — add @fontsource-variable/inter)
      src/renderer/styles/globals.css (modify — add font import, scrollbar, focus rings, selection, transitions)
    </files>
    <action>
      Bundle the Inter font locally and establish global design system styles.

      WHY: The CSS references Inter font but it's not installed — text silently falls back
      to system-ui which looks inconsistent. For an Electron desktop app, fonts must be
      bundled locally (no CDN in offline mode). Also, the dark theme needs custom scrollbar
      styling, consistent focus rings for keyboard users, and base transition patterns.

      Steps:

      1. Install @fontsource-variable/inter:
         `npm install @fontsource-variable/inter`
         WHY: @fontsource bundles Google Fonts as npm packages. The "variable" version
         includes all weights in a single file (~120KB), smaller than loading multiple weights.
         This is the standard approach for Electron/offline apps.

      2. Update globals.css — add Inter import at the very top (before @import "tailwindcss"):
         ```css
         @import "@fontsource-variable/inter";
         ```
         This makes the Inter variable font available globally.

      3. Add custom scrollbar styles for dark theme (after @theme block):
         ```css
         /* Custom scrollbar for dark theme */
         ::-webkit-scrollbar {
           width: 8px;
           height: 8px;
         }
         ::-webkit-scrollbar-track {
           background: transparent;
         }
         ::-webkit-scrollbar-thumb {
           background: var(--color-surface-700);
           border-radius: 4px;
         }
         ::-webkit-scrollbar-thumb:hover {
           background: var(--color-surface-600);
         }
         ```
         WHY: Electron uses Chromium, so ::-webkit-scrollbar works. The default bright
         scrollbar looks terrible on a dark-themed app.

      4. Add global focus ring styles:
         ```css
         /* Keyboard focus rings — visible only on keyboard navigation */
         :focus-visible {
           outline: 2px solid var(--color-primary-500);
           outline-offset: 2px;
         }
         :focus:not(:focus-visible) {
           outline: none;
         }
         ```
         WHY: Accessible keyboard navigation needs visible focus indicators.
         :focus-visible only shows the ring on keyboard tab, not on mouse click.

      5. Add text selection styling:
         ```css
         ::selection {
           background: var(--color-primary-600);
           color: white;
         }
         ```

      6. Add base body/html styles:
         ```css
         html, body {
           overflow: hidden;
           background: var(--color-surface-950);
           color: var(--color-surface-100);
         }
         ```
         WHY: Prevents page-level scrolling (the app manages its own scroll regions).
         Sets the base background to match the dark theme.

      IMPORTANT: Keep the @theme block unchanged. Only add new rules after it.
      The order should be:
      1. @import "@fontsource-variable/inter"
      2. @import "tailwindcss"
      3. @theme { ... } (unchanged)
      4. New global styles (scrollbar, focus, selection, body)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Check that @fontsource-variable/inter is in package.json dependencies
      3. Read globals.css and verify:
         - @fontsource-variable/inter import is present (before tailwindcss)
         - Custom scrollbar styles exist
         - :focus-visible rule exists
         - ::selection rule exists
         - html/body overflow:hidden and background set
    </verify>
    <done>
      Inter variable font is bundled locally (works offline).
      Dark-themed scrollbar matches the app design.
      Keyboard focus rings use primary-500 color.
      Text selection uses primary-600 background.
      Page-level scroll is prevented (app manages own scroll regions).
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - @fontsource-variable/inter works with Vite's CSS import system
      - Electron's Chromium supports ::-webkit-scrollbar and :focus-visible
      - CSS @import order: fontsource first, then tailwindcss, then @theme
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>404 catch-all route + NotFound page</n>
    <files>
      src/renderer/pages/NotFoundPage.tsx (create)
      src/renderer/App.tsx (modify — add catch-all route)
    </files>
    <action>
      Add a catch-all route for unmatched paths so users see a helpful 404 page
      instead of a blank screen.

      WHY: Without a catch-all route, navigating to a non-existent path renders nothing
      in the Outlet. A proper 404 page with a "Go Home" link prevents user confusion.
      This also future-proofs against broken links or bookmarks.

      Steps:

      1. Create NotFoundPage (src/renderer/pages/NotFoundPage.tsx):
         - Centered layout with:
           - Large "404" text (text-6xl, font-bold, text-surface-700)
           - "Page not found" heading (text-xl, text-surface-300)
           - Brief message: "The page you're looking for doesn't exist."
           - "Go to Projects" link button that navigates to /
         - Use Link from react-router-dom for the button
         - Style the button like: px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500
         - Keep it simple — no animations, no complex layout

      2. Update App.tsx — add catch-all route:
         Add a `<Route path="*" ...>` as the LAST route inside the AppLayout Route:
         ```tsx
         const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

         // Inside Routes:
         <Route element={<AppLayout />}>
           <Route index element={<ProjectsPage />} />
           <Route path="/meetings" element={<MeetingsPage />} />
           <Route path="/ideas" element={<IdeasPage />} />
           <Route path="/brainstorm" element={<BrainstormPage />} />
           <Route path="/settings" element={<SettingsPage />} />
           <Route path="*" element={<NotFoundPage />} />
         </Route>
         ```
         WHY: The `*` path matches anything not matched above. Placed inside AppLayout
         so the sidebar still renders (user can navigate back via sidebar).

      IMPORTANT: The NotFoundPage import should be lazy() like the other pages.
      Follow the same component pattern (file purpose comment, default export).
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify NotFoundPage.tsx exists in src/renderer/pages/
      3. Check App.tsx has a Route with path="*" and NotFoundPage
      4. Confirm it uses lazy() import like the other pages
    </verify>
    <done>
      Navigating to any unknown path shows a 404 page with "Go to Projects" link.
      The 404 page renders inside AppLayout so sidebar navigation is still available.
      NotFoundPage is lazy-loaded consistently with other pages.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - React Router v7 supports path="*" catch-all routes (standard feature)
      - Placing the catch-all inside a layout route works correctly
    </assumptions>
  </task>
</phase>