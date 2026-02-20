# Current State

## Session Info
Last updated: 2026-02-20
Session focus: Ad-hoc UX fixes and polish

## Position
Milestone: v2.0.0
Latest commit: 008d337 (fix: brainstorm auto-select only picks active sessions)
Plan H.1: COMPLETE (3/3 tasks) — Transcription Language Selection
Plan G.1: COMPLETE (2/2 tasks) — Achievement Banner Visual Overhaul
Plan E.1: COMPLETE (3/3 tasks) — Card Agent Foundation (Backend + Tools + Schema)
Plan E.2: COMPLETE (3/3 tasks) — Card Agent UI + 4 post-deploy fixes
Plan F.1: COMPLETE (3/3 tasks)
Plan F.2: COMPLETE (3/3 tasks) — Focus Time Tracking Page
Plan F.3: COMPLETE (3/3 tasks) — Session Edit, Delete, Chart Improvements
Version: 1.9.0 → targeting 2.0.0
Test suite: 150 tests across 7 files
Packaged app: `npm run make` verified working on Windows (Squirrel installer)
SELF-IMPROVE-NEW.md: 27 proposals — 14 implemented, 13 parked (not planned)
Plan A.1: COMPLETE (3/3 tasks)
Plan A.2: COMPLETE (2/2 tasks)
Plan B.1: COMPLETE (2/2 tasks)
Plan B.2: COMPLETE (3/3 tasks)
Plan C.1: COMPLETE (3/3 tasks) — Card Checklists / Subtasks
Plan C.2: COMPLETE (3/3 tasks) — Recurring Cards + Card Templates
Plan C.3: COMPLETE (3/3 tasks) — Focus Mode / Pomodoro Timer
Plan D.1: COMPLETE (3/3 tasks) — Meeting Prep Assistant
Plan D.2: COMPLETE (3/3 tasks) — Focus Mode Gamification
Plan D.3: COMPLETE (3/3 tasks) — Unified Gamification System
Plan D.4: COMPLETE (2/2 tasks) — 300-Level Visual Progression
Plan D.5: COMPLETE (3/3 tasks) — Achievement Expansion (28 → 84)
Plan D.6: COMPLETE (3/3 tasks) — Immersive Full-Screen Focus Overlay
Plan D.7: COMPLETE (3/3 tasks) — Light Mode Overhaul
Plan D.8: COMPLETE (2/2 tasks) — Achievement Banner
Plan D.9: COMPLETE (3/3 tasks) — Dark Mode Polish (Projects & Cards)

## Plan D.5 Results
- Task 1: Expand ACHIEVEMENTS array from 28 to 84 entries (04a7fb7)
  - Focus 12→24, Cards 4→14, Projects 2→8, Meetings 3→10, Ideas 2→8, Brainstorm 2→8, Cross 3→12
  - 56 new achievements with creative/funny names (Quarter Pounder, Touch Grass Soon, XP Dragon, etc.)
  - All entries use unique Lucide icon names (no duplicates across 84)
- Task 2: Update gamificationService with consolidated queries + 84 conditions (64c4864)
  - Replaced 3 individual xp_events queries with single GROUP BY (eventCountMap)
  - Added 10 new AchievementCounts fields: focusTotalMinutes, todayXp, aiPlanCount,
    aiDescriptionCount, aiBreakdownCount, aiStandupCount, meetingBriefCount,
    projectsArchived, brainstormExports, ideasAnalyzed
  - checkAndUnlockAchievements expanded from 28 to 84 condition checks
  - completionist_all uses ACHIEVEMENTS.length - 1 to avoid chicken-and-egg
- Task 3: Add 56 Lucide icons to ICON_MAP in AchievementsModal + FocusStatsWidget (48bc230)
  - Both files updated identically with 56 new imports + ICON_MAP entries
  - Aliased `Map` as `MapIcon` to avoid shadowing global Map constructor

## Plan D.4 Results
- Task 1: 300-level formula-based system with 30 named tiers (7efdde6)
  - Removed static 8-level LEVEL_THRESHOLDS array
  - Added LevelTier interface + LEVEL_TIERS array (30 tiers across 6 families)
  - Metal → Gem → Cosmic → Mythic → Divine → Ultimate visual escalation
  - Formula-based calculateLevel using quadratic formula (O(1) lookup)
  - getTier(level) + totalXpForLevel(n) helpers exported
  - Achievement updated: level_5 → level_50 (Gold Achiever)
- Task 2: LevelBadge component + UI integration (0f298af)
  - New LevelBadge.tsx: 3 sizes (sm/md/lg), tier-colored bg/border/text/glow
  - Shimmer animation for Divine/Ultimate tiers (CSS keyframes, module-level injection)
  - FocusStatsWidget: header + level column use LevelBadge, progress bar color dynamic
  - StatusBar: compact LevelBadge replaces "Lv.N Name" text
  - FocusCompleteModal: reward view uses centered LevelBadge + dynamic progress bar

## Plan D.3 Results
- Task 1: Unified gamification backend — schema + service + 28 achievements + IPC (d6ed188)
  - xp_events table with migration 0013 + backfill from focus_sessions
  - gamificationService: awardXP, getStats, getAchievements, getAchievementCounts, checkAndUnlockAchievements
  - 28 achievements across 7 categories (focus/cards/projects/meetings/ideas/brainstorm/cross)
  - XP_REWARDS for 18 event types, rebalanced level thresholds (XP-based, not minutes)
  - 3 gamification IPC handlers + preload bridge
  - focusService simplified (delegates achievements/levels to gamification)
- Task 2: Hook XP awards into all feature stores + gamificationStore (cdad49f)
  - New gamificationStore: unified stats/achievements, awardXP with +XP toasts
  - All stores fire XP: board (5/15), checklist (2), project (10/20), recording (20),
    meeting (10/5), idea (5/10/5), brainstorm (5/5), AI tasks (10/10/5/5)
  - focusStore delegates stats/achievements to gamificationStore
  - App startup loads unified gamification stats
