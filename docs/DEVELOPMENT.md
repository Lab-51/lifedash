# Development Guide

For project overview, features, and tech stack, see [README.md](../README.md).

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Runtime and package management |
| Docker Desktop | Latest | Hosts PostgreSQL 16 via `docker-compose.yml` |
| Git | Latest | Version control |

## First-Time Setup

```bash
git clone <repository-url>
cd living-dashboard
npm install
cp .env.example .env          # Adjust DB_PASSWORD if needed
docker compose up -d           # Start PostgreSQL 16 container
npm start                      # Launch Electron in dev mode
```

On first launch, the app automatically runs Drizzle migrations against the PostgreSQL database. No manual migration step is needed for a fresh setup.

## Daily Development

```bash
npm run db:up                  # Ensure PostgreSQL container is running
npm start                      # Launch with Vite HMR + DevTools
```

`npm start` runs `electron-forge start`, which boots three Vite builds simultaneously:

| Process | Entry Point | Hot Reload |
|---------|-------------|------------|
| Main (Node.js) | `src/main/main.ts` | Restart on change |
| Preload | `src/preload/preload.ts` | Restart on change |
| Renderer (React) | `src/renderer/main.tsx` | Vite HMR (instant) |

DevTools open automatically in development (`src/main/main.ts` line 153).

## Project Structure

```
src/
  main/                          # Electron main process (Node.js)
    main.ts                      # App entry: window, tray, DB, IPC registration
    tray.ts                      # System tray icon and menu
    db/
      connection.ts              # PostgreSQL pool (porsager/postgres + Drizzle)
      migrate.ts                 # Auto-migration runner
      schema/                    # 9 Drizzle schema files (projects, cards, meetings, etc.)
        index.ts                 # Barrel export for all schema tables
    ipc/                         # 18 IPC handler modules
      index.ts                   # Central registration — registerIpcHandlers()
    services/                    # 22 business logic services
      ai-provider.ts             # Multi-provider AI (OpenAI, Anthropic, Ollama)
      secure-storage.ts          # Electron safeStorage encryption wrapper
      logger.ts                  # Structured logger with scoped prefixes
      backupService.ts           # Database backup/restore
      ...
    workers/
      transcriptionWorker.ts     # Background Whisper transcription
  preload/                       # Electron preload bridge
    preload.ts                   # contextBridge.exposeInMainWorld('electronAPI', {...})
  renderer/                      # React 19 frontend
    main.tsx                     # React DOM entry
    App.tsx                      # HashRouter, routes, lazy-loaded pages
    components/                  # 32+ UI components
      settings/                  # Settings page sub-sections (4 files)
    hooks/                       # Custom hooks (useTheme, useKeyboardShortcuts, etc.)
    pages/                       # Route pages (Projects, Meetings, Ideas, Brainstorm, Settings, Board)
    services/                    # Frontend services (audioCaptureService)
    stores/                      # 10 Zustand stores
    styles/
      globals.css                # Tailwind CSS imports and custom styles
    utils/
      date-utils.ts              # Date formatting helpers
  shared/                        # Code shared across all processes
    types/                       # 16 domain type modules + barrel index
      electron-api.ts            # ElectronAPI interface (typed IPC bridge)
      index.ts                   # Barrel re-export
    utils/
      card-utils.ts              # Card sorting/filtering helpers
    validation/
      ipc-validator.ts           # Zod-based IPC input validation
      schemas.ts                 # Zod schemas for all IPC inputs
```

## NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm start` | `electron-forge start` | Launch app in development mode |
| `npm run package` | `electron-forge package` | Package app for distribution |
| `npm run make` | `electron-forge make` | Build platform installers (Squirrel/ZIP) |
| `npm run lint` | `tsc --noEmit` | Type-check the entire project |
| `npm test` | `vitest run` | Run all tests once |
| `npm run test:watch` | `vitest` | Run tests in watch mode |
| `npm run test:ui` | `vitest --ui` | Run tests with Vitest browser UI |
| `npm run db:generate` | `drizzle-kit generate` | Generate migration SQL from schema changes |
| `npm run db:migrate` | `drizzle-kit migrate` | Apply pending migrations |
| `npm run db:studio` | `drizzle-kit studio` | Open Drizzle Studio (database browser GUI) |
| `npm run db:up` | `docker compose up -d` | Start PostgreSQL container |
| `npm run db:down` | `docker compose down` | Stop PostgreSQL container |

