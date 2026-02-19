# New Feature Proposals: Living Dashboard

**Analyzed:** 2026-02-16
**Focus:** New features only (no polish/fixes)
**Agents:** 3 parallel (2x Opus core + engagement, 1x Sonnet quick-wins)
**Previous Analyses:** SELF-IMPROVE.md (43 proposals, all implemented), SELF-IMPROVE-2.md (32 proposals, all implemented)

---

## Do First (Top 5 Highest-Impact New Features)

1. **Global Quick Capture Hotkey (Ctrl+Shift+Space)** -- Impact: HIGH, Effort: LOW (4 hours)
   WHY: The biggest competitor to any productivity tool is friction. Capturing a thought currently requires switching to the app, navigating to the right page, and filling out a form. A global hotkey opens a compact floating overlay from ANY app. AI classifies input and routes it: task-like text becomes a card, questions become brainstorm starters, notes become ideas. This makes the Living Dashboard the universal inbox for work thoughts. Once users rely on this, they physically cannot work without it.

2. **Morning Briefing / Smart Daily Agenda** -- Impact: HIGH, Effort: MEDIUM (1-2 weeks)
   WHY: The dashboard answers "what happened recently" but not "what should I work on today?" A daily briefing synthesizes: overdue/due-today cards, pending action items from recent meetings, stale ideas, and an AI-generated "focus for today." This transforms the app from "a tool you use sometimes" into the first app opened every morning. The briefing is generated once per day (cached) and refreshed on demand.

3. **Transcript Search (per-meeting + global)** -- Impact: HIGH, Effort: LOW (1-3 days)
   WHY: Meeting transcripts become a searchable knowledge base instead of "record and forget." Full-text search within MeetingDetailModal + a global "Search Transcripts" action in CommandPalette. Click results to jump to the exact transcript segment with timestamp. The data already exists in the transcripts table -- this just surfaces it.

4. **Card Checklists / Subtasks** -- Impact: HIGH, Effort: MEDIUM (1-2 weeks)
   WHY: Real work happens at the subtask level. Without checklists, users either create separate cards for each subtask (polluting the board) or track subtasks mentally. AI-generated task breakdowns (TaskBreakdownSection) can feed directly into checklists. KanbanCard shows "3/7" progress badge. Bridges high-level cards and granular work.

5. **Smart Follow-Up Nudges** -- Impact: HIGH, Effort: MEDIUM (1-2 weeks)
   WHY: Transforms the app from passive to proactive. Monitors for patterns: unconverted action items, stale cards, unlinked meetings, approaching due dates. Surfaces nudges on the dashboard with one-click action buttons. Users trust the system to catch things they'd otherwise forget. This is the feature that creates dependency.

---

## Core Feature Proposals

### New Capabilities

| # | Feature | Impact | Effort | Category |
|---|---------|--------|--------|----------|
| F1 | Global Quick Capture Hotkey | HIGH | LOW (4h) | Capture |
| F2 | Morning Briefing / Daily Agenda | HIGH | MEDIUM (1-2w) | Daily Ritual |
| F3 | Transcript Search (per-meeting + global) | HIGH | LOW (1-3d) | Search |
| F4 | Card Checklists / Subtasks | HIGH | MEDIUM (1-2w) | Task Management |
| F5 | Smart Follow-Up Nudges | HIGH | MEDIUM (1-2w) | Proactive AI |
| F6 | Weekly Review / Reflection Journal | HIGH | MEDIUM (1-2w) | Accumulating Value |
| F7 | Meeting Prep Assistant | HIGH | MEDIUM (1-2w) | Meeting Intelligence |
| F8 | Recurring Cards (Repeating Tasks) | HIGH | MEDIUM (1-2w) | Task Management |
| F9 | Meeting Cross-Reference ("We discussed this before") | HIGH | MEDIUM (1-2w) | Knowledge Graph |
| F10 | Time Tracking on Cards | HIGH | MEDIUM (1-2w) | Productivity |
| F11 | Decision Tracker (extracted from meetings) | MEDIUM | MEDIUM (1-2w) | Meeting Intelligence |
| F12 | Card Templates | MEDIUM | LOW (6h) | Workflow |
| F13 | Idea Priority Queue with AI Ranking | MEDIUM | LOW (1-3d) | Ideas |
| F14 | AI Cost & Usage Dashboard | MEDIUM | LOW (1-3d) | Settings |
| F15 | Meeting Export (Markdown/PDF) | MEDIUM | LOW (1-3d) | Export |
| F16 | Knowledge Graph Visualization | HIGH | HIGH (2+w) | Visualization |
| F17 | Custom Dashboard Widgets | MEDIUM | HIGH (2+w) | Dashboard |

