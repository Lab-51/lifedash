# Living Dashboard — Cheat Sheet

> AI-powered Electron desktop dashboard for professionals. Unifies meeting intelligence,
> project management, AI brainstorming, task planning, and idea management in one app.

---

## At a Glance

| Attribute | Value |
|-----------|-------|
| **Platform** | Windows (Electron 40, Node 22) |
| **Frontend** | React 19 + TypeScript 5.9 + Tailwind CSS 4 |
| **Database** | PGlite (embedded WASM PostgreSQL) — zero setup |
| **AI** | Vercel AI SDK v6 — OpenAI, Anthropic, Ollama, Kimi |
| **Transcription** | Local Whisper (whisper.cpp native addon) |
| **Packaging** | Electron Forge + Vite 7 |
| **Tests** | 99 tests across 5 files (Vitest) |
| **Dependencies** | 24 production, 16 dev |
| **Version** | 0.1.0 |
| **License** | Private |

---

## Core Features

### 1. Meeting Intelligence
- **System audio capture** via `electron-audio-loopback` (WASAPI)
- **Real-time transcription** with local Whisper (tiny/base/small models)
- **AI-generated briefs** — automatic summary after recording stops
- **Action item extraction** — AI pulls tasks from transcript
- **One-click conversion** — action items become project cards
- **Audio level meter** — retro equalizer visualization
- **Silence detection** — skips silent segments (saves CPU)
- **Mic device selection** — pick headset/mic from Settings
- **Custom save folder** — recordings stored where you choose
- **Transcription providers** — local Whisper, Deepgram, or AssemblyAI
- **Speaker diarization** — who said what (via API providers)
- **Meeting analytics** — talk time, word count, speaker balance

### 2. Project Dashboard (Kanban)
- **Multi-project** with color-coded sidebar
- **Drag-and-drop** cards between columns (pragmatic-drag-and-drop)
- **Rich text** card descriptions (TipTap editor)
- **Labels/tags** per project
- **Card relationships** — blocks, depends on, related to
- **Comments + activity log** per card
- **File attachments** on cards
- **Priority levels** — low, medium, high, urgent
- **Due dates** with overdue tracking

### 3. AI Brainstorming
- **Conversational AI** — chat interface for ideation
- **Streaming responses** — real-time token-by-token output
- **Multi-session** — create, archive, resume brainstorm sessions
- **Export to Idea** — save brainstorm outputs to idea repository

### 4. Task Structuring Engine
- **AI project planning** — generate full project plans
- **Card breakdown** — decompose a card into subtasks
- **Quick plan** — plan from just a name + description

### 5. Idea Repository
- **Quick capture** with title + description
- **Tags + categorization**
- **AI analysis** — feasibility, effort, impact scoring
- **Convert to project** or **convert to card** in one click
- **Status workflow** — new, exploring, active, archived

### 6. Settings & Configuration
- **Appearance** — theme selector
- **Audio devices** — microphone input selection
- **Recordings folder** — custom save path
- **Transcription provider** — local/Deepgram/AssemblyAI
- **Network proxy** — URL, no-proxy list, system proxy toggle
- **AI providers** — API keys, enable/disable, connection test
- **Model assignments** — choose model per task type
- **AI usage** — token tracking with cost display
- **Database backups** — auto-scheduled + manual backup/restore
- **Notifications** — desktop notification preferences
- **Data export** — JSON or CSV

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Electron Main Process              │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ IPC Hub  │  │  AI Provider │  │  Proxy Service│  │
│  │ (50+ ch) │  │  Manager     │  │  (undici)     │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ PGlite   │  │  Whisper     │  │  Recording    │  │
│  │ (WASM)   │  │  (Native)    │  │  Service      │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Backup   │  │  Secure      │  │  Notification │  │
│  │ Service  │  │  Storage     │  │  Scheduler    │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
└────────────────────┬─────────────────────────────────┘
                     │ contextBridge (preload)
                     │ IPC invoke/send
┌────────────────────┴─────────────────────────────────┐
│                 Electron Renderer Process             │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ React 19 │  │  Zustand     │  │  React Router │  │
│  │ + TSX    │  │  Stores      │  │  (6 pages)    │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Tailwind │  │  Framer      │  │  TipTap       │  │
│  │ CSS 4    │  │  Motion      │  │  Editor       │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Process Boundaries
- **Main process** — database, AI calls, file I/O, audio, encryption
- **Renderer process** — React UI, no direct Node.js access
- **Preload bridge** — type-safe IPC via `window.electronAPI`
- **No worker threads** — Whisper runs in-process via native AsyncWorker

---

## Security

### Defense in Depth (7 Layers)

