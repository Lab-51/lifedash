# Plan 7.3 — Database Backup/Restore & Data Export

**Requirement:** R15 — Database Backup & Sync (5 points)
**Scope:** pg_dump backup/restore via Docker, JSON/CSV data export, auto-backup scheduling, backup management UI
**Deferred:** Cloud backup (S3/Google Drive) → ISSUES.md (adds significant scope: auth, SDK deps, config UI)

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| 7.2 | R16 (UI) | Comments UI, relationships UI, activity log, card templates in CardDetailModal |
| **7.3** | **R15** | **Database backup/restore (pg_dump), JSON/CSV export, backup UI** |
| 7.4 | R11 | Task structuring AI service — project planning, pillars, task breakdown |
| 7.5 | R11 (UI) | Task structuring UI — planning wizard, templates, milestone view |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| 7.7 | R13 | Meeting templates, analytics, speaker diarization |
| 7.8 | R17 | Notifications service, desktop/tray notifications, reminders |

## Architecture Decisions

1. **Backup method: pg_dump/psql via Docker exec** — Uses `child_process.execFile('docker', ['exec', ...])` to run `pg_dump` and `psql` inside the PostgreSQL container. This is the cleanest approach for a Dockerized PostgreSQL: captures full schema including enums, constraints, indexes, and data. `execFile` (not `exec`) avoids shell injection risks.

2. **Backup format: Plain SQL (.sql)** — Human-readable, restorable with `psql`, includes `--clean --if-exists` flags for idempotent restore (DROP + CREATE statements).

3. **Export method: Drizzle queries → JSON/CSV** — Queries all tables via Drizzle ORM, serializes to JSON (single file) or CSV (one file per table, zipped). No external dependencies needed.