---

## Engagement & Stickiness Proposals

### Habit-Forming Features

| # | Feature | Impact | Effort | Habit Type |
|---|---------|--------|--------|------------|
| E1 | Productivity Pulse (activity heatmap + streaks) | MEDIUM | LOW (1-3d) | Emotional Hook |
| E2 | Focus Mode / Pomodoro Timer | MEDIUM | LOW (6h) | Deep Work |
| E3 | Calendar View for Due Dates | MEDIUM | MEDIUM (2d) | Time Planning |
| E4 | Project Timeline / Gantt View | MEDIUM | HIGH (3d) | Planning |

### Habit Loops

**Morning Ritual:** Open app -> Morning Briefing shows priorities -> Address nudges -> Start first focus session
**Capture Loop:** Thought occurs -> Ctrl+Shift+Space -> AI routes to right place -> Zero context switch
**Weekly Ritual:** Friday notification -> Review auto-generated weekly summary -> Add notes -> Start next week prepared
**Streak:** Open dashboard -> See activity heatmap -> Maintain streak -> Satisfaction

---

## Quick-Win New Features

### Small features with outsized impact (< 1 day each)

| # | Feature | Impact | Effort | Builds On |
|---|---------|--------|--------|-----------|
| Q1 | Pin/Star Projects | HIGH | 3h | ProjectsPage, DashboardPage |
| Q2 | AI Generate Card Description | HIGH | 3h | CardDetailModal, AI provider |
| Q3 | Daily Standup Generator | MEDIUM | 4h | Dashboard quick actions, AI |
| Q4 | Scratchpad / Quick Notes Page | MEDIUM | 5h | TipTap editor, new table |
| Q5 | Screenshot Capture to Card | HIGH | 1d | Electron desktopCapturer, attachments |
| Q6 | AI Suggest Related Cards | MEDIUM | 3h | CardDetailModal, relationships |
| Q7 | Paste Image/URL to Create Card | HIGH | 4h | BoardColumn, clipboard API |
| Q8 | Label Auto-Suggest from AI | MEDIUM | 2h | CardDetailModal, labels |
| Q9 | Board Statistics Modal | MEDIUM | 5h | Board data, chart library |
| Q10 | System Tray Quick Actions | MEDIUM | 4h | Tray menu, IPC |
| Q11 | Stale Card Detection + Notifications | MEDIUM | 3h | notificationScheduler, cards |

---

## Detailed Feature Descriptions

### F1: Global Quick Capture Hotkey
**Impact:** HIGH | **Effort:** LOW (4 hours)
**What:** System-wide Ctrl+Shift+Space opens a compact floating overlay (300x120px, frameless, always-on-top). User types/pastes content, presses Enter. AI classifies and routes: task -> card on most recent project, question -> brainstorm starter, note -> idea. Clipboard text pre-fills if user just copied something. Toast confirms routing.
**Why:** Makes the Living Dashboard the universal inbox for work thoughts. Zero context switching.
**User Story:** As a developer working in VS Code, I want to capture a task idea without switching windows so that I don't break my flow.
**Dependencies:** Electron globalShortcut, new QuickCapturePage.tsx, AI classification call
**Success Metric:** Users capture 5+ items per week via hotkey; items captured while in other apps.

### F2: Morning Briefing / Smart Daily Agenda
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** "Today" section on dashboard (or /today route). Synthesizes: overdue/due-today cards, urgent cards with no progress, pending action items from recent meetings, active ideas, and AI-generated "suggested focus areas." User can check items off directly. Unchecked items carry forward.
**Why:** Answers "what should I work on today?" without triaging across 4 pages.
**User Story:** As a professional, I want to open the app each morning and see a prioritized list of what needs my attention today.
**Dependencies:** Cards (dueDate, priority), actionItems (pending), ideas (active), AI generate()
**Success Metric:** Users visit daily; overdue card count decreases over time.

