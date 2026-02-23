<phase n="K.1" name="Dev-only Figma Capture via Browser">
  <context>
    Figma's HTML-to-design capture script does not work inside Electron's renderer
    (tested: script injection via executeJavaScript, inline eval, Vite plugin —
    all failed to show toolbar or trigger capture in Electron).

    New approach: open the Vite dev server (localhost:5173) in Chrome/Edge for capture.
    The dev server already runs during `npm start` — Electron loads from it.
    In a real browser the Figma capture script works as designed.

    Challenge: the app has 258 IPC methods on `window.electronAPI` with 242 direct calls
    across the renderer. Without Electron, `window.electronAPI` is undefined and the app
    crashes immediately. Solution: a Proxy-based mock injected before React boots.

    Zero changes to main.ts, preload.ts, or any production code paths.
    Everything lives in the Vite plugin — dev-serve-only, env-gated.

    @vite.renderer.config.ts
    @src/renderer/index.html
    @src/shared/types/electron-api.ts (reference — full ElectronAPI interface)
    @src/renderer/App.tsx (lines 101-110 — store initialization via Promise.allSettled)
  </context>

  <task type="auto" n="1">
    <n>Create Vite plugin for Figma capture mode</n>
    <files>vite.renderer.config.ts</files>
    <action>
      Add a `figmaCapturePlugin()` Vite plugin with `apply: 'serve'` (dev only).
      Gated behind `process.env.FIGMA_CAPTURE` — does nothing when env var is absent.

      The plugin uses `transformIndexHtml` to inject TWO things before `&lt;/head&gt;`:

      1. **Inline shim script** (synchronous, runs before React):
         Creates `window.electronAPI` as a Proxy that auto-mocks every method:

         ```js
         window.electronAPI = new Proxy(
           { platform: 'browser', appVersion: '0.0.0-capture' },
           {
             get(target, prop) {
               if (prop in target) return target[prop];
               if (typeof prop === 'string' &amp;&amp; prop.startsWith('on'))
                 return () => () => {};          // event listeners → cleanup fn
               return () => Promise.resolve(
                 typeof prop === 'string' &amp;&amp; prop.startsWith('get') ? [] : null
               );                                 // data fetchers → [], rest → null
             }
           }
         );
         ```

         This handles all 258 methods automatically:
         - `platform`/`appVersion`: static values
         - `on*` (event listeners like `onCardAgentChunk`): return cleanup fn
         - `get*` (data fetchers like `getProjects`): return `Promise.resolve([])`
         - Everything else (`createCard`, `deleteProject`, etc.): return `Promise.resolve(null)`

         The React app boots, stores initialize via `Promise.allSettled()` with empty data,
         and the UI renders its layout/navigation with empty states — perfect for capture.

      2. **Figma capture script tag**:
         `&lt;script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async&gt;&lt;/script&gt;`

      WHY this approach:
      - `transformIndexHtml` modifies HTML at serve time only — zero source files touched
      - `apply: 'serve'` ensures zero impact on production builds or `npm run make`
      - Proxy handles all 258 methods in ~15 lines without listing them
      - Inline script runs before any module — critical for store initialization
      - No CSP concerns: Chrome loads from Vite dev server which sets no CSP headers

      Also log to console when the shim is active so the dev knows capture mode is on:
      `console.log('[Figma Capture] electronAPI mock active — running in browser mode');`
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero type errors
      2. Run `npm start` (no FIGMA_CAPTURE) → open DevTools in Electron → Elements tab →
         confirm NO capture script tag and NO shim in the HTML
      3. Run with FIGMA_CAPTURE=1 → open `http://localhost:5173` in Chrome →
         Elements tab → confirm BOTH the inline shim and capture.js script tag are present
      4. Chrome console → `window.electronAPI.getProjects()` → resolves to `[]`
      5. Chrome console → `window.electronAPI.onCardAgentChunk(() => {})` → returns a function
      6. React app renders in Chrome: sidebar, navigation visible, empty data states
      7. Chrome Network tab → capture.js loads with 200 OK
    </verify>
    <done>
      Vite plugin injects electronAPI mock shim + Figma capture script in dev serve mode
      when FIGMA_CAPTURE is set. App renders in Chrome with mocked API.
      Normal `npm start` and production builds are completely unaffected.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Vite dev server runs at localhost:5173 (Electron Forge + Vite default)
      - Promise.allSettled in App.tsx handles empty arrays gracefully (it should — that's its purpose)
      - Some components may show empty/error states — acceptable for UI structure capture
      - The Proxy get() trap handles all access patterns used in the renderer
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Add npm script and verify end-to-end capture</n>
    <files>package.json</files>
    <action>
      1. Check if `cross-env` is already in devDependencies. If not, install it.

      2. Add npm script to package.json:
         ```
         "figma:capture": "cross-env FIGMA_CAPTURE=1 electron-forge start"
         ```
         This eliminates shell-specific env var syntax (bash vs CMD vs PowerShell).

      3. Verify the full capture workflow end-to-end:
         a. Run `npm run figma:capture`
         b. Open Chrome to http://localhost:5173
         c. Confirm app renders with sidebar/navigation and empty states
         d. Use the Figma MCP `generate_figma_design` tool to get a capture URL
         e. Open that URL (localhost:5173#figmacapture=...) in Chrome
         f. Poll for capture completion
         g. Confirm design appears in Figma

      4. Verify zero production impact:
         - `npm start` (without figma:capture) → no Figma artifacts in Electron
         - `npm run make` → packaged app has no Figma code

      WHY cross-env: the user works on Windows and switches between CMD, PowerShell,
      and Git Bash. cross-env normalizes env var syntax across all shells.
    </action>
    <verify>
      1. `npm run figma:capture` starts the app with FIGMA_CAPTURE=1
      2. localhost:5173 in Chrome shows the app layout with empty data states
      3. Figma capture triggers and completes successfully via MCP
      4. `npm start` still works normally — no Figma artifacts
      5. `npm run make` produces clean packaged build
    </verify>
    <done>
      npm script exists for one-command capture mode. Full workflow verified end-to-end:
      dev server serves capture-ready page in Chrome, Figma MCP captures it successfully.
      Zero impact on production builds.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - cross-env is available on npm (it is — 50M+ weekly downloads)
      - Figma capture script works on localhost:5173 in Chrome (standard browser — should work)
      - The Proxy mock is sufficient for the app to render without crashes
      - Some visual differences between Electron and Chrome are acceptable (no frameless window)
    </assumptions>
  </task>
</phase>
