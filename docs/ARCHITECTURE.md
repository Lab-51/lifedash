# Architecture

## Overview

Living Dashboard is an Electron desktop app with three isolated processes communicating via IPC.

```
+-------------------+     IPC (invoke/handle)     +-------------------+
|   Renderer        |     contextBridge           |   Main Process    |
|   (React 19)      | <------------------------> |   (Node.js)       |
|  Zustand, Router  |                             |  Services, ORM   |
+-------------------+                             +--------+----------+
                                                           |
                                                  +--------v----------+
                                                  |  PGlite (WASM)   |
                                                  |  (embedded)       |
                                                  +-------------------+
```

## Process Model

**Main Process** (`src/main/main.ts`) -- Node.js process managing the app lifecycle: frameless window creation with state persistence, system tray, single instance lock, embedded database (PGlite) connection/migration on startup, IPC handler registration (17 modules, 100+ channels), CSP enforcement, and audio loopback init. On Windows/Linux, closing the window quits the app. On macOS, it hides to tray (standard convention).

**Preload** (`src/preload/preload.ts`) -- Bridge script exposing `window.electronAPI` via `contextBridge.exposeInMainWorld()`. Wraps every IPC channel in a typed method. Provides event subscription methods (e.g., `onRecordingState`) that return cleanup functions. Keeps `contextIsolation: true` and `nodeIntegration: false`.

**Renderer** (`src/renderer/App.tsx`) -- React 19 frontend in a Chromium webview. Uses `HashRouter` (required for `file://`), lazy-loaded pages, Zustand stores calling `window.electronAPI.*`, theme management, and keyboard shortcuts.

## Data Flow

All data flows unidirectionally through the IPC bridge:

```
UI Action -> Zustand Store -> window.electronAPI.method(data) -> ipcRenderer.invoke()
  -> IPC Handler (validates with Zod) -> Service / Drizzle query -> PostgreSQL
  -> Result returns through IPC -> Store updates state -> React re-renders
```

For streaming (brainstorm chat, recording), the main process pushes via `mainWindow.webContents.send()` and the preload exposes `on*` subscription methods.

## IPC Communication

### Channel Naming

Channels follow `domain:action`. Examples by domain:

| Domain | Examples |
|--------|----------|
| `projects` | `projects:list`, `projects:create`, `projects:update`, `projects:delete` |
| `cards` | `cards:create`, `cards:move`, `card:getComments`, `card:addAttachment` |
| `meetings` | `meetings:list`, `meetings:generate-brief`, `meetings:convert-action-to-card` |
| `ideas` | `ideas:list`, `ideas:convert-to-project`, `idea:analyze` |
| `brainstorm` | `brainstorm:create-session`, `brainstorm:send-message` |
| `ai` | `ai:list-providers`, `ai:test-connection`, `ai:get-usage-summary` |
| `recording` | `recording:start`, `recording:stop` |
| `backup` | `backup:create`, `backup:restore`, `backup:export` |

Push channels (main -> renderer): `recording:state-update`, `brainstorm:stream-chunk`, `backup:progress`, `whisper:download-progress`, `window:maximize-change`.

### Handler Registration

Each domain has a file in `src/main/ipc/` exporting `register*Handlers()`. All 17 are imported and called from `src/main/ipc/index.ts`.

### Input Validation

All handler inputs are validated with Zod via `validateInput()` (`src/shared/validation/ipc-validator.ts`). Schemas are in `src/shared/validation/schemas.ts`.

```typescript
ipcMain.handle('projects:create', async (_event, data: unknown) => {
  const input = validateInput(createProjectInputSchema, data);
  // input is now typed and validated
});
```

## Database Layer

**Connection:** `src/main/db/connection.ts` -- PGlite (WASM PostgreSQL) with filesystem persistence in `app.getPath('userData')/pg-data/`. Wrapped with Drizzle ORM. No external database server required.

**Schema files** in `src/main/db/schema/` (9 files, barrel-exported from `index.ts`):

| File | Tables |
|------|--------|
| `projects.ts` | projects |
| `boards.ts` | boards, columns |
| `cards.ts` | cards, card_comments, card_relationships, card_activities, card_attachments, card_labels |
| `labels.ts` | labels |
| `meetings.ts` | meetings, transcript_segments, meeting_briefs, meeting_action_items |
| `ideas.ts` | ideas |
| `brainstorming.ts` | brainstorm_sessions, brainstorm_messages |
| `settings.ts` | settings (key-value), ai_usage |
| `ai-providers.ts` | ai_providers |