### F3: Transcript Search
**Impact:** HIGH | **Effort:** LOW (1-3 days)
**What:** Search bar within MeetingDetailModal that searches transcript segments. Results highlight matching text with timestamp. Click to scroll. Global "Search Transcripts" in CommandPalette searches ALL meetings and navigates to specific meeting + segment.
**Why:** Turns recordings from "record and forget" into searchable personal work memory.
**User Story:** As a professional, I want to search "API deadline" across all meetings to find when that commitment was made.
**Dependencies:** transcripts table (content, startTime), PGlite ILIKE or full-text search
**Success Metric:** Users search transcripts 2+ times per week.

### F4: Card Checklists / Subtasks
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** Checkable subtask list inside cards. Add items, reorder via drag-and-drop, check/uncheck. KanbanCard shows "3/7" progress badge with mini progress bar. AI task breakdown can populate checklists with one click ("Add to checklist" button on TaskBreakdownSection results).
**Why:** Bridges high-level cards and granular work. Existing TaskBreakdownSection generates subtasks but doesn't persist them.
**User Story:** As a developer, I want to add subtasks to a card and track progress visually so I can break down work without creating dozens of separate cards.
**Dependencies:** New card_checklist_items table, CardDetailModal, KanbanCard, TaskBreakdownSection
**Success Metric:** 30%+ of cards have checklists; daily interaction with checklists.

### F5: Smart Follow-Up Nudges
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** Background nudge engine checks for actionable patterns every 30 min:
- "3 action items from Tuesday's meeting haven't been converted to cards yet"
- "Card 'Fix auth bug' has been in 'In Progress' for 8 days (your average is 3 days)"
- "Idea 'Migrate to GraphQL' has been new for 2 weeks -- explore, archive, or convert?"
- "You recorded a meeting about 'Q2 Planning' but it isn't linked to any project"
- "5 cards are due this week across 2 projects"
Nudges appear as collapsible section on dashboard with one-click action buttons (Convert, Open, Link, Dismiss).
**Why:** Users trust the system to catch things they'd forget. Creates dependency.
**User Story:** As a busy professional, I want the app to tell me what needs attention so nothing falls through the cracks.
**Dependencies:** notificationScheduler pattern, cards/actionItems/ideas tables, DashboardPage
**Success Metric:** 40%+ nudge action rate; users act within 24 hours.

### F6: Weekly Review / Reflection Journal
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** Friday notification triggers auto-generated weekly reflection: cards completed (grouped by project), meetings attended + key decisions, action items resolved vs. created, ideas captured, total AI usage. User adds personal notes, rates week (1-5). Stored in new reflections table, browsable over time. Month-over-month comparisons after 4+ weeks.
**Why:** After 3 months, 12 weekly reflections the user never had to write. Invaluable for performance reviews and 1-on-1s. Irreplaceable once accumulated -- enormous switching cost.
**User Story:** As a professional, I want a guided weekly review that automatically aggregates what I accomplished so I can reflect without reconstructing it manually.
**Dependencies:** All entity stores, new reflections table, new Journal page or section
**Success Metric:** 2+ reflections completed per month; time-to-complete under 5 minutes.

### F7: Meeting Prep Assistant
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** Before recording, if a project is selected, AI generates a prep briefing: summary of changes since last meeting (new/completed cards, pending actions from previous meeting, open high-priority items). Appears in collapsible section above recording controls. After meeting, AI compares prep vs transcript to flag undiscussed items.
**Why:** Turns the app from reactive recorder into proactive meeting assistant. Pre-meeting intelligence is a strong differentiator.
**User Story:** As a professional, I want the app to brief me on a project's status before I start a meeting so I walk in prepared.
**Dependencies:** meetingIntelligenceService, RecordingControls, boardStore, actionItems
**Success Metric:** Prep briefings generated for 30%+ of project-linked meetings.

