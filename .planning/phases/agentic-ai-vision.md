# Agentic AI Vision — Three-Tier Roadmap

## Overview

Transform the Living Dashboard from a "dashboard with AI features" into an **AI-native project management tool** where agents actively help users accomplish their tasks.

**Current state:** All AI features are single-shot, read-only, and human-initiated. The AI can generate text but cannot take actions, iterate, or update board state.

**Target state:** AI agents that understand project context, take actions (create cards, update checklists, add comments), and persist their conversations for continuity.

---

## Tier 1: Card-Attached Agent (Plans E.1 + E.2)

**Status:** PLANNED — ready for implementation

The foundational agent pattern. Every card gets an optional AI agent that can:

- Understand the card's full context (project, board, column, checklist, comments, related cards)
- Take actions via tool calling (Vercel AI SDK `tools` + `maxSteps`)
- Persist its conversation for continuity
- Stream responses with real-time tool execution feedback

### Tools available to the card agent:

| Tool | Type | Description |
|------|------|-------------|
| `getCardDetails` | Read | Load card title, description, priority, labels, checklist, comments |
| `searchProjectCards` | Read | Search cards across the project by keyword |
| `getRelatedCards` | Read | Get cards linked via relationships (blocks, depends_on, related_to) |
| `addChecklistItem` | Write | Create a new checklist item on the card |
| `toggleChecklistItem` | Write | Check/uncheck a checklist item |
| `addComment` | Write | Add a comment to the card |
| `updateDescription` | Write | Update the card's description |
| `createCard` | Write | Create a new card in the same or specified column |
| `setCardPriority` | Write | Change the card's priority level |

### Use cases:
- "Break this task down into steps" → agent creates checklist items
- "What's blocking this?" → agent reads related cards, adds analysis as comment
- "Create sub-tasks for frontend and backend" → agent creates two new cards
- "Draft acceptance criteria" → agent updates card description
- "What's the status of related work?" → agent searches project cards, summarizes

### Architecture:
- New `card_agent_messages` table (normalized, like brainstorm messages)
- `cardAgentService.ts` — tool definitions + context builder
- Streaming IPC with tool execution events (extends brainstorm pattern)
- `CardAgentPanel` component in CardDetailModal (new tab)

See PLAN.md for detailed implementation tasks.

---

## Tier 2: Project-Level Agent (Future)

**Status:** CONCEPTUAL — depends on Tier 1 completion

A project-scoped agent that operates across all boards and cards. Accessed via a dedicated section on the Projects page or a new "AI Assistant" page.

### Capabilities:
- **Cross-board intelligence:** "What's blocking progress?" scans all cards for blockers
- **Backlog prioritization:** "Prioritize my backlog" analyzes cards and suggests ordering
- **Sprint planning:** "Plan next sprint" pulls from backlog, estimates capacity
- **Changelog generation:** "What did we accomplish this week?" from card activity logs
- **Meeting integration:** "Prepare for standup" combines card state + action items + meeting history

### Tools (extends Tier 1):
| Tool | Description |
|------|-------------|
| `listBoards` | Get all boards in the project |
| `listColumnCards` | Get all cards in a specific column |
| `moveCard` | Move a card between columns |
| `createBoard` | Create a new board in the project |
| `getProjectStats` | Get aggregated stats (card counts, completion rates, recent activity) |
| `getActionItems` | Get pending action items from meetings |
| `getRecentActivity` | Get card activity log for the project |

### Architecture considerations:
- Could reuse card agent service with expanded tool set
- Needs a `project_agent_conversations` table (separate from card-level)
- Context window management becomes critical (project can have hundreds of cards)
- May need RAG or summarization to fit project state into context

### UI ideas:
- Full-page agent view with split panel (chat left, board preview right)
- Agent can highlight cards on the board as it discusses them
- "Apply suggestion" buttons that execute agent recommendations

---

## Tier 3: Autonomous Background Agents (Future)

**Status:** CONCEPTUAL — depends on Tier 2 completion

Agents that run without explicit user invocation, monitoring project state and surfacing insights proactively.

### Capabilities:
- **Stale card detection:** Flag cards that haven't moved in N days
- **Meeting-to-card mapping:** Auto-suggest linking action items to existing cards
- **Card relationship suggestions:** "These cards seem related" based on content similarity
- **Risk detection:** "Card X has been in 'In Progress' for 2 weeks with no activity"
- **Agenda drafting:** Auto-generate meeting agenda from board state before scheduled meetings
- **Weekly digest:** Generate weekly summary of project progress

### Architecture considerations:
- Background agent scheduler (run on app startup, periodic intervals)
- Notification integration (surface findings as desktop notifications or dashboard cards)
- Cost management (background agents could consume significant tokens)
- User control (enable/disable per-project, set frequency, choose what to monitor)
- Results stored in a new `agent_insights` table with read/dismiss state

### UI ideas:
- "AI Insights" section on dashboard with dismissible insight cards
- Per-project "Agent Activity" log showing what background agents found
- Settings page for configuring autonomous agent behavior

---

## Implementation Priority

```
Tier 1: Card Agent        → Proves the pattern, immediately useful
                           → 2 plans (E.1 backend + E.2 frontend)
                           → Prerequisite for everything else

Tier 2: Project Agent     → Amplifies value, cross-card intelligence
                           → 1-2 plans estimated
                           → Requires Tier 1 tools + project-level context

Tier 3: Background Agents → Differentiator, "AI that works for you"
                           → 2-3 plans estimated
                           → Requires Tier 2 + scheduler + notification system
```

## Technical Foundation (Shared Across Tiers)

All tiers build on the same core:
- **Vercel AI SDK `tools` + `maxSteps`** — the agent loop engine
- **Tool definitions as Zod schemas** — type-safe, validated parameters
- **Streaming with tool events** — real-time feedback to the UI
- **Existing service functions** — card CRUD, checklist, comments, relationships are already built
- **Context injection pattern** — already proven in brainstorm service
- **Usage logging** — already tracks tokens/cost per call

The main new investment per tier is:
- Tier 1: Tool wiring + agent message persistence + card-level UI
- Tier 2: Context summarization + project-level UI
- Tier 3: Scheduler + notification integration + cost controls
