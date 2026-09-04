// === FILE PURPOSE ===
// Electron main process entry point.
// Creates a frameless browser window with custom title bar support,
// system tray integration, window state persistence, and single instance lock.

// === DEPENDENCIES ===
// electron, electron-window-state, node:path,
// drizzle-orm, postgres (via ./db/connection and ./db/migrate),
// electron-audio-loopback (system audio capture)

import { app, BrowserWindow, dialog, globalShortcut, shell } from 'electron';
import path from 'node:path';
import icon from '../assets/icon.png';
import windowStateKeeper from 'electron-window-state';
import { registerIpcHandlers } from './ipc';
import { createTray } from './tray';
import { connectDatabase, disconnectDatabase, checkDatabaseIntegrity, getDatabaseSize } from './db/connection';
import { runMigrations } from './db/migrate';
import { initMain } from 'electron-audio-loopback';
import { initAutoBackup, stopAutoBackup } from './services/autoBackupScheduler';
import { initNotificationScheduler, stopNotificationScheduler } from './services/notificationScheduler';
import { initBackgroundAgentScheduler, stopBackgroundAgentScheduler } from './services/backgroundAgentScheduler';
import { createLogger, initFileLogging } from './services/logger';
import { getIsRecording, setIsRecording } from './services/recordingState';
import { applyGlobalProxy } from './services/proxyService';
import { initAutoUpdater } from './autoUpdater';
import {
  writeCrashMarker,
  startPeriodicSnapshot,
  stopPeriodicSnapshot,
  clearRecoveryState,
} from './services/sessionRecoveryService';
import { initSentry } from './services/sentryService';
import { initSyncService, stopSyncService } from './services/syncService';
import { getSupabaseClient } from './services/supabaseClient';
import { registerGoogleCalendarAdapter } from './services/calendarProviders/googleCalendarProvider';
import { registerMicrosoftCalendarAdapter } from './services/calendarProviders/microsoftCalendarProvider';
import { initCalendarPollScheduler, stopCalendarPollScheduler } from './services/calendarPollScheduler';
// Shutdown-only import: the built-in AI sidecar starts lazily from a routed request,
// never at boot. This just guarantees no llama-server outlives the app.
import { stop as stopLlamaRuntime } from './services/llamaRuntimeService';
import { reconcileBuiltinFromDisk } from './services/builtinProviderSetup';
import { emitRuntimeStatus } from './services/runtimeTelemetry';
import { sweepHallucinatedTranscripts } from './services/transcriptCleanupService';
import { sweepOrphanedRecordings } from './services/recordingSweepService';
import { sweepEntityNameFolds } from './services/entityNameFoldSweep';
import { recoverStaleRecordings } from './services/staleRecordingRecovery';
import { sweepFailedBriefEmbeddings } from './services/embeddingService';

const log = createLogger('App');

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error.stack || error.message || String(error));
  writeCrashMarker();
  try {
    dialog.showErrorBox('Unexpected Error', `${error.message || error}\n\nThe app may be unstable. Please restart.`);
  } catch {
    // Dialog may not be available if app isn't ready
  }
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason instanceof Error ? reason.stack || reason.message : String(reason));
});

// Initialize electron-audio-loopback for system audio capture.
// Must be called before app is ready.
initMain();

// --- Single instance lock ---
// Prevent multiple instances of the app from running simultaneously.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Graceful shutdown on SIGTERM/SIGINT — triggers before-quit cleanup.
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());

let mainWindow: BrowserWindow | null = null;
let memoryMonitorId: ReturnType<typeof setInterval> | null = null;

// When a second instance is attempted, focus the existing window.
app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

/**
 * Models downloaded before auto-activation existed would otherwise stay dead —
 * nothing re-runs on an old file. Treats a GGUF already on disk like a download
 * that just finished, and never overwrites an assignment the user made. No-op
 * when no models are installed; reads the filesystem and spawns nothing.
 */
async function reconcileBuiltinRuntime(): Promise<void> {
  try {
    if (await reconcileBuiltinFromDisk()) await emitRuntimeStatus();
  } catch (err) {
    log.warn('Built-in runtime reconciliation skipped:', err);
  }
}

/**
 * TRANS-HALL.1 Task 4: one-shot cleanup of previously-stored Whisper
 * hallucination segments (subtitle-credit boilerplate etc.), gated by a
 * settings flag so it runs exactly once. Non-fatal: any error is logged and
 * skipped here, and — because the service only writes the flag after a
 * successful delete — a failed run always retries on the next launch.
 */
async function sweepTranscriptHallucinations(): Promise<void> {
  try {
    await sweepHallucinatedTranscripts();
  } catch (err) {
    log.warn('Transcript hallucination cleanup skipped (will retry next launch):', err);
  }
}

/**
 * AI-RESIL.1 Task 2: one-shot cleanup of `embeddings` rows that were indexed
 * from a failure-sentinel brief before Task 1's write-side guards existed.
 * Gated by a settings flag (see embeddingService.sweepFailedBriefEmbeddings)
 * so it runs exactly once. Non-fatal: any error is logged and skipped here —
 * because the service only writes its flag after a successful delete, a
 * failed run always retries on the next launch. A single bounded SQL delete,
 * so awaited like sweepTranscriptHallucinations above rather than
 * fire-and-forget like the filesystem-scanning recording sweep below.
 */