### F8: Recurring Cards
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** Cards can have recurrence (daily, weekly, biweekly, monthly, custom). When moved to "done" column or archived, a new copy auto-creates in original column with next due date. Small repeat icon on KanbanCard. Configure from CardDetailModal "Repeat" dropdown next to due date.
**Why:** Weekly reports, monthly reviews, sprint ceremonies -- all need manual re-creation today.
**User Story:** As a professional, I want routine tasks to automatically regenerate when completed.
**Dependencies:** Cards schema (recurrence field), BoardColumn (done-column detection), CardDetailModal
**Success Metric:** 15%+ of active cards use recurrence.

### F9: Meeting Cross-Reference ("We discussed this before")
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** "Related Mentions" panel on cards, meetings, ideas, brainstorm sessions. Uses PGlite full-text search (tsvector/tsquery) to find related content across entity types. Card detail shows "This topic was discussed in 3 meetings" with links and excerpts. Meeting detail shows cross-references to other meetings and ideas.
**Why:** Value grows quadratically with content volume. With 50+ meetings, surfacing forgotten decisions and recurring themes becomes invaluable. "Second brain" feature that creates the highest switching cost.
**User Story:** As a professional managing multiple projects, I want to see where else a topic was discussed so I can connect scattered knowledge.
**Dependencies:** transcripts, brainstorm messages, cards, ideas tables, PGlite full-text search
**Success Metric:** Users link 30%+ more entities; orphaned entity count decreases.

### F10: Time Tracking on Cards
**Impact:** HIGH | **Effort:** MEDIUM (1-2 weeks)
**What:** Start/stop timer in CardDetailModal. Log of time entries (date, duration, note). Timer persists across restarts (stored in DB). KanbanCard shows total time badge ("2h 15m"). StatusBar shows active timer: "Tracking: Card Name - 00:45:12". Board "Time Report" exports CSV.
**Why:** Developers track time for billing or velocity using disconnected tools (Toggl, Clockify). Integrated tracking means context (which card) is automatic.
**User Story:** As a developer, I want to track time spent on cards to report accurate effort and understand where my time goes.
**Dependencies:** New card_time_entries table, CardDetailModal, KanbanCard, StatusBar
**Success Metric:** 5+ cards tracked per week; monthly time report export.

### F11: Decision Tracker
**Impact:** MEDIUM | **Effort:** MEDIUM (1-2 weeks)
**What:** AI extracts decisions (not just action items) from meeting transcripts. "Decided to use PostgreSQL," "Agreed to push launch to March." Stored as new entity linked to meetings + projects. Chronological decision log per project. Detects contradictory or superseding decisions.
**Why:** "Didn't we already decide this?" is universal. Automatic decision tracking creates an authoritative institutional record.
**User Story:** As a project lead, I want all decisions tracked automatically so I can reference when and why something was decided.
**Dependencies:** meetings, briefs, new decisions table, updated AI prompts
**Success Metric:** Decision log consulted during disagreements.

### F12: Card Templates
**Impact:** MEDIUM | **Effort:** LOW (6 hours)
**What:** Save card as template (title pattern, description skeleton, labels, priority, target column). Templates accessible from column "+" button and command palette. Project-scoped. Also: simple column automation rules (card enters "Done" -> lower priority; card in column N days -> apply "stale" label).
**Why:** Repetitive card types (bug reports, sprint tasks) waste time. Templates enforce consistency and speed creation.
**Dependencies:** New card_templates table, card creation flow, command palette
**Success Metric:** Templates used for 20%+ of card creation.

### F13: Idea Priority Queue with AI Ranking
**Impact:** MEDIUM | **Effort:** LOW (1-3 days)
**What:** Star rating (1-5) on ideas. "Priority Queue" sort combines user rating + AI-assessed impact + AI-assessed effort + recency. AI generates "Top 3 ideas to pursue next" based on current projects and workload.
**Why:** Ideas accumulate without triage. A scoring system turns the idea repo from a graveyard into an active pipeline.
**Dependencies:** ideas table (new score field), IdeasPage (rating UI, priority sort), AI ranking
**Success Metric:** 50%+ of ideas rated; idea-to-project conversion rate increases.

