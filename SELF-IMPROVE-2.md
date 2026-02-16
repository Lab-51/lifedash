# Self-Improvement Proposals: Living Dashboard (Incremental #2)

**Analyzed:** 2026-02-16
**Focus:** All (Feature Completeness + Engagement + Quick Wins)
**Agents:** 3 parallel (2x Opus, 1x Sonnet)
**Previous Analysis:** SELF-IMPROVE.md (2026-02-15, 43 proposals -- 18 completed in Phase 11-12)

---

## Do First (Top 5 Highest-Impact Proposals)

1. **Dashboard deep-links: clicks open detail modals, quick actions trigger creation** -- Impact: HIGH, Effort: LOW (3 hours)
   WHY: The Home Dashboard shows recent meetings/ideas and quick action buttons, but clicking a meeting navigates to `/meetings` (list page) instead of opening that meeting's detail. Quick actions like "New Project" navigate to the list page instead of triggering creation. The dashboard feels like a redirect hub, not a productivity launcher. Fixing this makes it the daily entry point users return to.

2. **Pre-recording preflight check (Whisper + AI provider)** -- Impact: HIGH, Effort: LOW (2 hours)
   WHY: A user can start recording a 30-minute meeting and only discover afterward that no Whisper model is installed (warning is BELOW the recording controls). Recording without transcription means no brief, no action items -- the core value proposition fails silently. A preflight check before Start Recording prevents wasted time entirely.

3. **Column rename via double-click** -- Impact: HIGH, Effort: LOW (1 hour)
   WHY: Users can rename projects, cards, brainstorm sessions, and meeting titles -- but not column names. AI-generated columns or typos require deleting the column (losing all cards) and recreating it. Double-click-to-rename matches the existing inline edit pattern.

4. **Project selector in RecordingControls** -- Impact: HIGH, Effort: LOW (1 hour)
   WHY: `startRecording()` always passes `undefined` for projectId. Users must link meetings to projects AFTER recording. This breaks the core flow: without a linked project, the "Push All to Board" button doesn't appear, and action items sit orphaned.

5. **Empty dashboard onboarding CTA** -- Impact: HIGH, Effort: MEDIUM (3 hours)
   WHY: First-time users see three empty sections ("No active projects yet," etc.) with no guidance on what to do first. They don't know they need to configure an AI provider or download a Whisper model. A "Get Started" card with numbered steps ("1. Configure AI provider, 2. Download Whisper, 3. Create your first project") transforms day-1 activation.

---

## Core Feature Improvements

**Overall Completeness: SOLID** (14 features assessed: 9 fully realized, 4 partially built, 3 missing table stakes)

| # | Proposal | Impact | Effort | Success Metric |
|---|----------|--------|--------|----------------|
| F1 | **Dashboard meeting/idea clicks open detail modals** -- Navigate to `/meetings?openMeeting=<id>` (pattern exists for cards on BoardPage) | HIGH | LOW | Zero additional clicks to view a specific item from Dashboard |
| F2 | **Column rename via double-click on header** -- Inline edit in BoardColumn.tsx, matching KanbanCard title pattern | HIGH | LOW | Column rename in < 3 seconds without losing cards |
| F3 | **Project selector dropdown in RecordingControls** -- Pass projectId to startRecording() instead of undefined | HIGH | LOW | Meetings pre-linked at recording time; "Push All" appears immediately |
| F4 | **Markdown rendering during brainstorm streaming** -- Replace `whitespace-pre-wrap` with ReactMarkdown for streamingText (BrainstormPage line 432) | MEDIUM | TINY | No visual "pop" when streaming completes |
| F5 | **Board empty filter state message** -- "No cards match your filters. [Clear filters]" when hasActiveFilters + 0 results | MEDIUM | TINY | Users understand filtered-out cards aren't deleted |
| F6 | **Column delete warns about card count** -- "Delete column with N cards?" instead of generic "Delete?" | MEDIUM | TINY | Users always know how many cards they'll lose |
| F7 | **Meeting delete button on MeetingCard** -- Hover-reveal trash icon (matching KanbanCard pattern) | LOW | TINY | Bulk meeting cleanup without opening each detail modal |
| F8 | **Filtered vs total card count in column headers** -- "2 of 8" when filters active | LOW | TINY | Users know cards exist but are hidden |
| F9 | **Brainstorm input auto-resize** -- onInput height adjustment for multi-line messages | LOW | TINY | Textarea grows naturally with content |
| F10 | **New brainstorm session keyboard shortcut** -- Ctrl+N on brainstorm page | LOW | LOW | Matches keyboard-driven UI speed |

---

## Engagement & Stickiness

**First Impression: ADEQUATE-STRONG | Habit Loop: DEVELOPING | Switching Cost: MEDIUM | Delight: PLEASANT**

