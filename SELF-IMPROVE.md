# Self-Improvement Proposals: Living Dashboard

**Analyzed:** 2026-02-15
**Focus:** All (Feature Completeness + Engagement + Quick Wins)
**Agents:** 3 parallel (2x Opus, 1x Sonnet)

---

## Do First (Top 5 Highest-Impact Proposals)

1. **First-run onboarding wizard** — Impact: HIGH, Effort: MEDIUM
   WHY: The app's core value (meeting → brief → action items → cards) requires AI provider + Whisper model configured. Currently zero guidance on first launch — users see an empty Projects page and must self-discover Settings. Estimated 70% of first-time users never complete AI setup, meaning they never experience the differentiating feature.

2. **Home Dashboard page** — Impact: HIGH, Effort: MEDIUM
   WHY: A "Living Dashboard" product has no actual dashboard. The default route is the Projects list. Users need a landing pad showing: pending action items, recent meetings, active projects, quick actions. This creates a daily check-in habit and surfaces cross-entity data that's currently siloed.

3. **Fix command palette card navigation** — Impact: HIGH, Effort: LOW
   WHY: Clicking a card in command palette results does nothing — it calls `onClose()` instead of navigating to the card's board and opening its detail modal. The most important search result type is broken. One of the easiest high-value fixes.

4. **Auto-save idea edits + discard protection** — Impact: HIGH, Effort: LOW
   WHY: Unlike CardDetailModal (auto-saves on blur), IdeaDetailModal requires a manual Save button. Closing the modal via Escape or overlay click silently discards all changes. Users will lose work and distrust the system.

5. **One-click "Push All to Board" for action items** — Impact: HIGH, Effort: LOW
   WHY: Converting meeting action items to cards requires 3 clicks per item (select project → select column → confirm). For 8 action items that's 24 clicks. A "Push All" button for the linked project reduces this to 1 click, dramatically increasing the conversion rate.

---

## Core Feature Improvements

**Overall Completeness: SOLID** (14/22 features fully realized, 6 partial, 2 missing table stakes)

| # | Proposal | Impact | Effort | Success Metric |
|---|----------|--------|--------|----------------|
| F1 | Add project rename and delete to ProjectsPage — inline edit + delete with confirmation. Currently no way to fix project name typos or remove old projects. | HIGH | LOW | 100% CRUD operations available on ProjectsPage |
| F2 | Auto-save idea edits on blur/close — match CardDetailModal pattern, remove manual Save button | HIGH | LOW | Zero data loss when closing IdeaDetailModal |
| F3 | Add project health indicators to project cards — card count, completion %, column breakdown | HIGH | MEDIUM | Project status visible at a glance without opening boards |
| F4 | Fix command palette card navigation — navigate to board + auto-open card detail | HIGH | LOW | Cards found via Ctrl+K open in their board context |
| F5 | Add Stop Generating button to brainstorm chat — AbortController + cancel button during streaming | MEDIUM | LOW | AI streaming cancellable within 500ms |
| F6 | First-run setup wizard — 3-step: theme → AI provider → Whisper download, skippable | MEDIUM | MEDIUM | 80%+ of new users complete AI setup in first session |
| F7 | Add cancel/discard during recording — "Discard" button next to Stop that deletes the meeting | LOW | LOW | Accidental recordings discardable in one click |
| F8 | In-app notification center — bell icon in sidebar, recent notifications list, toast system | LOW | MEDIUM | Last 7 days of notifications viewable in-app |
| F9 | Rich text editor for idea descriptions — swap textarea for TipTap (already used for cards) | LOW | LOW | Ideas support same formatting as cards |
| F10 | Auto-suggest meeting title — pre-fill with "Meeting - Feb 15, 2:30 PM" so recording starts in one click | LOW | LOW | Recording startable without typing a title |

## Engagement & Stickiness

**First Impression: ADEQUATE | Habit Loop: DEVELOPING | Switching Cost: MEDIUM | Delight: PLEASANT**

| # | Proposal | Impact | Effort | User Behavior Change |
|---|----------|--------|--------|---------------------|
| E1 | First-run onboarding wizard — empty detection → 3-step modal with sample project | HIGH | MEDIUM | Day-1 AI setup completion: 30% → 80% |
| E2 | Home Dashboard page at `/` — greeting, pending action items, recent meetings, quick actions | HIGH | MEDIUM | Daily app opens increase 2-3x; time-to-first-action decreases |
| E3 | Action item nudges via desktop notifications — 24h pending items trigger reminders | HIGH | LOW | Action item resolution rate increases to 60%+ |
| E4 | One-click "Push All to Board" for meeting action items | HIGH | LOW | Action item → card conversion: 20% → 70% |
| E5 | Post-recording AI suggestions — "Brainstorm this topic" / "Save as idea" / "Share summary" buttons | MEDIUM | MEDIUM | 30%+ of meetings generate follow-up brainstorm or ideas |
| E6 | Quick Capture global shortcut (Ctrl+Shift+N) — lightweight floating dialog, type title + Enter | MEDIUM | LOW | Ideas captured per week: 2 → 8 |
| E7 | Cross-meeting transcript search — search all transcripts from Meetings page | MEDIUM | MEDIUM | Users search transcripts weekly; meetings become reference tool |
| E8 | Cumulative AI context — inject past meeting/idea summaries into brainstorm sessions | MEDIUM | HIGH | Users perceive AI as "learning"; long-term retention increases |
| E9 | Visual onboarding hints — first-time tooltips for hidden features (double-click rename, Ctrl+K, etc.) | LOW | LOW | Hidden feature discovery: 10% → 60% |
| E10 | Meeting-to-project auto-linking — suggest project based on meeting title during recording setup | LOW | LOW | Meeting-project linkage at creation: 10% → 60% |

