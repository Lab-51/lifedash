# Living Dashboard — Competitive Analysis (February 2026)

## Overview

Research across 5 competitive categories identified 40+ feature gaps. Living Dashboard has strong foundational capabilities but lacks features users expect.

**Opportunities organized by scope:**
- **Quick Wins** (1-2 files, <5h): 9 features
- **Medium Features** (3-5 files, 2-3 days): 10 features
- **Major Features** (5+ files, 3-5 days): 5 features

---

## Category 1: Meeting Intelligence

### Critical Gaps

**1. Speaker Diarization (who said what)**
- Why: Action items 10x more useful linked to speakers
- Scope: MEDIUM | Phase 7 (R14)
- How: AssemblyAI/Deepgram integration during transcription
- Competitors: All (Otter, Fireflies, tl;dv, Fathom)

**2. Searchable Transcript + Highlights**
- Why: Transforms 60-min meeting into knowledge asset
- Scope: QUICK WIN (2 files)
- How: Full-text search + highlight table + timestamp nav
- Time: 3 hours

**3. Live Moment Detection**
- Why: Eliminates post-meeting triage; drives engagement
- Scope: MEDIUM (2-3 files)
- How: Trigger-word detection + timeline events + visual badges
- Patterns: "decided", "action item", "blocker", "URGENT"

### Medium Gaps

**4. Meeting Calendar Integration** (auto-start recording) — Phase 7
**5. Meeting Sharing & Clips** (30s videos to Slack) — Major, Phase 8+

### Quick Wins

**6. Better Transcript Display** (formatting, timestamps) — 2 hours

---

## Category 2: Project Management

### Critical Gaps

**1. Task Dependencies & Blocking**
- Why: Prevents bottlenecks; reveals critical path
- Scope: MEDIUM (3-4 files)
- How: cardDependencies table + visual indicators + filter view
- Time: 2-3 days
- Competitors: Linear (core), ClickUp (standard)

**2. Due Dates & Reminders**
- Why: Projects fail from missed deadlines
- Scope: QUICK WIN (2-3 files)
- How: dueDate column + DatePicker + NotificationService
- Time: 4 hours

**3. Card Comments & Activity Log**
- Why: Decisions on cards (not Slack); async collaboration
- Scope: MEDIUM (4-5 files)
- How: cardComments table + activity feed
- Time: 2-3 days

### Medium Gaps

**4. Timeline/Gantt View** — Major feature
**5. AI Task Breakdown** ("Break down this epic") — Medium, 1-2 days
**6. Smart Assignment** (from meeting speakers) — Medium, needs diarization

### Quick Wins

**7. Better Sorting & Filtering** (toolbar) — 4 hours

---

## Category 3: Brainstorming

### High-Impact

**1. Brainstorming Templates**
- "Feature Ideas", "Risk Analysis", "Roadmap", "Architecture"
- Scope: QUICK WIN (1 file)
- Time: 3 hours

**2. Idea → Project Auto-Generation**
- "Create project from idea" → AI generates 8-12 cards
- Scope: MEDIUM
- Time: 1-2 days

**3. Meeting → Brainstorm Pipeline**
- "Generate ideas from this meeting transcript"
- Scope: MEDIUM (1 day)

**4. Export to Markdown/PDF/Notion**
- Scope: MEDIUM (1-2 days)

---

## Category 4: Knowledge Management

### Critical Gaps

**1. Intelligent Cross-Linking**
- Auto-suggest related cards/ideas/meetings
- Scope: MEDIUM (3 files)
- Why: Reveals duplicate work
- Time: 2 days

**2. Universal Full-Text Search with AI**
- Search all data (cards, meetings, ideas) with AI ranking
- Scope: MAJOR (4-5 files)
- Why: Currently siloed; users don't know WHERE things are
- UI: Cmd+K universal search
- Time: 3-4 days

**3. Backlinks Pane**
- "Mentioned in [3 meetings, 2 ideas, 1 card]"
- Scope: QUICK WIN (2 files)
- Why: Prevents rework; shows impact
- Time: 3 hours

### Medium Gaps

**4. Knowledge Graph Visualization**
- Interactive network map of all entities
- Scope: MAJOR (5+ files)
- Time: 4-5 days

---

## Category 5: Desktop UX Patterns

### Critical Gaps

**1. Command Palette (Cmd+K)**
- Type action and execute: "New card", "Record", "Brainstorm"
- Scope: MEDIUM (3 files)
- Why: Premium feel; keyboard users expect this
- Time: 2 days
- Competitors: Raycast, VSCode standard

