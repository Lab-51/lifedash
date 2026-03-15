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

    await runMigrations();
    log.info('DB connected and migrations applied');

    const integrity = await checkDatabaseIntegrity();
    if (!integrity.healthy) {
      log.warn(`DB integrity issues: ${integrity.message}`);
    }

    const dbSizeBytes = await getDatabaseSize();
    if (dbSizeBytes !== null) {
      log.info(`DB size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)} MB`);
    }

    // Apply proxy settings for enterprise networks (before any AI calls)
    await applyGlobalProxy();

    // Start auto-backup scheduler (after DB is ready)
    initAutoBackup(mainWindow);

    // Start notification scheduler (after DB is ready)
    initNotificationScheduler();

    // Start background agent scheduler (after DB is ready, lower priority than notifications)
    initBackgroundAgentScheduler(mainWindow);

    // Initialize opt-in crash reporting (reads preference from DB)
    await initSentry();

    // Initialize cloud sync service (periodic push to Supabase)
    try {
      const supabase = getSupabaseClient();
      initSyncService(supabase, mainWindow);
    } catch (syncErr) {
      log.warn('Sync service initialization failed (non-fatal):', syncErr);
    }
  } catch (error) {
    log.error('DB connection failed:', error);
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
  stopSyncService();
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
