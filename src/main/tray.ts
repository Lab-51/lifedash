// === FILE PURPOSE ===
// System tray integration for Living Dashboard.
// Creates a tray icon with a context menu that allows
// showing the window or quitting the app.

// === DEPENDENCIES ===
// Electron (app, Tray, Menu, nativeImage, BrowserWindow)

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import icon from '../assets/icon.png';

let tray: Tray | null = null;

/**
 * Create a simple 16x16 tray icon programmatically.
 * Uses a solid blue square matching the primary-500 color (#3b82f6).
 * On Windows, .png works fine for tray icons.
 */
function createTrayIcon(): Electron.NativeImage {
  // 16x16 RGBA buffer: solid blue (#3b82f6) with full opacity
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buffer[i * 4] = 0x3b; // R
    buffer[i * 4 + 1] = 0x82; // G
    buffer[i * 4 + 2] = 0xf6; // B
    buffer[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBuffer(buffer, {
    width: size,
    height: size,
  });
}

/**
 * Create the system tray with a context menu.
 * Single-click on the tray icon toggles window visibility.
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  // Try to load from imported path (Vite asset)
  let trayIcon = nativeImage.createFromPath(icon);

  // If that fails (e.g. dev server URL issue), try absolute path in source for dev
  if (trayIcon.isEmpty()) {
    const path = require('path');
    const devIconPath = path.join(__dirname, '../../src/assets/icon.png');
    trayIcon = nativeImage.createFromPath(devIconPath);
  }

  // Resize for typical tray requirements
  // Windows: 16x16 or 32x32 (HiDPI)
  // macOS: 22x22 template
  const resizedIcon = trayIcon.resize({ width: 16, height: 16 });

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