async function sweepFailedBriefEmbeddingsOnStartup(): Promise<void> {
  try {
    await sweepFailedBriefEmbeddings();
  } catch (err) {
    log.warn('Sentinel-embedding sweep skipped (will retry next launch):', err);
  }
}

/**
 * MEET-DEL.1 Task 4: one-shot startup sweep that deletes recording WAVs no
 * meeting references (see recordingSweepService.ts for the guard rules).
 * Fire-and-forget, unlike sweepTranscriptHallucinations above — a large
 * backlog of orphaned recordings should not delay the rest of startup (DB
 * integrity checks, schedulers, etc.). Non-fatal by the same contract: the
 * service only marks its flag on a failure-free run, so a failure here always
 * retries next launch.
 */
function sweepOrphanedRecordingsOnStartup(): void {
  sweepOrphanedRecordings().catch((err) => {
    log.warn('Recording orphan sweep skipped (will retry next launch):', err);
  });
}

/**
 * Closes meetings left stuck at status 'recording' because the app was closed
 * or crashed mid-recording — the renderer owns the ONLY completed-transition,
 * so nothing else ever reconciles those rows and they render as "Running..."
 * forever.
 *
 * Unlike the three sweeps around it this is deliberately NOT flag-gated: it
 * repairs an ongoing failure mode rather than a one-time historical defect, so
 * it must run on every launch (see staleRecordingRecovery.ts).
 *
 * AWAITED rather than fire-and-forget, because its safety invariant is that no
 * recording exists yet in this process — completing it before the app is
 * interactive keeps that true. The query is a single indexed status filter.
 */
async function recoverStaleRecordingsOnStartup(): Promise<void> {
  try {
    await recoverStaleRecordings();
  } catch (err) {
    log.warn('Stale recording recovery skipped (will retry next launch):', err);
  }
}

/**
 * ENTITY-NAME.1 Task 2: one-shot startup sweep that re-keys every entity row
 * through the current name normalizer and merges the rows that now fold to the
 * same key (see entityNameFoldSweep.ts — it DELETES the merged-away rows, in a
 * per-group transaction, only after their facts and links have been re-pointed).
 * Same shape as the recording sweep above: fire-and-forget so it can never delay
 * or block startup, and error-isolated here rather than inside the service, which
 * writes its completion flag only after a failure-free pass and therefore retries
 * on the next launch after any failure.
 */
function sweepEntityNameFoldsOnStartup(): void {
  sweepEntityNameFolds().catch((err) => {
    log.error('Entity name-fold sweep skipped (will retry next launch):', err);
  });
}