| Layer | Mechanism | What It Protects |
|-------|-----------|-----------------|
| **1. Process Isolation** | `contextIsolation: true`, `nodeIntegration: false` | Renderer cannot access Node.js or main process |
| **2. IPC Validation** | Zod schemas on every `ipcMain.handle` | Prevents malformed/malicious input from renderer |
| **3. Content Security Policy** | Per-request CSP headers (strict in prod) | Blocks XSS, script injection, unauthorized network calls |
| **4. Electron Fuses** | 6 fuses hardened at package time | Binary-level protections (see below) |
| **5. API Key Encryption** | `Electron.safeStorage` (OS keychain) | API keys encrypted at rest, never sent to renderer |
| **6. Asar Integrity** | Embedded asar integrity validation | Prevents tampering with packaged app code |
| **7. Single Instance Lock** | `app.requestSingleInstanceLock()` | Prevents duplicate process attacks |

### Electron Fuses (Compile-Time)

| Fuse | Setting | Protection |
|------|---------|------------|
| RunAsNode | **OFF** | Blocks `ELECTRON_RUN_AS_NODE` hijack |
| CookieEncryption | **ON** | Encrypts cookies on disk |
| NodeOptionsEnv | **OFF** | Blocks `NODE_OPTIONS` injection |
| NodeCliInspect | **OFF** | Blocks `--inspect` debugging bypass |
| AsarIntegrity | **ON** | Validates asar hasn't been tampered |
| OnlyLoadFromAsar | **ON** | Prevents loading code from outside asar |

### Content Security Policy

| Directive | Development | Production |
|-----------|------------|------------|
| `default-src` | `'self'` | `'self'` |
| `script-src` | `'self' 'unsafe-eval' 'unsafe-inline'` | `'self'` |
| `style-src` | `'self' 'unsafe-inline'` | `'self' 'unsafe-inline'` |
| `connect-src` | `'self' ws: localhost:*` + API hosts | `'self'` + API hosts |
| `img-src` | `'self' data:` | `'self' data:` |
| `font-src` | `'self'` | `'self'` |

**Allowed API hosts:** `api.openai.com`, `api.anthropic.com`, `api.deepgram.com`, `api.assemblyai.com`, `localhost:11434` (Ollama)

### Data Security

