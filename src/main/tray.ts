// === FILE PURPOSE ===
// System tray integration for Living Dashboard.
// Creates a tray icon with a context menu that allows
// showing the window or quitting the app.

// === DEPENDENCIES ===
// Electron (app, Tray, Menu, nativeImage, BrowserWindow)

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import * as path from 'node:path';
import icon from '../assets/icon.png';

let tray: Tray | null = null;

/**
 * Create the system tray with a context menu.
 * Single-click on the tray icon toggles window visibility.
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  // Try to load from imported path (Vite asset)
  let trayIcon = nativeImage.createFromPath(icon);

  // If that fails (e.g. dev server URL issue), try absolute path in source for dev
  if (trayIcon.isEmpty()) {
    const devIconPath = path.join(__dirname, '../../src/assets/icon.png');
    trayIcon = nativeImage.createFromPath(devIconPath);
  }

  // Windows tray: 32x32 looks sharp on standard and HiDPI displays
  // macOS tray: 22x22 template
  const traySize = process.platform === 'darwin' ? 22 : 32;
  const resizedIcon = trayIcon.resize({ width: traySize, height: traySize });

  tray = new Tray(resizedIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show LifeDash',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as unknown as { isQuitting: boolean }).isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('LifeDash');
  tray.setContextMenu(contextMenu);

  // Single-click on tray icon: toggle window visibility
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}
