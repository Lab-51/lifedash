# How I Built LifeDash: An AI-Powered Desktop Dashboard with Electron, PGlite, and Real-Time Transcription

> A deep dive into the architecture of a desktop app that unifies meeting intelligence, project management, AI brainstorming, and focus tracking — all running locally on your machine.

---

## The Problem

I attend a lot of meetings. After each one, the same ritual plays out: open Otter.ai for the transcript, switch to Trello to create cards for action items, open ChatGPT to brainstorm the approach, then fire up Toggl to track time spent on each task. Four tools. Four logins. Four subscriptions. Context lost at every switch.

I wanted one tool that does all of it. Not a web app that locks my data in someone else's cloud — a desktop app that runs locally, respects my privacy, and uses AI to connect the dots between meetings, projects, and work.

So I built **LifeDash**.

---

## What LifeDash Does

LifeDash is an Electron desktop app with six integrated systems:

1. **Meeting Recording & Transcription** — Capture system audio from any app (Zoom, Teams, Meet), transcribe in real-time using local Whisper AI
2. **AI Meeting Intelligence** — Auto-generate summaries, extract action items, and push them to your project board
3. **Project Dashboard** — Kanban boards with drag-and-drop, rich text cards, labels, priorities, and checklists
4. **AI Brainstorming** — Chat with an AI that knows your projects, cards, and meeting history
5. **Focus Time Tracking** — Pomodoro timer with gamification (XP, 30 tiers, 84 achievements)
6. **Idea Repository** — Capture, tag, and AI-analyze ideas, then convert them to projects

Everything runs on your desktop. The database is embedded. Transcription can run locally. No Docker, no cloud services, no accounts required.

---

## The Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Desktop shell** | Electron + Vite | System audio access, native modules, desktop integration |
| **Frontend** | React 19 + TypeScript + Tailwind CSS 4 | Largest ecosystem, type safety, rapid styling |
| **State** | Zustand | Lightweight, TypeScript-native, no boilerplate |
| **Database** | PGlite (PostgreSQL in WebAssembly) | Full PostgreSQL. Zero setup. No Docker. |
| **ORM** | Drizzle ORM | SQL-first, lightweight, great TypeScript types |
| **AI** | Vercel AI SDK v6 | Multi-provider, streaming, tool-calling support |
| **Transcription** | @fugood/whisper.node (NAPI addon) | Local Whisper inference, no cloud dependency |
| **Drag & Drop** | pragmatic-drag-and-drop | 4.7kB, headless, by Atlassian |
| **Rich Text** | TipTap (ProseMirror) | Extension-based, great API |
| **Animations** | Framer Motion | Declarative, performant |

Let me walk through the most interesting architectural decisions.

---

## PGlite: PostgreSQL Without Docker

This was the decision that shaped everything. Most Electron apps use SQLite, but I wanted PostgreSQL's full feature set — proper JSONB, array types, full-text search, and real migrations.

**PGlite** compiles PostgreSQL to WebAssembly. It runs entirely in-process. No Docker container, no server socket, no connection strings. Just:

```typescript
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite('./data/lifedash');
await db.query('SELECT 1');  // Full PostgreSQL
```

**Drizzle ORM** sits on top, giving type-safe queries:

```typescript
const projects = await db
  .select()
  .from(projectsTable)
  .where(eq(projectsTable.archived, false))
  .orderBy(desc(projectsTable.updatedAt));
```

**The gotcha I discovered:** PGlite cannot join the same table twice in a single query, even with aliases. If you need to reference a table through two different foreign keys, you have to use COALESCE in the JOIN condition to resolve it as a single join. This isn't documented anywhere — I found it after hours of debugging.

Migrations run automatically on app startup via Drizzle Kit. The migration files ship as `extraResource` alongside the asar bundle.

---

## Real-Time Transcription with Local Whisper

The meeting transcription pipeline has several interesting layers:

### Audio Capture

Electron's `desktopCapturer` doesn't capture system audio on its own. I use `electron-audio-loopback`, which hooks into WASAPI (Windows) and CoreAudio (macOS) to capture the audio output:

```
System audio → electron-audio-loopback → Web Audio API → ScriptProcessorNode
    → Resampling (48kHz stereo → 16kHz mono) → PCM Int16 buffer → Whisper
```

The resampling step is critical. Whisper expects 16kHz mono PCM. Meeting apps output 48kHz stereo. The conversion happens in real-time via Web Audio API's `ScriptProcessorNode`.

### Chunking & Transcription

Audio is chunked into 10-second segments. Each chunk is sent to Whisper as an Int16 PCM ArrayBuffer. The native addon (`@fugood/whisper.node`) runs transcription in its own thread via NAPI `AsyncWorker` — the UI stays responsive.

**Important lesson:** Don't use Node.js Worker threads with NAPI native modules in Electron. Native code that crashes in a Worker thread takes down the entire process with a segfault. The NAPI `AsyncWorker` is process-level threading that's safe with Electron's architecture.

### Live Transcript Display

As each chunk completes, the transcript text streams into a Zustand store. React renders it in real-time. The meeting view shows the transcript growing line-by-line as the meeting progresses.

---

## AI Provider System: One Interface, Any Model

LifeDash uses the **Vercel AI SDK v6** to support multiple AI providers through a single interface:

```typescript
// All providers expose the same API
const result = await generateText({
  model: provider.chat(modelId),
  messages,
  maxOutputTokens: 2048,
});
```