### F14: AI Cost & Usage Dashboard
**Impact:** MEDIUM | **Effort:** LOW (1-3 days)
**What:** Visualize AI token usage and costs over time. Bar chart (daily/weekly/monthly), breakdown by task type and provider/model, configurable budget alert with desktop notification when threshold exceeded.
**Why:** AI costs are a real concern. The aiUsage table already logs every call but doesn't visualize it.
**Dependencies:** aiUsage table (already populated), chart library (recharts), notificationService
**Success Metric:** Users check monthly; budget alerts prevent surprise costs.

### F15: Meeting Export (Markdown/PDF)
**Impact:** MEDIUM | **Effort:** LOW (1-3 days)
**What:** "Export as Markdown" and "Export as PDF" in MeetingDetailModal. Includes: title, date, duration, transcript (with timestamps), AI brief, action items + status. Batch export for all project meetings. PDF via Electron's webContents.printToPDF().
**Why:** Meeting intelligence is locked in the app. Users need to share summaries with colleagues who don't use the app.
**User Story:** As a professional, I want to export meeting summaries as shareable documents for team members who weren't in the meeting.
**Dependencies:** MeetingDetailModal, Electron printToPDF, transcripts + briefs tables
**Success Metric:** 1+ meetings exported per week.

### E1: Productivity Pulse (Heatmap + Streaks)
**Impact:** MEDIUM | **Effort:** LOW (1-3 days)
**What:** Dashboard widget: GitHub-style activity heatmap (past 90 days), current streak counter ("12 consecutive workdays"), weekly rhythm chart (most productive day), milestone badges ("100th card"). All derived from existing createdAt timestamps. Pure CSS grid -- no charting library needed.
**Why:** Streaks and heatmaps are proven retention mechanics. Users open the app to maintain their streak.
**Dependencies:** Existing createdAt columns on all entities, DashboardPage
**Success Metric:** Users maintain streaks; app opened daily.

### E2: Focus Mode / Pomodoro Timer
**Impact:** MEDIUM | **Effort:** LOW (6 hours)
**What:** Activate via Ctrl+Shift+F or status bar click. Select a card to focus on. 25min timer in status bar. Sidebar collapses, card detail expands full-screen. Desktop notifications suppressed during focus. Timer end prompts "What did you accomplish?" -- logged as card comment. Tracks total focused time per card.
**Why:** Closes the loop between planning (cards) and execution (focused time). After 50+ sessions, time-per-card data enables future estimation.
**Dependencies:** StatusBar, CardDetailModal, notificationService, card comments
**Success Metric:** 5+ focus sessions per week.

### Q1: Pin/Star Projects
**Impact:** HIGH | **Effort:** LOW (3 hours)
**What:** Star icon on project cards. Pinned projects float to top of Projects list and appear in "Pinned" section on Dashboard. Persisted in DB.
**Why:** Users with 10+ projects waste time scrolling.
**Dependencies:** projects table (new pinned boolean), ProjectsPage, DashboardPage
**Implementation:** Add pinned column, Star toggle in project card hover actions, filter pinned to top.

### Q2: AI Generate Card Description
**Impact:** HIGH | **Effort:** LOW (3 hours)
**What:** "Generate with AI" button (Sparkles icon) in CardDetailModal when description is empty or sparse. Generates 2-3 sentence description from title + project context.
**Why:** Users create cards quickly with just titles. AI drafts a starting point in 2 seconds.
**Dependencies:** CardDetailModal, ai-provider.ts
**Implementation:** New IPC `cards:generate-description`, AI prompt with title + project name.

### Q3: Daily Standup Generator
**Impact:** MEDIUM | **Effort:** LOW (4 hours)
**What:** Dashboard quick action: "Generate Standup." AI scans yesterday's completed cards, today's in-progress cards, upcoming blockers. Generates 3-paragraph standup (Did / Doing / Blockers). Copy to clipboard.
**Why:** Saves 5 minutes daily. Delightful "wow, that's clever" moment.
**Dependencies:** Dashboard, AI provider, boardStore

### Q4: Scratchpad / Quick Notes
**Impact:** MEDIUM | **Effort:** LOW (5 hours)
**What:** New "Notes" page with TipTap editor, auto-save. Not linked to projects -- personal scratchpad for rough thoughts.
**Why:** Users need a "junk drawer" for content that isn't formal enough for Ideas or Cards.
**Dependencies:** TipTap, new notes table, Sidebar

