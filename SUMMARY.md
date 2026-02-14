# Summary: Plan 9.1 — Standalone Database (PGlite Migration)

## Date: 2026-02-14
## Status: COMPLETE (3/3 tasks, sequential execution)

## What Changed

Replaced Docker PostgreSQL with PGlite (WASM PostgreSQL). The app is now fully standalone — install and run, no external dependencies.

### Task 1: Replace postgres driver with PGlite
**Status:** COMPLETE | **Confidence:** HIGH

- **package.json**: Added `@electric-sql/pglite` (^0.3.15), removed `postgres` (^3.4.8)
- **connection.ts**: Full rewrite — PGlite with filesystem persistence in `userData/pg-data/`
  - `connectDatabase()`: `new PGlite(dataDir)` + `drizzle(pglite, { schema })`
  - `disconnectDatabase()`: `pglite.close()` instead of `sql.end()`
  - `checkDatabaseHealth()`: `pglite.query('SELECT 1')` instead of tagged template
  - Added `getPglite()` and `getDataDirectory()` exports
  - Removed: `getConnectionString()`, `DEFAULT_CONNECTION_STRING`, pool config
- **migrate.ts**: Import changed from `drizzle-orm/postgres-js/migrator` to `drizzle-orm/pglite/migrator`
- **main.ts**: Updated comment from "PostgreSQL" to "PGlite"

### Task 2: Rewrite backup service without Docker
**Status:** COMPLETE | **Confidence:** HIGH

- **backupService.ts**: Complete rewrite (277 → 344 lines)
  - Removed: Docker exec, pg_dump, psql, child_process, `isDockerAvailable()`
  - Added: Drizzle-based JSON backup/restore with FK-safe ordering (21 tables)
  - Backup format: JSON with `{ version, createdAt, tableCount, tables }` structure
  - File extension: `.json` (was `.sql`)
  - `listBackups()` + `deleteBackup()`: Accept both .sql and .json for backward compat
  - Strips `apiKeyEncrypted` from aiProviders (sensitive data)
- **exportService.ts**: Added missing `cardAttachments` to EXPORT_TABLES

### Task 3: Packaging config, Docker cleanup, documentation
**Status:** COMPLETE | **Confidence:** MEDIUM → verified HIGH

- **forge.config.ts**: Added `extraResource: ['./drizzle']` to packagerConfig
- **vite.main.config.ts**: Added `'@electric-sql/pglite'` to Rollup externals
- **drizzle.config.ts**: Updated header comment (PGlite at runtime, Docker URL for CLI only)
- **docker-compose.yml**: Added OPTIONAL header comment
- **.env.example**: Marked all variables as optional
- **README.md**: Removed Docker prerequisite, simplified Quick Start (3 steps), moved db:up/db:down to "Optional" section, updated Tech Stack to "PGlite (embedded) | 0.3.x"

## Files Modified (10)
- `package.json` (add pglite, remove postgres)
- `src/main/db/connection.ts` (full rewrite)
- `src/main/db/migrate.ts` (import change)
- `src/main/main.ts` (comment update)
- `src/main/services/backupService.ts` (full rewrite)
- `src/main/services/exportService.ts` (add cardAttachments)
- `forge.config.ts` (extraResource)
- `vite.main.config.ts` (externalize pglite)
- `drizzle.config.ts` (comment update)
- `README.md` (remove Docker prereq, simplify setup)

## Files Updated (not code)
- `docker-compose.yml` (optional header comment)
- `.env.example` (mark optional)

## Verification
- `npx tsc --noEmit`: PASS (zero errors)
- `npx vitest run`: 99/99 tests pass (no test changes needed)
- Manual verification: Pending (requires running app)

## What's Next
1. `/nexus:git` to commit Plan 9.1 changes
2. Manual test: `npm run start` → verify app boots with PGlite
3. Manual test: `npm run package` → verify packaged app works
4. Plan 9.2+: Auto-update, installer config, or next distribution tasks
