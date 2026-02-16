<phase n="A.2" name="Daily Standup Generator and Productivity Pulse">
  <context>
    Plan A.2 implements the remaining 2 features from SELF-IMPROVE-NEW.md Phase A:
    - Q3: Daily Standup Generator (4h) — AI-generated standup from recent activity
    - E1: Productivity Pulse (1-3d) — GitHub-style activity heatmap + streak counter

    Both are dashboard features. The standup generator uses the AI provider system
    established in Phase 3. The Productivity Pulse derives from existing createdAt
    timestamps — no new tables needed.

    Plan A.1 (COMPLETE) delivered: Pin/Star Projects, AI Card Description, Quick Capture.

    @PROJECT.md @STATE.md @SELF-IMPROVE-NEW.md
    @src/renderer/pages/DashboardPage.tsx
    @src/main/services/ai-provider.ts
    @src/main/ipc/cards.ts
    @src/main/ipc/meetings.ts
    @src/main/db/schema/cards.ts
    @src/main/db/schema/meetings.ts
    @src/main/db/schema/ideas.ts
    @src/shared/types/electron-api.ts
    @src/preload/domains/
    @src/renderer/stores/boardStore.ts
  </context>

  <task type="auto" n="1">
    <n>Daily Standup Generator with AI</n>
    <files>
      src/main/ipc/cards.ts (or new src/main/ipc/dashboard.ts)
      src/preload/domains/ (new or existing bridge)
      src/shared/types/electron-api.ts
      src/renderer/pages/DashboardPage.tsx
    </files>
    <action>
      Add a "Generate Standup" quick action on the Dashboard that uses AI to create a
      3-section standup report (Did / Doing / Blockers) from recent activity, with a
      copy-to-clipboard button.

      **A. New IPC handler**

      1. Create a new IPC handler `dashboard:generate-standup` (either in a new
         `src/main/ipc/dashboard.ts` file or at the bottom of `src/main/ipc/cards.ts` —
         whichever fits better). The handler should:

         a. Query card_activities from the last 24-48 hours:
            - Activities with action 'moved' or 'created' or 'updated'
            - Join to cards table to get card titles
            - Join to columns table to get column names (tells us where cards moved to)
            - Join through boards to get project names for context

         b. Query pending action_items from recent meetings (last 7 days):
            - Where status = 'pending' or status = 'approved'
            - Join to meetings table for meeting titles

         c. Query cards currently in flight:
            - Cards updated in the last 7 days that are not archived
            - Get their column names and project names

         d. Resolve AI provider via `resolveTaskModel('standup')`.
            If no provider available, throw an error.

         e. Build a prompt like:
            ```
            Generate a concise daily standup report based on this activity data.
            Format with 3 sections: "What I did", "What I'm doing today", "Blockers".
            Use bullet points. Be specific — mention card names and project context.
            Keep each section to 2-5 bullets max.

            Recent activity (last 24-48 hours):
            [card activities with titles, column moves, projects]

            Currently in progress:
            [active cards with column names and projects]

            Pending action items from meetings:
            [pending/approved action items with meeting titles]

            Today's date: ${new Date().toLocaleDateString()}
            ```

         f. Call `generate()` with taskType 'standup', temperature 0.7, maxTokens 500.
         g. Return `{ standup: result.text }`.

      2. If creating a new `dashboard.ts` IPC file, register it in `src/main/ipc/index.ts`.
         Import necessary schemas: cards, cardActivities, columns, boards, projects,
         actionItems, meetings from the schema barrel export.
         Import `resolveTaskModel`, `generate` from '../services/ai-provider'.
         Import `eq`, `gte`, `desc`, `and`, `or`, `inArray` from drizzle-orm as needed.

      **B. Preload bridge**

      3. Add the bridge method. Either in an existing domain file or create
         `src/preload/domains/dashboard.ts`:
         ```ts
         generateStandup: () => ipcRenderer.invoke('dashboard:generate-standup'),
         ```
         Register in the main preload bridge.

      4. Add `generateStandup` to the `ElectronAPI` interface in
         `src/shared/types/electron-api.ts`:
         ```ts
         generateStandup: () => Promise<{ standup: string }>;
         ```

      **C. Dashboard UI**

      5. In `src/renderer/pages/DashboardPage.tsx`, add a "Generate Standup" button
         alongside the existing quick actions row. Use the `ClipboardList` icon from
         lucide-react.

         Add it to the QUICK_ACTIONS array:
         ```ts
         { label: 'Generate Standup', icon: ClipboardList, path: '' }
         ```
         BUT this action is different — it doesn't navigate, it triggers AI generation.
         Instead of adding to QUICK_ACTIONS, add a separate button next to the grid, or
         handle it specially in the grid click handler.

         Better approach: Add a new state and modal/popup:

      6. Add state:
         ```ts
         const [standupText, setStandupText] = useState<string | null>(null);
         const [generatingStandup, setGeneratingStandup] = useState(false);
         const [standupCopied, setStandupCopied] = useState(false);
         ```

      7. Add handler:
         ```ts
         const handleGenerateStandup = async () => {
           setGeneratingStandup(true);
           setStandupCopied(false);
           try {
             const result = await window.electronAPI.generateStandup();
             setStandupText(result.standup);
           } catch (err) {
             toast('Failed to generate standup', 'error');
           } finally {
             setGeneratingStandup(false);
           }
         };

         const handleCopyStandup = async () => {
           if (standupText) {
             await navigator.clipboard.writeText(standupText);
             setStandupCopied(true);
             toast('Standup copied to clipboard', 'success');
             setTimeout(() => setStandupCopied(false), 2000);
           }
         };
         ```

      8. Render a "Generate Standup" button in a new row below quick actions
         (or as a 5th item in the grid). When clicked, show the result in a
         collapsible card below the button with:
         - The AI-generated standup text (rendered with whitespace preserved or
           as markdown using dangerouslySetInnerHTML with simple newline→br conversion,
           or using ReactMarkdown if already imported)
         - A "Copy to Clipboard" button (Check icon when copied)
         - A "Regenerate" button to try again
         - An "X" close button to dismiss

         Style: bg-surface-800 border border-surface-700 rounded-xl p-4, same as
         other dashboard cards. Standup text in text-sm text-surface-200, sections
         bolded (text-surface-100 font-medium).

      9. Import `toast` from '../hooks/useToast', `ClipboardList`, `Copy`, `Check`,
         `RefreshCw`, `X` from lucide-react.

      WHY: Saves 5 minutes daily. Users open the dashboard, click one button, get a
      standup ready to paste into Slack/Teams. Leverages all existing data (cards, activities,
      action items) with the existing AI provider system. The "wow, that's clever" moment
      from SELF-IMPROVE-NEW.md.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: open Dashboard → see "Generate Standup" button
      4. Manual: click button → loading state shown → standup text appears in 3-5 seconds
      5. Manual: standup has "What I did" / "What I'm doing" / "Blockers" sections
      6. Manual: click "Copy to Clipboard" → text copied, checkmark shown
      7. Manual: click "Regenerate" → new standup generated
      8. Manual: click close → standup card dismissed
      9. Manual: with no AI provider configured → error toast
    </verify>
    <done>
      Dashboard has "Generate Standup" button that uses AI to create a 3-section daily
      standup from recent card activities, in-progress cards, and pending action items.
      Copy-to-clipboard and regenerate functionality included.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - card_activities table has entries for 'moved', 'created', 'updated' actions
        (confirmed from schema — these enum values exist)
      - The details column in card_activities stores JSON with move context
        (confirmed pattern from existing code)
      - resolveTaskModel falls back to first enabled provider for unknown task types
        like 'standup' (confirmed from ai-provider.ts code)
      - navigator.clipboard.writeText works in Electron renderer (standard Web API)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Productivity Pulse — Activity Heatmap and Streak Counter</n>
    <files>
      src/main/ipc/dashboard.ts (new or extend from Task 1)
      src/preload/domains/ (extend from Task 1)
      src/shared/types/electron-api.ts
      src/renderer/pages/DashboardPage.tsx
      src/renderer/components/ActivityHeatmap.tsx (new)
    </files>
    <action>
      Add a "Productivity Pulse" widget to the Dashboard: a GitHub-style activity heatmap
      showing 90 days of activity, a current streak counter, and a simple weekly rhythm
      indicator. All derived from existing createdAt timestamps — no new tables needed.

      **A. New IPC handler for activity data**

      1. In `src/main/ipc/dashboard.ts` (created in Task 1, or create if Task 1 used
         a different file), add handler `dashboard:activity-data`:

         ```ts
         ipcMain.handle('dashboard:activity-data', async () => {
           const db = getDb();
           const ninetyDaysAgo = new Date();
           ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

           // Count entities created per day across all entity types
           // Query each table separately and merge — simple and reliable.

           const cardRows = await db
             .select({ createdAt: cards.createdAt })
             .from(cards)
             .where(gte(cards.createdAt, ninetyDaysAgo));

           const meetingRows = await db
             .select({ createdAt: meetings.createdAt })
             .from(meetings)
             .where(gte(meetings.createdAt, ninetyDaysAgo));

           const ideaRows = await db
             .select({ createdAt: ideas.createdAt })
             .from(ideas)
             .where(gte(ideas.createdAt, ninetyDaysAgo));

           // Merge all timestamps, group by date string (YYYY-MM-DD)
           const allDates: string[] = [];
           for (const row of [...cardRows, ...meetingRows, ...ideaRows]) {
             const d = new Date(row.createdAt);
             allDates.push(d.toISOString().split('T')[0]);
           }

           // Count per day
           const dayCounts: Record<string, number> = {};
           for (const date of allDates) {
             dayCounts[date] = (dayCounts[date] || 0) + 1;
           }

           return { dayCounts };
         });
         ```

      2. Add to preload bridge:
         ```ts
         getActivityData: () => ipcRenderer.invoke('dashboard:activity-data'),
         ```

      3. Add to ElectronAPI interface:
         ```ts
         getActivityData: () => Promise<{ dayCounts: Record<string, number> }>;
         ```

      **B. ActivityHeatmap component**

      4. Create `src/renderer/components/ActivityHeatmap.tsx`:

         Build a GitHub-style contribution heatmap using pure CSS Grid (no charting
         library needed). The component receives `dayCounts: Record<string, number>`.

         Layout:
         - 13 columns (weeks) × 7 rows (days, Mon-Sun)
         - Each cell is a small square (10-12px) with rounded corners
         - Color intensity based on activity count:
           - 0 activities: bg-surface-800 (dark/empty)
           - 1 activity: bg-emerald-900/50
           - 2-3 activities: bg-emerald-700/60
           - 4-5 activities: bg-emerald-500/70
           - 6+ activities: bg-emerald-400
         - Tooltip on hover showing date and count (use title attribute for simplicity)

         Structure:
         ```tsx
         function ActivityHeatmap({ dayCounts }: { dayCounts: Record<string, number> }) {
           const cells = useMemo(() => {
             const today = new Date();
             const result: Array<{ date: string; count: number; dayOfWeek: number }> = [];

             // Generate 91 days (13 weeks) ending today
             for (let i = 90; i >= 0; i--) {
               const d = new Date(today);
               d.setDate(d.getDate() - i);
               const dateStr = d.toISOString().split('T')[0];
               result.push({
                 date: dateStr,
                 count: dayCounts[dateStr] || 0,
                 dayOfWeek: d.getDay(), // 0=Sun, 1=Mon, ...
               });
             }
             return result;
           }, [dayCounts]);

           return (
             <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
               {cells.map(cell => (
                 <div
                   key={cell.date}
                   className={`w-[10px] h-[10px] rounded-sm ${getColor(cell.count)}`}
                   title={`${cell.date}: ${cell.count} activities`}
                 />
               ))}
             </div>
           );
         }
         ```

         The getColor function maps count → Tailwind class.

      **C. Streak counter**

      5. In the same component or in DashboardPage, compute the current streak:

         ```ts
         const streak = useMemo(() => {
           let count = 0;
           const today = new Date();
           // Start from today and go backwards
           for (let i = 0; i <= 90; i++) {
             const d = new Date(today);
             d.setDate(d.getDate() - i);
             const dateStr = d.toISOString().split('T')[0];
             // Skip weekends (optional — or count all days)
             const dayOfWeek = d.getDay();
             if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
             if (dayCounts[dateStr] && dayCounts[dateStr] > 0) {
               count++;
             } else {
               break; // streak broken
             }
           }
           return count;
         }, [dayCounts]);
         ```

         Streak counts consecutive workdays (Mon-Fri) with at least 1 activity.

      **D. Dashboard integration**

      6. In `src/renderer/pages/DashboardPage.tsx`, add the Productivity Pulse section
         between the quick actions and active projects:

         - Load activity data on mount using useEffect + useState:
           ```ts
           const [activityData, setActivityData] = useState<Record<string, number>>({});
           useEffect(() => {
             window.electronAPI.getActivityData().then(r => setActivityData(r.dayCounts));
           }, []);
           ```

         - Render a "Productivity Pulse" card:
           ```tsx
           <section className="bg-surface-800 border border-surface-700 rounded-xl p-4">
             <div className="flex items-center justify-between mb-3">
               <h2 className="text-sm font-semibold text-surface-100">Productivity Pulse</h2>
               <div className="flex items-center gap-2">
                 {streak > 0 && (
                   <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
                     <Flame size={14} />
                     {streak} day streak
                   </span>
                 )}
               </div>
             </div>
             <ActivityHeatmap dayCounts={activityData} />
             <div className="mt-2 flex items-center gap-3 text-xs text-surface-500">
               <span>Less</span>
               {[0, 1, 3, 5, 7].map(n => (
                 <div key={n} className={`w-[10px] h-[10px] rounded-sm ${getColor(n)}`} />
               ))}
               <span>More</span>
             </div>
           </section>
           ```

      7. Import `Flame` from lucide-react. Import `ActivityHeatmap` from
         '../components/ActivityHeatmap'.

      8. The Productivity Pulse section should only render when the user has data
         (projects.length > 0 or allCards.length > 0 — skip for empty dashboards).

      WHY: Streaks and heatmaps are proven retention mechanics (GitHub, Duolingo, fitness
      apps). Users open the app to maintain their streak. The heatmap provides a satisfying
      visual representation of productivity over time. Pure CSS — no chart library dependency.
      All data derived from existing createdAt timestamps with zero new schema.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual: open Dashboard → see "Productivity Pulse" section with heatmap
      4. Manual: heatmap shows 90 days of activity with color-coded cells
      5. Manual: hover a cell → tooltip shows date and activity count
      6. Manual: if you've been active for consecutive workdays → streak counter shows
      7. Manual: the "Less → More" legend appears below the heatmap
      8. Manual: empty dashboard (no data) → Productivity Pulse section hidden
      9. Manual: resize window → heatmap grid stays aligned and doesn't break
    </verify>
    <done>
      Dashboard shows "Productivity Pulse" widget with a 90-day GitHub-style activity
      heatmap and workday streak counter. Data derived from existing entity timestamps.
      Pure CSS grid — no charting library needed.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - createdAt timestamps on cards, meetings, and ideas tables are reliable activity
        indicators (confirmed — all three schemas have createdAt with defaultNow)
      - CSS Grid with grid-flow-col and grid-rows-7 produces the expected heatmap layout
        (standard Tailwind — confirmed pattern from GitHub-style heatmaps)
      - The 90-day window is sufficient for a meaningful heatmap (standard practice)
      - Weekday-only streaks are more useful than all-day streaks for professionals
      - Querying 3 tables for 90 days of data is fast enough (small dataset per user)
    </assumptions>
  </task>
</phase>