### Q5: Screenshot Capture to Card
**Impact:** HIGH | **Effort:** LOW (1 day)
**What:** Ctrl+Shift+S opens screen capture. User selects region, captured image auto-creates card with screenshot attachment.
**Why:** Visual bug reports and design feedback collapse from 5 steps to 1 hotkey.
**Dependencies:** Electron desktopCapturer, attachmentService

### Q6: AI Suggest Related Cards
**Impact:** MEDIUM | **Effort:** LOW (3 hours)
**What:** "Suggest Related" button in CardDetailModal relationships section. AI analyzes card title+description, searches project cards, suggests 3-5 semantically related cards. Click to add relationship.
**Why:** As boards grow to 50+ cards, manual linking is tedious. AI surfaces connections users miss.
**Dependencies:** CardDetailModal, RelationshipsSection, AI provider

### Q7: Paste Image/URL to Create Card
**Impact:** HIGH | **Effort:** LOW (4 hours)
**What:** Ctrl+V on board column: image -> card with attachment; URL -> card with fetched page title and URL in description.
**Why:** Instant capture. One paste -> card exists.
**Dependencies:** BoardColumn, clipboard API, attachmentService

### Q8: Label Auto-Suggest from AI
**Impact:** MEDIUM | **Effort:** LOW (2 hours)
**What:** "Suggest Labels" button analyzes card title+description and recommends 2-3 fitting labels from existing project labels. One-click to apply.
**Why:** Consistent labeling without manually remembering which labels exist.
**Dependencies:** CardDetailModal, labels table, AI provider

### Q9: Board Statistics Modal
**Impact:** MEDIUM | **Effort:** LOW (5 hours)
**What:** "Stats" button in board toolbar: cards per column (bar chart), cards by priority, cards by label, overdue count, average time in each column. Filterable by date range.
**Why:** Progress visibility -- "How many cards did we complete this week?"
**Dependencies:** BoardPage, cards + card_activities tables, chart library (recharts)

### Q10: System Tray Quick Actions
**Impact:** MEDIUM | **Effort:** LOW (4 hours)
**What:** Enhanced tray menu: "Quick Capture," "Start Recording," "New Idea," "Show Dashboard." Actions work without restoring the main window.
**Why:** Right-click tray -> action is faster than restore window -> navigate -> click button.
**Dependencies:** Existing tray integration, IPC handlers

### Q11: Stale Card Detection + Notifications
**Impact:** MEDIUM | **Effort:** LOW (3 hours)
**What:** Background check identifies cards not updated in N days (configurable, default 7). Desktop notification: "3 cards in 'Backend API' haven't been touched in 10+ days." Click navigates to board with stale cards highlighted.
**Why:** Cards silently go stale. Most have no due date. Staleness detection catches the 80% without due dates.
**Dependencies:** notificationScheduler.ts, cards table (updatedAt), card_activities

---

## Recommended Implementation Order

### Phase A: Quick Capture & Daily Habits (1-2 weeks)
| Priority | Feature | Effort | Rationale |
|----------|---------|--------|-----------|
| 1 | F1: Global Quick Capture Hotkey | 4h | Universal inbox -- highest habit-formation potential |
| 2 | Q1: Pin/Star Projects | 3h | Immediate navigation improvement |
| 3 | Q2: AI Generate Card Description | 3h | Leverages existing AI, instant value |
| 4 | Q3: Daily Standup Generator | 4h | Daily ritual, "wow" moment |
| 5 | E1: Productivity Pulse | 1-3d | Emotional hook, streaks drive daily opens |

### Phase B: Search & Intelligence (1-2 weeks)
| Priority | Feature | Effort | Rationale |
|----------|---------|--------|-----------|
| 6 | F3: Transcript Search | 1-3d | Unlocks value of recorded meetings |
| 7 | F5: Smart Follow-Up Nudges | 1-2w | Passive -> proactive app |
| 8 | F14: AI Cost Dashboard | 1-3d | Data already exists, just needs visualization |
| 9 | F15: Meeting Export (MD/PDF) | 1-3d | High shareability, Electron printToPDF is trivial |