- Task 3: Unified gamification widget + achievements modal + daily XP chart (c7b55b8)
  - FocusStatsWidget rewritten as unified progress hub: today XP, activity streak,
    level progress, 7-day XP bar chart, category breakdown (6 pills), 28 achievement badges
  - New AchievementsModal: full-screen grouped view by 7 categories
  - gamification:get-daily IPC for daily XP totals

## Ad-hoc Fixes This Session
- Fix: StatusBar level badge no longer opens FocusStartModal — now purely informational (b9289f6)
- Fix: Pending action count refreshes immediately on approve/dismiss/convert — no 30s delay (fdd6651)

## Plan D.6 Results
- Task 1: FocusOverlay.tsx full-screen component (10573c4)
  - SVG circular progress ring (280px, stroke-dashoffset animation)
  - Giant font-mono text-8xl countdown (emerald=focus, amber=break)
  - Top bar: LevelBadge + XP left, Flame streak right
  - Today stats: sessions, minutes, +XP with icons
  - 15 motivational quotes (random on mount, focus-only)
  - Break mode: amber theme, Coffee icon, "Relax, you earned it."
  - Breathing radial gradient background (4s CSS keyframes)
  - Pause/Resume + Stop circular buttons with labels
- Task 2: AppShell integration + StatusBar hiding (10573c4)
  - FocusOverlay lazy-loaded in App.tsx, rendered when mode=focus|break
  - StatusBar returns null during focus/break (full immersion)
  - Cleaned up dead focus/break code from StatusBar (TS narrowing)
  - z-40 overlay, FocusCompleteModal renders above on completion
- Task 3: Fade transition + polish (10573c4)
  - 500ms opacity fade-in via requestAnimationFrame + useState
  - Paused state: animate-pulse on ring + "PAUSED" label
  - "Ctrl+Shift+F to exit" keyboard hint at bottom

## Ad-hoc Fixes This Session
- Fix: Category pills in FocusStatsWidget now show "50 XP" instead of "50" (ece4f11)
  - User mistook XP values for item counts (e.g., "Meetings 50" looked like 50 meetings)

## Plan D.7 Results — Light Mode Overhaul
- Task 1: Class-based dark mode + natural Slate light palette (2df050f)
  - Added `@variant dark (&:where(.dark, .dark *))` for class-based dark mode
  - Updated useTheme.ts to toggle both `light` and `dark` classes
  - Replaced inverted CSS variable light palette with natural Slate values
  - Added light-specific CSS: scrollbar, select, TipTap, text selection, logo pulse, body bg
- Task 2: Component light mode support — 37 files (a84aca9)
  - Applied `dark:` variant pattern to all non-Modern components
  - Modals, StatusBar, sub-components, settings sections, FocusOverlay, toasts, error boundary
  - No dark mode values changed — only base (light) classes added
- Task 3: Visual polish — sweep + depth fixes (7846a59)
  - Fixed 8 more components with remaining dark-only patterns (count badges, inputs, timeline)
  - Added shadow-sm to MeetingCardModern for light-mode depth
  - Replaced hardcoded rgb color with CSS variable in FocusStatsWidget
  - All 150 tests pass, tsc clean

## Plan D.8 Results — Achievement Banner
- Task 1: AchievementBanner component + store + CSS animations (330 lines)
  - NEW: AchievementBanner.tsx — Zustand store with queue system (push/next/clear)
  - showAchievementBanner() convenience function for calling from any store
  - Dramatic top-center banner: slide-down entrance, pulsing category-colored glow, shimmer sweep
  - 7 category color configs (focus/emerald, cards/blue, projects/purple, meetings/amber, ideas/pink, brainstorm/cyan, cross/yellow)
  - Auto-dismiss after 6s, exit animation 400ms before next() call
  - Full dark/light mode support via runtime isDark check
  - ICON_MAP exported from AchievementsModal for shared icon lookup
  - 4 CSS keyframes in globals.css: achievement-enter, achievement-exit, achievement-glow, achievement-shimmer
- Task 2: Integration — gamificationStore + App.tsx
  - gamificationStore: replaced toast() calls with showAchievementBanner() in awardXP + refreshStats
  - +XP toasts still use toast() system (bottom-right, 2s)
  - AchievementBanner rendered in App.tsx between StatusBar and ToastContainer

## Plan D.9 Results — Dark Mode Polish (Projects & Cards)
- Task 1: Board column & Kanban card dark mode contrast fixes (d627b2d)
  - BoardColumnModern: solid column bg (removed /50 opacity), brighter count badge, visible dashed border, dark focus ring, subtler Add Card hover, stronger drag-over indicator
  - KanbanCardModern: brighter toolbar border, link badge text, checkbox border, hover glow
- Task 2: Projects page dark mode visibility fixes (d627b2d)
  - Hover shadow now visible (shadow-lg + /30 opacity), dropdown floats above card (surface-800), menu hover items surface-700, divider visible, star icon brighter, dark focus ring on search
- Task 3: Card detail modal dark mode depth & contrast fixes (d627b2d)
  - Deeper overlay (/60), brighter modal border (surface-600), priority active states /30 + /50, dropdown borders surface-600, action link hover brighter (surface-100), color picker ring /70

## Plan H.1 Results — Transcription Language Selection
- Task 1: Backend — configurable language across all providers (31c62d0)
  - TranscriptionLanguage type ('en' | 'cs' | 'auto') + TRANSCRIPTION_LANGUAGES constant
  - transcriptionService reads 'transcription:language' setting from DB at start
  - Whisper: omits language for 'auto' (per-segment detection), passes code otherwise
  - Deepgram: detect_language=true for 'auto', language=${code} otherwise
  - AssemblyAI: language_detection:true for 'auto', language_code otherwise
  - speakerDiarizationService also reads language setting for diarization calls
