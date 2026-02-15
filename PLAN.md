# Plan 11.1 — Critical UX Fixes & Data Loss Prevention

<phase n="11.1" name="Critical UX Fixes & Data Loss Prevention">
  <context>
    Full project review (REVIEW.md, 2026-02-15) identified 5 top priorities.
    This plan addresses the 3 highest-impact user-facing issues:

    1. **Close-during-recording guard** — Closing the app during an active recording
       silently discards the session. This is a data loss bug.
    2. **Command palette data loading** — Ctrl+K shows no results for entities
       (meetings, ideas, brainstorm sessions) until the user has visited each page.
       This makes the flagship Ctrl+K feature appear broken.
    3. **Brainstorm markdown rendering** — The existing regex-based renderMarkdown()
       in ChatMessage.tsx handles basic formatting but the review flagged it as
       displaying raw markdown characters. Need to upgrade to a proper markdown
       library (react-markdown) for reliable rendering of tables, links, nested
       lists, and edge cases the regex misses.

    Card count badges were already implemented (confirmed in BoardColumn.tsx).

    Key codebase facts:
    - Window close: src/main/main.ts lines 137-148 (macOS hides, Windows/Linux quits)
    - IPC window close: src/main/ipc/window-controls.ts — `window:close` handler
    - Recording state: src/renderer/stores/recordingStore.ts — `isRecording: boolean`
    - CommandPalette: src/renderer/components/CommandPalette.tsx — reads from Zustand
      stores (projectStore, meetingStore, ideaStore, brainstormStore, boardStore) but
      never calls load functions
    - ChatMessage: src/renderer/components/ChatMessage.tsx — has renderMarkdown()
      regex-based renderer (lines 71-176) that handles headings, bullets, code blocks,
      bold/italic but NOT tables, links, images, nested lists
    - BrainstormPage: src/renderer/pages/BrainstormPage.tsx — renders messages via
      ChatMessage component

    @src/main/main.ts
    @src/main/ipc/window-controls.ts
    @src/renderer/stores/recordingStore.ts
    @src/renderer/components/CommandPalette.tsx
    @src/renderer/components/ChatMessage.tsx
    @src/renderer/pages/BrainstormPage.tsx
    @src/preload/domains/window.ts
    @src/shared/types/electron-api.ts
  </context>

  <task type="auto" n="1">
    <n>Add close-during-recording guard to prevent data loss</n>
    <files>
      src/main/main.ts
      src/main/ipc/window-controls.ts
      src/preload/domains/window.ts
      src/shared/types/electron-api.ts
    </files>
    <action>
      When the user closes the app during an active recording, show a confirmation
      dialog instead of silently discarding the recording. This prevents accidental
      data loss — one of the review's top 5 priorities.

      **Approach:** The recording state lives in the renderer (Zustand store). The
      main process doesn't know if a recording is active. Two strategies:

      **Strategy A (recommended):** Track recording state in the main process.
      - Add a simple boolean `isRecording` in main.ts (module-level variable)
      - Add IPC handler `recording:set-state` that sets this boolean
      - Call this from the renderer whenever recording starts/stops
      - In the window 'close' event handler, check `isRecording` and show
        `dialog.showMessageBox()` if true

      **Strategy B:** Ask the renderer on close. This requires async IPC which
      is more complex for a synchronous 'close' event. Strategy A is simpler.

      **Implementation (Strategy A):**

      1. **src/main/main.ts** or a new lightweight module:
         - Add module-level: `let isRecording = false;`
         - Export getter/setter: `getIsRecording()`, `setIsRecording(value)`
         - In the `mainWindow.on('close', ...)` handler:
           ```ts
           mainWindow.on('close', async (event) => {
             if (isRecording) {
               event.preventDefault();
               const { response } = await dialog.showMessageBox(mainWindow, {
                 type: 'warning',
                 buttons: ['Keep Recording', 'Stop & Close'],
                 defaultId: 0,
                 cancelId: 0,
                 title: 'Recording in Progress',
                 message: 'A meeting recording is currently active.',
                 detail: 'Closing the app will stop the recording. The recorded audio up to this point will be saved.',
               });
               if (response === 1) {
                 // User chose to stop & close — send stop signal to renderer first
                 mainWindow?.webContents.send('recording:force-stop');
                 // Give renderer a moment to save, then close
                 setTimeout(() => {
                   isRecording = false;
                   mainWindow?.close();
                 }, 2000);
               }
             } else if (process.platform === 'darwin' && !(app as any).isQuitting) {
               event.preventDefault();
               mainWindow?.hide();
             }
           });
           ```

      2. **src/main/ipc/window-controls.ts** (or wherever window IPC lives):
         - Add handler: `ipcMain.handle('recording:set-state', (_e, value: boolean) => { setIsRecording(value); })`
         - Import setIsRecording from main.ts or the recording state module

      3. **src/preload/domains/window.ts**:
         - Add to the bridge: `recordingSetState: (isRecording: boolean) => ipcRenderer.invoke('recording:set-state', isRecording)`
         - Add listener: `onRecordingForceStop: (callback: () => void) => { ipcRenderer.on('recording:force-stop', callback); return () => { ipcRenderer.removeListener('recording:force-stop', callback); }; }`

      4. **src/shared/types/electron-api.ts**:
         - Add to ElectronAPI: `recordingSetState: (isRecording: boolean) => Promise<void>;`
         - Add: `onRecordingForceStop: (callback: () => void) => () => void;`

      5. **src/renderer/stores/recordingStore.ts**:
         - In `startRecording()`: after successful start, call `window.electronAPI.recordingSetState(true)`
         - In `stopRecording()`: call `window.electronAPI.recordingSetState(false)`
         - Add a listener for `onRecordingForceStop` that calls `stopRecording()`
           (set up in a `useEffect` or in the store's init)

      **WHY:** The review identified this as priority #4. A single dialog call
      prevents users from accidentally losing meeting recordings. The approach is
      minimal — one boolean in main process, one dialog check, one IPC channel.

      **Edge cases:**
      - If the app crashes, the recording is already lost (can't prevent this)
      - If the user closes from the tray icon, the same 'close' event fires
      - The 2-second timeout for force-close ensures the app doesn't hang
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all existing tests pass
      - Start a recording, then close the app → dialog appears
      - Choose "Keep Recording" → dialog closes, recording continues
      - Choose "Stop &amp; Close" → recording stops, app closes
      - Close the app with no recording → normal close behavior (no dialog)
      - macOS hide-to-tray behavior still works when not recording
    </verify>
    <done>
      Closing the app during an active recording shows a warning dialog with
      "Keep Recording" and "Stop &amp; Close" options. Recording state is tracked
      in the main process via a simple IPC channel.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - dialog.showMessageBox works with async/await in the close event handler
        when event.preventDefault() is called first (standard Electron pattern)
      - 2-second timeout is sufficient for the renderer to stop recording and save
      - The window 'close' event handler in main.ts is the correct interception point
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Load all entity data for command palette on app mount</n>
    <files>
      src/renderer/components/CommandPalette.tsx
      src/renderer/App.tsx
    </files>
    <preconditions>
      - Task 1 complete
    </preconditions>
    <action>
      The command palette (Ctrl+K) reads from Zustand stores but those stores
      are only populated when the user visits the corresponding page. If the user
      opens the palette before visiting Meetings, Ideas, or Brainstorm pages, those
      sections show no results — making the feature appear broken.

      **Fix:** Eagerly load entity lists on app mount so the command palette always
      has data to search.

      **Option A (recommended):** Add a `useEffect` in App.tsx that loads all
      entity lists on mount:
      ```tsx
      // In App.tsx, near the top of the component
      useEffect(() => {
        // Pre-load entity data for command palette search
        const projectStore = useProjectStore.getState();
        const meetingStore = useMeetingStore.getState();
        const ideaStore = useIdeaStore.getState();
        const brainstormStore = useBrainstormStore.getState();

        projectStore.loadProjects();
        meetingStore.loadMeetings();
        ideaStore.loadIdeas();
        brainstormStore.loadSessions();
      }, []);
      ```

      Note: Use `getState()` outside of React render cycle to avoid unnecessary
      re-renders. The stores will update internally and the CommandPalette (which
      subscribes via hooks) will pick up the data.

      **Option B:** Load inside CommandPalette when it opens. This is lazier but
      adds a loading delay when the user presses Ctrl+K. Option A is better UX.

      **Additional improvement (while we're here):**
      If CommandPalette doesn't already handle the "no results" state gracefully,
      add a brief message like "No results found" or "Start typing to search..."
      when the search yields nothing. This is already likely handled but verify.

      **WHY:** The command palette is a flagship feature (Plan 10.3). If it shows
      no results on first use, users will think it's broken and never use it again.
      Loading ~100 entities on mount is negligible (< 50ms from PGlite).

      **Performance note:** These are lightweight list queries (no relations loaded).
      PGlite responds in < 10ms for these. Loading 4 lists adds < 40ms to app start.
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all existing tests pass
      - Fresh app start → immediately open Ctrl+K → projects, meetings, ideas,
        brainstorm sessions all appear in search results
      - No visible delay or loading state when opening the palette
      - Individual page visits still work normally (no double-loading issues)
    </verify>
    <done>
      App.tsx loads all entity lists (projects, meetings, ideas, brainstorm sessions)
      on mount. Command palette shows results immediately without requiring page visits.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - useProjectStore/useMeetingStore/useIdeaStore/useBrainstormStore all have
        loadProjects/loadMeetings/loadIdeas/loadSessions methods
      - Loading all entities on mount is fast enough (< 50ms) for PGlite
      - No circular dependency issues from importing all stores in App.tsx
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Upgrade brainstorm chat to proper markdown rendering</n>
    <files>
      src/renderer/components/ChatMessage.tsx
      package.json (add react-markdown + remark-gfm)
    </files>
    <preconditions>
      - Tasks 1 and 2 complete
    </preconditions>
    <action>
      Replace the regex-based renderMarkdown() in ChatMessage.tsx with
      react-markdown for reliable, standards-compliant markdown rendering.
      The current regex renderer handles basic cases but misses tables, links,
      images, nested lists, and complex formatting that AI models frequently
      produce. This was identified as the review's #1 visual polish gap.

      **Install dependencies:**
      ```bash
      npm install react-markdown remark-gfm
      ```
      - `react-markdown`: React component for rendering markdown (uses unified/remark)
      - `remark-gfm`: GitHub Flavored Markdown support (tables, strikethrough,
        task lists, autolinks)

      **ChatMessage.tsx changes:**

      1. Import:
         ```tsx
         import ReactMarkdown from 'react-markdown';
         import remarkGfm from 'remark-gfm';
         ```

      2. Remove the entire `renderMarkdown()` function (lines ~71-176) and its
         helper functions. This deletes ~100 lines of fragile regex parsing.

      3. Replace the AI message rendering (where renderMarkdown is called) with:
         ```tsx
         <ReactMarkdown
           remarkPlugins={[remarkGfm]}
           components={{
             // Custom component overrides for Tailwind styling
             h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
             h2: ({ children }) => <h2 className="text-base font-semibold mt-2 mb-1">{children}</h2>,
             h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
             p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
             ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
             ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
             li: ({ children }) => <li className="mb-0.5">{children}</li>,
             code: ({ className, children, ...props }) => {
               const isInline = !className;
               return isInline
                 ? <code className="bg-surface-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                 : <code className={`${className} block bg-surface-800 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2`} {...props}>{children}</code>;
             },
             pre: ({ children }) => <pre className="bg-surface-800 rounded-lg overflow-x-auto my-2">{children}</pre>,
             a: ({ href, children }) => <a href={href} className="text-primary-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
             table: ({ children }) => <table className="border-collapse border border-surface-700 my-2 text-xs">{children}</table>,
             th: ({ children }) => <th className="border border-surface-700 px-2 py-1 bg-surface-800 font-semibold">{children}</th>,
             td: ({ children }) => <td className="border border-surface-700 px-2 py-1">{children}</td>,
             blockquote: ({ children }) => <blockquote className="border-l-2 border-primary-500 pl-3 italic text-surface-400 my-2">{children}</blockquote>,
             hr: () => <hr className="border-surface-700 my-3" />,
           }}
         >
           {message.content}
         </ReactMarkdown>
         ```

      4. Preserve the existing `text-sm text-surface-200` wrapper div around
         the ReactMarkdown component so font size and color remain consistent.

      5. User messages should remain as plain text with `whitespace-pre-wrap`
         (no markdown rendering for user input — keeps it authentic).

      **WHY:** The review identified brainstorm markdown rendering as the #1
      visual polish gap ("most visible gap that makes the flagship AI feature
      look broken"). AI models produce rich markdown including tables, nested
      lists, links, and code blocks. The regex renderer handles ~60% of cases
      but breaks on the rest. react-markdown is the standard solution (~4M
      weekly npm downloads), well-maintained, and tree-shakeable.

      **Styling consistency:** The component overrides ensure markdown renders
      with the same Tailwind classes used throughout the app (surface colors,
      primary accents, consistent spacing).

      **Bundle impact:** react-markdown + remark-gfm add ~40KB gzipped.
      Acceptable for an Electron app.
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all existing tests pass
      - Open a brainstorm session and send a prompt that generates markdown
        (e.g., "List 5 tips for better code reviews with examples")
      - AI response renders with proper formatting:
        - Headings are styled (larger, bold)
        - Bullet lists have proper bullets and indentation
        - Code blocks have dark background and monospace font
        - Inline code has subtle background
        - Bold/italic text renders correctly
        - Links are clickable (if AI generates any)
      - No raw markdown characters visible (#, *, -, ```)
      - User messages still display as plain text (no markdown processing)
    </verify>
    <done>
      ChatMessage.tsx uses react-markdown + remark-gfm for AI response rendering.
      All markdown elements (headings, lists, code, tables, links, blockquotes)
      render with proper Tailwind styling. The ~100-line regex renderer is removed.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - react-markdown v9+ supports ESM imports in Vite (it does — pure ESM since v9)
      - remark-gfm is compatible with react-markdown v9 (verified — same ecosystem)
      - The existing dark theme surface colors work well for markdown elements
      - No CSP issues with react-markdown in Electron (it doesn't use eval/innerHTML)
    </assumptions>
  </task>
</phase>