| # | Proposal | Impact | Effort | User Behavior Change |
|---|----------|--------|--------|---------------------|
| E1 | **Move Whisper warning ABOVE RecordingControls** -- Currently below fold on MeetingsPage (line 160-187). Move or disable Start button when no model. | HIGH | TINY | First-recording success rate: ~30% -> 90% |
| E2 | **Dashboard quick actions trigger creation directly** -- "New Project" -> `/projects?action=create`, auto-expands form. "New Recording" -> auto-focuses title. | HIGH | LOW | Clicks-to-first-action: 3 -> 1 |
| E3 | **Empty dashboard smart CTA for first-time users** -- "Get Started" card: configure AI, download Whisper, create project | HIGH | MEDIUM | Day-1 setup completion: ~20% -> 70% |
| E4 | **Pre-recording preflight check** -- Validate Whisper model + AI provider before Start Recording. "Record without AI" fallback. | HIGH | MEDIUM | Every recording produces full pipeline (transcript + brief + action items) |
| E5 | **Auto-select last active brainstorm session** -- Store last session ID in localStorage, auto-load on page visit | MEDIUM | LOW | Brainstorm return visits feel seamless; session re-engagement increases |
| E6 | **Board back arrow to /projects (not /)** -- BoardPage line 328: change `to="/"` to `to="/projects"` | MEDIUM | TINY | Spatial navigation matches mental model |
| E7 | **Contextual status bar -- pending action items count** -- Replace static "Ctrl+1-5: Navigate" with dynamic content | MEDIUM | MEDIUM | Passive awareness of outstanding work; resolution rate increases |
| E8 | **Toast notification system for completed actions** -- Idea conversion, plan application, label changes | MEDIUM | MEDIUM | Users receive confirmation; trust in system increases |
| E9 | **Brainstorm "Save as Card" button** -- Direct card creation from AI messages (alongside "Save as Idea") | MEDIUM | LOW | Brainstorm -> card conversion: 3 steps -> 1 step |
| E10 | **"Since last visit" context on dashboard** -- Track last visit timestamp, show "2 new action items, 1 idea added" | MEDIUM | MEDIUM | Dashboard feels responsive and alive |

---

## Quick Wins & Delighters

**Quick wins identified: 12 | Under 1 hour: 7 | Under 1 day: 4 | Under 1 week: 1 | Delight boost: MEDIUM**

| # | Proposal | Impact | Effort | Expected Delight |
|---|----------|--------|--------|-----------------|
| Q1 | **Strip HTML tags from command palette card descriptions** -- Shows `<p>` tags in search results currently | HIGH | 30 min | Removes annoyance -- clean search results |
| Q2 | **Action item count badge on meeting cards** -- Quick scan for actionable meetings without opening each one | HIGH | 30 min | Nice touch -- glanceable meeting status |
| Q3 | **`/` keyboard shortcut to focus board search** -- Matches GitHub, Gmail, modern web apps | MEDIUM | 30 min | Nice touch -- power user speed |
| Q4 | **Escape key closes filter dropdowns on board** -- Currently requires clicking outside | MEDIUM | 20 min | Removes annoyance -- keyboard-first UX |
| Q5 | **Card description 1-line preview on board cards** -- Truncated description below card title | MEDIUM | 15 min | Nice touch -- card context at a glance |
| Q6 | **Export board as CSV** -- Column, title, description, labels, priority, due date | HIGH | 2 hours | Wow moment -- data portability for Excel/analysis |
| Q7 | **Project color dot on meeting cards** -- Visual association between meetings and projects | MEDIUM | 30 min | Nice touch -- cross-entity visual link |
| Q8 | **Relative time on card detail** -- "Created 3 days ago, last edited 2 hours ago" | LOW | 30 min | Nice touch -- temporal context |
| Q9 | **Last recording duration when idle** -- "Last recording: 23m 45s" in recording controls | LOW | 1 hour | Nice touch -- feedback on past recordings |
| Q10 | **Duplicate project action** -- Copy board structure (columns + column names) for template workflows | MEDIUM | 3 hours | Wow moment -- template workflows |
| Q11 | **Keyboard shortcut tooltips on button hover** -- Progressive disclosure of Ctrl+K, Ctrl+1, etc. | LOW | 2 hours | Nice touch -- feature discovery |
| Q12 | **Soft-delete trash bin with 30-day recovery** -- Safety net for accidental project/card/meeting deletion | HIGH | 1 week | Wow moment -- "I can undo that!" |

---

## Summary

- **Total proposals:** 32
- **High-impact items:** 12
- **Quick wins (< 1 day effort):** 22
- **Overall product maturity:** GROWING -> MATURE (solid foundation with good UX, needs engagement loop completion)

### Key Themes (What Changed Since Last Analysis)

1. **Onboarding Gap (STILL #1):** First-run experience is still the biggest issue. No wizard, no smart CTA, no preflight checks. Users must discover Settings and Whisper on their own.

2. **Dashboard Is a Dead End (NEW):** The Home Dashboard was added (great!) but quick actions navigate to list pages instead of triggering creation, and item clicks go to lists instead of detail modals. The dashboard needs to become a true launch pad.

3. **Recording Preflight (NEW):** The Whisper model warning is positioned below recording controls. Users can record entire meetings that produce no AI output. This is the single most destructive first-time failure mode.

4. **Column Management Gap (NEW):** Columns can't be renamed, and deleting columns with cards gives no warning about data loss.

5. **Missing Confirmation Feedback (NEW):** Multiple high-value actions (idea conversion, plan application, label changes) complete silently with no visual confirmation.

6. **The "Living" Is Still Static:** The dashboard doesn't track "since last visit," the status bar shows static text, and no passive engagement nudges exist. The app waits for the user; it should greet them with what changed.

### Previous Analysis Comparison

Of the 43 proposals from SELF-IMPROVE.md (2026-02-15):
- **18 completed** in Phase 11-12 (all 5 "Do First" items addressed)
- **25 still open** (carried forward where not superseded by new findings)
- **14 new proposals** not in previous analysis (dashboard deep-links, preflight check, column rename, streaming markdown, brainstorm auto-select, board back arrow, HTML stripping, action item badges, etc.)

---

Analyzed by NEXUS Self-Improve Agent (3 parallel agents: 2x Opus, 1x Sonnet)
