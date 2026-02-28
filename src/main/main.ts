// === FILE PURPOSE ===
// Electron main process entry point.
// Creates a frameless browser window with custom title bar support,
// system tray integration, window state persistence, and single instance lock.

// === DEPENDENCIES ===
// electron, electron-window-state, node:path,
// drizzle-orm, postgres (via ./db/connection and ./db/migrate),
// electron-audio-loopback (system audio capture)

import { app, BrowserWindow, dialog, globalShortcut } from 'electron';
import path from 'node:path';
// @ts-ignore
import icon from '../assets/icon.png';
import windowStateKeeper from 'electron-window-state';
import { registerIpcHandlers } from './ipc';
import { createTray } from './tray';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { initMain } from 'electron-audio-loopback';
import { initAutoBackup, stopAutoBackup } from './services/autoBackupScheduler';
import { initNotificationScheduler, stopNotificationScheduler } from './services/notificationScheduler';
import { createLogger } from './services/logger';
import { getIsRecording, setIsRecording } from './services/recordingState';
import { applyGlobalProxy } from './services/proxyService';
import { initAutoUpdater } from './autoUpdater';

const log = createLogger('App');

// Initialize electron-audio-loopback for system audio capture.
// Must be called before app is ready.
initMain();

// --- Single instance lock ---
// Prevent multiple instances of the app from running simultaneously.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

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
    ? "connect-src 'self' ws: http://localhost:* https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com https://api.lemonsqueezy.com http://localhost:11434"
    : "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com https://api.lemonsqueezy.com http://localhost:11434 https://api.github.com https://github.com https://objects.githubusercontent.com";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"  // Vite HMR needs eval + React preamble needs inline in dev
    : "script-src 'self'";

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ${connectSrc}`
        ],
      },
    });
  });

  // Show window only when the renderer is ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

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
    await connectDatabase();
    await runMigrations();
    log.info('DB connected and migrations applied');

    // Apply proxy settings for enterprise networks (before any AI calls)
    await applyGlobalProxy();

    // Start auto-backup scheduler (after DB is ready)
    initAutoBackup(mainWindow);

    // Start notification scheduler (after DB is ready)
    initNotificationScheduler();
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
    } else if (
      process.platform === 'darwin' &&
      !(app as unknown as { isQuitting: boolean }).isQuitting
    ) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Load the renderer — Forge's Vite plugin injects these globals
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

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
  stopAutoBackup();
  stopNotificationScheduler();
  await disconnectDatabase();
});

// Ensure global shortcuts are cleaned up when the app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Create window when Electron is ready
app.on('ready', () => {
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
