# Plan 9.1: Standalone Database — Replace Docker PostgreSQL with PGlite

## Approach: PGlite (WASM PostgreSQL)

Replace Docker + PostgreSQL 16 container with **PGlite** (`@electric-sql/pglite`) — a WASM-compiled
PostgreSQL that runs entirely in-process. No external binaries, no Docker, no port management.

**Why PGlite:**
- Same PostgreSQL dialect — all 10 `pg-core` schema files, 11 enums, 7 migrations work unchanged
- All 15+ IPC handler files and 10+ service files continue using `getDb()` untouched
- Runs in-process as WASM — invisible to antivirus/corporate security, no license concerns
- ~3-4MB package size (vs ~100-150MB for embedded-postgres)
- Architecture-independent WASM — works on x64, ARM, Apple Silicon without per-platform builds
- Drizzle adapter verified: `drizzle-orm/pglite` + `drizzle-orm/pglite/migrator`
- Enables future auto-update distribution (Squirrel) — data in userData survives app updates

**What changes (6 files):**
- `connection.ts` — PGlite with filesystem persistence in `userData/pg-data/`
- `migrate.ts` — PGlite migrator import
- `backupService.ts` — Drizzle-based JSON dump/restore (removes last Docker dependency)
- `package.json` — add `@electric-sql/pglite`, remove `postgres`
- `forge.config.ts` — include `drizzle/` migrations as extraResource
- `README.md` — remove Docker prerequisite

**What stays the same (50+ files):**
- All 10 schema files (same `pg-core` definitions)
- All 15+ IPC handler files (use `getDb()` unchanged)
- All 10+ service files (use Drizzle query API unchanged)
- All renderer/store code (IPC bridge unchanged)
- `exportService.ts` (uses `PgTable` from `drizzle-orm/pg-core` — still valid, PGlite uses pg-core schemas)

**Docker/postgres references in codebase (verified via grep — only 2 active files):**
- `connection.ts:15` — `import postgres from 'postgres'` → replaced in Task 1
- `backupService.ts` — 6 Docker references (exec, pg_dump, psql) → replaced in Task 2