## Adding a New Feature

Standard flow for adding functionality end-to-end:

1. **Define types** in `src/shared/types/` -- create a new domain file or extend an existing one. Re-export from `src/shared/types/index.ts`.
2. **Add Zod schema** in `src/shared/validation/schemas.ts` for any new IPC inputs.
3. **Create/extend a service** in `src/main/services/` for business logic.
4. **Add IPC handlers** in `src/main/ipc/` -- create a new module or extend an existing one. Each handler uses `ipcMain.handle('channel:name', ...)`.
5. **Register handlers** in `src/main/ipc/index.ts` -- import and call your `register*Handlers()` function.
6. **Add preload bridge methods** in the appropriate domain file under `src/preload/domains/` (e.g., `projects.ts`, `meetings.ts`). Each domain file exports a bridge object that wraps `ipcRenderer.invoke('channel:name', ...)`.
7. **Extend `ElectronAPI`** interface in `src/shared/types/electron-api.ts` so the renderer has typed access.
8. **Create/extend a Zustand store** in `src/renderer/stores/` -- calls `window.electronAPI.*` methods.
9. **Build UI components** in `src/renderer/components/` and wire them into a page in `src/renderer/pages/`.

## Database

- **Schema location:** `src/main/db/schema/` (9 files, barrel-exported from `index.ts`)
- **Migration output:** `./drizzle/` directory (SQL files generated by Drizzle Kit)
- **Config:** `drizzle.config.ts` at project root

### Creating a new migration

```bash
# 1. Edit/create schema files in src/main/db/schema/
# 2. Generate migration SQL:
npm run db:generate
# 3. Apply migration (or just restart the app -- migrations run automatically on startup):
npm run db:migrate
```

### Browsing data

```bash
npm run db:studio    # Opens Drizzle Studio at https://local.drizzle.studio
```

## Testing

- **Framework:** Vitest 4.x with `globals: true` (no explicit imports needed)
- **Config:** `vitest.config.ts` at project root
- **Environment:** `node` (not jsdom)
- **Test location:** co-located in `__tests__/` directories next to source files
- **Pattern:** `src/**/*.test.ts` and `src/**/*.test.tsx`
- **Current test files:** 5 test files covering types, validation schemas, IPC validator, card utils, and date utils

```bash
npm test              # Run once
npm run test:watch    # Watch mode
npm run test:ui       # Vitest UI in browser
```

## Debugging

- **Renderer DevTools:** Opens automatically in development (Ctrl+Shift+I to toggle)
- **Main process logs:** Visible in the terminal where `npm start` was run. Uses structured logger with timestamps and scoped prefixes: `HH:mm:ss.SSS [LEVEL] [Prefix] message`
- **Database status:** The StatusBar component at the bottom of the app shows real-time DB connection state
- **IPC validation errors:** Logged to main process console with Zod error details

## Common Issues

| Problem | Solution |
|---------|----------|
| Docker not running | Start Docker Desktop, then `npm run db:up` |
| Port 5432 in use | Stop conflicting PostgreSQL instance or change port in `docker-compose.yml` |
| DB connection refused | Verify container is healthy: `docker ps` should show `living-dashboard-db` |
| Whisper model not found | Download a model from the Settings page in the app |
| White flash on startup | Expected to not occur -- `show: false` + `ready-to-show` + dark `backgroundColor` are set in `main.ts` |
| TypeScript errors after schema change | Run `npm run db:generate` then restart the app |
| CSP errors in DevTools | Dev CSP allows `unsafe-eval` and `unsafe-inline` for Vite HMR; production CSP is stricter |