### Phase C: Task Management Power (2-3 weeks)
| Priority | Feature | Effort | Rationale |
|----------|---------|--------|-----------|
| 10 | F4: Card Checklists | 1-2w | Bridges AI task breakdown to trackable subtasks |
| 11 | F8: Recurring Cards | 1-2w | Eliminates routine card re-creation |
| 12 | F12: Card Templates | 6h | Speeds up consistent card creation |
| 13 | E2: Focus Mode / Pomodoro | 6h | Closes planning-to-execution loop |

### Phase D: Meeting Intelligence 2.0 (2-3 weeks)
| Priority | Feature | Effort | Rationale |
|----------|---------|--------|-----------|
| 14 | F7: Meeting Prep Assistant | 1-2w | Pre-meeting intelligence, strong differentiator |
| 15 | F9: Meeting Cross-Reference | 1-2w | "Second brain" -- value grows with content |
| 16 | F11: Decision Tracker | 1-2w | Authoritative record of decisions |

### Phase E: Productivity & Accumulating Value (2-3 weeks)
| Priority | Feature | Effort | Rationale |
|----------|---------|--------|-----------|
| 17 | F2: Morning Briefing / Daily Agenda | 1-2w | Daily driver, AI-generated priorities |
| 18 | F6: Weekly Review / Reflection | 1-2w | Irreplaceable after 3 months |
| 19 | F10: Time Tracking | 1-2w | High value but significant scope |
| 20 | F13: Idea Priority Queue | 1-3d | Active pipeline vs idea graveyard |

### Phase F: Advanced (3+ weeks, when ready)
| Priority | Feature | Effort | Rationale |
|----------|---------|--------|-----------|
| 21 | Q5: Screenshot Capture to Card | 1d | Visual capture workflow |
| 22 | Q7: Paste Image/URL to Create Card | 4h | Fast capture |
| 23 | Q4: Scratchpad / Quick Notes | 5h | Lightweight buffer |
| 24 | E3: Calendar View for Due Dates | 2d | Time-based card view |
| 25 | F16: Knowledge Graph Visualization | 2+w | Impressive but complex |
| 26 | F17: Custom Dashboard Widgets | 2+w | Nice-to-have |
| 27 | E4: Timeline / Gantt View | 3d | Niche planning use case |

---

## Implementation Status

**Implemented (14):** F1, Q1, Q2, Q3, E1, F3, F14, F15, F4, F8, F12, E2, F7, F10

**Not Planned — Parked Ideas (13):**
These were considered but are not prioritized for implementation. Kept here for reference.

| # | Feature | Why Parked |
|---|---------|------------|
| F2 | Morning Briefing / Daily Agenda | Nice-to-have, dashboard already covers daily view |
| F5 | Smart Follow-Up Nudges | Partially covered by pending action count in status bar |
| F6 | Weekly Review / Reflection Journal | Low urgency |
| F9 | Meeting Cross-Reference | High effort, niche use case |
| F11 | Decision Tracker | High effort, niche use case |
| F13 | Idea Priority Queue with AI Ranking | Low urgency |
| Q4 | Scratchpad / Quick Notes | Can use Ideas page instead |
| Q5 | Screenshot Capture to Card | Low urgency |
| Q6 | AI Suggest Related Cards | Card agent can do this now |
| Q7 | Paste Image/URL to Create Card | Low urgency |
| Q8 | Label Auto-Suggest from AI | Card agent can do this now |
| Q9 | Board Statistics Modal | Low urgency |
| Q10 | System Tray Quick Actions | Low urgency |
| E3 | Calendar View for Due Dates | High effort |
| E4 | Timeline / Gantt View | High effort, niche |
| F16 | Knowledge Graph Visualization | High effort |
| F17 | Custom Dashboard Widgets | High effort |

---

## Summary

- **Total new features proposed:** 27 (deduplicated across agents)
- **Implemented:** 14
- **Parked (not planned):** 13
- **Overall product maturity:** SOLID — feature-complete for v2.0

---

Analyzed by NEXUS Self-Improve Agent (3 parallel agents: 2x Opus, 1x Sonnet)