- Task 2: UI — language selector + model compatibility warnings (85f7411)
  - Language dropdown in RecordingControls (en/cs/auto-detect)
  - Language selector in Settings TranscriptionProviderSection
  - whisper:get-active-model IPC for checking model filename
  - Amber warning when .en model + non-English language + local provider
  - Selection persists via settings table (shared between both UIs)
- Task 3: Per-recording language storage + full pipeline (56b7b31)
  - Migration 0017: transcriptionLanguage varchar(10) on meetings table (nullable)
  - CreateMeetingInput + Zod schema updated
  - Full pipeline: RecordingControls → recordingStore → meetingService → DB
  - recording:start reads language from meeting record → audioProcessor → transcriptionService
  - MeetingDetailModal shows language label in metadata row (hidden for legacy meetings)

## Plan G.1 Results — Achievement Banner Visual Overhaul
- Task 1: Redesign banner layout + proper dark: variant classes (4f70dd5)
  - Removed all runtime isDark checks — every themed element uses Tailwind dark: variants
  - dark: prefix baked into CATEGORY_STYLES values for Tailwind CSS 4 detection
  - Wider banner (480px), larger icon (w-12 h-12, size 26)
  - Category label pill next to "Achievement Unlocked" text
  - 3px countdown progress bar at bottom (CSS transition, depletes over DISPLAY_MS)
  - Animation simplified: 50+ lines of inline styles → 3 CSS classes (enter/exit/hidden)
  - Light mode: bg-white, ring-1, shadow-xl, from-{color}-50/80, solid bg-{color}-100 icon circles
  - Dark mode: bg-surface-900, shadow-2xl, glow animation unchanged
  - CSS glow variable: .achievement-banner sets --achievement-glow-color via :where(.dark) rule
  - Shimmer unified to single .achievement-shimmer class (0.08 light, 0.15 dark)
- Task 2: Celebration particle effects + icon entrance animation (28ff382)
  - 6 CSS-only sparkle particles burst from icon on entrance (achievement-particle keyframes)
  - Particles use currentColor — auto-match category color in both modes
  - Icon bounce animation (500ms, 200ms delay for staggered entrance)
  - Entrance sequence: banner slides → icon bounces → particles burst
  - Light-mode ring pulse replaces invisible-on-white glow (achievement-ring-pulse)
  - :where(:not(.dark)) .achievement-banner-enter overrides glow → ring-pulse
  - No new dependencies — all pure CSS animations

## Ad-hoc Fixes (2026-02-20)
- Fix: Level progress bar invisible — dynamic .replace('text-','bg-') produced classes Tailwind CSS 4 JIT never detected; switched to backgroundColor:'currentColor' (39876f9)
- Feat: Brainstorm archive checkbox → Active/Archived tab system (5f04696)
- Feat: Per-page accent colors on sidebar nav items — matches dashboard quick actions (7a8f219)
- Feat: Clickable sidebar recording indicator with stop popover (0fbdf43 → ef41374 → 6a8acc1)
- Feat: Sidebar recording indicator shows amber "Saving" processing state, navigates to meetings after completion (b3703c3)
- Feat: Meeting cards with action items highlighted with amber border + prominent badge; removed All/Active/Done filter tabs (a43a96e)
- Fix: Meeting card title overlap — increased right padding for badges (1f3e3fa)
- Fix: Brainstorm auto-select only picks active sessions, not archived (008d337)

## Resume Context
8 ad-hoc UX fixes/features pushed this session.
Next action: TBD — user decides

## Plan F.1 Results — Focus Session History & Time Tracking
- Task 1: Focus history backend — session list + period aggregation queries (a421156)
  - getSessionHistory(): paginated sessions with card titles via LEFT JOIN
  - getPeriodStats(): single-query conditional aggregation (today/week/month/allTime) + 30-day dailyData
  - 2 IPC handlers: focus:get-history, focus:get-period-stats
  - Preload bridge: focusGetHistory, focusGetPeriodStats
  - Types: FocusSessionWithCard, FocusPeriodBucket, FocusPeriodStats
- Task 2: FocusHistoryModal — full session history view (386cfdf)
  - 4 period summary cards (Today highlighted, This Week, This Month, All Time)
  - 30-day activity bar chart (minutes per day, hover tooltips)
  - Paginated session history table with card titles, notes, relative dates
  - Loading skeleton, empty state, "Load More" pagination
  - 253 lines, dark/light mode support
- Task 3: Integration — entry points from widget, overlay, sidebar (21369c7)
  - focusStore: showHistoryModal state + setShowHistoryModal action
  - FocusStatsWidget: "View Focus History" button below achievements
  - FocusOverlay: "History" button in today stats row
  - SidebarModern: History icon button next to Focus Mode toggle
  - App.tsx: FocusHistoryModal lazy-loaded in Suspense block

## Plan F.2 Results — Focus Time Tracking Page
- Task 1: Cleanup + project-aware time tracking backend (2fe1aed)
  - Removed Focus History buttons from sidebar, widget, overlay, start modal
  - Removed showHistoryModal from focusStore + FocusHistoryModal render from App.tsx
  - New getTimeReport() service with 4-way LEFT JOIN (sessions → cards → columns → boards → projects)
  - New types: FocusTimeReportOptions, FocusSessionFull, FocusProjectTime, FocusTimeReport
  - New IPC handler: focus:get-time-report + preload bridge + ElectronAPI type
- Task 2: Focus Time Tracking page at /focus (4639a7d)
  - FocusPage.tsx (299 lines): period selector (week/month/last month/custom), project filter dropdown
  - Summary stats cards (4 cards: sessions, total time, avg session, active days)
  - Project breakdown horizontal bars (proportional, color-coded)
  - Daily activity bar chart (emerald bars, hover tooltips)
  - Date-grouped session list with Load More pagination (50 per page)
  - CSV export (Blob + anchor download) with project-filtered filenames
  - Empty state with Start Focus Session CTA
  - Sidebar: Focus nav item with Clock icon (Ctrl+6), Settings shifted to Ctrl+7
  - FocusHistoryModal.tsx deleted (replaced by page)
