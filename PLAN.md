# Plan C.3 — Focus Mode / Pomodoro Timer

<phase n="C.3" name="Focus Mode / Pomodoro Timer">
  <context>
    Phase C: Task Management Power, feature E2 (Focus Mode / Pomodoro Timer).
    Plans C.1 (Card Checklists) and C.2 (Recurring Cards + Card Templates) are COMPLETE.

    Current state:
    - StatusBar: src/renderer/components/StatusBar.tsx — h-6 bar, left=DB status, right=pending actions + "Ctrl+K: Commands"
    - SidebarModern: src/renderer/components/SidebarModern.tsx — w-20 icon-nav, no collapse mechanism
    - AppLayout: src/renderer/components/AppLayout.tsx — flex row: Sidebar + main (Outlet)
    - AppShell in App.tsx: manages CommandPalette + KeyboardShortcutsModal toggle state
    - useKeyboardShortcuts: Ctrl+1-6 nav, Ctrl+K palette, Ctrl+? shortcuts help
    - KeyboardShortcutsModal: 3 groups (Navigation, Actions, Page Shortcuts)
    - Zustand stores in src/renderer/stores/ (boardStore, cardDetailStore, settingsStore, etc.)
    - settingsStore: key-value via setSetting/getSetting IPC — no new IPC needed for preferences
    - notificationService: showNotification(title, body) exists in main process
    - notifications IPC: get-preferences, update-preferences, test — but NO generic "show" handler
    - notificationsBridge: notificationSendTest available in renderer
    - Card comments: addCardComment({ cardId, content }) via cardDetailStore + IPC
    - allCards: useBoardStore(s => s.allCards) — AllCardsItem[] with id, title, projectId, etc.
    - Toast: useToastStore + toast() for in-app notifications
    - Main process global shortcuts: globalShortcut.register in main.ts

    Design decisions:
    - Timer runs client-side via setInterval (no IPC for countdown — pure renderer logic).
    - Focus store as new Zustand store (focusStore.ts) — same pattern as all other stores.
    - Sidebar hides during focus mode (conditional render in AppLayout, reading focusStore).
    - Session-end logs as card comment (existing IPC, no new table — keeps it simple).
    - Desktop notification for timer end via new notifications:show IPC handler.
    - Settings stored in existing key-value table: pomodoro.workDuration, pomodoro.breakDuration.
    - No dedicated focus_sessions DB table (card comments serve as log; table can be added later).
    - Ctrl+Shift+F triggers focus mode (not registered as globalShortcut — renderer-only,
      so it only works when the app is focused, which is fine).

    @PROJECT.md @STATE.md @SELF-IMPROVE-NEW.md
    @src/renderer/components/StatusBar.tsx
    @src/renderer/components/SidebarModern.tsx
    @src/renderer/components/AppLayout.tsx
    @src/renderer/App.tsx (AppShell)
    @src/renderer/hooks/useKeyboardShortcuts.ts
    @src/renderer/components/KeyboardShortcutsModal.tsx
    @src/renderer/stores/boardStore.ts (allCards pattern)
    @src/renderer/stores/cardDetailStore.ts (addComment)
    @src/renderer/stores/settingsStore.ts
    @src/main/ipc/notifications.ts
    @src/main/services/notificationService.ts
    @src/preload/domains/notifications.ts
    @src/shared/types/electron-api.ts
  </context>

  <task type="auto" n="1">
    <n>Focus Store + notifications:show IPC + keyboard shortcut wiring</n>
    <files>
      src/renderer/stores/focusStore.ts (new)
      src/main/ipc/notifications.ts
      src/preload/domains/notifications.ts
      src/shared/types/electron-api.ts
      src/renderer/hooks/useKeyboardShortcuts.ts
      src/renderer/components/KeyboardShortcutsModal.tsx
    </files>
    <action>
      **WHY:** The focus mode needs a core timer engine before any UI can display it. This task
      creates the Zustand store with full timer logic, wires up the notification IPC for timer-end
      alerts, and registers the keyboard shortcut so the feature has a trigger.

      ## Focus Store (src/renderer/stores/focusStore.ts)

      1. Create a new Zustand store following the existing pattern (see boardStore, settingsStore):

         ```ts
         interface FocusState {
           // State
           mode: 'idle' | 'focus' | 'break';
           timeRemaining: number;       // seconds
           focusedCardId: string | null;
           focusedCardTitle: string | null;
           workDuration: number;         // minutes (default 25)
           breakDuration: number;        // minutes (default 5)
           sessionCount: number;         // completed focus sessions this app run
           isPaused: boolean;
           intervalId: ReturnType<typeof setInterval> | null;

           // Actions
           startFocus: (cardId: string | null, cardTitle: string | null) => void;
           startBreak: () => void;
           pause: () => void;
           resume: () => void;
           stop: () => void;
           tick: () => void;
           setDurations: (work: number, breakMins: number) => void;
           loadSettings: () => Promise<void>;
         }
         ```

      2. `startFocus(cardId, cardTitle)`:
         - Set mode='focus', focusedCardId, focusedCardTitle
         - Set timeRemaining = workDuration * 60
         - Set isPaused=false
         - Clear any existing intervalId, then start new setInterval calling `tick()` every 1000ms
         - Store the intervalId in state

      3. `startBreak()`:
         - Set mode='break', timeRemaining = breakDuration * 60, isPaused=false
         - Start interval (same pattern as startFocus)

      4. `pause()`: Set isPaused=true, clear interval
      5. `resume()`: Set isPaused=false, restart interval

      6. `stop()`:
         - Clear interval, reset to mode='idle', timeRemaining=0, isPaused=false
         - Do NOT clear focusedCardId/focusedCardTitle (needed for completion modal)
         - Do NOT increment sessionCount (only incremented on natural timer end)

      7. `tick()`:
         - Decrement timeRemaining by 1
         - If timeRemaining reaches 0:
           - Clear interval
           - If mode was 'focus':
             - Increment sessionCount
             - Send desktop notification: `window.electronAPI.notificationShow('Focus Complete', 'Great work! Time for a break.')`
             - Set mode to 'completed' (temporary state for the completion modal)
               ACTUALLY: add 'completed' to the mode union: `'idle' | 'focus' | 'break' | 'completed'`
               The 'completed' mode signals the UI to show the completion prompt.
           - If mode was 'break':
             - Send notification: `window.electronAPI.notificationShow('Break Over', 'Ready to focus again?')`
             - Set mode to 'idle'

      8. `setDurations(work, breakMins)`:
         - Update workDuration and breakDuration in state
         - Persist via settings: `window.electronAPI.setSetting('pomodoro.workDuration', String(work))`
         - Persist: `window.electronAPI.setSetting('pomodoro.breakDuration', String(breakMins))`

      9. `loadSettings()`:
         - Read from settings: `window.electronAPI.getSetting('pomodoro.workDuration')`
         - Read: `window.electronAPI.getSetting('pomodoro.breakDuration')`
         - Parse as numbers (default 25 and 5 if not set), update state

      10. Export `useFocusStore` (named export for consistency with other stores).

      ## notifications:show IPC

      11. Add handler in src/main/ipc/notifications.ts:
          ```ts
          ipcMain.handle('notifications:show', async (_event, title: string, body: string) => {
            showNotification(title, body);
          });
          ```
          Import `showNotification` from the notificationService (already imported via sendTestNotification's module).

      12. Add to preload bridge (src/preload/domains/notifications.ts):
          ```ts
          notificationShow: (title: string, body: string) =>
            ipcRenderer.invoke('notifications:show', title, body),
          ```

      13. Add to ElectronAPI interface (src/shared/types/electron-api.ts):
          ```ts
          notificationShow: (title: string, body: string) => Promise<void>;
          ```

      ## Keyboard Shortcut

      14. Add `onToggleFocusMode` callback parameter to `useKeyboardShortcuts`:
          - New param: `onToggleFocusMode?: () => void`
          - In handleKeyDown: detect Ctrl+Shift+F (e.ctrlKey && e.shiftKey && e.key === 'F')
          - IMPORTANT: Check for e.shiftKey to avoid conflicting with Ctrl+F (browser find).
            When Shift is held, e.key is uppercase 'F'.
          - Call `onToggleFocusMode()` and preventDefault

      15. Add to KeyboardShortcutsModal SHORTCUT_GROUPS:
          - In the "Actions" group, add: `{ keys: 'Ctrl+Shift+F', description: 'Focus Mode' }`

      16. In App.tsx AppShell:
          - Add `showFocusStart` state (boolean, default false)
          - Add `toggleFocusStart` callback: if focus mode is idle, toggle showFocusStart;
            if focus mode is active, call `useFocusStore.getState().stop()`
          - Pass `toggleFocusStart` as `onToggleFocusMode` to `useKeyboardShortcuts`
          - Initialize focus store settings: call `useFocusStore.getState().loadSettings()` in
            the existing Promise.allSettled (add it alongside the other store loads)
          - Export/expose `showFocusStart` and its setter — will be consumed by Task 2's
            FocusStartModal. For now, just add the state. The modal rendering comes in Task 2.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx vitest run` — all 150 tests pass (no existing tests broken)
      3. Verify focusStore.ts exports useFocusStore with all documented actions
      4. Verify notifications:show IPC handler registered in notifications.ts
      5. Verify notificationShow in preload bridge and ElectronAPI type
      6. Verify useKeyboardShortcuts accepts onToggleFocusMode parameter
      7. Verify KeyboardShortcutsModal lists Ctrl+Shift+F under Actions
    </verify>
    <done>
      focusStore.ts created with full timer engine (start/pause/resume/stop/tick).
      notifications:show IPC handler wired (main + preload + types).
      Ctrl+Shift+F registered in keyboard shortcuts hook + visible in shortcuts modal.
      AppShell has showFocusStart state and toggleFocusStart callback.
      Settings persistence for work/break durations working via existing settings IPC.
      tsc clean, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - setInterval in renderer process is reliable for 1-second ticks (standard pattern)
      - Electron Notification API works from main process (already proven by test notification)
      - Ctrl+Shift+F doesn't conflict with any existing shortcuts (verified: not in SHORTCUT_MAP)
      - Settings key-value store works for pomodoro.* keys (same pattern as ai.* keys)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Focus Mode UI — StatusBar timer, FocusStartModal, sidebar toggle</n>
    <files>
      src/renderer/components/StatusBar.tsx
      src/renderer/components/FocusStartModal.tsx (new)
      src/renderer/components/SidebarModern.tsx
      src/renderer/components/AppLayout.tsx
      src/renderer/App.tsx (AppShell — add modal rendering)
    </files>
    <action>
      **WHY:** Users need visual feedback for the timer, a way to start focus sessions (pick a card
      and duration), and the distraction-reducing sidebar collapse. This task builds all the
      interactive UI on top of the store from Task 1.

      ## StatusBar Timer Display

      1. In StatusBar.tsx, import `useFocusStore` from the focus store.
         Read: `mode`, `timeRemaining`, `isPaused`, `focusedCardTitle`.

      2. Add timer section between the pending actions badge and the "Ctrl+K" hint:
         - Only visible when mode is 'focus', 'break', or 'completed'
         - Layout: `[icon] [card name truncated] [MM:SS] [pause/resume btn] [stop btn]`
         - Format timeRemaining: `Math.floor(s/60).toString().padStart(2,'0') + ':' + (s%60).toString().padStart(2,'0')`
         - During focus: emerald accent (text-emerald-400), Timer icon (lucide-react)
         - During break: amber accent (text-amber-400), Coffee icon (lucide-react)
         - Card name: max-w-[120px] truncate, text-surface-300
         - Pause button: Pause icon when running, Play icon when paused (toggle)
           - onClick: `isPaused ? useFocusStore.getState().resume() : useFocusStore.getState().pause()`
         - Stop button: Square icon, text-surface-500 hover:text-red-400
           - onClick: `useFocusStore.getState().stop()`
         - All controls are tiny (w-3.5 h-3.5 icons) to fit in h-6 bar

      3. Make the timer section clickable (the card name part):
         - Title tooltip: "Click to open focus card" or the full card title if truncated
         - This is informational only — no navigation (card could be on any board page)

      ## FocusStartModal (src/renderer/components/FocusStartModal.tsx)

      4. Create a new modal component following the KeyboardShortcutsModal pattern:
         - Props: `isOpen: boolean, onClose: () => void`
         - Escape key closes it (same pattern as other modals)
         - Backdrop: `fixed inset-0 z-50 bg-black/50`
         - Content: centered card, max-w-md, bg-surface-900 rounded-xl

      5. Modal content:
         ```
         ┌──────────────────────────────────────────────┐
         │ 🎯 Start Focus Session                   [X] │
         ├──────────────────────────────────────────────┤
         │                                              │
         │ Focus on (optional):                         │
         │ [Search cards...                         🔍] │
         │  ┌─ Card 1 title (Project A)              ─┐ │
         │  │  Card 2 title (Project B)               │ │
         │  └─ Card 3 title (Project C)              ─┘ │
         │                                              │
         │ Duration:                                    │
         │ [25m] [30m] [45m] [60m] [Custom: ___]       │
         │                                              │
         │         [ Start Focus ]                      │
         └──────────────────────────────────────────────┘
         ```

      6. Card search implementation:
         - Read `useBoardStore(s => s.allCards)` for the card list
         - Text input with search icon, filters allCards by title (case-insensitive includes)
         - Show max 5 results in a dropdown list below the input
         - Each result: card title + project name (from projectStore lookup or embedded)
         - Clicking a card selects it (shown as a chip below the input with X to deselect)
         - Card selection is OPTIONAL — user can start a generic focus session without a card
         - Filter out archived cards from the list

      7. Duration presets:
         - 4 pill buttons: 25, 30, 45, 60 minutes
         - Default selected: the store's workDuration value
         - "Custom" option: small number input (min 1, max 120)
         - Selected duration highlighted with primary color ring

      8. "Start Focus" button:
         - Primary button style (bg-primary-600 hover:bg-primary-700)
         - On click:
           a. If custom duration differs from stored workDuration, update via setDurations
           b. Call `useFocusStore.getState().startFocus(selectedCardId, selectedCardTitle)`
           c. Call onClose() to dismiss the modal
           d. Show toast: `toast({ type: 'success', message: 'Focus mode started — 25 min' })`

      ## Sidebar Toggle

      9. In SidebarModern.tsx, add a Focus Mode button in the bottom section (above theme toggle):
         - Import `useFocusStore` and read `mode`
         - Import `Timer` icon from lucide-react
         - Show the button always (it opens the start modal OR indicates active focus)
         - When mode === 'idle': `Timer` icon, text-surface-400, tooltip "Focus Mode (Ctrl+Shift+F)"
           onClick dispatches to AppShell's toggleFocusStart via a callback prop or by reading
           a shared trigger. SIMPLEST APPROACH: import and use a tiny event emitter, OR just
           have the button call `document.dispatchEvent(new CustomEvent('toggle-focus-mode'))`
           and have AppShell listen for it. BUT CLEANER: just make the sidebar button trigger
           the same keyboard shortcut effect. Actually, simplest: have SidebarModern accept an
           optional `onToggleFocus` prop passed from AppLayout.
           REVISED: Use the focusStore itself — add an `openStartModal` boolean + `setOpenStartModal`
           action to focusStore. Sidebar and keyboard shortcut both set this flag. AppShell reads
           it to show/hide FocusStartModal. This avoids prop drilling.

      10. Update focusStore (from Task 1) to include:
          - `showStartModal: boolean` (default false)
          - `setShowStartModal: (show: boolean) => void`
          - Modify Task 1's AppShell integration: instead of local `showFocusStart` state,
            read `useFocusStore(s => s.showStartModal)` and use `setShowStartModal` to toggle.

      11. When mode !== 'idle': the sidebar Timer button shows with emerald pulse animation
          (animate-pulse, text-emerald-400) to indicate active focus session.
          Click during active session → calls stop() (same as Ctrl+Shift+F during active).

      12. In AppLayout.tsx, conditionally hide the sidebar during active focus mode:
          - Import `useFocusStore`
          - Read `mode` from store
          - When mode is 'focus' or 'break': don't render `<Sidebar />`
          - The main content will expand to fill the full width automatically (flex-1)
          - Add a small "Show sidebar" hover zone on the left edge (w-2 h-full, transparent,
            shows sidebar on hover). ACTUALLY, skip the hover zone for simplicity — user can
            stop focus mode to get sidebar back. The StatusBar has stop controls.

      ## AppShell Modal Wiring

      13. In App.tsx AppShell, render FocusStartModal:
          - Import FocusStartModal (lazy-loaded like other modals)
          - Read `showStartModal` from focusStore
          - Render: `<FocusStartModal isOpen={showStartModal} onClose={() => useFocusStore.getState().setShowStartModal(false)} />`
          - Update the keyboard shortcut toggle to use focusStore's setShowStartModal instead
            of local state (from Task 1 integration).
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx vitest run` — all tests pass
      3. Manual: Press Ctrl+Shift+F → FocusStartModal opens
      4. Manual: Search for a card → select it → choose 25m → Start Focus
      5. Manual: StatusBar shows emerald timer with card name, MM:SS countdown, pause/stop buttons
      6. Manual: Sidebar collapses during focus mode, main content expands
      7. Manual: Pause button works (timer stops, resumes on unpause)
      8. Manual: Stop button returns to idle, sidebar reappears
      9. Manual: Timer counts down to 0 → desktop notification appears
      10. Manual: Sidebar Timer icon visible, clickable, pulses during active session
      11. Manual: Start focus WITHOUT selecting a card → generic timer works
    </verify>
    <done>
      StatusBar displays live timer with card name, controls (pause/resume/stop), color-coded
      by mode (emerald=focus, amber=break).
      FocusStartModal provides card search/selection + duration presets + start button.
      Sidebar hides during focus mode. Sidebar has Timer icon button.
      Ctrl+Shift+F opens modal (idle) or stops session (active).
      Desktop notification fires on timer completion.
      tsc clean, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - lucide-react has Timer, Pause, Play, Square, Coffee icons (all standard, verified)
      - allCards from boardStore is loaded eagerly in AppShell (existing pattern)
      - Hiding sidebar via conditional render won't cause layout shift (flex-1 handles it)
      - Card search across allCards is fast enough without debounce (typically < 500 items)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Session completion flow — card comment logging + break cycle + polish</n>
    <files>
      src/renderer/components/FocusCompleteModal.tsx (new)
      src/renderer/App.tsx (AppShell — render completion modal)
      src/renderer/stores/focusStore.ts (update: handle 'completed' mode transition)
    </files>
    <action>
      **WHY:** The most valuable part of focus mode is the feedback loop: completing a session
      prompts reflection, which gets logged as a card comment. This turns focus sessions into
      persistent data attached to cards. The break cycle keeps the Pomodoro rhythm going.

      ## FocusCompleteModal (src/renderer/components/FocusCompleteModal.tsx)

      1. Create a modal that appears when focusStore mode === 'completed':
         - Same modal pattern as FocusStartModal (backdrop, centered card, Escape to close)
         - Content:
         ```
         ┌──────────────────────────────────────────────┐
         │ ✅ Focus Session Complete!                    │
         ├──────────────────────────────────────────────┤
         │                                              │
         │ You focused for 25 minutes                   │
         │ on "Card Title Here"                         │
         │                                              │
         │ What did you accomplish?                      │
         │ ┌──────────────────────────────────────────┐ │
         │ │ (textarea, 3 rows)                       │ │
         │ └──────────────────────────────────────────┘ │
         │                                              │
         │ Session #3 today                             │
         │                                              │
         │   [ Skip ]          [ Save & Start Break ]   │
         └──────────────────────────────────────────────┘
         ```

      2. Show the completed session details:
         - Duration: the store's workDuration (what was configured when session started)
         - Card title: focusedCardTitle from store (or "General focus" if no card)
         - Session count: sessionCount from store

      3. Textarea for accomplishment notes:
         - Placeholder: "What did you accomplish during this session?"
         - Auto-focuses when modal opens
         - Not required — can be left empty

      4. "Save & Start Break" button (primary):
         - If textarea has content AND focusedCardId is set:
           - Call `window.electronAPI.addCardComment({ cardId: focusedCardId, content })` where
             content is formatted as:
             `🍅 Focus session completed (${workDuration} min)\n\n${userNote}`
           - If textarea is empty but card exists, still log a minimal comment:
             `🍅 Focus session completed (${workDuration} min)`
         - If no card was selected, skip the comment (nothing to attach to)
         - Then call `useFocusStore.getState().startBreak()`
         - Show toast: `toast({ type: 'info', message: 'Break time — ${breakDuration} min' })`
         - Close the modal

      5. "Skip" button (secondary, text style):
         - Skips logging, does NOT start break
         - Sets mode to 'idle' via `useFocusStore.getState().stop()`
         - Clears focusedCardId/focusedCardTitle
         - Close the modal

      6. Add a "Save & Done" variant: if user doesn't want a break:
         - Actually, keep it simple. Two buttons: "Skip" (idle, no log) and "Save & Break" (log + break).
         - If user wants to skip the break, they can stop it from the StatusBar.

      ## Break Cycle

      7. When break timer ends (handled in focusStore.tick from Task 1):
         - mode is set to 'idle'
         - Desktop notification: "Break Over — Ready to focus again?"
         - Toast: `toast({ type: 'info', message: 'Break complete! Ready for another session?' })`
         - User can start a new session via Ctrl+Shift+F or sidebar button

      8. In StatusBar during break mode:
         - Already handled by Task 2 (amber color, Coffee icon)
         - The break timer counts down just like focus timer
         - Stop button during break → immediate return to idle

      ## AppShell Integration

      9. In App.tsx AppShell:
         - Import FocusCompleteModal (lazy)
         - Read `mode` from focusStore
         - Render FocusCompleteModal when mode === 'completed':
           `<FocusCompleteModal isOpen={mode === 'completed'} onClose={() => useFocusStore.getState().stop()} />`
         - The onClose (backdrop click or Escape) acts as "Skip" — returns to idle

      ## focusStore Updates

      10. Ensure 'completed' → 'break' transition works:
          - When FocusCompleteModal calls startBreak(), it should work from 'completed' mode
          - startBreak should clear the 'completed' state and begin break timer

      11. Add `clearFocusedCard()` action:
          - Sets focusedCardId and focusedCardTitle to null
          - Called by FocusCompleteModal's "Skip" after stopping

      12. Add toast import to focusStore for break-end notification:
          - Import `toast` from useToast hook
          - Call `toast({ type: 'info', message: 'Break complete! Ready for another session?' })`
            at end of break timer
          - ALTERNATIVELY: handle the toast in FocusCompleteModal or a useEffect in AppShell
            that watches for mode transitions. The cleanest approach: add a `useEffect` in
            AppShell that watches `mode` and shows toast when it transitions from 'break' to 'idle'.

      ## Polish

      13. Audio feedback (optional, skip if complex): Browser Audio API can play a short tone
          on timer end. Skip this for now — desktop notification is sufficient.

      14. Ensure the focus timer survives page navigation:
          - Since focusStore is a Zustand global store and the interval runs in the store,
            navigating between pages won't affect it. Verify this works.
          - StatusBar is rendered outside Routes (in App component), so it always shows.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx vitest run` — all tests pass
      3. Manual: Start focus on a card → wait for timer (or set to 1 min for testing) →
         FocusCompleteModal appears with textarea
      4. Manual: Type accomplishment note → "Save & Start Break" → card comment created →
         break timer starts in StatusBar (amber)
      5. Manual: Break timer ends → notification → toast → mode returns to idle → sidebar reappears
      6. Manual: "Skip" button → no comment logged → mode returns to idle
      7. Manual: Start focus WITHOUT card → completion modal skips card comment → break still works
      8. Manual: Navigate between pages during focus → timer continues uninterrupted in StatusBar
      9. Manual: Session counter increments correctly across multiple sessions
    </verify>
    <done>
      FocusCompleteModal prompts "What did you accomplish?" on session end.
      Accomplishment note logged as card comment with Pomodoro emoji prefix.
      Break timer auto-starts after saving, with amber StatusBar display.
      Break end triggers notification + toast + return to idle.
      Full Pomodoro cycle works: focus → complete → break → idle → repeat.
      Timer persists across page navigation.
      tsc clean, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - addCardComment IPC can be called directly from modal (doesn't require cardDetailStore loading)
        VERIFY: check if addCardComment works standalone or needs selectedCard context.
        If cardDetailStore is needed, call its addComment action instead.
      - 'completed' as a temporary mode state works without race conditions
        (user interaction required to transition out of 'completed')
      - Toast import pattern: `import { toast } from '../hooks/useToast'` (verified in other files)
    </assumptions>
  </task>
</phase>
