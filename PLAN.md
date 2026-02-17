# Plan D.2 — Focus Mode Gamification

<phase n="D.2" name="Focus Mode Gamification">
  <context>
    Phase D: Engagement and Intelligence upgrades. Plan D.2 makes focus mode
    a core engagement loop with persistent stats, XP/leveling, and achievements.

    Current state:
    - Focus mode works: start/pause/resume/stop, break cycle, Ctrl+Shift+F.
    - FocusStartModal: card selection + duration presets.
    - FocusCompleteModal: accomplishment textarea → card comment → auto-break.
    - StatusBar: live countdown with card name, pause/resume/stop.
    - focusStore: in-memory sessionCount (lost on restart). No DB persistence.
    - ProductivityPulse on dashboard: GitHub-style heatmap + calculateStreak().
    - DashboardModern: 12-column grid — stats row → productivity pulse → projects + meetings.
    - Next migration number: 0012.

    Design decisions:
    - New `focus_sessions` table stores every completed session (not breaks/skips).
    - XP system: 1 XP per minute focused. Levels at thresholds (0, 60, 300, 900, 2100, 4500, 9000, 18000).
      Level names: Beginner, Focused, Disciplined, Dedicated, Master, Grandmaster, Legend, Transcendent.
    - Focus streak: consecutive calendar days with at least 1 completed session.
    - Achievements: 12 milestones checked on session save. Toast celebration when new unlock.
    - FocusStatsWidget: prominent dashboard card after the stats row, before productivity pulse.
    - Enhanced FocusCompleteModal: shows XP earned, level progress, streak, new achievements.
    - All stats fetched via IPC; focusStore gains totalMinutes/level/streak for use across UI.

    XP Level Thresholds (cumulative minutes):
    | Level | Name          | Minutes | Sessions (~25min avg) |
    |-------|---------------|---------|-----------------------|
    | 1     | Beginner      | 0       | 0                     |
    | 2     | Focused       | 60      | ~2-3                  |
    | 3     | Disciplined   | 300     | ~12                   |
    | 4     | Dedicated     | 900     | ~36                   |
    | 5     | Master        | 2100    | ~84                   |
    | 6     | Grandmaster   | 4500    | ~180                  |
    | 7     | Legend         | 9000    | ~360                  |
    | 8     | Transcendent  | 18000   | ~720                  |

    Achievements (12):
    | ID              | Name               | Condition                          |
    |-----------------|--------------------|-------------------------------------|
    | first_session   | First Focus        | Complete 1 session                  |
    | five_sessions   | Getting Warmed Up  | Complete 5 sessions                 |
    | ten_sessions    | In The Zone        | Complete 10 sessions                |
    | fifty_sessions  | Focus Machine      | Complete 50 sessions                |
    | hundred_sessions| Centurion          | Complete 100 sessions               |
    | one_hour_day    | Power Hour         | 60+ minutes focused in a single day |
    | two_hour_day    | Deep Worker        | 120+ minutes focused in a single day|
    | streak_3        | Three-Day Streak   | 3 consecutive days with sessions    |
    | streak_7        | Week Warrior       | 7 consecutive days with sessions    |
    | streak_14       | Fortnight Focus    | 14 consecutive days with sessions   |
    | streak_30       | Monthly Master     | 30 consecutive days with sessions   |
    | level_5         | Master Achiever    | Reach Level 5 (Master)              |

    @PROJECT.md @STATE.md
    @src/renderer/stores/focusStore.ts
    @src/renderer/components/FocusCompleteModal.tsx
    @src/renderer/components/FocusStartModal.tsx
    @src/renderer/components/StatusBar.tsx
    @src/renderer/components/DashboardModern.tsx
    @src/renderer/components/ProductivityPulse.tsx
    @src/main/db/schema/cards.ts (table pattern reference)
    @src/main/db/connection.ts (getDb pattern)
    @src/shared/types/electron-api.ts
    @src/preload/domains/meetings.ts (preload pattern reference)
  </context>

  <task type="auto" n="1">
    <n>Focus sessions DB table + save flow + stats IPC</n>
    <files>
      src/main/db/schema/focus.ts (new)
      src/main/db/schema/index.ts
      drizzle/0012_focus_sessions.sql (new — manual migration)
      src/main/services/focusService.ts (new)
      src/main/ipc/focus.ts (new)
      src/main/index.ts (register IPC)
      src/preload/domains/focus.ts (new)
      src/preload/index.ts
      src/shared/types/focus.ts (new)
      src/shared/types/electron-api.ts
    </files>
    <action>
      **WHY:** All gamification features depend on persistent session data. Without a DB table,
      stats are lost on restart and achievements can't be tracked. This is the foundation.

      ## Schema (src/main/db/schema/focus.ts)

      1. Create `focus_sessions` table:
         ```ts
         export const focusSessions = pgTable('focus_sessions', {
           id: uuid('id').defaultRandom().primaryKey(),
           cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
           durationMinutes: integer('duration_minutes').notNull(),
           note: text('note'),
           completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
         });
         ```

      2. Create `focus_achievements` table:
         ```ts
         export const focusAchievements = pgTable('focus_achievements', {
           id: varchar('id', { length: 50 }).primaryKey(), // e.g. 'first_session'
           unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
         });
         ```

      3. Export both from schema/index.ts.

      ## Migration (drizzle/0012_focus_sessions.sql)

      ```sql
      CREATE TABLE "focus_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "card_id" uuid REFERENCES "cards"("id") ON DELETE SET NULL,
        "duration_minutes" integer NOT NULL,
        "note" text,
        "completed_at" timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE "focus_achievements" (
        "id" varchar(50) PRIMARY KEY,
        "unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
      );
      ```

      Also create drizzle/meta/0012_snapshot.json (copy pattern from 0011) and add entry
      to drizzle/meta/_journal.json.

      ## Shared Types (src/shared/types/focus.ts)

      4. Define types:
         ```ts
         export interface FocusSession {
           id: string;
           cardId: string | null;
           durationMinutes: number;
           note: string | null;
           completedAt: string;
         }

         export interface FocusStats {
           totalSessions: number;
           totalMinutes: number;
           todaySessions: number;
           todayMinutes: number;
           currentStreak: number; // consecutive days
           longestStreak: number;
           level: number;
           levelName: string;
           xpCurrent: number; // totalMinutes
           xpNextLevel: number; // minutes needed for next level
           xpProgress: number; // 0-1 progress toward next level
         }

         export interface FocusAchievement {
           id: string;
           name: string;
           description: string;
           icon: string;
           unlockedAt: string | null; // null = locked
         }

         export interface FocusDailyData {
           date: string; // YYYY-MM-DD
           sessions: number;
           minutes: number;
         }
         ```

      ## Focus Service (src/main/services/focusService.ts)

      5. Implement service functions:

         a. `saveSession(input: { cardId?: string; durationMinutes: number; note?: string }): Promise<FocusSession>`
            - Insert into focus_sessions, return the row.

         b. `getStats(): Promise<FocusStats>`
            - COUNT + SUM total sessions/minutes.
            - COUNT + SUM today's sessions/minutes (where completedAt >= today start).
            - Calculate streak: query distinct dates with sessions, walk backwards from today.
            - Calculate longest streak: walk all dates forward, track max consecutive run.
            - Calculate level/XP from totalMinutes using the threshold table.

         c. `getDailyData(days: number = 30): Promise<FocusDailyData[]>`
            - Group by date, count sessions, sum minutes for last N days.
            - Fill gaps with zero-value entries (same pattern as AI usage daily).

         d. `getAchievements(): Promise<FocusAchievement[]>`
            - Return the full list of 12 achievements with unlock status from DB.
            - Use a static ACHIEVEMENTS array with id/name/description/icon.
            - Left-join with focus_achievements table to get unlockedAt.

         e. `checkAndUnlockAchievements(stats: FocusStats): Promise<FocusAchievement[]>`
            - Given current stats, check each achievement condition.
            - Insert newly unlocked achievements into focus_achievements.
            - Return only the newly unlocked ones (for toast notifications).

         The ACHIEVEMENTS constant array and LEVEL_THRESHOLDS array should be defined
         in this file (or in shared/types/focus.ts if renderer needs them).

         Define LEVEL_THRESHOLDS:
         ```ts
         const LEVEL_THRESHOLDS = [
           { level: 1, name: 'Beginner', minutes: 0 },
           { level: 2, name: 'Focused', minutes: 60 },
           { level: 3, name: 'Disciplined', minutes: 300 },
           { level: 4, name: 'Dedicated', minutes: 900 },
           { level: 5, name: 'Master', minutes: 2100 },
           { level: 6, name: 'Grandmaster', minutes: 4500 },
           { level: 7, name: 'Legend', minutes: 9000 },
           { level: 8, name: 'Transcendent', minutes: 18000 },
         ];
         ```

         Define calculateLevel(totalMinutes) that returns { level, levelName, xpCurrent, xpNextLevel, xpProgress }.

      ## IPC Handlers (src/main/ipc/focus.ts)

      6. Register handlers:
         - `focus:save-session` → saveSession(input) → returns { session, stats, newAchievements }
           (save + get fresh stats + check achievements — all in one round trip)
         - `focus:get-stats` → getStats()
         - `focus:get-daily` → getDailyData(days)
         - `focus:get-achievements` → getAchievements()

      7. Register in main/index.ts: import './ipc/focus'.

      ## Preload Bridge (src/preload/domains/focus.ts)

      8. Add bridge methods:
         ```ts
         focusSaveSession: (input) => ipcRenderer.invoke('focus:save-session', input),
         focusGetStats: () => ipcRenderer.invoke('focus:get-stats'),
         focusGetDaily: (days) => ipcRenderer.invoke('focus:get-daily', days),
         focusGetAchievements: () => ipcRenderer.invoke('focus:get-achievements'),
         ```

      9. Add to preload/index.ts.

      ## ElectronAPI Types

      10. Add all 4 methods to ElectronAPI interface. Import types from shared/types/focus.ts.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx vitest run` — all 150 tests pass
      3. Verify focus_sessions and focus_achievements tables in schema
      4. Verify migration 0012 exists
      5. Verify focusService exports: saveSession, getStats, getDailyData, getAchievements, checkAndUnlockAchievements
      6. Verify 4 IPC handlers registered
      7. Verify preload bridge and ElectronAPI types
      8. Verify LEVEL_THRESHOLDS and ACHIEVEMENTS constants defined
    </verify>
    <done>
      focus_sessions + focus_achievements tables created. focusService with save/stats/daily/achievements.
      4 IPC handlers wired. Preload bridge + types complete. Migration 0012 ready.
      tsc clean, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - PGlite supports gen_random_uuid() (already used by all other tables)
      - GROUP BY date with timestamp works as expected in PGlite
      - 12 achievements is a good starting set (can add more later)
      - Level thresholds feel achievable but stretch appropriately
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Focus Dashboard Widget + enhanced completion modal</n>
    <files>
      src/renderer/components/FocusStatsWidget.tsx (new)
      src/renderer/components/DashboardModern.tsx
      src/renderer/components/FocusCompleteModal.tsx
      src/renderer/stores/focusStore.ts
    </files>
    <action>
      **WHY:** The dashboard is where users start their day. A prominent focus widget
      with XP, level, streak, and daily progress makes focus mode visible and creates
      a pull to engage. The enhanced completion modal provides immediate reward feedback.

      ## focusStore Updates

      1. Add persistent stats to focusStore:
         ```ts
         // New state fields
         stats: FocusStats | null;
         achievements: FocusAchievement[];
         // New actions
         loadStats: () => Promise<void>;
         saveSession: (input: { cardId?: string; durationMinutes: number; note?: string }) =>
           Promise<{ newAchievements: FocusAchievement[] }>;
         ```

      2. `loadStats()`: calls focusGetStats() and focusGetAchievements(), updates store.
      3. `saveSession()`: calls focusSaveSession() IPC, updates stats + achievements in store,
         returns newAchievements for the completion modal to show.

      ## FocusStatsWidget (src/renderer/components/FocusStatsWidget.tsx)

      4. Create a dashboard widget component. It fetches stats on mount and renders:

         **Layout (full-width card, col-span-12, placed after stats row):**
         ```
         ┌──────────────────────────────────────────────────────────────────────┐
         │  ⚡ Focus Mode                            [Start Focus Session]     │
         ├────────────┬────────────┬────────────┬───────────────────────────────┤
         │  TODAY     │  STREAK    │  LEVEL     │  THIS WEEK                   │
         │  45 min    │  🔥 7 days │  Lv.3      │  ▃▅▇▃▅▇▁  (7-day bar chart) │
         │  2 sessions│  Best: 14  │  Disciplined│  4h 30m total              │
         │            │            │  ████░░ 67%│                              │
         ├────────────┴────────────┴────────────┴───────────────────────────────┤
         │  Achievements: 🏆🏆🏆🏆⬜⬜⬜⬜⬜⬜⬜⬜  (4/12 unlocked)           │
         └──────────────────────────────────────────────────────────────────────┘
         ```

      5. **Today section**: todayMinutes + todaySessions from stats.
         Emerald accent color. If no sessions today, show "No sessions yet" with subtle CTA.

      6. **Streak section**: currentStreak with fire icon (🔥 or Flame from lucide-react).
         Show "Best: N" for longestStreak. Amber/orange color.
         If streak is 0, show "Start your streak!" in muted text.

      7. **Level section**: level number + levelName.
         XP progress bar: xpProgress (0-1) → width percentage.
         Colors: emerald bar on surface-700 track.
         Show "N min to next level" below progress bar.

      8. **Weekly chart**: 7-day mini bar chart (pure CSS, same as AI usage pattern).
         Fetch focusGetDaily(7). Each bar represents daily minutes, scaled to max.
         Day labels (Mon-Sun) below bars. Emerald bars.
         Show total weekly minutes below chart.

      9. **Achievements row**: horizontal scrollable row of 12 achievement icons.
         Unlocked: full color with tooltip showing name + unlock date.
         Locked: grayscale/muted with tooltip showing name + requirement.
         Show "N/12 unlocked" count.

      10. **Start button**: top-right of widget header. Opens FocusStartModal.
          Uses `useFocusStore.getState().setShowStartModal(true)`.
          Only show when mode is 'idle'.

      11. **Styling**: Follow DashboardModern patterns:
          - bg-white dark:bg-surface-900/50 rounded-2xl border shadow
          - Section headers: text-xs uppercase tracking-wider text-surface-500
          - Stats values: text-2xl font-bold
          - Compact but scannable

      ## DashboardModern Integration

      12. Import FocusStatsWidget.
      13. Place it after the stats row (3 stat cards) and BEFORE the Productivity Pulse:
          ```tsx
          {/* Focus Stats */}
          <div className="col-span-12">
            <FocusStatsWidget />
          </div>
          ```

      ## Enhanced FocusCompleteModal

      14. After saving the session, show reward feedback:
          - Fetch fresh stats from the store's saveSession() return value
          - Show XP earned: "+25 XP" with emerald pulse animation
          - Show level progress: "Level 3: Disciplined — 67% to next"
          - Show streak: "🔥 7 day streak!"
          - If new achievements unlocked: show them with celebration styling
            (gold border, icon, name, brief animation)
          - This replaces the plain "Session #N today" text
          - Keep the accomplishment textarea and Save & Start Break flow unchanged

      15. The save flow changes:
          - Instead of directly calling addCardComment, call focusStore.saveSession()
            which saves to DB and returns stats + newAchievements
          - THEN call addCardComment for the card comment (keep existing behavior)
          - Show reward info before transitioning to break
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx vitest run` — all tests pass
      3. Manual: Dashboard shows FocusStatsWidget after stats row
      4. Manual: Widget displays today's stats, streak, level, weekly chart, achievements
      5. Manual: "Start Focus Session" button opens FocusStartModal
      6. Manual: Complete a session → FocusCompleteModal shows XP earned, level progress, streak
      7. Manual: Stats update in real-time after session completion
      8. Manual: Weekly chart shows bars for days with sessions
      9. Manual: Achievement icons show locked/unlocked state
    </verify>
    <done>
      FocusStatsWidget on dashboard with today's stats, streak, XP/level, weekly chart,
      achievements preview. FocusCompleteModal shows reward feedback (XP, level, streak,
      new achievements). focusStore has persistent stats via IPC.
      tsc clean, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - DashboardModern has room for a full-width widget after stats row
      - 7-day bar chart is sufficient (don't need 30-day for focus)
      - Achievement icons can be lucide-react icons or simple text badges
      - XP animation doesn't need Framer Motion — CSS transitions suffice
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Achievement toasts + StatusBar XP display + focus quick action</n>
    <files>
      src/renderer/components/StatusBar.tsx
      src/renderer/components/DashboardModern.tsx
      src/renderer/components/AppShell.tsx (or wherever FocusCompleteModal is mounted)
    </files>
    <action>
      **WHY:** Achievements need real-time celebration beyond the completion modal — toasts
      visible anywhere in the app. StatusBar should show focus progress persistently. And
      the dashboard hero section needs a direct "Focus" action button for prominence.

      ## Achievement Toast Notifications

      1. When focusStore.saveSession() returns newAchievements with length > 0:
         - Show a toast for each new achievement
         - Toast format: "🏆 Achievement Unlocked: [Name] — [Description]"
         - Use the existing toast() system with 'success' type
         - Duration: 5 seconds (longer than normal 3s to celebrate)
         - If multiple achievements unlock at once, stagger by 500ms

      2. Wire this in the FocusCompleteModal's save flow and also in the Skip flow:
         - Save flow: after saveSession completes, toast each new achievement
         - Skip flow: if user skips, still save session to DB (just no note),
           then toast any achievements.
           IMPORTANT: Currently skip calls stop() without saving. Change it to save
           the session (with no note) before stopping, so the session still counts
           toward stats and achievements.

      ## StatusBar XP/Level Indicator

      3. When focus mode is idle, show a subtle level indicator in the StatusBar:
         - Left side (or right side, wherever there's space):
         - Format: "Lv.3 Disciplined" with a mini XP bar
         - Clicking it opens the FocusStartModal (quick access)
         - Use focusStore.stats for level info
         - Style: text-xs, muted when idle, emerald when focus active
         - This gives persistent visibility to the leveling system

      4. When in active focus mode, the existing timer display continues as-is.
         The level indicator hides during active focus (timer takes priority).

      ## Dashboard Quick Action Button

      5. In DashboardModern hero section, add a "Focus" quick action button:
         - Same pattern as Record, Project, Brainstorm, Idea, Standup buttons
         - Icon: Timer (from lucide-react)
         - Color: emerald
         - Click: opens FocusStartModal
         - Place it as the 6th button (after Standup)
         - If focus mode is active, show "In Focus" with a pulse animation instead

      ## Stats Loading

      6. In AppShell (or wherever the app initializes stores), call focusStore.loadStats()
         on startup so stats are available immediately for StatusBar and Dashboard.
         Same pattern as loadSettings() which is already called.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. `npx vitest run` — all tests pass
      3. Manual: Complete a session → achievement toast appears (if new achievement unlocked)
      4. Manual: Skip a session → session still saved to DB, stats updated
      5. Manual: StatusBar shows "Lv.N Name" when idle, clicking opens focus modal
      6. Manual: StatusBar hides level when focus timer is active
      7. Manual: Dashboard hero has "Focus" button that opens FocusStartModal
      8. Manual: Focus button shows "In Focus" pulse when session is active
      9. Manual: Stats load on app startup (no delay on first dashboard visit)
    </verify>
    <done>
      Achievement toasts celebrate unlocks anywhere in the app. StatusBar shows level/XP
      persistently. Dashboard has Focus quick action button. Skip still saves sessions.
      Stats load on startup. tsc clean, all tests pass.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Toast system supports custom duration (check — may need to pass duration param)
      - StatusBar has horizontal space for level indicator when idle
      - 6 hero action buttons still fit in the DashboardModern layout
      - AppShell is the right place to call loadStats (check where loadSettings is called)
    </assumptions>
  </task>
</phase>
</content>