- Task 3: FocusStartModal enhancement (9c555fa)
  - Today's stats row (sessions + duration) shown above card search when sessions exist
  - "View Time Report" CTA navigates to /focus page
  - Keyboard shortcuts already updated by Task 2

## Plan F.3 Results — Session Edit, Delete, Chart Improvements
- Task 1: Activity chart — 6 period options + full-week display (d4cb97d)
  - Period type: thisWeek | lastWeek | last7Days | thisMonth | lastMonth | custom
  - thisWeek now shows full Mon-Sun (future days show 0 min bars)
  - lastWeek: previous Mon-Sun, last7Days: rolling 6-day lookback
  - Day-of-week labels (Mon, Tue, ...) for 7-day periods, numeric for others
  - Footer label: "Weekly Activity" for 7-day, "{N}-Day Activity" otherwise
- Task 2: Backend — session update/delete + direct project assignment (1c19404)
  - Migration 0015: projectId column on focus_sessions (FK to projects, onDelete: set null)
  - aliasedTable + COALESCE pattern: prefers direct projectId over card-chain projectId
  - Updated all getTimeReport queries (sessions, breakdown, summary, daily)
  - updateSession(id, {projectId, note}) + deleteSession(id) service functions
  - IPC: focus:update-session, focus:delete-session + preload bridge + ElectronAPI
- Task 3: Session edit + delete UI in FocusPage (13c5d94)
  - Hover-reveal Pencil + Trash2 icons on session rows
  - Inline edit form: project dropdown + note input + Save/Cancel
  - Delete with 5s undo toast (optimistic removal, actual delete after timeout)
  - focusStore: updateSession + deleteSession thin wrappers

## Plan E.1 Results — Card Agent Foundation (Backend + Tools + Schema)
- Task 1: Agent messages schema + migration + shared types (3fb806d)
  - card_agent_messages table: 7 columns (id, cardId, role, content, toolCalls, toolResults, createdAt)
  - Migration 0016 with corrected journal timestamp (PGlite monotonic fix)
  - Shared types: CardAgentMessage, ToolCallRecord, ToolResultRecord, AgentAction
  - AITaskType extended with 'card_agent'
- Task 2: Card agent service with 7 tools + context builder (c0715ac)
  - buildCardContext(): queries card + column + board + project + checklist + comments + relationships
  - 7 tools: getCardDetails, searchProjectCards, addChecklistItem, toggleChecklistItem, addComment, updateDescription, createCard
  - AI SDK v6 verified: tool() with inputSchema (Zod), streamText + stopWhen: stepCountIs(5)
  - Message persistence: getMessages, addMessage, clearMessages, getMessageCount
  - collectAgentActions helper for UI action badges
- Task 3: IPC handlers for agent chat — streaming + tool events (ea25770)
  - 5 IPC handlers: send-message (streaming), get-messages, clear-messages, get-message-count, abort
  - fullStream iteration: text-delta + tool-call + tool-result events forwarded to renderer
  - Per-card AbortController map (multiple simultaneous conversations)
  - Preload bridge: 7 methods (5 invoke + 2 event listeners)
  - ElectronAPI interface updated with card agent section

## Plan E.2 Results — Card Agent UI
- Task 1: cardAgentStore + CardAgentPanel (b7e0c95)
  - Zustand store: 6 actions (loadMessages, sendMessage, clearMessages, abort, loadMessageCount, reset)
  - Streaming pattern: onCardAgentChunk + onCardAgentToolEvent listeners, cleanup in finally block
  - CardAgentPanel: markdown-rendered messages, 4 starter prompts (2x2 grid), auto-scroll, input area
  - Send/Stop/Clear controls, textarea auto-resize, Shift+Enter for newline
- Task 2: CardDetailModal tab system (9b6dc0e)
  - 2-tab bar: Details (LayoutList icon) + AI Agent (Bot icon) with emerald message count badge
  - Existing content wrapped in Details tab conditional (zero visual changes)
  - CardAgentPanel lazy-loaded in 60vh container with Suspense spinner
  - Agent store resets on modal close, message count loaded on mount
- Task 3: Tool visualization + polish (3ab9cda)
  - Streaming tool events: animated pills (Loader2 amber for 'call', CheckCircle2 emerald for 'result')
  - Human-readable tool descriptions (present tense during streaming, past tense on persisted)
  - Action badges on assistant messages from toolCalls[] with success/failure icons
  - Copy button on assistant messages (hover-reveal, top-right)
  - No-provider guard: centered message + "Open Settings" link
  - Error toast via store catch block (surfaces IPC errors like "No AI provider configured")
  - Card data refresh after write tool mutations (loadCardDetails)
  - Message count update after each turn (for tab badge)

## Ad-hoc Fixes After E.2
- Fix: streaming state getting stuck — reset on load, abort resets state, 90s timeout (e3901f5)
- Fix: Kimi K2.5 temperature error — don't force 0.7, let provider decide (10cbf1d)
- Fix: agent panel input unreachable — flex modal layout when agent tab active (1f84a4b)
- Fix: suppress unhandled rejection from AI SDK continuation errors (142a054)
  - Kimi K2.5 "thinking mode" rejects multi-step tool continuations
  - Multi-step stays enabled (stepCountIs(5)) for GPT-4o/Claude full summaries
  - Kimi gracefully degrades: initial text + tool execution, no summary

## Known Limitation: Kimi K2.5 + Multi-Step Tool Calling
- Kimi K2.5's "thinking mode" requires `reasoning_content` on assistant tool call messages
- AI SDK v6 doesn't include this field → continuation step fails
- Graceful degradation: partial results kept (initial text + tool badges)
- GPT-4o / Claude handle multi-step correctly → full summaries after tool calls

