<phase n="15.2" name="Last Visit Context, Shortcut Tooltips, Undo Delete">
  <context>
    Plan 15.2 completes the final 3 proposals from SELF-IMPROVE-2.md:
    - E10: "Since last visit" context on dashboard
    - Q11: Keyboard shortcut tooltips on sidebar/buttons
    - Q12: Soft-delete safety net (scoped as undo-based deletion via toast)

    Q12 was originally estimated at 1 week for a full deletedAt column + trash bin approach.
    That requires touching 18+ card query sites across the backend. Instead, we implement
    the same "wow moment" (recovering from accidental deletion) using a delayed-delete +
    undo toast pattern — zero backend changes, zero schema changes, all frontend.

    @PROJECT.md @STATE.md @SELF-IMPROVE-2.md
    @src/renderer/pages/DashboardPage.tsx
    @src/renderer/components/Sidebar.tsx
    @src/renderer/hooks/useKeyboardShortcuts.ts
    @src/renderer/components/KeyboardShortcutsModal.tsx
    @src/renderer/hooks/useToast.ts
    @src/renderer/components/ToastContainer.tsx
    @src/renderer/components/CardDetailModal.tsx
    @src/renderer/stores/boardStore.ts
  </context>

  <task type="auto" n="1">
    <n>"Since last visit" context on dashboard</n>
    <files>
      src/renderer/pages/DashboardPage.tsx
    </files>
    <action>
      Track when the user last visited the dashboard. On return visits, show a brief
      summary line below the greeting: "Since your last visit: 2 new meetings, 1 new idea".
      This makes the dashboard feel alive and responsive.

      **A. Track last visit timestamp in localStorage**

      1. On DashboardPage mount, read `localStorage.getItem('dashboard_last_visit')`.
         Store the result in a ref (not state — we don't want re-renders).

      2. After reading, immediately set the current timestamp:
         `localStorage.setItem('dashboard_last_visit', new Date().toISOString())`

      **B. Compute "since last visit" counts**

      3. Using the previous visit timestamp, compute counts of entities created since:
         ```tsx
         const sinceLastVisit = useMemo(() => {
           if (!lastVisitRef.current) return null;
           const since = new Date(lastVisitRef.current).getTime();
           const newMeetings = meetings.filter(m => new Date(m.createdAt).getTime() > since).length;
           const newIdeas = ideas.filter(i => new Date(i.createdAt).getTime() > since).length;
           return { newMeetings, newIdeas };
         }, [meetings, ideas]);
         ```

         Use a `useRef` for the last visit timestamp, read it in a `useEffect` that runs once
         on mount BEFORE the useMemo computes. Actually, since the ref value is set before
         the first render computation, use `useState` with a lazy initializer instead:
         ```tsx
         const [lastVisit] = useState(() => {
           const saved = localStorage.getItem('dashboard_last_visit');
           // Update timestamp for next visit
           localStorage.setItem('dashboard_last_visit', new Date().toISOString());
           return saved;
         });
         ```

         Then the useMemo can read `lastVisit` from state (set once, never changes).

      4. Only count meetings and ideas — not projects or cards, since those are often created
         programmatically (action item conversion, AI planning, etc.).

      **C. Render the summary line**

      5. Below the greeting, after the `formatToday()` paragraph, conditionally render:
         ```tsx
         {sinceLastVisit && (sinceLastVisit.newMeetings > 0 || sinceLastVisit.newIdeas > 0) && (
           <p className="mt-1 text-sm text-primary-400/80">
             Since your last visit:
             {sinceLastVisit.newMeetings > 0 && ` ${sinceLastVisit.newMeetings} new meeting${sinceLastVisit.newMeetings !== 1 ? 's' : ''}`}
             {sinceLastVisit.newMeetings > 0 && sinceLastVisit.newIdeas > 0 && ','}
             {sinceLastVisit.newIdeas > 0 && ` ${sinceLastVisit.newIdeas} new idea${sinceLastVisit.newIdeas !== 1 ? 's' : ''}`}
           </p>
         )}
         ```

      6. On first-ever visit (no localStorage entry), show nothing (null from useState).

      WHY this approach: localStorage is persistent across sessions, requires no backend changes,
      and is the standard pattern for tracking client-side timestamps. The lazy useState initializer
      ensures we capture the previous timestamp before overwriting it.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: first visit to dashboard → no "Since" line shown
      4. Manual: navigate away, create a meeting or idea, return to dashboard →
         "Since your last visit: 1 new meeting" appears in primary color
      5. Manual: close and reopen app → counter reflects activity since last dashboard visit
    </verify>
    <done>
      Dashboard shows "Since your last visit" summary with new meetings/ideas counts.
      First visit shows nothing. Timestamp persists across sessions via localStorage.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - localStorage is available in Electron renderer (standard web API)
      - meetings and ideas arrays are already loaded by the time DashboardPage renders
        (App.tsx pre-loads them in useEffect on mount)
      - Only counting meetings + ideas (not cards/projects which are often auto-created)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Keyboard shortcut hints in sidebar and shortcut modal updates</n>
    <files>
      src/renderer/components/Sidebar.tsx
      src/renderer/components/KeyboardShortcutsModal.tsx
    </files>
    <action>
      Add keyboard shortcut hints to sidebar navigation items and update the shortcuts
      modal with page-specific shortcuts that were added in recent phases.

      **A. Sidebar shortcut hints (Sidebar.tsx)**

      1. Read `src/renderer/components/Sidebar.tsx`. The navItems array maps paths to labels
         and icons. The NavLink elements have `title={label}`.

      2. Create a shortcut map:
         ```tsx
         const SHORTCUT_KEYS: Record<string, string> = {
           '/': 'Ctrl+1',
           '/projects': 'Ctrl+2',
           '/meetings': 'Ctrl+3',
           '/ideas': 'Ctrl+4',
           '/brainstorm': 'Ctrl+5',
           '/settings': 'Ctrl+6',
         };
         ```

      3. Update the NavLink `title` to include the shortcut:
         ```tsx
         title={`${label}  (${SHORTCUT_KEYS[path] || ''})`}
         ```
         This provides progressive discovery — users hovering over sidebar icons see the
         shortcut key in the native browser tooltip, without any new UI components needed.

      **B. Update KeyboardShortcutsModal with page-specific shortcuts (KeyboardShortcutsModal.tsx)**

      4. Read `src/renderer/components/KeyboardShortcutsModal.tsx`. It has two groups:
         Navigation (Ctrl+1-6) and Actions (Ctrl+K, Ctrl+Shift+Space, Ctrl+?, Esc).

      5. Add a third group for page-specific shortcuts that were added in recent phases:
         ```tsx
         {
           label: 'Page Shortcuts',
           shortcuts: [
             { keys: '/', description: 'Focus board search (on Board page)' },
             { keys: 'Ctrl+N', description: 'New brainstorm session (on Brainstorm page)' },
             { keys: 'Esc', description: 'Close filters / blur search (on Board page)' },
           ],
         },
         ```

      WHY: These shortcuts were added in Plans 13.1-13.2 but never documented in the
      keyboard shortcuts modal. Users discover them by accident or not at all.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: hover any sidebar icon → tooltip shows "Home (Ctrl+1)", "Projects (Ctrl+2)", etc.
      4. Manual: open Ctrl+? shortcuts modal → new "Page Shortcuts" group shows /, Ctrl+N, Esc
    </verify>
    <done>
      Sidebar items show shortcut keys in tooltip on hover.
      Keyboard shortcuts modal includes page-specific shortcuts from recent phases.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Native title attribute tooltip is sufficient for shortcut discovery (no custom tooltip component)
      - The 3 page-specific shortcuts (/, Ctrl+N, Esc on board) are the only ones added recently
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Undo card deletion via delayed delete and toast undo button</n>
    <files>
      src/renderer/hooks/useToast.ts
      src/renderer/components/ToastContainer.tsx
      src/renderer/components/CardDetailModal.tsx
      src/renderer/stores/boardStore.ts
    </files>
    <action>
      Replace the harsh window.confirm + permanent delete pattern for cards with a smooth
      undo-based flow: remove card from UI immediately, show a toast with "Undo" button,
      actually delete after 5 seconds. If undo is clicked, the card reappears.

      This delivers the "I can undo that!" wow moment from Q12 without any schema changes,
      migration, or backend modifications. Zero backend changes — all frontend.

      **A. Extend Toast type to support actions (useToast.ts)**

      1. Read `src/renderer/hooks/useToast.ts`. Current Toast interface:
         ```ts
         interface Toast { id: string; message: string; type: 'success' | 'error' | 'info'; }
         ```

      2. Add an optional action:
         ```ts
         export interface Toast {
           id: string;
           message: string;
           type: 'success' | 'error' | 'info';
           action?: { label: string; onClick: () => void };
         }
         ```

      3. Update the `addToast` signature and `toast()` convenience function:
         ```ts
         addToast: (message: string, type?: Toast['type'], action?: Toast['action']) => void;
         ```
         ```ts
         export function toast(message: string, type?: Toast['type'], action?: Toast['action']) {
           useToastStore.getState().addToast(message, type, action);
         }
         ```

      **B. Render action button in ToastContainer (ToastContainer.tsx)**

      4. Read `src/renderer/components/ToastContainer.tsx`.

      5. After the message text span, before the X close button, add:
         ```tsx
         {t.action && (
           <button
             onClick={() => { t.action!.onClick(); removeToast(t.id); }}
             className="text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors shrink-0"
           >
             {t.action.label}
           </button>
         )}
         ```

      **C. Implement undo card deletion (CardDetailModal.tsx + boardStore.ts)**

      6. Read `src/renderer/components/CardDetailModal.tsx`. Find the delete handler —
         it likely uses `window.confirm()` then calls `deleteCard(id)`.

      7. Read `src/renderer/stores/boardStore.ts`. Find the `deleteCard` action.

      8. In boardStore.ts, add a new action `removeCardFromUI`:
         ```ts
         removeCardFromUI: (cardId: string) => {
           set({
             allCards: get().allCards.filter(c => c.id !== cardId),
             columnCards: get().columnCards.filter(c => c.id !== cardId),
           });
         },
         ```
         Also add `restoreCardToUI`:
         ```ts
         restoreCardToUI: (card: Card) => {
           set({
             allCards: [...get().allCards, card],
             columnCards: [...get().columnCards, card],
           });
         },
         ```
         These are purely UI-side operations — no IPC calls.

      9. In CardDetailModal.tsx, replace the delete handler:
         ```tsx
         const handleDelete = () => {
           // Snapshot the card before removing from UI
           const cardSnapshot = { ...card };
           const cardId = card.id;

           // Remove from UI immediately (optimistic)
           removeCardFromUI(cardId);
           onClose(); // Close the detail modal

           // Schedule actual deletion after 5 seconds
           let cancelled = false;
           const timer = setTimeout(() => {
             if (!cancelled) {
               deleteCard(cardId); // Actually call IPC to delete
             }
           }, 5000);

           // Show toast with undo button
           toast('Card deleted', 'info', {
             label: 'Undo',
             onClick: () => {
               cancelled = true;
               clearTimeout(timer);
               restoreCardToUI(cardSnapshot);
             },
           });
         };
         ```

         Import `toast` from `../hooks/useToast`.
         Import `removeCardFromUI` and `restoreCardToUI` from boardStore.

      10. Remove the `window.confirm()` guard — the undo toast IS the safety net.

      WHY this approach over soft-delete:
      - Zero backend changes (no migration, no schema change, no query filter modifications)
      - Zero risk to existing 18+ card query sites
      - Same UX outcome: user can recover from accidental deletion
      - 5-second window is generous enough for "oh no" moments
      - After 5 seconds, deletion is permanent (matching current behavior)
      - The toast undo pattern is well-established (Gmail, Google Docs, Slack)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: open a card → click Delete → no confirm dialog appears
      4. Manual: card disappears from board, modal closes, toast appears: "Card deleted [Undo]"
      5. Manual: click Undo within 5 seconds → card reappears in its column
      6. Manual: wait 5 seconds without clicking Undo → card is permanently deleted
      7. Manual: toast auto-dismisses after 3 seconds (but deletion waits 5 seconds)
      8. Manual: verify toasts with actions render correctly (message + Undo button + X)
    </verify>
    <done>
      Cards can be recovered from accidental deletion via toast undo button.
      Toast system extended with action buttons. No backend or schema changes.
      5-second undo window before permanent deletion.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - CardDetailModal handles card deletion (need to verify the exact handler location)
      - boardStore has `allCards` and `columnCards` arrays that can be filtered/restored
      - The 5s delay between UI removal and actual IPC deletion is acceptable
      - Toast auto-dismiss (3s) is shorter than delete delay (5s) — the undo action fires
        before actual deletion even if toast has visually disappeared. Need to extend toast
        duration to 5s for undo toasts, or accept that undo is available even after toast
        fades. IMPORTANT: For undo toasts, use a longer auto-dismiss (5s instead of 3s).
      - Timer cleanup: if user navigates away, the setTimeout still fires — this is fine,
        the deletion should still happen after 5 seconds regardless
    </assumptions>
  </task>
</phase>
