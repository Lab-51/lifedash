# Plan 10.4 — Final UX Polish & Discoverability

<phase n="10.4" name="Final UX Polish & Discoverability">
  <context>
    Plan 10.3 delivered the high-impact power-user features (command palette,
    transcript search, dependency badges). The competitive analysis still lists
    several "DO FIRST" and "POLISH" items that round out the app's feel:
    brainstorm templates, always-on-top toggle, and keyboard shortcut discovery.

    These are all small, self-contained features (1-2 files each) that close out
    Phase 10's "UX Polish" theme before moving to Phase 11 (Smart Project Mgmt).

    Key codebase facts for the executing agent:
    - BrainstormPage creates sessions with { title, projectId } — no template support
    - brainstormService.ts has getBaseSystemPrompt() that returns a fixed prompt
    - buildContext() enriches the prompt with project/card/meeting data
    - TitleBar.tsx is a frameless custom title bar with min/max/close buttons
    - Window controls go through window.electronAPI (IPC bridge)
    - main.ts has `mainWindow` reference accessible via closures
    - useKeyboardShortcuts.ts handles Ctrl+1-5 and Ctrl+K
    - CommandPalette.tsx has quick actions and search — can add "Show Shortcuts"

    @src/renderer/pages/BrainstormPage.tsx
    @src/main/services/brainstormService.ts
    @src/shared/types/brainstorm.ts
    @src/renderer/components/TitleBar.tsx
    @src/main/main.ts
    @src/renderer/hooks/useKeyboardShortcuts.ts
    @src/renderer/components/CommandPalette.tsx
    @src/renderer/App.tsx
    @src/preload/domains/window.ts
    @src/shared/types/electron-api.ts
  </context>

  <task type="auto" n="1">
    <n>Brainstorm session templates with starter prompts</n>
    <files>
      src/shared/types/brainstorm.ts
      src/renderer/pages/BrainstormPage.tsx
      src/main/services/brainstormService.ts
    </files>
    <action>
      Add template selection when creating a new brainstorm session. Templates
      provide a pre-written system prompt context that guides the AI's behavior,
      plus a suggested first user message that kickstarts the conversation.

      **Template definitions** (in src/shared/types/brainstorm.ts):
      Add a new `BrainstormTemplate` interface and a `BRAINSTORM_TEMPLATES` array:

      ```ts
      export interface BrainstormTemplate {
        id: string;
        name: string;
        description: string;
        icon: string; // lucide-react icon name for the UI
        systemContext: string; // appended to the base system prompt
        starterPrompt: string; // suggested first message (user can edit)
      }
      ```

      Define 5 templates:
      1. **Free Form** (id: 'freeform') — No extra context, blank starter.
         "Open-ended brainstorming — go wherever the ideas take you."
      2. **Feature Ideas** (id: 'features') — Focus on user-facing features,
         prioritize feasibility, suggest MVP scope. Starter: "I want to
         brainstorm new features for [project/product]."
      3. **Problem Solving** (id: 'problem-solving') — Root cause analysis,
         5 Whys, structured debugging. Starter: "I'm facing a problem: [describe]."
      4. **Architecture Review** (id: 'architecture') — System design, trade-offs,
         scalability, security considerations. Starter: "I need to design [system]."
      5. **Sprint Planning** (id: 'sprint-planning') — Break work into tasks,
         estimate effort, identify risks. Starter: "I need to plan work for [goal]."

      Export the array so both renderer and main can import it.

      **CreateBrainstormSessionInput** (in brainstorm.ts):
      Add optional `templateId?: string` to the input type.

      **brainstormService.ts** changes:
      - Import `BRAINSTORM_TEMPLATES` from shared types
      - In `buildContext()` (or wherever the system prompt is assembled), check
        if the session was created with a templateId. If so, find the matching
        template and append its `systemContext` to the base system prompt.
      - To store the templateId: add it to the session creation. The simplest
        approach is to store it in the session record — BUT the DB schema has no
        templateId column. Two options:
        (a) Add a migration for a templateId column — heavy
        (b) Store it in the first user message as metadata — awkward
        (c) Pass it through to buildContext via the session title convention — fragile
        (d) Just use the templateId from the create input to auto-send the
            starterPrompt as the first user message + append template context
            to the system prompt for ALL messages in that session.

      **RECOMMENDED approach (d-variant):** Since the brainstormService already
      builds context dynamically per-message, the simplest approach is:
      - Store templateId as a nullable column in brainstorm_sessions (requires
        a small Drizzle migration)
      - In buildContext(), read the session's templateId and append the template's
        systemContext to the system prompt

      HOWEVER, to avoid a migration: use approach (b-alt) — store the template
      system context as the FIRST message in the session with role='system' or
      prepend it to the system prompt in buildContext by checking if the session
      title matches a template pattern.

      **SIMPLEST approach:** Don't store templateId at all. Instead:
      - When user picks a template, create the session normally
      - Immediately auto-send the template's starterPrompt as the first user
        message (this kickstarts the conversation with the right framing)
      - The AI will naturally follow the framing from the starter message
      - No schema changes needed, no migrations, no buildContext changes

      This is the recommended approach. The template's value is in the starter
      prompt that frames the conversation, not in a persistent system prompt override.

      **BrainstormPage.tsx** changes:
      - Import `BRAINSTORM_TEMPLATES` from shared types
      - In the "new session" form area, add template selection:
        - Show template cards/buttons in a grid (2 or 3 columns)
        - Each shows: icon, name, description
        - Selected template has a highlight border
        - Default selection: "Free Form"
      - Add state: `selectedTemplateId` (default: 'freeform')
      - When creating a session: after `loadSession(session.id)`, if the selected
        template has a non-empty starterPrompt, auto-send it as the first message.
        BUT: the session needs to be loaded first (loadSession), then sendMessage.
        Since sendMessage requires activeSession to be set, use a useEffect or
        chain the calls.
      - Simpler: after creating the session and loading it, pre-fill the input
        field with the starterPrompt text. User can then edit and send manually.
        This is more user-friendly — they see what's about to be sent and can
        customize it.

      **WHY**: Brainstorm templates eliminate the "blank page problem." Users see
      structured starting points instead of an empty chat. Competitors like Notion
      and ChatGPT all offer conversation templates. The 5 templates cover the most
      common professional brainstorming scenarios.

      **Design notes**:
      - Template picker: show in the new-session form, below the title input
      - Cards: bg-surface-800, rounded-lg, p-3, border border-surface-700,
        hover: border-primary-500/50, selected: border-primary-500 bg-primary-600/10
      - Icons: use lucide-react (Sparkles for freeform, Lightbulb for features,
        Search for problem-solving, Layers for architecture, ListChecks for sprint)
      - Compact layout — don't overwhelm the create form
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all tests pass
      - New session form shows 5 template options
      - Selecting a template highlights it
      - Creating a session with a template pre-fills the input with starterPrompt
      - Free Form template starts with empty input (no starter)
      - Templates are defined in shared types (importable from both sides)
    </verify>
    <done>
      Brainstorm session creation offers 5 templates (Free Form, Feature Ideas,
      Problem Solving, Architecture Review, Sprint Planning). Selecting a template
      pre-fills the chat input with a starter prompt. No schema migration needed.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - No DB schema change needed (templates are UI-only, starter is just a
        pre-filled message that user sends manually)
      - 5 templates cover the main professional brainstorming use cases
      - Pre-filling input (not auto-sending) is better UX — user can customize
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Always-on-top toggle with pin button in title bar</n>
    <files>
      src/renderer/components/TitleBar.tsx
      src/main/main.ts
      src/preload/domains/window.ts
      src/shared/types/electron-api.ts
    </files>
    <preconditions>
      - Task 1 complete
    </preconditions>
    <action>
      Add a pin/unpin button to the title bar that toggles always-on-top mode.
      This is a standard desktop app feature (Slack, Discord, sticky notes all
      have it) that lets users keep the dashboard visible while working in other
      apps — especially useful during meetings.

      **Main process** (src/main/main.ts):
      1. Add IPC handler for `window:set-always-on-top`:
         ```ts
         ipcMain.handle('window:set-always-on-top', (_event, value: boolean) => {
           mainWindow?.setAlwaysOnTop(value);
           return mainWindow?.isAlwaysOnTop() ?? false;
         });
         ```
      2. Add IPC handler for `window:is-always-on-top`:
         ```ts
         ipcMain.handle('window:is-always-on-top', () => {
           return mainWindow?.isAlwaysOnTop() ?? false;
         });
         ```
      3. Register these handlers inside `createWindow()` after `registerIpcHandlers`
         or inside the existing IPC registration flow. NOTE: the existing IPC
         handlers are registered via `registerIpcHandlers(mainWindow)` in
         `src/main/ipc/index.ts`. The window handlers may be in
         `src/main/ipc/window.ts`. Check where existing window:minimize etc are
         handled and add the new handlers there for consistency.

      **Preload bridge** (src/preload/domains/window.ts):
      Add to windowBridge:
      ```ts
      windowSetAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('window:set-always-on-top', value),
      windowIsAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
      ```

      **ElectronAPI type** (src/shared/types/electron-api.ts):
      Add to ElectronAPI interface:
      ```ts
      windowSetAlwaysOnTop: (value: boolean) => Promise<boolean>;
      windowIsAlwaysOnTop: () => Promise<boolean>;
      ```

      **TitleBar.tsx** changes:
      1. Import `Pin` and `PinOff` from lucide-react
      2. Add state: `const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)`
      3. In useEffect (existing one), also check initial always-on-top state:
         `window.electronAPI.windowIsAlwaysOnTop().then(setIsAlwaysOnTop)`
      4. Add toggle handler:
         ```ts
         const toggleAlwaysOnTop = async () => {
           const result = await window.electronAPI.windowSetAlwaysOnTop(!isAlwaysOnTop);
           setIsAlwaysOnTop(result);
         };
         ```
      5. Add a pin button BEFORE the minimize button in the window controls:
         - When pinned: Pin icon, text-primary-400 (visually "active")
         - When unpinned: PinOff icon, text-surface-400 (same as other buttons)
         - Same sizing as other title bar buttons (w-10 h-9 or similar)
         - Tooltip: "Pin on top" / "Unpin"

      **WHY**: Users frequently want the dashboard visible while working in their
      IDE or browser. During meetings, keeping the transcript visible in a corner
      is a core use case. Always-on-top is expected in desktop productivity tools.

      **Design**: The pin button fits naturally in the title bar controls. When
      active, it uses the primary color to indicate the mode is on. Small enough
      not to crowd the title bar — slightly narrower than min/max/close buttons.
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all tests pass
      - Pin button visible in title bar (before minimize)
      - Clicking pin toggles always-on-top mode
      - Pin icon changes between Pin and PinOff
      - Pinned state uses primary color for visual feedback
      - Window actually stays on top when other apps are focused
      - Clicking pin again un-pins the window
    </verify>
    <done>
      Title bar has a pin/unpin button that toggles always-on-top mode via
      Electron's setAlwaysOnTop API. Visual feedback shows pinned state.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Electron's setAlwaysOnTop works reliably on Windows (it does)
      - Pin/PinOff icons exist in lucide-react (verified — they do)
      - Window IPC handlers are registered in src/main/ipc/window.ts (need to verify)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Keyboard shortcuts cheat sheet overlay</n>
    <files>
      src/renderer/components/KeyboardShortcutsModal.tsx (new)
      src/renderer/hooks/useKeyboardShortcuts.ts
      src/renderer/App.tsx
      src/renderer/components/CommandPalette.tsx
    </files>
    <preconditions>
      - Tasks 1 and 2 complete
    </preconditions>
    <action>
      Add a keyboard shortcuts help overlay that shows all available shortcuts.
      Opens with Ctrl+? (Ctrl+Shift+/) and is also accessible from the command
      palette as a quick action.

      **KeyboardShortcutsModal.tsx** (NEW, ~80-100 lines):
      A simple modal overlay listing all keyboard shortcuts in a clean grid.

      Shortcut categories and entries:
      - **Navigation:**
        - Ctrl+1 → Projects
        - Ctrl+2 → Meetings
        - Ctrl+3 → Ideas
        - Ctrl+4 → Brainstorm
        - Ctrl+5 → Settings
      - **Actions:**
        - Ctrl+K → Command Palette
        - Ctrl+Shift+Space → Quick Capture (global)
        - Ctrl+? → Keyboard Shortcuts (this modal)
        - Esc → Close modal/overlay

      Layout:
      - Full-screen overlay with dark backdrop (same pattern as CommandPalette)
      - Centered modal, max-w-md
      - Title: "Keyboard Shortcuts"
      - Two-column grid per shortcut: key combo on left, description on right
      - Key combos styled as `<kbd>` elements with bg-surface-700 rounded px-2
      - Close with Esc or clicking backdrop
      - Close button (X) in top-right

      Props: `{ isOpen: boolean; onClose: () => void }`
      Render nothing when !isOpen.

      **useKeyboardShortcuts.ts** changes:
      - Add a third optional callback: `onToggleShortcutsHelp?: () => void`
      - Add handler for Ctrl+? (which is Ctrl+Shift+/ on most keyboards):
        Check `e.key === '?'` with ctrlKey/metaKey — call onToggleShortcutsHelp

      **App.tsx** changes:
      - Add `showShortcutsHelp` state (boolean)
      - Add toggle callback for shortcuts help
      - Pass it to useKeyboardShortcuts as the third param
      - Render `KeyboardShortcutsModal` with isOpen and onClose props
      - Import the modal component (can be lazy-loaded)

      **CommandPalette.tsx** changes:
      - Add "Keyboard Shortcuts" to the quick actions list
      - Icon: Keyboard from lucide-react
      - Action: close palette, then trigger shortcuts help
      - Accept an optional `onShowShortcuts?: () => void` prop
      - In App.tsx, pass the toggle function to CommandPalette

      **WHY**: Users don't know what shortcuts exist unless they can discover them.
      Every premium desktop app (VS Code, Figma, Linear) has a shortcuts cheat
      sheet. This also serves as a learning tool — users see shortcuts they didn't
      know about and start using them. Ctrl+? is the de facto standard shortcut
      for showing help.

      **Design**:
      - Same overlay pattern as CommandPalette (bg-black/50 backdrop, centered modal)
      - Modal: bg-surface-900, rounded-xl, max-w-md, border border-surface-700
      - Category headers: text-xs text-surface-500 uppercase tracking-wider
      - Shortcut rows: flex justify-between, py-1.5
      - Key badges: inline-flex bg-surface-700 rounded px-2 py-0.5 text-xs
        font-mono text-surface-200
      - Description: text-sm text-surface-300
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all tests pass
      - Ctrl+? opens the shortcuts modal
      - Modal lists all shortcuts in organized categories
      - Key combos are styled as kbd badges
      - Esc closes the modal
      - Clicking backdrop closes the modal
      - Command palette includes "Keyboard Shortcuts" action
      - Selecting it from command palette opens the shortcuts modal
    </verify>
    <done>
      Keyboard shortcuts cheat sheet opens on Ctrl+? showing all shortcuts in
      a categorized grid. Also accessible from command palette quick actions.
      Key combos styled as kbd badges with clear descriptions.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Ctrl+? maps to e.key === '?' with ctrlKey true (standard behavior)
      - Keyboard icon exists in lucide-react (it does)
      - Lazy-loading the modal is sufficient (no need for eager import)
    </assumptions>
  </task>
</phase>