**2. Quick Capture (Alt+Shift+I)**
- Floating modal to capture ideas anywhere
- Scope: MEDIUM (3 files)
- Why: Capture latency matters; stay in flow
- Time: 1-2 days

**3. System Clipboard Integration**
- Copy transcript/summary with one click
- Scope: QUICK WIN (1 file)
- Time: 1 hour

### Medium Gaps

**4. Always-On-Top Toggle** — 1 hour
**5. Snippet Library** — 1-2 days

### Quick Wins

**6. Custom Themes** (Nord, Dracula, Solarized) — 3 hours
**7. Keyboard Shortcut Customization** — 1 day

---

## Roadmap: Next 12 Weeks

### Phase 10.3: UX Polish (Week 1-2, ~3 days)

Quick wins for premium feel:
- Command Palette (Cmd+K)
- Quick Capture (global hotkey)
- Transcript search UI + better display
- Due dates + notifications
- Copy to clipboard
- Brainstorm templates
- Always-on-top, custom themes

**Outcome:** App feels faster, more powerful, more intuitive

### Phase 11: Smart Project Management (Week 3-6, ~2 weeks)

Enable real project work:
- Task dependencies & blocking
- Card comments & activity
- AI task breakdown
- Intelligent linking
- Sort/filter improvements
- Snippet library

**Outcome:** Communication moves from Slack to app

### Phase 12: Knowledge Engine (Week 7-10, ~2 weeks)

Turn data into insight:
- Universal search with AI ranking
- Speaker diarization (Phase 7)
- Knowledge graph visualization
- Analytics dashboard

**Outcome:** Dashboard = "single source of truth"

### Phase 13: Collaboration (Optional, Week 11-12)

- Meeting clips to Slack
- Export to markdown/PDF
- Slack integration
- Notifications

---

## Feature Priority Matrix

### DO FIRST (High Impact, Low Effort)
- Due dates on cards
- Command Palette
- Quick Capture
- Brainstorm templates
- Backlinks pane
- Transcript search
- Copy to clipboard

### DO NEXT (High Impact, Medium Effort)
- Task dependencies
- Card comments
- AI task breakdown
- Universal search
- Speaker diarization

### POLISH (Medium Impact, Low Effort)
- Always-on-top
- Custom themes
- Sort/filter
- Better formatting

### NICE-TO-HAVE (Medium Impact, Medium Effort)
- Card linking
- Calendar integration
- Gantt timeline
- Keyboard customization

### DEFER (Lower Priority)
- Knowledge graph
- Meeting clips export
- Advanced analytics

---

## Competitive Positioning

### Unique Strengths vs Competitors

|  | Living Dashboard | Otter/Fireflies | Linear/Notion | Raycast |
|---|---|---|---|---|
| **All-in-one** | ✓ | ✗ | ✗ | ✗ |
| **AI Customizable** | ✓ | ✗ | Limited | Limited |
| **Privacy-First** | ✓ | ✗ | ✗ | ✓ |
| **Desktop Native** | ✓ | ✗ | ✗ | ✓ |
| **Cost** | Free | $8-25/mo | $5-12/mo | $12/mo |

### Positioning

"Living Dashboard is the desktop-native, all-in-one AI productivity platform for developers who want to capture ideas, manage projects, and run meetings in one privacy-first app with any AI model."

Key differentiators:
- **Unified experience** (meeting → project → brainstorm in one flow)
- **Privacy-first** (local Whisper option, no SaaS lock-in)
- **AI flexibility** (swap models, use Ollama offline)
- **Developer-first** (keyboard, command palette, extensible)

---

## Success Metrics

| Metric | Target | Current | Competitor |
|--------|--------|---------|-----------|
| **Meeting → Actionable Project** | <2 min (auto) | 5 min | Fireflies: <3 min |
| **Avg Cards/Project** | 20+ | 5-10 | Linear: 50+ |
| **Session Length** | 45+ min | 20 min | Linear: 60+ min |
| **Keyboard Shortcuts** | 5+ used | 0 | Raycast: 20+ |
| **Search Latency** | <500ms | N/A | Notion: <1s |

---

## Sources

- Otter vs Fireflies vs Fathom (index.dev)
- tl;dv Best Meeting Assistants 2026 (tldv.io)
- ClickUp AI vs Notion AI (clickup.com)
- Obsidian vs Notion (productive.io)
- Raycast (raycast.com)
- Command Palette Patterns (mobbin.com)
- 9 Best AI Meeting Assistants (read.ai)
- Kanban Boards in 2026 (asrify.com)
- Unified Knowledge 2026 (gosearch.ai)