const createWindow = async () => {
  // Restore previous window position and size
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  mainWindow = new BrowserWindow({
    icon: icon,
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 900,
    minHeight: 600,
    frame: false, // Frameless window — custom title bar in renderer
    backgroundColor: '#020617', // Match surface-950 to prevent white flash
    show: false, // Wait until ready-to-show to prevent flicker
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Content Security Policy — defense-in-depth against XSS
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const connectSrc = isDev
    ? "connect-src 'self' ws: http://localhost:* https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434"
    : "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434 https://lifedash.space https://objects.githubusercontent.com";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" // Vite HMR needs eval + React preamble needs inline in dev
    : "script-src 'self'";

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; ${connectSrc}`,
        ],
      },
    });
  });

  // Prevent target="_blank" and window.open from spawning bare Electron windows.
  // Redirect all such requests to the user's default system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent the main window from navigating away from the app (e.g. clicking
  // a link inside dangerouslySetInnerHTML content). Open in system browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL || 'file://';
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });

  // Show window only when the renderer is ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    log.info('App started', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
    });
  });

  // Periodic memory monitoring — warn if heap exceeds 500 MB
  memoryMonitorId = setInterval(() => {
    const heapUsed = process.memoryUsage().heapUsed;
    if (heapUsed > 500 * 1024 * 1024) {
      log.warn('High memory usage', { heapUsedMB: Math.round(heapUsed / 1024 / 1024) });
    }
  }, 300_000);

  // Auto-updater: check GitHub Releases for new versions (production only)
  initAutoUpdater(mainWindow);

  // Let electron-window-state track position/size changes
  mainWindowState.manage(mainWindow);

  // Register all IPC handlers
  registerIpcHandlers(mainWindow);

  // Create system tray
  createTray(mainWindow);

  // --- Database startup ---
  // Connect to PGlite and run migrations. Non-fatal on failure:
  // the app can still function without a database connection, and
  // the renderer can check db:status to show connection state.
  try {
    const RETRY_DELAYS = [500, 1000, 2000];
    let connected = false;
    for (let attempt = 1; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        await connectDatabase();
        connected = true;
        break;
      } catch (err) {
        log.error(`DB connection attempt ${attempt}/${RETRY_DELAYS.length} failed:`, err);
        if (attempt < RETRY_DELAYS.length) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
        }
      }
    }
    if (!connected) {
      throw new Error('All database connection attempts failed');
    }

    try {
      await runMigrations();
      log.info('DB connected and migrations applied');
    } catch (migrationErr) {
      log.error('Migration failed (continuing with existing schema):', migrationErr);
    }

    // Must run AFTER migrations — the transcripts table (and the settings flag
    // row it gates on) must exist first.
    await sweepTranscriptHallucinations();

    // Must run AFTER migrations too (the embeddings table + settings flag row
    // it gates on).
    await sweepFailedBriefEmbeddingsOnStartup();

    // Must run AFTER migrations too (the meetings table + settings flag row it
    // gates on). Fire-and-forget — does not block the rest of startup below.
    sweepOrphanedRecordingsOnStartup();

    // Must run AFTER migrations (reads meetings + transcripts) and BEFORE the
    // app can start a recording — every 'recording' row is stale only while
    // that is true. Awaited for exactly that reason.
    await recoverStaleRecordingsOnStartup();

    // Must run AFTER migrations too (the entities/entity_facts/entity_links tables
    // + settings flag row it gates on). Fire-and-forget for the same reason.
    sweepEntityNameFoldsOnStartup();

    const integrity = await checkDatabaseIntegrity();
    if (!integrity.healthy) {
      log.warn(`DB integrity issues: ${integrity.message}`);
    }

    const dbSizeBytes = await getDatabaseSize();
    if (dbSizeBytes !== null) {
      log.info(`DB size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)} MB`);
    }

    await reconcileBuiltinRuntime();

    // Apply proxy settings for enterprise networks (before any AI calls)
    await applyGlobalProxy();

    // Start auto-backup scheduler (after DB is ready)
    initAutoBackup(mainWindow);

    // Start notification scheduler (after DB is ready)
    initNotificationScheduler();

    // Start background agent scheduler (after DB is ready, lower priority than notifications)
    initBackgroundAgentScheduler(mainWindow);

    // Register calendar provider adapters (Task 2/3 left boot wiring to Task 4), then
    // start the calendar poll scheduler (after DB is ready).
    registerGoogleCalendarAdapter();
    registerMicrosoftCalendarAdapter();
    initCalendarPollScheduler(mainWindow);

    // Initialize opt-in crash reporting (reads preference from DB)
    await initSentry();
  } catch (error) {
    log.error('DB connection failed:', error);
  }

  // Initialize cloud sync service (after DB + auth are ready, but independent
  // of the DB try-catch so a failure in sentry/backup/etc. doesn't skip it)
  try {
    const supabase = getSupabaseClient();
    initSyncService(supabase, mainWindow);
  } catch (syncErr) {
    log.warn('Sync service initialization failed (non-fatal):', syncErr);
  }

  // --- Close behavior ---
  // Guard against closing during an active recording (data loss prevention).
  // On macOS, hide to tray (standard macOS behavior — red button hides, Cmd+Q quits).
  // On Windows/Linux, close button quits the app to prevent orphaned processes.
  mainWindow.on('close', async (event) => {
    if (getIsRecording()) {
      event.preventDefault();
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Keep Recording', 'Stop & Close'],
        defaultId: 0,
        cancelId: 0,
        title: 'Recording in Progress',
        message: 'A meeting recording is currently active.',
        detail: 'Closing the app will stop the recording. The recorded audio up to this point will be saved.',
      });
      if (response === 1) {
        mainWindow?.webContents.send('recording:force-stop');
        setTimeout(() => {
          setIsRecording(false);
          mainWindow?.close();
        }, 2000);
      }
    } else if (process.platform === 'darwin' && !(app as unknown as { isQuitting: boolean }).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Load the renderer — Forge's Vite plugin injects these globals
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Start periodic recovery snapshot (crash-safe state persistence)
  startPeriodicSnapshot();

  // Open DevTools in development only
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Register global hotkey to open command palette from anywhere
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('app:show-command-palette');
    }
  });
};

// Ensure the isQuitting flag is set when the app is about to quit
// (e.g. via Cmd+Q on macOS or when the OS requests termination).
// Also gracefully close the database connection pool.
app.on('before-quit', async () => {
  (app as unknown as { isQuitting: boolean }).isQuitting = true;
  globalShortcut.unregisterAll();
  if (memoryMonitorId) clearInterval(memoryMonitorId);
  stopPeriodicSnapshot();
  clearRecoveryState();
  stopAutoBackup();
  stopNotificationScheduler();
  stopBackgroundAgentScheduler();
  stopCalendarPollScheduler();
  stopSyncService();
  await stopLlamaRuntime();
  await disconnectDatabase();
});

// Ensure global shortcuts are cleaned up when the app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Create window when Electron is ready
app.on('ready', () => {
  initFileLogging();
  createWindow().catch((error) => {
    log.error('Failed to create window:', error);
  });
});

// On macOS, keep app running when all windows are closed (tray behavior).
// On Windows/Linux, the close-to-tray handler above prevents actual close,
// so window-all-closed won't fire during normal use. This handler is a
// safety net for edge cases.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Re-create window on macOS dock click
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      log.error('Failed to create window on activate:', error);
    });
  } else if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});
