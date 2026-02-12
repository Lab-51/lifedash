// === FILE PURPOSE ===
// System tray integration for Living Dashboard.
// Creates a tray icon with a context menu that allows
// showing the window or quitting the app.

// === DEPENDENCIES ===
// Electron (app, Tray, Menu, nativeImage, BrowserWindow)

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';

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
  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Living Dashboard',
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

  tray.setToolTip('Living Dashboard');
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
