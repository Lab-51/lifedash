# Issues & Deferred Items

## Open Issues
_None yet_

## Deferred Items

### D1: Meeting Calendar Integration (R13)
**Deferred from:** Plan 7.7
**Reason:** Requires OS-level calendar access (Google Calendar API, Outlook/Exchange integration, or desktop calendar IPC). Complex auth flows and platform-specific APIs make this a standalone effort.
**Scope:** Sync scheduled meetings from calendar, auto-create meeting records, pre-populate meeting titles/templates from calendar events.

### D2: Automatic Meeting Detection / VAD (R13)
**Deferred from:** Plan 7.7
**Reason:** Requires Voice Activity Detection (VAD) library to detect when audio starts/stops automatically. Would need continuous audio monitoring even when not recording, which has performance and privacy implications.
**Scope:** Auto-start recording when voice detected in system audio, auto-stop after silence threshold, background listening mode.

## Enhancement Ideas

### E1: Real-time Speaker Diarization
**Context:** Plan 7.7 implements post-recording diarization. Real-time diarization during recording would require consistent speaker labels across 10-second segments, which current APIs don't handle well for short segments.
**Approach:** Could use WebSocket streaming APIs (Deepgram/AssemblyAI) with session-level speaker tracking. Major pipeline refactor required.

---

## Agentic AI Vision (Future Tiers)

Full vision document: `.planning/phases/agentic-ai-vision.md`

### Tier 2: Project-Level Agent
**Depends on:** Tier 1 (Plans E.1 + E.2) — Card Agent must be working first
**Scope:** A project-scoped AI agent that operates across all boards and cards. Dedicated project section or page.
**Key capabilities:**
- Cross-board intelligence: identify blockers, stale cards, dependency chains
- Backlog prioritization with rationale
- Sprint planning: pull from backlog, estimate capacity, suggest grouping
- Changelog generation from card activity logs
- Meeting integration: combine card state + action items + meeting history for standup prep
**New tools:** listBoards, listColumnCards, moveCard, getProjectStats, getRecentActivity
**Estimated effort:** 1-2 plans after Tier 1

### Tier 3: Autonomous Background Agents
**Depends on:** Tier 2 — Project Agent must be working first
**Scope:** Agents that run without user invocation, monitoring project state and surfacing insights proactively.
**Key capabilities:**
- Stale card detection (no movement in N days)
- Auto-suggest linking action items to existing cards
- Card relationship suggestions based on content similarity
- Risk detection (cards stuck in "In Progress" too long)
- Auto-generate meeting agendas from board state
- Weekly progress digest
**Architecture needs:** Background scheduler, notification integration, cost controls, agent_insights table
**Estimated effort:** 2-3 plans after Tier 2
