// === FILE PURPOSE ===
// Electron main process entry point.
// Creates a frameless browser window with custom title bar support,
// system tray integration, window state persistence, and single instance lock.

// === DEPENDENCIES ===
// electron, electron-squirrel-startup, electron-window-state, node:path,
// drizzle-orm, postgres (via ./db/connection and ./db/migrate),
// electron-audio-loopback (system audio capture)

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import windowStateKeeper from 'electron-window-state';
import { registerIpcHandlers } from './ipc';
import { createTray } from './tray';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { initMain } from 'electron-audio-loopback';
import { initAutoBackup, stopAutoBackup } from './services/autoBackupScheduler';
import { initNotificationScheduler, stopNotificationScheduler } from './services/notificationScheduler';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

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
    : "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepgram.com https://api.assemblyai.com http://localhost:11434";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval'"       // Vite HMR needs eval in dev
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

  // Let electron-window-state track position/size changes
  mainWindowState.manage(mainWindow);

  // Register all IPC handlers
  registerIpcHandlers(mainWindow);

  // Create system tray
  createTray(mainWindow);

  // --- Database startup ---
  // Connect to PostgreSQL and run migrations. Non-fatal on failure:
  // the app can still function without a database connection, and
  // the renderer can check db:status to show connection state.
  try {
    await connectDatabase();
    await runMigrations();
    console.log('[DB] Connected and migrations applied');

    // Start auto-backup scheduler (after DB is ready)
    initAutoBackup(mainWindow);

    // Start notification scheduler (after DB is ready)
    initNotificationScheduler();
  } catch (error) {
    console.error('[DB] Connection failed:', error);
  }

  // --- Close-to-tray behavior ---
  // Instead of quitting, hide to tray. Only actually close when
  // app.isQuitting is set (from tray "Quit" or before-quit event).
  mainWindow.on('close', (event) => {
    if (!(app as unknown as { isQuitting: boolean }).isQuitting) {
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

  // Open DevTools in development
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }
};

// Ensure the isQuitting flag is set when the app is about to quit
// (e.g. via Cmd+Q on macOS or when the OS requests termination).
// Also gracefully close the database connection pool.
app.on('before-quit', async () => {
  (app as unknown as { isQuitting: boolean }).isQuitting = true;
  stopAutoBackup();
  stopNotificationScheduler();
  await disconnectDatabase();
});

// Create window when Electron is ready
app.on('ready', () => {
  createWindow().catch((error) => {
    console.error('[App] Failed to create window:', error);
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
      console.error('[App] Failed to create window on activate:', error);
    });
  } else if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});