Users can configure:
- **OpenAI** (GPT-4o, GPT-4o-mini)
- **Anthropic** (Claude Sonnet, Claude Haiku)
- **Ollama** (any local model — Llama, Mistral, etc.)
- **Kimi** (Moonshot AI for reasoning tasks)

Each AI task (summarization, brainstorming, card agent, etc.) can be assigned a different provider and model. A user might use Claude for brainstorming but GPT-4o-mini for quick summaries.

### API Key Security

API keys are encrypted using Electron's `safeStorage` API, which delegates to the OS-level secret store:
- **Windows:** DPAPI
- **macOS:** Keychain
- **Linux:** libsecret

The renderer process never sees raw API keys — only a `hasApiKey: boolean` flag. Decryption happens on-demand in the main process when making API calls.

---

## Card AI Agent: Tool-Calling in a Desktop App

The most advanced feature is the **Card AI Agent** — a per-card AI assistant that can take actions using Vercel AI SDK's tool-calling:

```typescript
const result = await streamText({
  model: provider.chat(modelId),
  messages: conversationHistory,
  tools: {
    getCardDetails: tool({ ... }),
    searchProjectCards: tool({ ... }),
    addChecklistItem: tool({ ... }),
    toggleChecklistItem: tool({ ... }),
    addComment: tool({ ... }),
    updateDescription: tool({ ... }),
    createCard: tool({ ... }),
  },
  maxSteps: 5,  // Agent can chain up to 5 tool calls
});
```

The agent can read the card's content, search across the project, add checklist items, write comments, and even create new cards — all through natural language. It streams responses via IPC, with tool execution events visualized in the UI.

---

## The Gamification System

Focus tracking includes a full gamification layer: XP, levels, achievements, and streaks. This might seem like a gimmick, but it genuinely changed my productivity habits.

- **300 levels** across 30 named tiers (from "Initiate" to "Transcendent")
- **84 achievements** across 7 categories (Focus, Projects, Meetings, etc.)
- **Achievement banners** with particle effects when you unlock one
- **Daily streaks** that track consecutive days of focus

The XP formula scales logarithmically — early levels come fast to hook you, later levels require sustained effort. Each focus session linked to a card earns XP based on duration.

---

## Packaging: The Electron Forge Dance

Packaging an Electron app with native modules and WASM is... non-trivial. Here's what I learned:

1. **Forge's Vite plugin doesn't include node_modules in the asar.** Only the `.vite/build/` output gets bundled. Any native module (whisper.node, PGlite) must be explicitly copied via a `packageAfterCopy` hook.

2. **Externalized packages** need a custom copy step in `forge.config.ts`:
   ```typescript
   const EXTERNAL_PACKAGES = [
     '@electric-sql/pglite',
     '@fugood/whisper.node',
     '@fugood/node-whisper-win32-x64',
   ];
   ```

3. **PGlite loads from inside the asar** (no `asarUnpack` needed). Drizzle migrations ship as `extraResource`.

4. **DevTools detection:** Use `app.isPackaged`, not `process.env.NODE_ENV`. The environment variable isn't reliable in packaged Electron apps.

---

## Design System: The HUD Aesthetic

LifeDash uses a custom "HUD" (Heads-Up Display) design language — think sci-fi command center meets productivity tool. It's built on CSS custom properties:

```css
--color-surface-950: #0a0a0f;
--color-accent: #00e5ff;
--color-accent-subtle: rgba(0, 229, 255, 0.08);
```

Subtle scanline overlays, corner-cut clip paths, and ambient animations (node clusters, flicker effects) give the interface personality without sacrificing usability. The dark theme is the primary design target, with a clean light theme as an alternative.

---

## Licensing: The "Don't Be Evil" Model

I deliberately chose a generous freemium model:

- **Free tier** includes EVERYTHING — projects, meetings, transcription, AI brainstorming, focus tracking, ideas. All with no limits.
- **Pro** ($29/year or $69 lifetime) adds the Card AI Agent, automatic meeting-to-card conversion, backup/restore, and data exports.
- **"Perpetual fallback"** — if you stop paying, you keep every Pro feature on the version you have. We don't hold your tools hostage.

The AI features are free because users bring their own API keys (BYOK). This means AI costs us nothing to offer, so we can be genuinely generous.

---

## Numbers

- **150 tests** across 7 test files
- **47 completed plans** (each 2-3 tasks, tracked in a structured state system)
- **84 achievements** in the gamification system
- **7 AI-callable tools** in the card agent
- **4 AI providers** supported (OpenAI, Anthropic, Ollama, Kimi)
- **0 cloud services** required to run

---

## What I'd Do Differently

1. **Start with PGlite from day one.** I briefly considered SQLite and it would have been fine, but PGlite's real PostgreSQL compatibility means I never had to compromise on queries.

2. **Avoid Worker threads with native NAPI modules.** I lost days to segfaults before realizing the NAPI `AsyncWorker` pattern is the correct approach in Electron.

3. **Build the setup wizard earlier.** The BYOK model is powerful but intimidating for non-technical users. A guided first-run experience should have been in v1.

4. **Design the state management system first.** Zustand stores evolved organically and some got complex. Planning the store architecture upfront would have saved refactoring.

---

## Try It

LifeDash is open source and free to download:
- **Website:** [lifedash.space](https://lifedash.space)
- **GitHub:** [github.com/Lab-51/lifedash](https://github.com/Lab-51/lifedash)

If you're a developer who attends meetings and manages projects, give it a shot. And if you build something interesting with PGlite, Whisper, or the Vercel AI SDK tool-calling — I'd love to hear about it.

---

*Built by a developer who was tired of switching between five different apps to get work done.*