## Resume Context
Plan E.2 COMPLETE + 4 bug fixes pushed
Card Agent feature is end-to-end operational (schema → service → IPC → store → UI)
Next action: TBD — user decides

## Plan D.2 Results
- Task 1: Focus sessions DB + service + IPC for gamification foundation (4e6b206)
  - focus_sessions and focus_achievements Drizzle schema + migration 0012
  - focusService: saveSession, getStats (streak calc, XP/level), getDailyData, getAchievements, checkAndUnlockAchievements
  - 4 IPC handlers: focus:save-session, focus:get-stats, focus:get-daily, focus:get-achievements
  - Preload bridge (focusBridge) + shared types (FocusStats, FocusAchievement, LEVEL_THRESHOLDS, ACHIEVEMENTS, calculateLevel)
- Task 2: FocusStatsWidget on dashboard + XP reward feedback in completion modal (da49ad6)
  - FocusStatsWidget: today stats, streak counter, XP/level progress bar, 7-day bar chart, achievements row
  - FocusCompleteModal: reward view with "+N XP", level progress, streak, new achievement badges
  - focusStore: loadStats + saveSession actions for persistent stats via IPC
  - Auto-transitions to break after 2s reward display
- Task 3: Achievement toasts + StatusBar XP level + Focus quick action button (38da38a)
  - Achievement toast notifications (5s duration, staggered 500ms) on save and skip
  - Skip now saves session to DB (counts toward XP/achievements)
  - StatusBar: clickable "Lv.N Name" indicator when idle → opens FocusStartModal
  - Dashboard hero: Focus quick action button with pulse animation when active
  - Stats load on app startup via Promise.allSettled in AppShell

## Resume Context
Next action: Execute Plan D.3 — Unified Gamification System (3 tasks)
Prerequisites: None — all clean
Plan D.3 confidence: HIGH (all 3 tasks)

## Plan D.3 Summary — Unified Gamification System
Expands gamification from focus-only to ALL features. 3 tasks:
- Task 1: xp_events table + gamificationService + 28 achievements + shared types + IPC
- Task 2: Hook awardXP into all stores (board, project, meeting, idea, brainstorm, AI)
- Task 3: Unified widget + AchievementsModal + StatusBar + FocusCompleteModal updates

## Plan D.1 Results
- Task 1: Meeting prep service + schema migration + IPC handler (4c918dc)
  - meetingPrepService.ts: queries project state since last meeting (card changes, pending actions, high-priority cards)
  - Generates AI briefing via resolveTaskModel('meeting_prep')
  - Schema: prepBriefing text column on meetings table, migration 0011
  - meetings:generate-prep IPC handler + preload bridge + types
  - CreateMeetingInput accepts optional prepBriefing
- Task 2: MeetingPrepSection UI in RecordingControls (7ad1836)
  - Collapsible card shows prep data when project selected (before recording)
  - Structured sections: card changes, pending actions, high-priority, AI briefing
  - Loading skeleton, error state with retry, regenerate button
  - recordingStore carries prepBriefing to createMeeting on recording start
- Task 3: Prep in MeetingDetailModal + undiscussed item flagging (e27854e)
  - Collapsible "Meeting Prep" section in modal (collapsed by default)
  - generateBrief() appends prep context to AI prompt when available
  - Produces "Items Not Discussed" section flagging gaps
  - Backwards-compatible: existing meetings unaffected

## Ad-hoc Changes This Session
- Feat: Project-scoped standup generation (a6779fe)
  - Standup button opens fixed-position picker dropdown with "All Projects" + each active project
  - IPC handler accepts optional `projectId` — filters activities, action items, and active cards

## Plan B.2 Results
- Task 1: Global Transcript Search in CommandPalette (3d417e7)
  - `meetings:search-transcripts` IPC with ILIKE + join through meetings table
  - CommandPalette "Transcripts" category with 300ms debounce (3+ chars)
  - Click navigates to meeting with transcriptSearch param pre-populated
  - MeetingDetailModal auto-seeds search from URL param
- Task 2: Meeting Export as Markdown (e62da47)
  - Download button in MeetingDetailModal header
  - Formatted .md with title, metadata, summary, action items (checkboxes), transcript (HH:MM:SS)
  - Browser Blob+download pattern (same as CSV export)
- Task 3: AI Usage Dashboard with Visual Charts (50e9010)
  - New `ai:get-usage-daily` IPC groups by date, fills 30-day series
  - Summary cards: tokens (compact notation), cost, API calls
  - 30-day vertical bar chart (pure CSS, hover tooltips)
  - Task type + model breakdowns with color-coded horizontal progress bars

## Resume Context
Next action: Execute Plan D.2 (Focus Mode Gamification) — 3 tasks
Prerequisites: None — all clean
Plan D.2 confidence: HIGH (all 3 tasks)

## Plan C.3 Results
- Task 1: Focus Store + notifications:show IPC + Ctrl+Shift+F shortcut (b07f296)
  - focusStore.ts Zustand store with full Pomodoro timer engine
  - Mode: idle → focus → completed → break → idle cycle
  - setInterval-based tick(), pause/resume, session counting
  - notifications:show IPC handler (main + preload + types)
  - Ctrl+Shift+F keyboard shortcut registered + visible in shortcuts modal
  - Settings persistence for work/break durations via settings IPC
- Task 2: Focus Mode UI — StatusBar timer, FocusStartModal, sidebar collapse (fab5456)
  - StatusBar: live countdown with card name, pause/resume/stop, color-coded (emerald=focus, amber=break)
  - FocusStartModal: card search + duration presets (25/30/45/60 + custom) + start button
  - SidebarModern: Timer icon button (opens modal / stops session), emerald pulse when active
  - AppLayout: sidebar hidden during focus/break modes
