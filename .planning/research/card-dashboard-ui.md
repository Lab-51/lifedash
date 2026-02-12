# Card-Based Dashboard UI Research

## Summary
For a Trello-like card-based dashboard in React + TypeScript + Tailwind, use `pragmatic-drag-and-drop` (Atlassian) for DnD, Zustand for state management, TipTap for rich text, and Framer Motion for animations.

## Key Findings

### Drag and Drop Library

**Decision needed: Two strong options depending on complexity needs.**

| Library | Bundle | Status | Best For |
|---------|--------|--------|----------|
| @dnd-kit | ~10kB | Active (15.9k stars) | Complex layouts (grids, trees, 2D), React-specific, best a11y |
| pragmatic-drag-and-drop | 4.7kB core | Active (Atlassian) | Headless, framework-agnostic, file drops |
| @hello-pangea/dnd | ~30kB | Maintained fork | Simple Kanban lists (drop-in react-beautiful-dnd replacement) |
| react-beautiful-dnd | ~30kB | **DEPRECATED** | Do NOT use |

**Option A: `@dnd-kit` (for complex dashboard)**
- Most flexible — supports lists, grids, trees, custom 2D layouts
- 15.9k GitHub stars, active maintenance
- Excellent TypeScript and accessibility (keyboard + screen reader built-in)
- Best choice if dashboard will have multiple board types beyond Kanban
- More code to write than @hello-pangea/dnd but more control

**Option B: `pragmatic-drag-and-drop` (for minimal bundle)**
- Smallest bundle (4.7kB core)
- Headless — no UI constraints, full Tailwind compatibility
- Built on native HTML5 drag-and-drop API
- Handles file drops (useful for card attachments)
- Composable: adapters, monitors, utilities — pay for what you import
- Built by Atlassian (powers Trello/Jira internally)
- Newer, less community examples than @dnd-kit

**Current recommendation: `@dnd-kit`** — flexibility for future dashboard variations outweighs the ~5kB bundle difference. Can switch to pragmatic-drag-and-drop later if needed.

### State Management

**Recommendation: Zustand**

| Library | Size | Learning Curve | Best For |
|---------|------|---------------|----------|
| Zustand | ~1kB | Low | Simple stores, moderate complexity |
| Jotai | ~3kB | Low | Atomic state, many independent pieces |
| Redux Toolkit | ~11kB | Medium | Complex state, middleware needs |

**Why Zustand:**
- Minimal boilerplate
- Works great with React + TypeScript
- Supports middleware (persistence, devtools)
- Multiple stores for different concerns (projects, boards, cards, meetings)
- Easy to integrate with Electron IPC

### Rich Text Editor

**Recommendation: TipTap**

| Editor | Based On | Bundle | Extensibility |
|--------|----------|--------|---------------|
| TipTap | ProseMirror | Modular | Excellent — extension-based |
| Plate | Slate.js | Heavy | Good but complex |
| Lexical | Meta's custom | Medium | Growing ecosystem |

**Why TipTap:**
- Extension-based architecture (add only what you need)
- Great Tailwind integration
- Collaborative editing support (future multi-user)
- Markdown shortcuts
- Code blocks, tables, task lists built-in

### Electron-Specific UI

- **Frameless window**: Custom title bar with `-webkit-app-region: drag`
- **System tray**: For background meeting recording
- **Native menus**: Right-click context menus on cards
- **Window management**: Remember size/position between sessions
- **IPC**: Renderer ↔ Main process communication for audio, DB, AI

### Layout & Components

```
┌──────────────────────────────────────────────────────┐
│ [Custom Title Bar]                          [─ □ ✕]  │
├──────┬───────────────────────────────────────────────┤
│      │                                               │
│ Side │  Main Content Area                            │
│ bar  │  (Board View / Meeting View / Ideas / etc.)   │
│      │                                               │
│ Nav  │  ┌─────┐  ┌─────┐  ┌─────┐                   │
│      │  │Card │  │Card │  │Card │  ← Draggable      │
│      │  └─────┘  └─────┘  └─────┘                   │
│      │                                               │
├──────┴───────────────────────────────────────────────┤
│ [Status Bar / Meeting Recording Indicator]            │
└──────────────────────────────────────────────────────┘
```

### Animation

**Framer Motion** for:
- Card drag animations (spring physics)
- Layout transitions when cards move between columns
- Page transitions between views
- Micro-interactions (hover, focus states)

### Recommended Package Stack

```json
{
  "@atlaskit/pragmatic-drag-and-drop": "^1.x",
  "zustand": "^5.x",
  "@tiptap/react": "^2.x",
  "framer-motion": "^11.x",
  "tailwindcss": "^4.x",
  "@tanstack/react-query": "^5.x",
  "react-router-dom": "^7.x",
  "lucide-react": "^0.x"
}
```

### Reference Projects (Open-Source Trello Clones)
- **jameslongstaff/react-trello-clone** — React + Zustand + Tailwind + TS, local-first, no backend (closest to our stack)
- **0l1v3rr/trello-clone** — Next.js 14 + shadcn/ui + Prisma + NextAuth (full-stack patterns)
- **knowankit/trello-clone** — Next.js + TypeScript + MongoDB
- Plane.so — Open-source project management, React
- Atlassian's Trello (uses pragmatic-drag-and-drop internally)

## Risks
- pragmatic-drag-and-drop is headless — more code to write for visual feedback
- Complex state management with many boards/cards — need careful store design
- TipTap extensions can add bundle size quickly
- Accessibility for drag-and-drop requires extra work (keyboard support)

## Sources
- https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react
- https://dndkit.com/
- https://www.purplesquirrels.com.au/2024/05/pragmatic-drag-and-drop-the-ultimate-drag-and-drop-library/
- https://blog.logrocket.com/implement-pragmatic-drag-drop-library-guide/