| Data | Storage | Encryption |
|------|---------|------------|
| AI API keys | PGlite DB (base64 blob) | Electron safeStorage (DPAPI/Keychain) |
| Meeting audio | Local filesystem (WAV) | None (user's disk encryption) |
| Transcripts | PGlite DB | None (local DB, no network) |
| Settings | PGlite DB (key-value) | None (non-sensitive) |
| Database | PGlite WASM (in userData) | None (local only) |
| Backups | Local filesystem | None (user responsibility) |

### Enterprise Security (Phase 10)

| Feature | Status | Description |
|---------|--------|-------------|
| Code signing | Ready | Self-signed cert + Squirrel signing (IT pushes GPO trust) |
| MSI installer | Ready | WiX MSI for SCCM/Intune (installs to Program Files) |
| Proxy support | Ready | undici ProxyAgent, env vars + Settings UI |
| AppLocker compat | Via MSI | MSI installs to Program Files (allowed zone) |
| SmartScreen | Via signing | Signed exe bypasses SmartScreen warning |

---

## Database Schema (18 Tables)

### Core Entities

```
projects ──< boards ──< columns ──< cards >── card_labels ──> labels
                                       │
                                       ├── card_comments
                                       ├── card_activities
                                       ├── card_attachments
                                       └── card_relationships
```

```
meetings ──< transcripts
    │
    ├── meeting_briefs
    └── action_items ──> cards (optional conversion)
```

```
ideas ──< idea_tags

brainstorm_sessions ──< brainstorm_messages

settings (key-value store)
ai_providers ──< ai_usage
```

| Table | Rows Track | Key Columns |
|-------|-----------|-------------|
| `projects` | Workspaces | name, description, color, archived |
| `boards` | Kanban boards | projectId, name, position |
| `columns` | Board columns | boardId, name, position |
| `cards` | Tasks/items | columnId, title, description, priority, dueDate |
| `labels` | Tags | projectId, name, color |
| `meetings` | Recordings | projectId, title, template, status, audioPath |
| `transcripts` | Speech segments | meetingId, content, startTime, speaker |
| `meeting_briefs` | AI summaries | meetingId, summary |
| `action_items` | Extracted tasks | meetingId, description, status |
| `ideas` | Idea entries | title, status, effort, impact |
| `brainstorm_sessions` | AI chats | projectId, title, status |
| `brainstorm_messages` | Chat messages | sessionId, role, content |
| `settings` | App config | key (PK), value |
| `ai_providers` | LLM configs | name, apiKeyEncrypted, baseUrl, enabled |
| `ai_usage` | Token log | providerId, model, taskType, tokens |

---

## Pages & Navigation

| Page | Route | Purpose |
|------|-------|---------|
| Projects | `/` | Project list, create new |
| Board | `/projects/:id` | Kanban board for a project |
| Meetings | `/meetings` | Meeting list + recording controls |
| Ideas | `/ideas` | Idea repository |
| Brainstorm | `/brainstorm` | AI brainstorming sessions |
| Settings | `/settings` | All configuration |

**Sidebar** — persistent left nav with icons (Lucide React)
**Custom title bar** — frameless window, drag region, window controls

---

## AI Provider System

### Supported Providers

| Provider | Package | Use Case |
|----------|---------|----------|
| OpenAI | `@ai-sdk/openai` | GPT-4o, GPT-4o-mini |
| Anthropic | `@ai-sdk/anthropic` | Claude Sonnet, Haiku |
| Ollama | `ollama-ai-provider` | Local LLMs (Llama, Mistral) |
| Kimi (Moonshot) | `@ai-sdk/openai` (compat) | Kimi K2.5 |

### AI Task Types

| Task | What It Does | Default Model |
|------|-------------|---------------|
| Meeting Brief | Summarize transcript | Provider default |
| Action Items | Extract tasks from transcript | Provider default |
| Idea Analysis | Score feasibility/effort/impact | Provider default |
| Brainstorm | Conversational AI chat | Provider default |
| Task Structuring | Generate project plans | Provider default |
| Card Breakdown | Decompose card into subtasks | Provider default |

Users can override model per task type in Settings > Model Assignments.

### Token Usage Tracking
- Every AI call logged to `ai_usage` table (fire-and-forget)
- Tracks: provider, model, task type, input/output/total tokens
- Viewable in Settings > AI Usage

---

## IPC Channel Summary (50+ Handlers)

| Domain | Channels | Key Operations |
|--------|----------|----------------|
| Window | 4 | minimize, maximize, close, isMaximized |
| Database | 1 | status check |
| Projects | 4 | CRUD |
| Boards | 4 | CRUD |
| Columns | 5 | CRUD + reorder |
| Cards | 6 | CRUD + move |
| Card Extras | 12 | comments, relationships, activities, attachments |
| Labels | 6 | CRUD + attach/detach |
| Meetings | 5 | CRUD |
| Recording | 3 | start, stop, audio chunks |
| Whisper | 4 | list, download, has-model, progress |
| Intelligence | 6 | brief, actions, status, convert |
| Settings | 8 | get, set, delete, proxy, recordings path |
| AI Providers | 8 | CRUD, test, encryption, usage |
| Ideas | 8 | CRUD, convert, analyze |
| Brainstorm | 7 | CRUD, send message, export |
| Task Structuring | 3 | plan, quick-plan, breakdown |
| Backup | 8 | create, list, restore, export, auto-settings |
| Notifications | 3 | prefs, update, test |
| Transcription | 4 | config, set-provider, set-key, test |
| Diarization | 2 | diarize, analytics |

---

## Build & Distribution

### Development
```bash
npm start              # Launch dev mode (Vite HMR)
npm run lint           # TypeScript check (tsc --noEmit)
npm test               # Run 99 tests (Vitest)
```

### Packaging
```bash
npm run package        # Package app (no installer)
npm run make           # Build installers (Squirrel .exe + WiX .msi)
```

### Enterprise Build (with signing)
```powershell
# 1. Generate cert (once)
.\scripts\generate-cert.ps1

# 2. Build signed installers
$env:CERT_PASSWORD = "your-password"
npm run make
# Output: Squirrel .exe (signed) + WiX .msi
```

### Installer Targets

| Installer | Format | Install Location | Use Case |
|-----------|--------|-----------------|----------|
| Squirrel | `.exe` | `%LOCALAPPDATA%` | Dev/personal |
| WiX MSI | `.msi` | `Program Files` | Enterprise (SCCM/Intune) |
| ZIP | `.zip` | macOS only | macOS distribution |

### Externalized Packages (copied into asar)
- `@electric-sql/pglite` — WASM PostgreSQL
- `@fugood/whisper.node` — native Whisper addon
- `@fugood/node-whisper-win32-x64` — platform binary

### Extra Resources (alongside asar)
- `drizzle/` — database migration SQL files

---

## Key Settings Keys

| Key | Type | Purpose |
|-----|------|---------|
| `audio:inputDeviceId` | string | Selected microphone device ID |
| `recordings:savePath` | string | Custom recordings folder path |
| `proxy:url` | string | HTTP proxy URL |
| `proxy:noProxy` | string | Comma-separated bypass domains |
| `proxy:useSystem` | `"true"/"false"` | Use env var proxy |
| `task_models` | JSON | Model assignments per task type |
| `transcription:provider` | string | Active transcription provider |
| `theme` | string | UI theme |
| `backup:autoEnabled` | `"true"/"false"` | Auto-backup toggle |
| `backup:intervalHours` | string | Backup frequency |
| `backup:maxBackups` | string | Retention limit |

---

## Quick Facts for Stakeholders

- **Zero infrastructure** — no Docker, no server, no cloud account required
- **Fully offline capable** — with Ollama + local Whisper, works without internet
- **Data stays local** — embedded database, local file storage, no telemetry
- **Enterprise ready** — MSI installer, code signing, proxy support, Program Files install
- **AI provider agnostic** — swap between OpenAI/Anthropic/Ollama/Kimi per task
- **99 automated tests** — validation, schemas, utilities
- **Single binary** — ships as one installer, auto-migrates database on startup