- Task 3: Session completion — FocusCompleteModal + card comment logging + break cycle (a6b0f82)
  - FocusCompleteModal: accomplishment textarea, session summary, Save & Start Break / Skip
  - Card comment logged with tomato emoji prefix on save
  - Break timer auto-starts after saving
  - Break-end toast notification via AppShell mode transition watcher

## Plan C.2 Results
- Task 1: Schema + migration + IPC handlers for recurring cards and card templates (0cf5915)
  - 3 new columns on cards: recurrenceType (varchar), recurrenceEndDate, sourceRecurringId
  - card_templates table: id, projectId, name, description, priority, labelNames
  - spawnRecurringCard utility auto-creates next occurrence on completion
  - cards:update returns { card, spawnedCard } — boardStore handles spawn
  - 4 template IPC handlers: list, create, delete, save-from-card
  - Migration 0010 generated and verified
- Task 2: Recurring Cards UI (6908931)
  - CardDetailModal: "Repeat" section with dropdown (None/Daily/Weekly/Bi-weekly/Monthly)
  - Next occurrence date preview when due date + recurrence set
  - End repeat date picker with clear button
  - KanbanCard + KanbanCardModern: blue RefreshCw badge on recurring cards
  - boardStore shows toast when recurring card spawns
- Task 3: DB-backed Card Templates (28c0184)
  - CARD_TEMPLATES renamed to BUILTIN_TEMPLATES, 5 built-in always available
  - "Save as Template" button (BookmarkPlus) in CardDetailModal
  - Template dropdown shows "Your Templates" (DB) + "Built-in" groups
  - DB templates deletable via hover X button
  - BoardColumn + BoardColumnModern: "From template" in card creation flow
  - Selected template applies priority + description to new card
  - boardStore.addCard now returns Card (for template description application)

## Plan C.1 Results
- Task 1: Schema + migration + IPC handlers for checklist items (006c7a3)
  - `card_checklist_items` table with migration 0009
  - 6 IPC handlers: get, add, update, delete, reorder, batch-add
  - Preload bridge, ElectronAPI types, Zod validation schemas
- Task 2: ChecklistSection UI component in CardDetailModal (8cc0611)
  - New ChecklistSection.tsx (178 lines) with progress bar, inline edit, rapid entry
  - cardDetailStore extended with optimistic CRUD actions
  - Rendered before AttachmentsSection in card detail view
- Task 3: KanbanCard checklist badge + TaskBreakdown integration (434c194)
  - Batch checklist count query (Query 5) in cards:list-by-board
  - "3/7" badge on KanbanCard (emerald when all complete)
  - "Add to Checklist" button in TaskBreakdownSection alongside "Create as Cards"

## Plan B.1 Results
- Task 1: CSS splash screen in index.html (cbc4d23)
  - Pure HTML+CSS splash renders before any JS loads — no white flash
  - Full viewport #020617 background, "Living Dashboard" title, 3-dot pulse animation
  - `.splash-hidden` class with 300ms fade-out transition
- Task 2: React splash dismissal in App.tsx (cbc4d23)
  - Promise.allSettled waits for all 5 store hydrations before setting appReady
  - Splash fades out smoothly when appReady=true, removed from DOM after 400ms
  - App content gated on appReady — no empty-state flash between splash and dashboard

## Plan A.2 Results
- Task 1: Daily Standup Generator ✓ (1a8fb34)
  - `dashboard:generate-standup` IPC queries card activities (48h), active cards (7d), pending action items (7d)
  - Joins through cardActivities→cards→columns→boards→projects for full context
  - AI generates 3-section report: What I did / Doing today / Blockers
  - Classic: 5th quick action button + dismissible result card with copy/regenerate
  - Modern: 5th hero action button (emerald) + full-width result card in grid
- Task 2: Productivity Pulse ✓ (f4cbd79)
  - `dashboard:activity-data` IPC queries cards, meetings, ideas createdAt (90 days)
  - New ActivityHeatmap component — pure CSS Grid, no chart library
  - calculateStreak counts consecutive weekdays with activity
  - Classic: section below standup, above projects — emerald heatmap + streak counter
  - Modern: full-width card in grid below stats row — same heatmap + streak

## Plan A.1 Results
- Task 1: Pin/Star Projects ✓ (2b7ffdc)
  - Schema migration adds `pinned` boolean column to projects
  - Pinned projects sort to top via `desc(projects.pinned)` ordering
  - Star toggle on project cards (always visible when pinned, hover when not)
  - Dashboard shows star icon next to pinned project names
- Task 2: AI Generate Card Description ✓ (6dd0b54)
  - `card:generate-description` IPC traverses card→column→board→project for context
  - Sparkles button in CardDetailModal next to "Apply Template"
  - Uses configured AI provider with temperature 0.7, max 200 tokens
  - Generates 2-3 sentence HTML description from title + priority + labels
- Task 3: Quick Capture in Command Palette ✓ (f5f08e6)
  - When typed text has <3 data matches, shows Quick Capture section
  - "Create idea" — saves to idea repository via ideaStore
  - "Create card in [Project]" — creates in first column of most recent project
  - "Start brainstorm" — navigates to brainstorm page
  - Works via Ctrl+K and global Ctrl+Shift+Space shortcut

## Ad-hoc Fixes (2026-02-16)
- Fix: Backup list regex mismatch — backups were created but never listed (6e6bbd1)
  - listBackups regex expected \d{6} for time but filenames had HH-MM-SS with dashes
- Feat: Collapse activity log to 4 latest with expand toggle (24842fe)
- Feat: Collapse comments to 3 latest with expand toggle (3d4748b)
- Feat: Collapse relationships to 3 latest with expand toggle (5b6fb8e)
- Feat: "Save audio recordings" toggle in Settings (c4142ad)
  - Toggle in Recordings section: when off, WAV files are not saved to disk
  - Transcripts still captured live during recording regardless of setting
  - Folder picker hidden when saving is disabled
  - audioProcessor reads `audio:saveRecordings` setting, defaults to true
