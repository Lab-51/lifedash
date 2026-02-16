<phase n="A.2" name="Daily Standup Generator and Productivity Pulse">
  <context>
    Plan A.2 implements the remaining 2 features from SELF-IMPROVE-NEW.md Phase A:
    - Q3: Daily Standup Generator (4h) — AI-generated standup from recent activity
    - E1: Productivity Pulse (1-3d) — GitHub-style activity heatmap + streak counter

    Both are dashboard features. The standup generator uses the AI provider system
    established in Phase 3. The Productivity Pulse derives from existing createdAt
    timestamps — no new tables needed.

    IMPORTANT ARCHITECTURE CHANGE (commit 53be31f): The app now has a Classic/Modern
    design switching system. DashboardPage.tsx is a thin switcher that renders either
    DashboardClassic or DashboardModern based on the `useDesign()` hook. ALL dashboard
    UI changes must be implemented in BOTH variants with appropriate styling:
    - Classic: dark theme (bg-surface-800, border-surface-700, text-surface-xxx)
    - Modern: glassmorphism (bg-white dark:bg-surface-900, rounded-2xl, shadow-sm, border-surface-200 dark:border-surface-800)

    The design switching is controlled by the `app.designVariant` setting in settingsStore.
    The `useDesign()` hook from `src/renderer/hooks/useDesign.ts` returns `designVariant`
    ('classic' | 'modern').

    Plan A.1 (COMPLETE) delivered: Pin/Star Projects, AI Card Description, Quick Capture.

    @PROJECT.md @STATE.md @SELF-IMPROVE-NEW.md
    @src/renderer/pages/DashboardPage.tsx (thin switcher — do NOT modify)
    @src/renderer/components/DashboardClassic.tsx
    @src/renderer/components/DashboardModern.tsx
    @src/renderer/hooks/useDesign.ts
    @src/main/services/ai-provider.ts
    @src/main/ipc/cards.ts
    @src/main/ipc/meetings.ts
    @src/main/ipc/index.ts
    @src/main/db/schema/cards.ts (cardActivities, cards, columns, boards)
    @src/main/db/schema/meetings.ts (meetings, actionItems)
    @src/main/db/schema/ideas.ts
    @src/shared/types/electron-api.ts
    @src/preload/preload.ts
    @src/preload/domains/
    @src/renderer/stores/boardStore.ts
  </context>

  <task type="auto" n="1">
    <n>Daily Standup Generator with AI</n>
    <files>
      src/main/ipc/dashboard.ts (new)
      src/main/ipc/index.ts
      src/preload/domains/dashboard.ts (new)
      src/preload/preload.ts
      src/shared/types/electron-api.ts
      src/renderer/components/DashboardClassic.tsx
      src/renderer/components/DashboardModern.tsx
    </files>
    <action>
      Add a "Generate Standup" action on the Dashboard that uses AI to create a
      3-section standup report (Did / Doing / Blockers) from recent activity, with a
      copy-to-clipboard button. Must be implemented in BOTH Classic and Modern variants.

      **A. New IPC handler — src/main/ipc/dashboard.ts (new file)**

      1. Create `src/main/ipc/dashboard.ts` with a `registerDashboardHandlers()` export.
         Add a handler `dashboard:generate-standup`:

         a. Query card_activities from the last 48 hours:
            - Activities with action 'moved' or 'created' or 'updated'
            - Join to cards table to get card titles
            - Join to columns table to get column names
            - Join through boards → projects to get project names

         b. Query pending action_items from recent meetings (last 7 days):
            - Where status = 'pending' or status = 'approved'
            - Join to meetings table for meeting titles

         c. Query cards currently in flight:
            - Cards updated in the last 7 days that are not archived
            - Join to columns + boards + projects for context

         d. Resolve AI provider via `resolveTaskModel('standup')`.
            If no provider, throw `new Error('No AI provider configured')`.

         e. Build prompt:
            ```
            Generate a concise daily standup report based on this activity data.
            Format with 3 sections using markdown:
            ## What I did
            ## What I'm doing today
            ## Blockers
            Use bullet points. Be specific — mention card names and project context.
            Keep each section to 2-5 bullets max. If a section has no data, write "None".

            Recent activity (last 48 hours):
            [card activities with titles, actions, column names, projects]

            Currently in progress:
            [active cards with column names and projects]

            Pending action items from meetings:
            [pending/approved action items with meeting titles]

            Today's date: ${new Date().toLocaleDateString()}
            ```

         f. Call `generate()` with taskType 'standup', temperature 0.7, maxTokens 500.
         g. Return `{ standup: result.text }`.

      2. Import schemas: `cards`, `cardActivities`, `columns`, `boards`, `projects`,
         `actionItems`, `meetings` from `../db/schema`.
         Import `resolveTaskModel`, `generate` from `../services/ai-provider`.
         Import `eq`, `gte`, `desc`, `and`, `or` from `drizzle-orm`.
         Import `getDb` from `../db/connection`.
         Import `ipcMain` from `electron`.

      3. Register in `src/main/ipc/index.ts`:
         ```ts
         import { registerDashboardHandlers } from './dashboard';
         ```
         Add `registerDashboardHandlers();` in the function body.

      **B. Preload bridge — src/preload/domains/dashboard.ts (new file)**

      4. Create `src/preload/domains/dashboard.ts`:
         ```ts
         import { ipcRenderer } from 'electron';
         export const dashboardBridge = {
           generateStandup: () => ipcRenderer.invoke('dashboard:generate-standup'),
         };
         ```

      5. Register in `src/preload/preload.ts`:
         ```ts
         import { dashboardBridge } from './domains/dashboard';
         ```
         Add `...dashboardBridge,` in the contextBridge.exposeInMainWorld object.

      6. Add to ElectronAPI in `src/shared/types/electron-api.ts`:
         ```ts
         generateStandup: () => Promise<{ standup: string }>;
         ```

      **C. DashboardClassic.tsx UI**

      7. In `src/renderer/components/DashboardClassic.tsx`:

         - Import: `ClipboardList`, `Copy`, `Check`, `RefreshCw`, `X`, `Loader2` from lucide-react.
         - Import `toast` from `../hooks/useToast`.

         - Add state:
           ```ts
           const [standupText, setStandupText] = useState<string | null>(null);
           const [generatingStandup, setGeneratingStandup] = useState(false);
           const [standupCopied, setStandupCopied] = useState(false);
           ```

         - Add handlers:
           ```ts
           const handleGenerateStandup = async () => {
             setGeneratingStandup(true);
             setStandupCopied(false);
             try {
               const result = await window.electronAPI.generateStandup();
               setStandupText(result.standup);
             } catch {
               toast('Failed to generate standup', 'error');
             } finally {
               setGeneratingStandup(false);
             }
           };
           const handleCopyStandup = async () => {
             if (!standupText) return;
             await navigator.clipboard.writeText(standupText);
             setStandupCopied(true);
             toast('Standup copied to clipboard', 'success');
             setTimeout(() => setStandupCopied(false), 2000);
           };
           ```

         - Add "Generate Standup" button to the quick actions grid. Make it 5 items
           (grid-cols-2 sm:grid-cols-5). The standup button uses a special onClick
           that calls handleGenerateStandup instead of navigate:
           ```tsx
           <button
             onClick={handleGenerateStandup}
             disabled={generatingStandup}
             className="flex flex-col items-center gap-2 bg-surface-800 border border-surface-700 rounded-xl p-4 hover:border-primary-500 transition-colors group disabled:opacity-50"
           >
             {generatingStandup ? (
               <Loader2 size={22} className="text-primary-400 animate-spin" />
             ) : (
               <ClipboardList size={22} className="text-surface-400 group-hover:text-primary-400 transition-colors" />
             )}
             <span className="text-sm text-surface-300 group-hover:text-surface-100 transition-colors">
               {generatingStandup ? 'Generating...' : 'Standup'}
             </span>
           </button>
           ```

         - After the quick actions grid, render the standup result card (when standupText):
           ```tsx
           {standupText && (
             <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
               <div className="flex items-center justify-between mb-3">
                 <h3 className="text-sm font-semibold text-surface-100">Daily Standup</h3>
                 <div className="flex items-center gap-2">
                   <button onClick={handleCopyStandup} className="p-1 rounded hover:bg-surface-700" title="Copy to clipboard">
                     {standupCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-surface-400" />}
                   </button>
                   <button onClick={handleGenerateStandup} disabled={generatingStandup} className="p-1 rounded hover:bg-surface-700" title="Regenerate">
                     <RefreshCw size={14} className={`text-surface-400 ${generatingStandup ? 'animate-spin' : ''}`} />
                   </button>
                   <button onClick={() => setStandupText(null)} className="p-1 rounded hover:bg-surface-700" title="Dismiss">
                     <X size={14} className="text-surface-400" />
                   </button>
                 </div>
               </div>
               <div className="text-sm text-surface-200 whitespace-pre-wrap">{standupText}</div>
             </div>
           )}
           ```

      **D. DashboardModern.tsx UI**

      8. In `src/renderer/components/DashboardModern.tsx`, add the same functionality
         but styled for the Modern design:

         - Same imports, same state, same handlers.

         - Add "Generate Standup" button to the quick actions row (the hero section).
           Add a 5th action button with Modern styling:
           ```tsx
           { icon: ClipboardList, label: 'Standup', path: '', color: 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white' }
           ```
           BUT since this is not a navigate action, handle it specially — if path is '',
           call handleGenerateStandup instead of navigate(path). Use an `action` callback
           pattern or an if/else in the onClick.

         - Standup result card in Modern style (insert into the main grid after stats row):
           ```tsx
           {standupText && (
             <div className="col-span-12 bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm p-5">
               <div className="flex items-center justify-between mb-3">
                 <h3 className="font-semibold text-surface-900 dark:text-surface-100">Daily Standup</h3>
                 <div className="flex items-center gap-2">
                   <button onClick={handleCopyStandup} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Copy">
                     {standupCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-surface-400" />}
                   </button>
                   <button onClick={handleGenerateStandup} disabled={generatingStandup} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Regenerate">
                     <RefreshCw size={14} className={`text-surface-400 ${generatingStandup ? 'animate-spin' : ''}`} />
                   </button>
                   <button onClick={() => setStandupText(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Dismiss">
                     <X size={14} className="text-surface-400" />
                   </button>
                 </div>
               </div>
               <div className="text-sm text-surface-700 dark:text-surface-200 whitespace-pre-wrap">{standupText}</div>
             </div>
           )}
           ```

      WHY: Saves 5 minutes daily. Users open the dashboard, click one button, get a
      standup ready to paste into Slack/Teams. Leverages existing card activities, action
      items, and AI provider system. The "wow, that's clever" moment from SELF-IMPROVE-NEW.md.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual (Classic mode): open Dashboard → see "Standup" quick action button
      4. Manual (Classic mode): click → loading state → standup appears below actions
      5. Manual (Classic mode): copy, regenerate, dismiss all work
      6. Manual (Modern mode): switch to Modern via Settings → "Standup" button in hero
      7. Manual (Modern mode): click → standup card appears in grid with Modern styling
      8. Manual (Modern mode): copy, regenerate, dismiss all work
      9. Manual: with no AI provider → error toast
    </verify>
    <done>
      Dashboard has "Generate Standup" button (both Classic and Modern variants) that
      uses AI to create a 3-section daily standup from recent card activities, in-progress
      cards, and pending action items. Copy-to-clipboard and regenerate included.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - card_activities table has 'moved', 'created', 'updated' actions (confirmed schema)
      - resolveTaskModel falls back to first enabled provider for 'standup' (confirmed code)
      - navigator.clipboard.writeText works in Electron renderer (standard Web API)
      - The quick actions in DashboardClassic are a grid; in DashboardModern they're
        inline button pills in the hero section (confirmed from reading both files)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Productivity Pulse — Activity Heatmap and Streak Counter</n>
    <files>
      src/main/ipc/dashboard.ts (extend from Task 1)
      src/preload/domains/dashboard.ts (extend from Task 1)
      src/shared/types/electron-api.ts
      src/renderer/components/ActivityHeatmap.tsx (new)
      src/renderer/components/DashboardClassic.tsx
      src/renderer/components/DashboardModern.tsx
    </files>
    <preconditions>
      - Task 1 completed (dashboard.ts IPC file and preload bridge exist)
    </preconditions>
    <action>
      Add a "Productivity Pulse" widget to the Dashboard: a GitHub-style activity heatmap
      showing 90 days of activity, a current streak counter. All derived from existing
      createdAt timestamps — no new tables needed. Must be in BOTH dashboard variants.

      **A. New IPC handler for activity data**

      1. In `src/main/ipc/dashboard.ts` (created in Task 1), add handler
         `dashboard:activity-data`:

         ```ts
         ipcMain.handle('dashboard:activity-data', async () => {
           const db = getDb();
           const ninetyDaysAgo = new Date();
           ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

           // Query each entity table for createdAt timestamps in the last 90 days
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

           // Merge all, group by YYYY-MM-DD
           const dayCounts: Record<string, number> = {};
           for (const row of [...cardRows, ...meetingRows, ...ideaRows]) {
             const dateStr = new Date(row.createdAt).toISOString().split('T')[0];
             dayCounts[dateStr] = (dayCounts[dateStr] || 0) + 1;
           }

           return { dayCounts };
         });
         ```

      2. Add to preload bridge in `src/preload/domains/dashboard.ts`:
         ```ts
         getActivityData: () => ipcRenderer.invoke('dashboard:activity-data'),
         ```

      3. Add to ElectronAPI in `src/shared/types/electron-api.ts`:
         ```ts
         getActivityData: () => Promise<{ dayCounts: Record<string, number> }>;
         ```

      **B. ActivityHeatmap component (design-agnostic)**

      4. Create `src/renderer/components/ActivityHeatmap.tsx`:

         A self-contained, design-agnostic component that renders a GitHub-style
         contribution heatmap using CSS Grid. No charting library needed.

         ```tsx
         import { useMemo } from 'react';

         function getColor(count: number): string {
           if (count === 0) return 'bg-surface-700/50';
           if (count === 1) return 'bg-emerald-900/60';
           if (count <= 3) return 'bg-emerald-700/70';
           if (count <= 5) return 'bg-emerald-500/80';
           return 'bg-emerald-400';
         }

         interface Props {
           dayCounts: Record<string, number>;
         }

         export default function ActivityHeatmap({ dayCounts }: Props) {
           const cells = useMemo(() => {
             const today = new Date();
             const result: Array<{ date: string; count: number }> = [];
             for (let i = 90; i >= 0; i--) {
               const d = new Date(today);
               d.setDate(d.getDate() - i);
               const dateStr = d.toISOString().split('T')[0];
               result.push({ date: dateStr, count: dayCounts[dateStr] || 0 });
             }
             return result;
           }, [dayCounts]);

           return (
             <div className="inline-grid grid-flow-col grid-rows-7 gap-[3px]">
               {cells.map(cell => (
                 <div
                   key={cell.date}
                   className={`w-[10px] h-[10px] rounded-sm ${getColor(cell.count)}`}
                   title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'activity' : 'activities'}`}
                 />
               ))}
             </div>
           );
         }

         export { getColor };
         ```

         Export `getColor` so the dashboard components can render the legend.

      **C. Streak calculation (shared helper)**

      5. Add a `calculateStreak` function. This can live in the ActivityHeatmap file
         or as a standalone util. It counts consecutive workdays (Mon-Fri) from today
         backwards that have at least 1 activity:

         ```ts
         export function calculateStreak(dayCounts: Record<string, number>): number {
           let count = 0;
           const today = new Date();
           for (let i = 0; i <= 90; i++) {
             const d = new Date(today);
             d.setDate(d.getDate() - i);
             const dayOfWeek = d.getDay();
             if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
             const dateStr = d.toISOString().split('T')[0];
             if ((dayCounts[dateStr] || 0) > 0) {
               count++;
             } else {
               break;
             }
           }
           return count;
         }
         ```

      **D. DashboardClassic.tsx integration**

      6. In `src/renderer/components/DashboardClassic.tsx`:

         - Import `ActivityHeatmap`, `getColor`, `calculateStreak` from '../components/ActivityHeatmap'.
         - Import `Flame` from lucide-react.
         - Import `useEffect` (if not already).

         - Add state + effect:
           ```ts
           const [activityData, setActivityData] = useState<Record<string, number>>({});
           useEffect(() => {
             window.electronAPI.getActivityData().then(r => setActivityData(r.dayCounts));
           }, []);
           const streak = useMemo(() => calculateStreak(activityData), [activityData]);
           ```

         - Render the Productivity Pulse section between quick actions and the conditional
           content (after standup card, before the empty/projects sections). Only show
           when user has data (projects.length > 0 || meetings.length > 0):
           ```tsx
           {(projects.length > 0 || meetings.length > 0) && (
             <section className="bg-surface-800 border border-surface-700 rounded-xl p-4">
               <div className="flex items-center justify-between mb-3">
                 <h3 className="text-sm font-semibold text-surface-100">Productivity Pulse</h3>
                 {streak > 0 && (
                   <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
                     <Flame size={14} /> {streak} day streak
                   </span>
                 )}
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
           )}
           ```

      **E. DashboardModern.tsx integration**

      7. In `src/renderer/components/DashboardModern.tsx`:

         - Same imports: ActivityHeatmap, getColor, calculateStreak, Flame, useEffect.

         - Same state + effect + streak calculation.

         - Render in the main grid, as a full-width card below the stats row:
           ```tsx
           {(projects.length > 0 || meetings.length > 0) && (
             <div className="col-span-12 bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm p-5">
               <div className="flex items-center justify-between mb-3">
                 <h3 className="font-semibold text-surface-900 dark:text-surface-100">Productivity Pulse</h3>
                 {streak > 0 && (
                   <span className="text-xs text-amber-500 font-semibold flex items-center gap-1">
                     <Flame size={14} /> {streak} day streak
                   </span>
                 )}
               </div>
               <ActivityHeatmap dayCounts={activityData} />
               <div className="mt-2 flex items-center gap-3 text-xs text-surface-400">
                 <span>Less</span>
                 {[0, 1, 3, 5, 7].map(n => (
                   <div key={n} className={`w-[10px] h-[10px] rounded-sm ${getColor(n)}`} />
                 ))}
                 <span>More</span>
               </div>
             </div>
           )}
           ```

         Place this inside the `<div className="grid grid-cols-12 gap-6 pb-8">` after
         the stats row (3 stat cards) and before the left/right column layout.

      WHY: Streaks and heatmaps are proven retention mechanics (GitHub, Duolingo). Users
      open the app to maintain their streak. Pure CSS Grid — no chart library. All data
      from existing createdAt timestamps, zero new schema.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — zero type errors
      2. Run `npm test` — all tests pass
      3. Manual (Classic): Dashboard shows "Productivity Pulse" with heatmap below actions
      4. Manual (Classic): hover cells → tooltip shows date + count
      5. Manual (Classic): streak counter shows if consecutive workdays have activity
      6. Manual (Classic): Less→More legend renders below heatmap
      7. Manual (Modern): switch to Modern → heatmap in full-width card below stats
      8. Manual (Modern): same heatmap, streak, legend — Modern styling
      9. Manual: empty dashboard → Productivity Pulse hidden
      10. Manual: resize window → heatmap grid stays aligned
    </verify>
    <done>
      Dashboard shows "Productivity Pulse" widget in both Classic and Modern variants
      with a 90-day GitHub-style activity heatmap, workday streak counter, and legend.
      Data derived from existing entity timestamps. Pure CSS grid.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - createdAt timestamps on cards, meetings, ideas are reliable activity indicators
        (confirmed — all schemas have createdAt with defaultNow)
      - CSS Grid grid-flow-col grid-rows-7 produces correct heatmap layout
      - The heatmap component is design-agnostic (emerald colors work in both themes)
      - Weekday-only streaks are more useful for professionals
      - 3 table queries for 90 days is fast (small dataset per user)
      - Task 1's dashboard.ts IPC file and preload bridge exist before this task runs
    </assumptions>
  </task>
</phase>