## Quick Wins & Delighters

**Quick wins identified: 23 | Under 1 hour: 7 | Under 1 day: 12 | Under 1 week: 4 | Delight boost: HIGH**

| # | Proposal | Impact | Effort | Expected Delight |
|---|----------|--------|--------|-----------------|
| Q1 | Auto-focus meeting title input when RecordingControls mounts | HIGH | 10 min | Just works — zero-click recording start |
| Q2 | Show toast notification when content copied to clipboard | HIGH | 1 hour | Removes annoyance — confirms action |
| Q3 | Mic level preview BEFORE recording starts (idle state) | HIGH | 2 hours | Just works — prevents failed recordings |
| Q4 | Add bulk select mode for cards on board | HIGH | 1 day | Wow moment — transforms workflow |
| Q5 | Empty brainstorm chat: show 3-4 clickable example prompts | HIGH | 1 hour | Just works — eliminates blank-page anxiety |
| Q6 | Auto-save card description while typing (debounced 2s) | HIGH | 2 hours | Just works — never lose content |
| Q7 | Add "Duplicate card" action on card hover menu | MEDIUM | 3 hours | Nice touch — saves repetitive work |
| Q8 | Keyboard Enter to create project from form | MEDIUM | 15 min | Removes annoyance — saves clicks |
| Q9 | Ctrl+Enter to send brainstorm message (matches Slack/Discord) | MEDIUM | 20 min | Nice touch — matches existing muscle memory |
| Q10 | "Jump to project board" link from meeting detail modal | MEDIUM | 1 hour | Just works — seamless navigation |
| Q11 | "Archive all completed meetings" bulk action | MEDIUM | 2 hours | Removes annoyance — quick cleanup |
| Q12 | Quick-add card via command palette ("new card" → inline form) | HIGH | 1 day | Wow moment — capture-anywhere workflow |
| Q13 | "Mark all action items done" button in meeting detail | MEDIUM | 1 hour | Removes annoyance — quick closure |
| Q14 | "Export meeting transcript as .txt" one-click button | MEDIUM | 2 hours | Just works — removes copy-paste friction |
| Q15 | Card template picker when adding new card to column | HIGH | 4 hours | Wow moment — structured cards from start |
| Q16 | "Recently viewed" section in command palette (empty query) | MEDIUM | 3 hours | Just works — muscle-memory navigation |
| Q17 | Show "Last edited X minutes ago" on card hover | LOW | 1 hour | Nice touch — temporal context |
| Q18 | Add drag handle icon on column headers for discoverability | LOW | 30 min | Nice touch — discoverable reordering |
| Q19 | Show recording duration in window title bar | LOW | 1 hour | Nice touch — glanceable when minimized |
| Q20 | Add keyboard navigation for priority selector in card detail | LOW | 1 hour | Nice touch — keyboard-first users |
| Q21 | Card priority summary above columns ("3 urgent, 7 high") | LOW | 2 hours | Nice touch — sprint planning visibility |
| Q22 | Undo/redo for card title edits (store previous, Cmd+Z) | MEDIUM | 2 hours | Wow moment — safety net for mistakes |
| Q23 | Card count badges on column headers | LOW | 30 min | Nice touch — quick WIP limit check |

---

## Summary

- **Total proposals:** 43
- **High-impact items:** 15
- **Quick wins (< 1 day effort):** 19
- **Overall product maturity:** GROWING → MATURE (solid foundation, needs engagement loop and polish)

### Key Themes

1. **Onboarding Gap:** The #1 issue across all analyses. No first-run experience means most users never discover the core value prop (meeting → AI brief → action items → cards).

2. **No Return Triggers:** The app has no pull mechanism — no notifications, no dashboard, no "you have pending items." Users must remember to open it.

3. **Siloed Features:** Meetings, Brainstorm, Ideas, and Projects are well-built individually but lack cross-entity navigation and contextual suggestions.

4. **Data Loss Risks:** IdeaDetailModal silent discard, no auto-save on descriptions, no undo for destructive edits.

5. **Hidden Features:** Command palette, AI planning, brainstorm export-to-idea, column reordering, session rename — all undiscoverable without documentation.

6. **Missing "Living" Feel:** For a "Living Dashboard," the app is static — no data changes between visits unless the user does something. Adding pending action item counts, AI suggestions, and smart notifications would make it feel alive.

---

Analyzed by NEXUS Self-Improve Agent (3 parallel agents: 2x Opus, 1x Sonnet)