4. **Storage: app.getPath('userData')/backups/** — Default location for automatic backups. Manual exports use Electron's `dialog.showSaveDialog` for user-chosen location.

5. **Auto-backup: setInterval in main process** — Checks hourly whether a backup is due (daily/weekly). Simple and reliable with no cron library dependency. Settings stored in existing settings table.

6. **Restore safety: Pre-restore backup** — Automatically creates a backup before any restore operation. Confirmation required in UI.

7. **Security: API keys excluded from exports** — `aiProviders.apiKeyEncrypted` column is stripped from JSON/CSV exports. Backups via pg_dump include it (same machine, encrypted at rest).

8. **Audio files NOT in backups** — Referenced by path in DB, potentially gigabytes. Noted in UI.

---

<phase n="7.3" name="Database Backup/Restore & Data Export">
  <context>
    Phase 7, Plan 3 of 8. Implements R15: Database Backup & Sync.
    PostgreSQL 16 runs in Docker container "living-dashboard-db" with user "dashboard",
    database "living_dashboard".

    Existing infrastructure:
    - Service files in src/main/services/ (9 files, e.g. secure-storage.ts, ai-provider.ts)
    - IPC handlers in src/main/ipc/ (12 files), registered via registerIpcHandlers(mainWindow)
    - Types in src/shared/types.ts (ElectronAPI interface with ~60 methods)
    - Preload bridge in src/preload/preload.ts (contextBridge.exposeInMainWorld)
    - DB connection via src/main/db/connection.ts (getConnectionString, getDb, checkDatabaseHealth)
    - Settings table: key-value store (key VARCHAR 255 PK, value text)
    - Schema: 20 tables across 10 schema files in src/main/db/schema/

    @docker-compose.yml (container name, credentials, port)
    @src/main/db/connection.ts (getConnectionString, getDb)
    @src/main/db/schema/index.ts (all table imports — barrel export)
    @src/main/ipc/index.ts (handler registration pattern)
    @src/main/ipc/settings.ts (simple handler example)
    @src/preload/preload.ts (preload bridge pattern)
    @src/shared/types.ts (type definitions + ElectronAPI)
    @src/renderer/pages/SettingsPage.tsx (settings UI structure)
  </context>

  <task type="auto" n="1">
    <n>Backup service, export service, types, IPC handlers, and preload bridge</n>
    <files>
      src/main/services/backupService.ts (NEW ~280 lines)
      src/main/services/exportService.ts (NEW ~200 lines)
      src/main/ipc/backup.ts (NEW ~130 lines)
      src/main/ipc/index.ts (MODIFY — add registerBackupHandlers import + call)
      src/shared/types.ts (MODIFY — add backup/export types + 8 ElectronAPI methods)
      src/preload/preload.ts (MODIFY — add 8 backup/export bridge methods)
    </files>
    <action>
      ## WHY
      R15 requires pg_dump backup/restore, manual backup/restore UI, and JSON/CSV export.
      This task builds the complete backend infrastructure: service layer, IPC handlers,
      types, and preload bridge. Separating backup (Docker/pg_dump) from export (Drizzle queries)
      keeps concerns clean and failure modes isolated.

      ## WHAT

      ### 1a. Types — add to src/shared/types.ts

      Add these types before the ElectronAPI interface:

      ```typescript
      // === BACKUP & EXPORT TYPES ===

      export interface BackupInfo {
        fileName: string;
        filePath: string;
        createdAt: string; // ISO timestamp
        sizeBytes: number;
      }

      export interface BackupProgress {
        phase: 'starting' | 'dumping' | 'saving' | 'restoring' | 'complete' | 'failed';
        message: string;
        error?: string;
      }

      export type ExportFormat = 'json' | 'csv';

      export interface ExportOptions {
        format: ExportFormat;
        tables?: string[]; // if omitted, export all user-data tables
      }

      export interface ExportResult {
        filePath: string;
        format: ExportFormat;
        tables: string[];
        sizeBytes: number;
      }

      export type AutoBackupFrequency = 'daily' | 'weekly' | 'off';

      export interface AutoBackupSettings {
        enabled: boolean;
        frequency: AutoBackupFrequency;
        retention: number; // number of backups to keep
        lastRun: string | null; // ISO timestamp or null
      }
      ```

      Add to ElectronAPI interface:
      ```typescript
      // Backup & Restore
      backupCreate: () => Promise<BackupInfo>;
      backupList: () => Promise<BackupInfo[]>;
      backupRestore: (filePath: string) => Promise<void>;
      backupRestoreFromFile: () => Promise<void>;
      backupDelete: (fileName: string) => Promise<void>;
      backupExport: (options: ExportOptions) => Promise<ExportResult | null>;
      backupAutoSettingsGet: () => Promise<AutoBackupSettings>;
      backupAutoSettingsUpdate: (settings: Partial<AutoBackupSettings>) => Promise<void>;
      onBackupProgress: (callback: (progress: BackupProgress) => void) => () => void;
      ```

      ### 1b. Create src/main/services/backupService.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // Database backup and restore via pg_dump/psql through Docker exec.
      // Manages backup files in app.getPath('userData')/backups/.
      //
      // === DEPENDENCIES ===
      // - Docker CLI on system PATH
      // - PostgreSQL container "living-dashboard-db" running
      //
      // === LIMITATIONS ===
      // - Audio files are NOT backed up (stored outside DB)
      // - Requires Docker to be running
      ```

      Exports:
      - `getBackupDir(): string` — Returns `path.join(app.getPath('userData'), 'backups')`.
        Creates directory with `fs.mkdirSync({ recursive: true })` if it doesn't exist.

      - `isDockerAvailable(): Promise<boolean>` — Runs `execFile('docker', ['info'])`
        wrapped in try/catch. Returns true if exit code 0, false otherwise.

      - `createBackup(mainWindow?: BrowserWindow): Promise<BackupInfo>` —
        1. Emit progress: { phase: 'starting', message: 'Preparing backup...' }
        2. Generate filename: `backup-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.sql`
           (use manual date formatting, no date-fns: `new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19)` → `backup-2026-02-13-143022.sql`)
        3. Emit progress: { phase: 'dumping', message: 'Dumping database...' }
        4. Run: `execFile('docker', ['exec', 'living-dashboard-db', 'pg_dump', '-U', 'dashboard', '--clean', '--if-exists', 'living_dashboard'])`
        5. Capture stdout (the SQL dump)
        6. Emit progress: { phase: 'saving', message: 'Saving backup file...' }
        7. Write stdout to `path.join(getBackupDir(), filename)` via `fs.promises.writeFile`
        8. Get file stats for size
        9. Emit progress: { phase: 'complete', message: 'Backup complete' }
        10. Return BackupInfo

        On error: emit { phase: 'failed', message: '...', error: err.message }, then throw.
        Progress via `mainWindow?.webContents.send('backup:progress', progress)`.

      - `listBackups(): Promise<BackupInfo[]>` —
        1. Read backup dir with `fs.promises.readdir`
        2. Filter files matching `/^backup-\d{4}-\d{2}-\d{2}-\d{6}\.sql$/`
        3. For each: get stats (size, mtime)
        4. Return sorted by createdAt descending
        5. If dir doesn't exist, return empty array

      - `restoreBackup(filePath: string, mainWindow?: BrowserWindow): Promise<void>` —
        1. Verify file exists with `fs.promises.access`
        2. Emit progress: { phase: 'starting', message: 'Creating safety backup...' }
        3. Call `createBackup(mainWindow)` as safety net (catch and log errors, don't block)
        4. Emit progress: { phase: 'restoring', message: 'Restoring database...' }
        5. Read backup file content
        6. Spawn: `spawn('docker', ['exec', '-i', 'living-dashboard-db', 'psql', '-U', 'dashboard', 'living_dashboard'])`
        7. Pipe file content to stdin, wait for completion
        8. Emit progress: { phase: 'complete', message: 'Restore complete' }
        On error: emit failed progress, throw.

      - `deleteBackup(fileName: string): Promise<void>` —
        1. Validate fileName matches `/^backup-[\d-]+\.sql$/` (prevent path traversal)
        2. Construct full path: `path.join(getBackupDir(), fileName)`
        3. Delete with `fs.promises.unlink`

      - `cleanOldBackups(retention: number): Promise<void>` —
        1. List backups (sorted newest first)
        2. If count > retention, delete the oldest ones
        3. Log deletions

      Implementation notes:
      - Use `child_process.execFile` for pg_dump (captures stdout into buffer)
      - Use `child_process.spawn` for psql restore (needs stdin piping)
      - Wrap execFile in a Promise (use util.promisify or manual Promise wrapper)
      - Set maxBuffer for execFile: 100MB (`100 * 1024 * 1024`) to handle large dumps
      - All file operations use fs.promises (async)

      ### 1c. Create src/main/services/exportService.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // Export database data as JSON or CSV for external use.
      // Queries all tables via Drizzle ORM, serializes, and writes to file.
      //
      // === DEPENDENCIES ===
      // - Database connection (getDb from connection.ts)
      //
      // === LIMITATIONS ===
      // - API keys (aiProviders.apiKeyEncrypted) excluded from exports
      // - Audio files not included
      // - CSV: one file per table (relational data doesn't flatten)
      ```

      Imports: All schema tables from `../db/schema`, getDb from `../db/connection`.

      Table export list (map of tableName → drizzle table reference):
      ```typescript
      const EXPORT_TABLES: Record<string, any> = {
        projects, boards, columns, cards, labels, cardLabels,
        cardComments, cardRelationships, cardActivities,
        meetings, transcripts, meetingBriefs, actionItems,
        ideas, ideaTags,
        brainstormSessions, brainstormMessages,
        settings, aiProviders, aiUsage,
      };
      ```

      Exports:
      - `exportAllData(tables?: string[]): Promise<Record<string, any[]>>` —
        1. Get db instance
        2. For each table in EXPORT_TABLES (or filtered by `tables` param):
           `const rows = await db.select().from(table)`
        3. Special handling for aiProviders: map rows to exclude `apiKeyEncrypted` field
        4. Return `{ [tableName]: rows[] }`

      - `writeJSON(data: Record<string, any[]>, filePath: string): Promise<number>` —
        1. `JSON.stringify(data, null, 2)`
        2. Write to filePath
        3. Return file size in bytes

      - `writeCSV(data: Record<string, any[]>, filePath: string): Promise<number>` —
        For JSON export: single .json file.
        For CSV export: write a single .csv file with a section per table
        (header row with table name, column headers, data rows, blank line separator).

        OR simpler approach: if format is CSV and there are multiple tables,
        create individual .csv files in a temp directory and the IPC handler
        uses dialog.showOpenDialog({ properties: ['openDirectory'] }) to let user
        pick a folder.

        Actually, simplest approach: Write one CSV per table to user-selected directory.
        Each file named `{tableName}.csv`.

        CSV serialization helper:
        ```typescript
        function toCsvRow(values: any[]): string {
          return values.map(v => {
            if (v === null || v === undefined) return '';
            const str = String(v);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          }).join(',');
        }

        function tableToCsv(rows: any[]): string {
          if (rows.length === 0) return '';
          const headers = Object.keys(rows[0]);
          const lines = [toCsvRow(headers)];
          for (const row of rows) {
            lines.push(toCsvRow(headers.map(h => row[h])));
          }
          return lines.join('\n');
        }
        ```

      ### 1d. Create src/main/ipc/backup.ts

      Follow existing handler pattern (export registerBackupHandlers function):

      ```typescript
      export function registerBackupHandlers(mainWindow: BrowserWindow): void {
        ipcMain.handle('backup:create', async () => {
          return createBackup(mainWindow);
        });

        ipcMain.handle('backup:list', async () => {
          return listBackups();
        });

        ipcMain.handle('backup:restore', async (_event, filePath: string) => {
          return restoreBackup(filePath, mainWindow);
        });

        ipcMain.handle('backup:restore-from-file', async () => {
          const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Backup File',
            filters: [{ name: 'SQL Backup', extensions: ['sql'] }],
            properties: ['openFile'],
          });
          if (result.canceled || !result.filePaths[0]) return;
          return restoreBackup(result.filePaths[0], mainWindow);
        });

        ipcMain.handle('backup:delete', async (_event, fileName: string) => {
          return deleteBackup(fileName);
        });

        ipcMain.handle('backup:export', async (_event, options: ExportOptions) => {
          const data = await exportAllData(options.tables);
          const tables = Object.keys(data);

          if (options.format === 'json') {
            const result = await dialog.showSaveDialog(mainWindow, {
              title: 'Export Data as JSON',
              defaultPath: `living-dashboard-export-${Date.now()}.json`,
              filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (result.canceled || !result.filePath) return null;
            const size = await writeJSON(data, result.filePath);
            return { filePath: result.filePath, format: 'json', tables, sizeBytes: size };
          } else {
            // CSV: show folder picker, write one file per table
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Select Export Folder for CSV Files',
              properties: ['openDirectory', 'createDirectory'],
            });
            if (result.canceled || !result.filePaths[0]) return null;
            const dir = result.filePaths[0];
            let totalSize = 0;
            for (const [name, rows] of Object.entries(data)) {
              const csv = tableToCsv(rows);
              const fp = path.join(dir, `${name}.csv`);
              await fs.promises.writeFile(fp, csv, 'utf-8');
              totalSize += Buffer.byteLength(csv);
            }
            return { filePath: dir, format: 'csv', tables, sizeBytes: totalSize };
          }
        });

        // Auto-backup settings
        ipcMain.handle('backup:auto-settings-get', async () => {
          return getAutoBackupSettings();
        });

        ipcMain.handle('backup:auto-settings-update', async (_event, settings) => {
          return updateAutoBackupSettings(settings);
        });
      }
      ```

      Import getAutoBackupSettings/updateAutoBackupSettings from autoBackupScheduler
      (will be created in Task 3). For now, create simple stub functions that read/write
      from the settings table directly within this file, OR better: define them in
      backupService.ts so Task 3 can move/enhance them.

      Actually, to avoid circular dependencies and keep Task 1 self-contained:
      Define getAutoBackupSettings and updateAutoBackupSettings in backupService.ts
      (they just read/write settings table). Task 3 will import and use them from there
      when building the scheduler.

      ```typescript
      // In backupService.ts:
      export async function getAutoBackupSettings(): Promise<AutoBackupSettings> {
        const db = getDb();
        const rows = await db.select().from(settings)
          .where(sql`${settings.key} LIKE 'autoBackup.%'`);
        const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
        return {
          enabled: map['autoBackup.enabled'] === 'true',
          frequency: (map['autoBackup.frequency'] as AutoBackupFrequency) || 'daily',
          retention: parseInt(map['autoBackup.retention'] || '5', 10),
          lastRun: map['autoBackup.lastRun'] || null,
        };
      }

      export async function updateAutoBackupSettings(
        updates: Partial<AutoBackupSettings>
      ): Promise<void> {
        const db = getDb();
        const entries: [string, string][] = [];
        if (updates.enabled !== undefined) entries.push(['autoBackup.enabled', String(updates.enabled)]);
        if (updates.frequency !== undefined) entries.push(['autoBackup.frequency', updates.frequency]);
        if (updates.retention !== undefined) entries.push(['autoBackup.retention', String(updates.retention)]);
        if (updates.lastRun !== undefined) entries.push(['autoBackup.lastRun', updates.lastRun || '']);
        for (const [key, value] of entries) {
          await db.insert(settings).values({ key, value })
            .onConflictDoUpdate({ target: settings.key, set: { value } });
        }
      }
      ```

      ### 1e. Register in src/main/ipc/index.ts

      Add import: `import { registerBackupHandlers } from './backup';`
      Add call: `registerBackupHandlers(mainWindow);` (in registerIpcHandlers)

      ### 1f. Extend src/preload/preload.ts

      Add to the electronAPI object:
      ```typescript
      // Backup & Restore
      backupCreate: () => ipcRenderer.invoke('backup:create'),
      backupList: () => ipcRenderer.invoke('backup:list'),
      backupRestore: (filePath: string) => ipcRenderer.invoke('backup:restore', filePath),
      backupRestoreFromFile: () => ipcRenderer.invoke('backup:restore-from-file'),
      backupDelete: (fileName: string) => ipcRenderer.invoke('backup:delete', fileName),
      backupExport: (options: ExportOptions) => ipcRenderer.invoke('backup:export', options),
      backupAutoSettingsGet: () => ipcRenderer.invoke('backup:auto-settings-get'),
      backupAutoSettingsUpdate: (settings: Partial<AutoBackupSettings>) =>
        ipcRenderer.invoke('backup:auto-settings-update', settings),
      onBackupProgress: (callback: (progress: BackupProgress) => void) => {
        const handler = (_event: any, progress: BackupProgress) => callback(progress);
        ipcRenderer.on('backup:progress', handler);
        return () => { ipcRenderer.removeListener('backup:progress', handler); };
      },
      ```

      Import types in preload if needed (ExportOptions, AutoBackupSettings, BackupProgress
      are used as parameter types — import from '../shared/types').
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. backupService.ts exports: getBackupDir, isDockerAvailable, createBackup, listBackups,
         restoreBackup, deleteBackup, cleanOldBackups, getAutoBackupSettings, updateAutoBackupSettings
      3. exportService.ts exports: exportAllData, writeJSON, writeCSV (or tableToCsv + writeCSV)
      4. backup.ts IPC handlers: 8 channels registered
      5. index.ts imports and calls registerBackupHandlers(mainWindow)
      6. ElectronAPI has 9 new methods (8 invoke + 1 event listener)
      7. preload.ts has 9 new bridge methods
    </verify>
    <done>Complete backend for backup/restore/export: two service files, IPC handlers, types, preload bridge. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Docker CLI available on system PATH (standard for Docker Desktop on Windows/Mac)
      - Container name "living-dashboard-db" matches docker-compose.yml (verified)
      - pg_dump and psql available inside postgres:16-alpine container (standard)
      - child_process.execFile works on Windows with Docker (standard Node.js behavior)
      - app.getPath('userData') returns writable directory (guaranteed by Electron)
      - maxBuffer of 100MB sufficient for pg_dump output (handles very large databases)
      - Drizzle db.select().from(table) works for all schema tables (standard Drizzle API)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Backup management UI and data export in Settings page</n>
    <files>
      src/renderer/stores/backupStore.ts (NEW ~90 lines)
      src/renderer/components/settings/BackupSection.tsx (NEW ~300 lines)
      src/renderer/components/settings/ExportSection.tsx (NEW ~120 lines)
      src/renderer/pages/SettingsPage.tsx (MODIFY — add backup/export sections + progress listener)
    </files>
    <action>
      ## WHY
      Users need a visual interface to manage backups (create, view, restore, delete)
      and export their data. This integrates into the existing Settings page, which already
      has section-based layout for Appearance, AI Providers, Model Assignments, etc.

      ## WHAT

      ### 2a. Create src/renderer/stores/backupStore.ts

      Zustand store for backup state management:

      ```typescript
      interface BackupState {
        backups: BackupInfo[];
        loading: boolean;
        error: string | null;
        progress: BackupProgress | null;
        autoSettings: AutoBackupSettings | null;
        // Actions
        loadBackups: () => Promise<void>;
        createBackup: () => Promise<void>;
        restoreBackup: (filePath: string) => Promise<void>;
        restoreFromFile: () => Promise<void>;
        deleteBackup: (fileName: string) => Promise<void>;
        exportData: (options: ExportOptions) => Promise<ExportResult | null>;
        loadAutoSettings: () => Promise<void>;
        updateAutoSettings: (settings: Partial<AutoBackupSettings>) => Promise<void>;
        setProgress: (progress: BackupProgress | null) => void;
        clearError: () => void;
      }
      ```

      Implementation:
      - loadBackups: calls electronAPI.backupList(), sets backups + loading
      - createBackup: sets loading, calls electronAPI.backupCreate(), reloads list
      - restoreBackup: calls electronAPI.backupRestore(filePath), reloads list
      - restoreFromFile: calls electronAPI.backupRestoreFromFile(), reloads list
      - deleteBackup: calls electronAPI.backupDelete(fileName), reloads list
      - exportData: calls electronAPI.backupExport(options), returns result
      - loadAutoSettings: calls electronAPI.backupAutoSettingsGet()
      - updateAutoSettings: calls electronAPI.backupAutoSettingsUpdate(), reloads settings
      - Error handling: catch in each action, set error message
      - Progress: setProgress called from onBackupProgress listener

      ### 2b. Create src/renderer/components/settings/BackupSection.tsx

      Component for backup management, rendered in SettingsPage.

      Structure:
      ```
      ┌─ Database Backups ──────────────────────────────────────────┐
      │                                                              │
      │  [Create Backup]   [Restore from File...]                    │
      │                                                              │
      │  ┌─ Progress Bar (visible during backup/restore) ────────┐  │
      │  │  ◐ Dumping database...                                 │  │
      │  └────────────────────────────────────────────────────────┘  │
      │                                                              │
      │  ┌─ Error Banner (if error) ─────────────────────────────┐  │
      │  │  ⚠ Error message here                          [×]    │  │
      │  └────────────────────────────────────────────────────────┘  │
      │                                                              │
      │  ┌─ Backup List ─────────────────────────────────────────┐  │
      │  │  backup-2026-02-13-143022.sql   Feb 13   1.2 MB       │  │
      │  │                              [Restore] [Delete]        │  │
      │  │                                                        │  │
      │  │  backup-2026-02-12-090015.sql   Feb 12   1.1 MB       │  │
      │  │                              [Restore] [Delete]        │  │
      │  └────────────────────────────────────────────────────────┘  │
      │                                                              │
      │  ℹ Backups include all database data. Audio files are        │
      │    stored separately and not included in backups.            │
      │                                                              │
      │  ── Auto-Backup ──                                           │
      │  [Toggle: Automatic Backups]                                 │
      │  Frequency: [Daily ▼]                                        │
      │  Keep last: [5] backups                                      │
      │  Last backup: Feb 13, 2026 at 2:30 PM                       │
      └──────────────────────────────────────────────────────────────┘
      ```

      Props: none (uses backupStore directly)

      State (local):
      - `confirmRestore: string | null` — filePath of backup being confirmed for restore
      - `confirmDelete: string | null` — fileName of backup being confirmed for delete

      Behavior:
      - **Create Backup**: Button with Database icon. On click, call backupStore.createBackup().
        Disabled while loading or progress is active.
      - **Restore from File**: Button with Upload icon. Opens file dialog via backupStore.restoreFromFile().
      - **Backup List**: Load on mount via useEffect → backupStore.loadBackups().
        Each row shows: fileName, formatted date (from createdAt), human-readable size.
        "Restore" button → sets confirmRestore state.
        "Delete" button → sets confirmDelete state.
      - **Restore confirmation**: Inline banner below the backup row:
        "This will replace ALL current data. A safety backup will be created first."
        [Cancel] [Restore] (red button)
      - **Delete confirmation**: Inline text: "Delete this backup?" [Cancel] [Delete]
      - **Progress indicator**: When progress is not null, show phase message with spinner.
        Blue for dumping/saving/restoring, green for complete, red for failed.
      - **Error banner**: Red bg, error message, dismiss (×) button.
      - **Empty state**: "No backups yet. Create your first backup to protect your data."

      **Auto-backup controls** (bottom section):
      - Toggle switch: "Automatic Backups" (styled like a checkbox/toggle)
      - When enabled, show:
        - Frequency: select dropdown (Daily / Weekly)
        - Retention: number input (1-50, default 5) with label "Keep last N backups"
        - Last backup time: formatted from autoSettings.lastRun
      - Changes call backupStore.updateAutoSettings({ ... })
      - Load on mount: backupStore.loadAutoSettings()

      Size formatting helper:
      ```typescript
      function formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      }
      ```

      Styling — follow existing SettingsPage section pattern:
      - Section wrapper: `bg-surface-900 rounded-xl p-6` (or matching existing sections)
      - Section title: `text-lg font-semibold text-surface-100 mb-4`
      - Buttons: primary (bg-primary-600 hover:bg-primary-500), destructive (bg-red-600/20 text-red-400 hover:bg-red-600/30)
      - List items: `bg-surface-800/50 rounded-lg px-4 py-3`
      - Info text: `text-xs text-surface-500 mt-4`
      - Toggle: simple checkbox or custom toggle (keep it simple — a checkbox with label is fine)

      ### 2c. Create src/renderer/components/settings/ExportSection.tsx

      Separate component for data export (different user intent from backup):

      ```
      ┌─ Export Data ────────────────────────────────────────────────┐
      │                                                              │
      │  Export your data for external use or migration.             │
      │  API keys are excluded for security.                         │
      │                                                              │
      │  [Export as JSON]   [Export as CSV]                           │
      │                                                              │
      │  ✓ Exported to C:\Users\...\export.json (1.5 MB)            │
      └──────────────────────────────────────────────────────────────┘
      ```

      State:
      - `exporting: boolean` — loading state
      - `result: ExportResult | null` — last export result (shown as success message)
      - `error: string | null`

      Behavior:
      - "Export as JSON" → calls backupStore.exportData({ format: 'json' })
      - "Export as CSV" → calls backupStore.exportData({ format: 'csv' })
      - Shows success message with file path and size after export
      - Shows error if export fails
      - Both buttons disabled while exporting

      Styling: same section pattern as BackupSection.

      ### 2d. Modify SettingsPage.tsx

      1. Import BackupSection and ExportSection
      2. Add them as new sections. Place after the "About" section (or before it):
         ```tsx
         <BackupSection />
         <ExportSection />
         ```
      3. Add useEffect to subscribe to backup progress events:
         ```tsx
         useEffect(() => {
           const cleanup = window.electronAPI.onBackupProgress((progress) => {
             useBackupStore.getState().setProgress(progress);
           });
           return cleanup;
         }, []);
         ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. backupStore.ts exists with ~10 actions
      3. BackupSection.tsx renders: create button, backup list, restore/delete per backup,
         progress indicator, error banner, auto-backup controls
      4. ExportSection.tsx renders: JSON/CSV export buttons, success/error messages
      5. SettingsPage includes BackupSection and ExportSection
      6. Progress events flow from main → renderer → store → UI
      7. Restore confirmation dialog appears before restore executes
    </verify>
    <done>Backup management UI (create, list, restore, delete, auto-backup settings) and export UI (JSON/CSV) integrated into Settings page. Users can fully manage backups and export data visually.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - lucide-react has: Database, Upload, Download, Trash2, RotateCcw, AlertCircle, Check icons (standard lucide icons)
      - SettingsPage section layout is consistent (white/dark bg sections with padding/rounded)
      - Zustand store can be accessed both via hook (in components) and via getState() (in useEffect)
      - electronAPI.onBackupProgress returns a cleanup function (standard preload pattern)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Auto-backup scheduler with settings persistence and retention cleanup</n>
    <files>
      src/main/services/autoBackupScheduler.ts (NEW ~100 lines)
      src/main/main.ts (MODIFY — init scheduler after DB connect, cleanup on quit)
    </files>
    <action>
      ## WHY
      R15 requires "scheduled automatic backups." This task adds a background scheduler
      in the main process that periodically checks whether a backup is due based on
      user settings, runs pg_dump, and cleans up old backups according to retention policy.

      ## WHAT

      ### 3a. Create src/main/services/autoBackupScheduler.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // Background scheduler for automatic database backups.
      // Checks hourly if a backup is due based on user-configured frequency.
      //
      // === DEPENDENCIES ===
      // - backupService (createBackup, cleanOldBackups, getAutoBackupSettings, updateAutoBackupSettings)
      // - Database connection must be established before init
      //
      // === LIMITATIONS ===
      // - Hourly check granularity (not second-precise)
      // - Requires Docker running when backup triggers
      ```

      Module state:
      ```typescript
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let mainWindowRef: BrowserWindow | null = null;
      ```

      Exports:
      - `initAutoBackup(mainWindow: BrowserWindow): void` —
        1. Store mainWindow reference
        2. Set interval: every 1 hour (3_600_000 ms), call `checkAndRunBackup()`
        3. Also run checkAndRunBackup() once immediately (debounced by 10 seconds
           after startup to avoid blocking app launch)

      - `stopAutoBackup(): void` —
        1. If intervalId exists, clearInterval
        2. Set intervalId = null, mainWindowRef = null

      - `checkAndRunBackup(): Promise<void>` —
        1. Read auto-backup settings via `getAutoBackupSettings()`
        2. If not enabled, return early
        3. Determine if backup is due:
           - If lastRun is null → due (first time)
           - If frequency is 'daily' → due if lastRun > 24 hours ago
           - If frequency is 'weekly' → due if lastRun > 7 days ago
           - If frequency is 'off' → return (shouldn't happen if enabled, but guard)
        4. If due:
           a. Try `createBackup(mainWindowRef)` — wrap in try/catch, log errors
           b. On success: update lastRun to new Date().toISOString()
              via `updateAutoBackupSettings({ lastRun: new Date().toISOString() })`
           c. Read retention setting, call `cleanOldBackups(retention)`
        5. On any error: console.error, don't throw (background task shouldn't crash app)

      All operations wrapped in try/catch with console.error logging.
      This is a fire-and-forget background task — errors are logged, never thrown.

      ### 3b. Modify src/main/main.ts

      1. Import: `import { initAutoBackup, stopAutoBackup } from './services/autoBackupScheduler';`

      2. After the mainWindow is created and database is connected (look for where
         `registerIpcHandlers(mainWindow)` is called), add:
         ```typescript
         // Start auto-backup scheduler
         initAutoBackup(mainWindow);
         ```

      3. In the app 'before-quit' or 'will-quit' handler (or window close handler),
         add: `stopAutoBackup();`
         If no quit handler exists, add one:
         ```typescript
         app.on('before-quit', () => {
           stopAutoBackup();
         });
         ```

      ### Notes on integration

      - The auto-backup settings are already readable/writable via backupService.ts
        (getAutoBackupSettings/updateAutoBackupSettings added in Task 1).
      - The IPC channels for settings get/update are already in backup.ts (Task 1).
      - The BackupSection UI controls from Task 2 already call these IPC channels.
      - This task just adds the background scheduler that reads those settings and acts.
      - When the user changes auto-backup settings in the UI, the next hourly check
        will pick up the new values (no restart needed).
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. autoBackupScheduler.ts exports: initAutoBackup, stopAutoBackup, checkAndRunBackup
      3. main.ts calls initAutoBackup(mainWindow) after DB connection
      4. main.ts calls stopAutoBackup() on app quit
      5. checkAndRunBackup correctly determines if backup is due (daily: >24h, weekly: >7d)
      6. Errors in background backup are caught and logged (not thrown)
      7. cleanOldBackups called after successful auto-backup
    </verify>
    <done>Auto-backup scheduler runs in background, checks hourly, respects user settings for frequency and retention, cleans up old backups. Integrated into app lifecycle (start on boot, stop on quit).</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - setInterval persists for Electron main process lifetime (standard Node.js behavior)
      - Hourly check interval is acceptable granularity (not second-precise scheduling)
      - Docker container is running when auto-backup triggers (if not, backup fails gracefully)
      - Settings table is available when scheduler first checks (migrations run before scheduler init)
      - getAutoBackupSettings reads from settings table each check (picks up UI changes automatically)
    </assumptions>
  </task>
</phase>