- Fix: Brainstorm scroll-up during streaming no longer snaps back to bottom (2b3ad51)
  - Scroll listener tracks if user is >80px from bottom; auto-scroll only when at bottom
  - Scroll lock resets when user sends a new message

## Plan 15.2 Results (SELF-IMPROVE-2.md final 3 proposals)
- Task 1: "Since last visit" context on dashboard ✓ (05d3292)
  - localStorage tracks dashboard visit timestamps across sessions
  - Returns show "Since your last visit: N new meetings, M new ideas" below greeting
  - First-ever visit shows nothing; only counts meetings + ideas (not auto-created entities)
- Task 2: Keyboard shortcut hints in sidebar and modal ✓ (5622327)
  - Sidebar NavLink tooltips show shortcut on hover: "Home (Ctrl+1)", "Projects (Ctrl+2)", etc.
  - KeyboardShortcutsModal gains "Page Shortcuts" group: /, Ctrl+N, Esc
- Task 3: Undo card deletion via delayed delete and toast ✓ (f8fddfc)
  - Replaces two-click confirm with undo-based flow (Gmail/Slack pattern)
  - Card removed from UI instantly, 5s toast with "Undo" button, actual delete after timeout
  - Toast system extended with action buttons and configurable duration
  - boardStore gains removeCardFromUI/restoreCardToUI for optimistic updates

## Plan 15.1 Results (SELF-IMPROVE-2.md remaining 6 → 3)
- Task 1: Toast notification system ✓ (9cd8846)
  - Zustand-based `useToastStore` + standalone `toast()` function
  - `ToastContainer` renders fixed bottom-right, max 3 toasts, 3s auto-dismiss
  - Wired up 3 ProjectsPage actions as proof of concept (create/archive/delete)
- Task 2: Duplicate project action ✓ (432a1da)
  - `projects:duplicate` IPC handler copies project + boards + columns (not cards)
  - Copy button in project card hover actions (between Plan with AI and Archive)
  - Toast confirmation: "Duplicated as 'Name (copy)'"
- Task 3: Dynamic status bar ✓ (5613f31)
  - `meetings:pending-action-count` IPC with COUNT query on action_items
  - StatusBar shows amber "N pending actions" when > 0, polled every 30s
  - Right side changed from "Ctrl+1-5: Navigate" to "Ctrl+K: Commands"

## Plan 14.1 Results (SELF-IMPROVE-2.md remaining 7)
- Task 1: Meeting card action item count badge + delete button ✓ (6a18676)
  - New `getActionItemCounts` service + `meetings:action-item-counts` IPC
  - MeetingCard shows ListChecks icon + count badge when action items exist
  - Hover-reveal Trash2 delete button with window.confirm guard
  - MeetingsPage passes actionItemCount and onDelete props
- Task 2: Brainstorm save-as-card, Ctrl+N shortcut, filtered column count ✓ (10c3788)
  - "Save as Card" button on AI messages (project-linked sessions only)
  - Card created in first column of linked project's board
  - Ctrl+N keyboard shortcut opens new session form
  - Column headers show "X of Y" format when filters are active
- Task 3: Card detail relative time + last recording duration ✓ (cf2f8f3)
  - CardDetailModal timestamps show relative time: "Created: Feb 10 (6d ago)"
  - RecordingControls idle state shows last completed recording title + duration

## Plan 13.2 Results (SELF-IMPROVE-2.md remaining 10)
- Task 1: Board UX quick wins + command palette HTML fix ✓ (501b0e7)
  - stripHtml helper strips HTML from card/project/idea descriptions in CommandPalette
  - Empty filter state: "No cards match your filters" + Clear Filters button
  - `/` keyboard shortcut focuses board search (GitHub/Gmail convention)
  - Escape closes priority/label filter dropdowns and blurs search
  - 1-line description preview on KanbanCard (line-clamp-1, HTML stripped)
- Task 2: Brainstorm streaming markdown, auto-select, textarea resize ✓ (f40ed59)
  - Streaming responses render with ReactMarkdown + remark-gfm (matches ChatMessage)
  - Last active session persisted to localStorage and auto-loaded on revisit
  - Textarea auto-resizes with content up to ~6 lines, resets after send
- Task 3: Board CSV export + meeting card project color ✓ (fb408e7)
  - Export CSV button in board toolbar — downloads all cards with metadata
  - Meeting cards show project color dot next to project name badge

## Plan 13.1 Results (SELF-IMPROVE-2.md top 5)
- Task 1: Dashboard deep-links + quick action triggers + board back arrow fix ✓ (4f73670)
  - Recent meeting/idea clicks deep-link to detail modals via ?openMeeting=/openIdea= params
  - Quick actions trigger creation flows via ?action=create/record params
  - Board back arrow → /projects instead of /
- Task 2: Recording preflight check + project selector ✓ (37f8360)
  - Whisper warning moved above recording controls
  - Inline amber preflight warning in RecordingControls when no model
  - Project selector dropdown pre-links meetings to projects at recording time
- Task 3: Column rename + empty dashboard onboarding CTA ✓ (25e95bb)
  - Double-click column name → inline rename input (Enter/blur saves, Escape cancels)
  - Column delete shows "Delete N cards?" when cards exist
  - Empty dashboard shows 3-step onboarding CTA (AI provider, Whisper, first project)

## Plan 12.3 Results
Home Dashboard & Project Health (SELF-IMPROVE.md items E2, F3, Q8, Q9, F10, F7):
- Task 1: Home Dashboard as default route ✓ (068d58f)
  - New DashboardPage with greeting, quick actions, active projects, recent meetings, recent ideas
  - ProjectsPage moved to /projects route
  - Sidebar updated: Home (LayoutDashboard) icon first, Projects at /projects
  - Keyboard shortcuts shifted: Ctrl+1=Home, Ctrl+2=Projects, etc.
  - CommandPalette updated with Home entry and /projects navigation