<phase n="9.1" name="Standalone Database — PGlite Migration">
  <context>
    The app currently requires Docker Desktop + PostgreSQL 16 container to function.
    Docker is a distribution killer: 500MB install, WSL2 required on Windows, paid license
    for enterprise, must be running before app launches, impossible for Mac App Store.

    This plan replaces Docker PostgreSQL with PGlite, making the app fully standalone.

    Key files (read before executing):
    @src/main/db/connection.ts (71 lines — postgres driver + pool + health check)
    @src/main/db/migrate.ts (30 lines — postgres-js migrator + path resolution)
    @src/main/main.ts (195 lines — app lifecycle, connectDatabase + runMigrations at line 120)
    @src/main/services/backupService.ts (277 lines — Docker exec pg_dump/psql + auto-backup settings)
    @src/main/services/exportService.ts (111 lines — reference for Drizzle table query pattern)
    @forge.config.ts (61 lines — asar: true, no extraResource yet)
    @vite.main.config.ts (13 lines — currently externalizes @fugood/whisper.node only)
    @package.json (67 lines — "postgres": "^3.4.8" to remove)
    @drizzle.config.ts (14 lines — dialect: postgresql, Docker connection URL)

    Database inventory (from schema exploration):
    - 20 tables across 9 schema files
    - 11 pgEnums (card_priority, meeting_status, idea_status, etc.)
    - 7 migrations (0000-0006)
    - 40+ UUID columns with gen_random_uuid() default
    - 15+ foreign keys with CASCADE delete
    - 2 composite primary keys (card_labels, idea_tags)
    - 3 upsert patterns (onConflictDoUpdate)
    - 1 raw SQL use (LIKE pattern in backup settings)
    - No advanced PG features (no CTEs, window functions, JSONB operators, LISTEN/NOTIFY)

    FK-safe table ordering (parents → children, for backup restore):
    INSERT ORDER: projects → settings → aiProviders → boards → labels → columns →
      meetings → ideas → brainstormSessions → cards → aiUsage → transcripts →
      meetingBriefs → actionItems → cardLabels → cardComments → cardRelationships →
      cardActivities → cardAttachments → ideaTags → brainstormMessages
    DELETE ORDER: reverse of above
  </context>

  <task type="auto" n="1">
    <n>Replace postgres driver with PGlite + update connection and migration</n>
    <files>
      package.json (add @electric-sql/pglite, remove postgres)
      src/main/db/connection.ts (rewrite: PGlite with filesystem persistence)
      src/main/db/migrate.ts (update import: drizzle-orm/pglite/migrator)
      src/main/main.ts (update comment on line 116, no functional changes needed)
    </files>
    <preconditions>
      - Node.js 18+ installed
      - npm available
      - Current working directory is project root
    </preconditions>
    <action>
      1. Install PGlite and remove old driver:
         - `npm install @electric-sql/pglite`
         - `npm uninstall postgres`
         - Keep all other dependencies unchanged

      2. Rewrite `connection.ts` (71 lines → ~65 lines):
         - Replace: `import postgres from 'postgres'` → `import { PGlite } from '@electric-sql/pglite'`
         - Replace: `import { drizzle } from 'drizzle-orm/postgres-js'` → `import { drizzle } from 'drizzle-orm/pglite'`
         - Add: `import path from 'node:path'` and `import { app } from 'electron'`
         - Data directory: `path.join(app.getPath('userData'), 'pg-data')`
         - Module state: replace `sql` (postgres client) + `db` (drizzle) with `pglite` (PGlite) + `db` (drizzle)
         - `connectDatabase()`: `pglite = new PGlite(dataDir)`, then `db = drizzle(pglite, { schema })`
         - `getDb()`: unchanged (returns drizzle instance)
         - Add `getPglite()`: export for health check and direct access
         - `disconnectDatabase()`: call `await pglite.close()` instead of `await sql.end()`
         - `checkDatabaseHealth()`: use `await pglite.query('SELECT 1')` instead of `await sql\`SELECT 1\``
         - Remove: `getConnectionString()` (no longer needed — no connection string)
         - Remove: `DEFAULT_CONNECTION_STRING` constant
         - Remove: pool configuration (max, idle_timeout, connect_timeout)

      3. Update `migrate.ts` (30 lines → ~30 lines):
         - Replace: `import { migrate } from 'drizzle-orm/postgres-js/migrator'`
         - With: `import { migrate } from 'drizzle-orm/pglite/migrator'`
         - Keep the same migrationsFolder logic (app.isPackaged → resourcesPath, else appPath)
         - Keep `getDb()` call unchanged

      4. Update `main.ts` comment (line 116):
         - Change "Connect to PostgreSQL" comment to "Initialize embedded database"
         - No functional changes — connectDatabase() + runMigrations() + disconnectDatabase()
           lifecycle already works correctly. PGlite just runs in-process instead of connecting
           to Docker.

      WHY: PGlite eliminates the Docker dependency entirely. The Drizzle query API is
      identical — getDb() returns the same drizzle instance type, so all 15+ IPC handler
      files and 10+ service files continue working without any changes.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero errors (type compatibility between drizzle-orm/pglite and pg-core schemas)
      2. `npx vitest run` — all 99 tests pass (no test changes needed — tests don't import connection.ts)
      3. `npm run start` — app boots, creates pg-data/ directory in userData, runs migrations, loads UI
      4. Create a project → add a board → add columns → add cards with labels → verify CRUD works
      5. Navigate to Meetings, Ideas, Brainstorm, Settings pages → verify no errors
    </verify>
    <done>
      App boots with PGlite instead of Docker PostgreSQL.
      All existing features work (projects, boards, cards, meetings, ideas, brainstorm, settings).
      pg-data/ directory created in userData with persistent database files.
      No Docker or external database required.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - drizzle-orm v0.45.1 includes the pglite adapter (drizzle-orm/pglite export)
      - PGlite supports all PostgreSQL features used: pgEnum, uuid with gen_random_uuid(),
        timestamp with timezone, varchar, boolean, integer, text, real, composite PKs,
        foreign keys with CASCADE, onConflictDoUpdate, LIKE pattern in sql template
      - PGlite works in Electron main process Node.js context (WASM in Node.js is supported)
      - PGlite filesystem persistence: new PGlite(dirPath) creates/opens database at that path
      - All service files use getDb() and Drizzle query API — no raw postgres driver calls
        exist outside connection.ts (verified via grep: only connection.ts:15 imports postgres)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Rewrite backup service without Docker dependency</n>
    <files>
      src/main/services/backupService.ts (rewrite: Drizzle-based JSON backup/restore)
      src/main/services/exportService.ts (add missing cardAttachments to EXPORT_TABLES)
    </files>
    <preconditions>
      - Task 1 complete (PGlite connection working)
      - App can connect to database and query tables
    </preconditions>
    <action>
      1. Rewrite `createBackup()`:
         - Remove Docker exec pg_dump — replace with Drizzle table queries
         - Import all 21 tables from schema (20 tables + cardAttachments which is missing from exportService)
         - Query each table via `db.select().from(table)` in FK-safe order (parents first):
           projects, settings, aiProviders, boards, labels, columns, meetings, ideas,
           brainstormSessions, cards, aiUsage, transcripts, meetingBriefs, actionItems,
           cardLabels, cardComments, cardRelationships, cardActivities, cardAttachments,
           ideaTags, brainstormMessages
         - Strip apiKeyEncrypted from aiProviders rows (same pattern as exportService)
         - Serialize as JSON with metadata header: { version: 1, createdAt, tableCount, tables: {...} }
         - Save as `backup-YYYY-MM-DD-HHmmss.json` (changed from .sql)
         - Keep same BackupInfo return type and progress events

      2. Rewrite `restoreBackup()`:
         - Read and parse JSON backup file
         - Validate version field and table structure
         - Create safety backup first (existing pattern, now calls the rewritten createBackup)
         - DELETE all data in reverse FK order (children first):
           brainstormMessages, ideaTags, cardAttachments, cardActivities, cardRelationships,
           cardComments, cardLabels, actionItems, meetingBriefs, transcripts, aiUsage,
           cards, brainstormSessions, ideas, meetings, columns, labels, boards,
           aiProviders, settings, projects
         - INSERT data in forward FK order (parents first) — same order as createBackup
         - Use `db.insert(table).values(rows)` for each non-empty table
         - Keep progress events throughout

      3. Update `listBackups()`:
         - Change regex to accept BOTH .sql and .json files:
           `/^backup-\d{4}-\d{2}-\d{2}-\d{6}\.(sql|json)$/`
         - This provides backward compatibility — old .sql backups still show up (read-only,
           can be deleted but not restored since we no longer have pg_dump/psql)

      4. Update `deleteBackup()`:
         - Update filename validation regex to accept both .sql and .json:
           `/^backup-[\d-]+\.(sql|json)$/`

      5. Remove Docker dependencies:
         - Remove `import { execFile, spawn } from 'node:child_process'`
         - Remove `import { promisify } from 'node:util'`
         - Remove `const execFileAsync = promisify(execFile)`
         - Remove `isDockerAvailable()` function entirely
         - Remove `import { sql } from 'drizzle-orm'` if no longer needed
           (check: getAutoBackupSettings still uses `sql` template for LIKE query — KEEP IT)
         - Update file header comments

      6. Fix exportService.ts gap:
         - Add `cardAttachments: schema.cardAttachments` to EXPORT_TABLES
         - This table was added in Plan 7.8 but never added to the export list

      7. Keep unchanged:
         - `getBackupDir()` — same logic
         - `emitProgress()` — same logic
         - `cleanOldBackups()` — same logic (uses listBackups + unlink)
         - `getAutoBackupSettings()` — same logic (Drizzle query with sql LIKE)
         - `updateAutoBackupSettings()` — same logic (Drizzle upsert)

      WHY: The backup service is the ONLY remaining Docker dependency in the entire codebase.
      Rewriting it to use Drizzle queries (same pattern as exportService) makes the app
      100% standalone. JSON backups are human-readable, portable, and version-tagged.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero errors
      2. `npx vitest run` — all 99 tests pass
      3. Manual: Settings → Backup → Create Backup → verify .json file appears in list
      4. Manual: Open the .json file — verify it contains all 21 tables with data
      5. Manual: Create some test data → Backup → Delete test data → Restore → verify data is back
      6. Manual: Verify auto-backup settings toggle still works
    </verify>
    <done>
      Backup/restore works without Docker. Creates versioned .json backup files.
      Restore deletes all data then reinserts in FK-safe order.
      Old .sql backups still visible in list (for manual deletion).
      cardAttachments now included in both backup and export.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - FK-safe table ordering is correct (derived from schema foreign key definitions)
      - Drizzle bulk insert handles all column types: UUIDs as strings, timestamps as ISO strings,
        enums as string values — which is how Drizzle serializes them from select()
      - Drizzle delete().from(table) without WHERE deletes all rows (verified: standard SQL)
      - JSON file size is manageable — for a single-user desktop app, backup should be < 10MB
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Packaging config, Docker cleanup, and documentation update</n>
    <files>
      forge.config.ts (add extraResource for drizzle/ migrations)
      vite.main.config.ts (externalize @electric-sql/pglite if needed for WASM)
      drizzle.config.ts (add comment about PGlite — keep Docker URL for drizzle-kit studio)
      docker-compose.yml (add OPTIONAL header comment)
      .env.example (simplify — mark DATABASE_URL as optional)
      README.md (remove Docker prerequisite, update setup instructions)
      package.json (update db:up/db:down script descriptions if possible)
    </files>
    <preconditions>
      - Tasks 1 and 2 complete (PGlite working, backup rewritten)
      - `npx tsc --noEmit` passes
      - `npx vitest run` passes
    </preconditions>
    <action>
      1. Update `forge.config.ts`:
         - Add `extraResource: ['./drizzle']` to `packagerConfig`
         - This copies the drizzle/ migrations folder alongside the asar in the packaged app
         - The existing migrate.ts already resolves: `path.join(process.resourcesPath, 'drizzle')`

      2. Check `vite.main.config.ts`:
         - PGlite is a WASM package. Vite may try to bundle its WASM binary inline.
         - Add `'@electric-sql/pglite'` to the external array alongside '@fugood/whisper.node'
         - This ensures PGlite is loaded from node_modules at runtime, not bundled by Vite

      3. Update `drizzle.config.ts`:
         - Add comment explaining: "This config is used by drizzle-kit CLI only.
           The app uses PGlite at runtime (see connection.ts).
           Keep Docker URL here for optional drizzle-kit studio/migrate usage."
         - Keep `dialect: 'postgresql'` (PGlite IS PostgreSQL)
         - Keep `dbCredentials.url` pointing to Docker (only needed for `db:studio`)

      4. Update Docker files:
         - `docker-compose.yml`: Add comment at top:
           "# OPTIONAL: Only needed for drizzle-kit studio or direct SQL access during development.
            # The app uses an embedded database (PGlite) — Docker is NOT required to run."
         - `.env.example`: Mark both variables as optional, add note:
           "# These are only needed if using Docker for development database access."

      5. Update `README.md`:
         - Remove Docker Desktop from Prerequisites section
         - Remove `docker compose up -d` from Quick Start
         - Simplify Quick Start to: git clone → npm install → npm start
         - Add note: "The database is embedded — no external setup needed."
         - Move `db:up`, `db:down` to an "Optional: Docker Development Database" section
         - Update Tech Stack table: change "PostgreSQL (Docker) | 16" to "PGlite (embedded) | 0.3.x"

      6. Verify no stale Docker references in active code:
         - autoBackupScheduler.ts — uses backupService functions only (no Docker refs) ✓
         - SettingsPage.tsx — no Docker status check ✓
         - No IPC handlers reference Docker directly ✓
         - Only backupService.ts had Docker refs → already removed in Task 2

      WHY: The packaged app must include migration SQL files and work without any external
      dependencies. Docker becomes optional (for devs who want drizzle-kit studio).
      README must reflect the simplified "install and run" experience.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero errors
      2. `npx vitest run` — all 99 tests pass
      3. `npm run start` — app boots correctly (development mode)
      4. `npm run package` — completes without errors
      5. Run packaged app from `out/` folder — boots, creates database, all features work
      6. Verify drizzle/ folder exists in packaged app's resources directory
    </verify>
    <done>
      Packaged app is fully standalone. No Docker, no external database.
      User installs and runs immediately. Migrations auto-apply on first launch.
      README reflects the simplified setup.
      Docker remains available as optional dev tool for drizzle-kit studio.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - PGlite WASM loads correctly when externalized by Vite (not bundled inline)
      - Drizzle migrate() can read SQL files from extraResource path in packaged app
        (migrate.ts already has this path logic: process.resourcesPath + '/drizzle')
      - Electron Forge's extraResource copies the entire drizzle/ folder correctly
      - If WASM loading from asar fails, fallback: add '@electric-sql/pglite' to
        packagerConfig.asar.unpack or asarUnpack glob
    </assumptions>
  </task>
</phase>