**Migrations:** Drizzle Kit generates SQL into `./drizzle/` (config: `drizzle.config.ts`). Migrations run automatically on startup via `src/main/db/migrate.ts`. In packaged builds, `drizzle/` is shipped as an `extraResource` and resolved from `process.resourcesPath`.

## State Management

Ten Zustand stores in `src/renderer/stores/`:

| Store | Responsibility |
|-------|----------------|
| `useBoardStore` | Active board, columns, cards, labels (Kanban) |
| `useCardDetailStore` | Card comments, relationships, activities, attachments |
| `useProjectStore` | Project list CRUD |
| `useMeetingStore` | Meeting list, detail, transcript |
| `useRecordingStore` | Recording state, audio capture, segments |
| `useIdeaStore` | Ideas CRUD, analysis, conversion |
| `useBrainstormStore` | Sessions, messages, streaming |
| `useSettingsStore` | Settings, AI providers, task model config |
| `useBackupStore` | Backup/restore, export, auto-backup |
| `useTaskStructuringStore` | AI project planning, task breakdown |

Stores follow a consistent pattern: state fields (`items`, `loading`, `error`) plus async actions that call `window.electronAPI.*`, update state with `set()`, and handle errors.

## AI Provider System

`src/main/services/ai-provider.ts` provides a unified interface over three providers:

| Provider | Package | Factory |
|----------|---------|---------|
| OpenAI | `@ai-sdk/openai` | `createOpenAI()` |
| Anthropic | `@ai-sdk/anthropic` | `createAnthropic()` |
| Ollama | `ollama-ai-provider` | `createOllama()` |

**Per-task model routing:** `resolveTaskModel(taskType)` checks a `task_models` JSON setting so users can assign different provider/model combos per task type. Falls back to the first enabled provider.

**Usage logging:** Every AI call logs token counts to `ai_usage` (fire-and-forget). Summaries displayed on the Settings page.

## Security Model

- **Context isolation:** `contextIsolation: true`, `nodeIntegration: false`. Renderer never touches Node.js APIs directly.
- **API key encryption:** Electron `safeStorage` API (`src/main/services/secure-storage.ts`) -- OS-level encryption (DPAPI/Keychain/libsecret). Keys stored as base64 in DB, decrypted only for API calls.
- **CSP:** Injected via `session.webRequest.onHeadersReceived()`. Production: `script-src 'self'`. Dev: adds `unsafe-eval`/`unsafe-inline` for Vite HMR. Connect-src whitelists OpenAI, Anthropic, Deepgram, AssemblyAI, Ollama.
- **IPC validation:** All inputs validated with Zod before any DB or service calls.
- **Electron Fuses** (`forge.config.ts`): `RunAsNode: false`, `EnableCookieEncryption: true`, `OnlyLoadAppFromAsar: true`, and other hardening flags.

## Audio Pipeline

```
System Audio (electron-audio-loopback, init before app ready)
  -> audioCaptureService.ts (renderer, captures chunks)
  -> ipcRenderer.send('audio:chunk', buffer)
  -> audioProcessor.ts (main, buffers PCM, writes WAV)
  -> transcriptionWorker.ts (worker thread, Whisper inference)
  -> segments stored in DB + pushed to renderer via IPC
  -> Cloud fallback: deepgramTranscriber.ts / assemblyaiTranscriber.ts
```

## Key Patterns

- **Service layer:** Business logic in `src/main/services/` as stateless functions importing `getDb()`.
- **IPC handlers:** Each module exports `register*Handlers(mainWindow?)`. Uses `ipcMain.handle()` for request/response, `webContents.send()` for push events.
- **Type organization:** 16 domain modules in `src/shared/types/`, barrel-exported from `index.ts`. `ElectronAPI` interface in `electron-api.ts` imports all domain types.
- **Validation schemas:** Zod schemas in `src/shared/validation/schemas.ts` mirror type definitions, used at IPC boundary via `validateInput()`.
- **Logger:** `createLogger(prefix)` from `src/main/services/logger.ts` returns scoped `debug/info/warn/error` methods.
- **Backup:** `src/main/services/backupService.ts` -- Drizzle-based JSON backup/restore. Queries all 21 tables in FK-safe order, serializes to versioned JSON. Restores by deleting all data (children first) then inserting (parents first).
- **Build:** Electron Forge + Vite plugin builds main, preload, renderer, and worker targets. Installers: Squirrel (Windows), ZIP (macOS). A `packageAfterCopy` hook in `forge.config.ts` copies externalized packages (`@electric-sql/pglite`) and renderer output into the asar.