- Task 2: Card count badges on ProjectsPage ✓ (81a9ac5)
  - LayoutList icon + "N cards" badge per project card
  - Uses allCards from boardStore grouped by projectId (no extra IPC)
  - DashboardPage already had card counts from Task 1
- Task 3: Quick keyboard/workflow wins ✓ (addb102)
  - Enter-to-create project: already worked (form onSubmit)
  - Ctrl+Enter brainstorm: already worked (Enter sends, Shift+Enter for newline)
  - Auto-suggest meeting title: "Meeting - Feb 15, 2:30 PM" pre-filled
  - Discard recording: "Discard last recording" button with confirmation

## Plan 12.2 Results
Workflow speed & UX polish (SELF-IMPROVE.md items E4, F5, Q5, Q1, Q10, Q23):
- Task 1: One-click push all approved action items ✓ (74f0eb0)
  - "Push N approved to [Project]" button in ActionItemList
  - Skips 3-step ConvertActionModal, creates cards in first column
  - Uses existing getBoards/getColumns/convertActionToCard IPC
  - Existing batch flow preserved as alternative
- Task 2: Brainstorm starter prompts + stop generating ✓ (089e62f)
  - 4 clickable starter prompts in empty sessions (2-column grid)
  - AbortController-based stream cancellation via brainstorm:abort IPC
  - Stop button with Square icon during streaming
  - Partial responses preserved on abort
- Task 3: Quick polish — auto-focus, project link ✓ (aa50215)
  - RecordingControls title input auto-focuses on mount
  - MeetingDetailModal "Open board" button navigates to linked project
  - Card count badges already existed in BoardColumn.tsx (no change needed)

## Plan 12.1 Results
Based on SELF-IMPROVE.md analysis (43 proposals). Top 3 HIGH-impact items:
- Task 1: Fix command palette card navigation ✓ (ceb5f3c)
  - New `cards:list-all` IPC endpoint (cards→columns→boards join for projectId)
  - allCards in boardStore, eager-loaded in App.tsx
  - CommandPalette navigates to `/projects/{id}?openCard={cardId}`
  - BoardPage reads openCard param → auto-opens CardDetailModal
- Task 2: Auto-save idea edits ✓ (6d1e20c)
  - IdeaDetailModal: title/description save on blur, status/effort/impact/tags save immediately
  - Removed manual Save button and handleSave function
  - Matches CardDetailModal auto-save pattern
- Task 3: Project rename + delete ✓ (258bba9)
  - Inline rename: click Pencil → input replaces h3, Enter/blur saves, Escape cancels
  - Delete with confirmation: Trash2 icon, window.confirm with warning text
  - Both available on active and archived project cards

## Plan 11.3 Results
- Task 1: Show Archived toggle on ProjectsPage ✓ (7662047)
  - Modified: src/renderer/pages/ProjectsPage.tsx — showArchived state, checkbox, opacity styling, unarchive action
- Task 2: Sort controls on IdeasPage + MeetingsPage ✓ (03f5d5d)
  - Modified: src/renderer/pages/IdeasPage.tsx — sort dropdown (newest/oldest/title)
  - Modified: src/renderer/pages/MeetingsPage.tsx — sort dropdown (newest/oldest/title)
- Task 3: Documentation reconciliation ✓ (23b784d)
  - Modified: PROJECT.md — Docker→PGlite (3 places)
  - Modified: REQUIREMENTS.md — whisper package + Docker refs (5 places)
  - Modified: ROADMAP.md — phase checkboxes + PGlite refs (4 places)
  - Modified: CHEATSHEET.md — removed Framer Motion from architecture

## Plan 11.2 Results
- Task 1: Extract card-move reordering logic ✓ (f55bb97)
- Task 2: Extract action-item parsing ✓ (16d4792)
- Task 3: Comprehensive tests — 51 new tests ✓ (331836f)

## Plan 11.1 Results
- Task 1: Close-during-recording guard ✓ (baaf733)
- Task 2: Eager entity loading for command palette ✓ (6d982ee)
- Task 3: react-markdown + remark-gfm for brainstorm chat ✓ (4c9e1c6)

## Phase 1-7 — COMPLETE
All requirements R1-R17 delivered (99 points).

## Phase 8 — COMPLETE
Plans 8.1-8.7 + 4 ad-hoc features delivered.

## Phase 9 — COMPLETE
- Plan 9.1: PGlite migration + packaging
- Plan 9.2: Post-recording UX (3 tasks)
- Ad-hoc: DevTools fix, recording crash fix, audio device selection, level meter, silence detection
- Ad-hoc: Custom recordings save folder

## Phase 10 — COMPLETE (Enterprise Distribution)
- Plan 10.1: Self-signed code signing, WiX MSI, proxy-aware networking
- Ad-hoc: Retro equalizer audio level meter
- Plan 10.2: Zustand selectors, React.memo, remove Framer Motion + lazy modals
- Plan 10.3: Command palette, transcript search, dependency badges
- Plan 10.4: Brainstorm templates, always-on-top toggle, keyboard shortcuts overlay

## Phase 11 — COMPLETE (Review Remediation)
- Plan 11.1: Close-during-recording guard, command palette loading, markdown rendering
- Plan 11.2: Extract card-move/action-item logic, 51 new tests
- Plan 11.3: Archive toggle, sort controls, documentation reconciliation

## Confidence Levels
Overall approach: HIGH
Plan C.1: HIGH — all 3 tasks verified with tsc + 150/150 tests
Plan C.2: HIGH — all 3 tasks verified with tsc + 150/150 tests
Plan C.3: HIGH — all 3 tasks verified with tsc + 150/150 tests
All tasks: HIGH — verified with tsc + 150/150 tests

## Blockers
- None
