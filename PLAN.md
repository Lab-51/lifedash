<phase n="13.2" name="Board UX, Brainstorm Polish, CSV Export">
  <context>
    Plan 13.2 addresses 10 remaining proposals from SELF-IMPROVE-2.md, covering board UX
    quick wins, brainstorm streaming/UX improvements, CSV board export, and meeting card polish.

    All items are LOW-to-MEDIUM effort (under 2 hours each) and HIGH-to-MEDIUM impact.
    Plan 13.1 addressed the top 5 "Do First" items; this plan covers the next tier.

    Proposals addressed:
    - Q1: Strip HTML from command palette card descriptions
    - F5: Board empty filter state message
    - Q3: `/` keyboard shortcut to focus board search
    - Q4: Escape key closes filter dropdowns
    - Q5: Card description 1-line preview on KanbanCard
    - F4: Markdown during brainstorm streaming
    - E5: Auto-select last active brainstorm session
    - F9: Brainstorm input auto-resize
    - Q6: Export board as CSV
    - Q7: Project color dot on meeting cards

    @PROJECT.md @STATE.md @SELF-IMPROVE-2.md
    @src/renderer/components/CommandPalette.tsx
    @src/renderer/pages/BoardPage.tsx
    @src/renderer/components/KanbanCard.tsx
    @src/renderer/pages/BrainstormPage.tsx
    @src/renderer/components/ChatMessage.tsx
    @src/renderer/components/MeetingCard.tsx
    @src/renderer/pages/MeetingsPage.tsx
    @src/renderer/stores/boardStore.ts
  </context>

  <task type="auto" n="1">
    <n>Board UX quick wins and command palette HTML fix</n>
    <files>
      src/renderer/components/CommandPalette.tsx
      src/renderer/pages/BoardPage.tsx
      src/renderer/components/KanbanCard.tsx
    </files>
    <action>
      Five quick improvements to the board and command palette:

      **A. Strip HTML tags from command palette card descriptions (CommandPalette.tsx)**

      1. Line 91: Card descriptions from TipTap contain HTML tags (`&lt;p&gt;`, `&lt;strong&gt;`, etc.)
         that show raw in the command palette sublabel. Add a `stripHtml` helper at the top:
         ```
         function stripHtml(html: string): string {
           return html.replace(/&lt;[^&gt;]*&gt;/g, '').trim();
         }
         ```
      2. Apply it where the sublabel is set (line 91):
         `sublabel: c.description ? stripHtml(c.description) : undefined`

      **B. Board empty filter state message (BoardPage.tsx)**

      3. When `hasActiveFilters &amp;&amp; filteredCards.length === 0`, show a centered message
         ABOVE the column grid (around line 462, before the columns container):
         ```tsx
         {hasActiveFilters &amp;&amp; filteredCards.length === 0 &amp;&amp; (
           &lt;div className="text-center py-12"&gt;
             &lt;p className="text-surface-400 text-sm"&gt;No cards match your filters.&lt;/p&gt;
             &lt;button onClick={clearFilters} className="text-xs text-primary-400 hover:text-primary-300 mt-2"&gt;
               Clear filters
             &lt;/button&gt;
           &lt;/div&gt;
         )}
         ```

      **C. `/` keyboard shortcut to focus board search (BoardPage.tsx)**

      4. Add a ref to the search input: `const searchInputRef = useRef&lt;HTMLInputElement&gt;(null);`
         Attach it to the search `&lt;input&gt;` at line 341.

      5. Add a `useEffect` with a global keydown listener:
         ```tsx
         useEffect(() =&gt; {
           const handleGlobalKeyDown = (e: KeyboardEvent) =&gt; {
             if (e.key === '/' &amp;&amp; !e.ctrlKey &amp;&amp; !e.metaKey &amp;&amp; !e.altKey) {
               const tag = (e.target as HTMLElement).tagName;
               if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
               e.preventDefault();
               searchInputRef.current?.focus();
             }
           };
           document.addEventListener('keydown', handleGlobalKeyDown);
           return () =&gt; document.removeEventListener('keydown', handleGlobalKeyDown);
         }, []);
         ```
         This matches GitHub/Gmail convention. Guards against triggering inside inputs.

      **D. Escape key closes filter dropdowns (BoardPage.tsx)**

      6. The priority and label dropdowns use state: `showPriorityFilter` and `showLabelFilter`
         (check exact state names). Add to the same global keydown handler from step 5:
         ```
         if (e.key === 'Escape') {
           setShowPriorityFilter(false);
           setShowLabelFilter(false);
           searchInputRef.current?.blur();
         }
         ```
         Or if the dropdowns use different state names, find them first.

      **E. Card description 1-line preview on KanbanCard (KanbanCard.tsx)**

      7. After the title element (around line 191, after the `&lt;/p&gt;` for card.title), add a
         1-line description preview when a description exists:
         ```tsx
         {card.description &amp;&amp; !isEditing &amp;&amp; (
           &lt;p className="text-xs text-surface-500 line-clamp-1 mt-0.5"&gt;
             {card.description.replace(/&lt;[^&gt;]*&gt;/g, '').trim()}
           &lt;/p&gt;
         )}
         ```
         Same `stripHtml` approach. `line-clamp-1` limits to one line. `text-xs text-surface-500`
         for subtle appearance. Only show when not in title-editing mode.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: open command palette (Ctrl+K) → search for a card with rich text →
         description shows plain text (no HTML tags)
      4. Manual: on board, apply a filter that matches 0 cards →
         "No cards match your filters. [Clear filters]" message appears
      5. Manual: on board, press `/` → search input focuses
      6. Manual: `/` does NOT fire when typing in a text input
      7. Manual: open priority or label dropdown → press Escape → dropdown closes
      8. Manual: cards with descriptions show a subtle 1-line preview below the title
      9. Manual: cards without descriptions show no extra line
    </verify>
    <done>
      Command palette strips HTML from card descriptions. Board shows empty filter message
      with clear button. `/` focuses search. Escape closes dropdowns. Cards show 1-line
      description preview.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Card descriptions stored as TipTap HTML (confirmed: rich text editor saves HTML)
      - BoardPage has showPriorityFilter/showLabelFilter state (confirmed via explore)
      - KanbanCard title ends around line 191 (confirmed via explore)
      - Simple regex HTML strip is sufficient (no nested or escaped tags in TipTap output)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Brainstorm streaming markdown, auto-select session, textarea resize</n>
    <files>
      src/renderer/pages/BrainstormPage.tsx
    </files>
    <action>
      Three brainstorm UX improvements:

      **A. Markdown rendering during streaming (BrainstormPage.tsx)**

      1. Line 443 renders streaming text with `whitespace-pre-wrap`, showing raw text.
         Completed messages (in ChatMessage.tsx) already use ReactMarkdown + remark-gfm.
         Replace the streaming text div (line 443) with ReactMarkdown:
         ```tsx
         &lt;div className="text-sm text-surface-200"&gt;
           &lt;ReactMarkdown remarkPlugins={[remarkGfm]}&gt;
             {streamingText}
           &lt;/ReactMarkdown&gt;
           &lt;span className="animate-pulse text-primary-400"&gt;|&lt;/span&gt;
         &lt;/div&gt;
         ```
         Import `ReactMarkdown` from 'react-markdown' and `remarkGfm` from 'remark-gfm'
         at the top of BrainstormPage.tsx (they're already dependencies of the project).

         Note: ReactMarkdown re-renders on each token. Keep the existing components config
         from ChatMessage or use minimal styling. If performance is a concern, you may use
         the same `components` prop as ChatMessage for consistent styling, but copy it inline
         rather than importing from ChatMessage (to keep it simple).

      **B. Auto-select last active brainstorm session (BrainstormPage.tsx)**

      2. When a user loads a session (clicks in sidebar), persist its ID to localStorage:
         In the session click handler (around line 264 where `loadSession(session.id)` is called),
         add: `localStorage.setItem('lastBrainstormSessionId', session.id);`

      3. Also persist when creating a new session: after `createSession()` returns, save the
         new session's ID to localStorage.

      4. On page mount (in a useEffect), after sessions are loaded (`sessions.length &gt; 0`
         and `!activeSession`), check localStorage for `lastBrainstormSessionId`. If it exists
         and matches an ID in the loaded sessions, call `loadSession(id)`. Otherwise, do nothing
         (user sees the session list as before).
         ```tsx
         useEffect(() =&gt; {
           if (sessions.length &gt; 0 &amp;&amp; !activeSession &amp;&amp; !loadingSession) {
             const lastId = localStorage.getItem('lastBrainstormSessionId');
             if (lastId &amp;&amp; sessions.some(s =&gt; s.id === lastId)) {
               loadSession(lastId);
             }
           }
         }, [sessions, activeSession, loadingSession, loadSession]);
         ```

      **C. Brainstorm textarea auto-resize (BrainstormPage.tsx)**

      5. Find the chat input `&lt;textarea&gt;` (around line 462-475). It likely has a fixed height
         or rows. Change it to auto-resize with content:
         - Add a ref: `const textareaRef = useRef&lt;HTMLTextAreaElement&gt;(null);`
         - Add an auto-resize function:
           ```tsx
           const autoResize = () =&gt; {
             const el = textareaRef.current;
             if (el) {
               el.style.height = 'auto';
               el.style.height = Math.min(el.scrollHeight, 160) + 'px'; // max ~6 lines
             }
           };
           ```
         - Call `autoResize()` in `onChange` (after setting the input value).
         - Also call `autoResize()` on mount via useEffect.
         - Reset height after sending a message (set input to '' and then call autoResize
           or set style.height to 'auto' directly).
         - Set `rows={1}` and remove any fixed `h-` class. Add `resize-none overflow-hidden`
           to prevent manual resize and scrollbar flicker.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: in brainstorm, send a message → streaming response renders with markdown
         formatting (headers, bold, lists, code blocks) — no visual "pop" when streaming ends
      4. Manual: load a brainstorm session → navigate away → return to brainstorm page →
         the same session is automatically loaded
      5. Manual: type a multi-line message in the brainstorm input → textarea grows to fit
         content (up to ~6 lines max, then scrolls)
      6. Manual: send the message → textarea shrinks back to 1 line
    </verify>
    <done>
      Streaming brainstorm text renders with full markdown. Last-used session auto-loads on
      page revisit. Textarea auto-resizes with content up to 6 lines.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - react-markdown and remark-gfm are already project dependencies (confirmed)
      - ReactMarkdown handles incremental streaming text gracefully (it re-renders on each update)
      - localStorage is available in Electron renderer (confirmed: standard web API)
      - Textarea has no fixed height constraint that would prevent auto-resize
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Board CSV export and meeting card project color</n>
    <files>
      src/renderer/pages/BoardPage.tsx
      src/renderer/components/MeetingCard.tsx
      src/renderer/pages/MeetingsPage.tsx
    </files>
    <action>
      Two data-focused improvements: CSV export for boards and project color dots on meeting cards.

      **A. Export board as CSV (BoardPage.tsx)**

      1. Add a CSV export helper function inside BoardPage or as a local utility:
         ```tsx
         function exportBoardAsCsv(columns: Column[], cards: Card[], labels: Label[]) {
           const headers = ['Column', 'Title', 'Description', 'Priority', 'Due Date', 'Labels', 'Created', 'Updated'];
           const rows = cards.map(card =&gt; {
             const col = columns.find(c =&gt; c.id === card.columnId);
             const cardLabels = card.labels?.map(l =&gt; l.name).join('; ') ?? '';
             const desc = card.description?.replace(/&lt;[^&gt;]*&gt;/g, '').replace(/"/g, '""').trim() ?? '';
             return [
               col?.name ?? '',
               card.title.replace(/"/g, '""'),
               desc,
               card.priority,
               card.dueDate ?? '',
               cardLabels,
               new Date(card.createdAt).toLocaleDateString(),
               new Date(card.updatedAt).toLocaleDateString(),
             ].map(v =&gt; `"${v}"`).join(',');
           });
           const csv = [headers.join(','), ...rows].join('\n');

           const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url;
           a.download = `board-export-${new Date().toISOString().slice(0, 10)}.csv`;
           a.click();
           URL.revokeObjectURL(url);
         }
         ```

      2. Add an "Export CSV" button in the board header toolbar, after the filter indicator area
         (around line 444-459). Use the Download icon from lucide-react:
         ```tsx
         &lt;button
           onClick={() =&gt; exportBoardAsCsv(columns, cards, labels)}
           className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 px-2 py-1 rounded hover:bg-surface-700"
           title="Export board as CSV"
         &gt;
           &lt;Download size={14} /&gt;
           Export CSV
         &lt;/button&gt;
         ```
         Import `Download` from lucide-react. Note: this exports ALL cards (unfiltered), not just
         filtered cards. The export reflects the full board state.

      **B. Project color dot on meeting cards (MeetingCard.tsx + MeetingsPage.tsx)**

      3. In MeetingsPage.tsx, create a `projectColorMap` alongside the existing `projectNameMap`:
         The projects data is already available from `useProjectStore(s =&gt; s.projects)` (line 37).
         ```tsx
         const projectColorMap = useMemo(() =&gt; {
           const map = new Map&lt;string, string&gt;();
           projects.forEach(p =&gt; map.set(p.id, p.color ?? '#6366f1'));
           return map;
         }, [projects]);
         ```
         Pass `projectColor` to MeetingCard:
         ```tsx
         &lt;MeetingCard
           ...existing props...
           projectColor={meeting.projectId ? projectColorMap.get(meeting.projectId) : undefined}
         /&gt;
         ```

      4. In MeetingCard.tsx, add `projectColor?: string` to the MeetingCardProps interface.

      5. Where the `projectName` badge is rendered (lines 87-91), add a small color dot
         BEFORE the project name text:
         ```tsx
         {projectName &amp;&amp; (
           &lt;span className="text-xs bg-primary-600/10 text-primary-400 px-2 py-0.5 rounded-full flex items-center gap-1.5"&gt;
             {projectColor &amp;&amp; (
               &lt;span
                 className="w-2 h-2 rounded-full shrink-0"
                 style={{ backgroundColor: projectColor }}
               /&gt;
             )}
             {projectName}
           &lt;/span&gt;
         )}
         ```
         The inline style uses the project's actual hex color for the dot.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: on a board with cards, click "Export CSV" → CSV file downloads
      4. Manual: open the CSV in a text editor or Excel → headers + card data are correct,
         descriptions have HTML stripped, labels are semicolon-separated
      5. Manual: on MeetingsPage, meetings linked to a project show a color dot next to
         the project name badge
      6. Manual: the color dot matches the project's assigned color
      7. Manual: meetings without a project show no color dot or project badge
    </verify>
    <done>
      Board can be exported as CSV with all card data. Meeting cards show a project color
      dot next to the project name badge for visual cross-entity association.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Project type has a `color` field (confirmed: projects store + project type)
      - Blob URL download works in Electron renderer (standard web API, confirmed)
      - Card descriptions are TipTap HTML (same strip approach as Task 1)
      - The `labels` array is available on Card objects in boardStore (confirmed)
    </assumptions>
  </task>
</phase>
