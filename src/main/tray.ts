// === FILE PURPOSE ===
// System tray integration for Living Dashboard.
// Creates a tray icon with a context menu that allows
// showing the window or quitting the app.

// === DEPENDENCIES ===
// Electron (app, Tray, Menu, nativeImage, BrowserWindow)

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import * as path from 'node:path';

let tray: Tray | null = null;

/**
 * Resolve the tray icon path for both dev and packaged environments.
 * In production, the icon lives in the resources directory (via extraResource).
 * In dev, it lives in the source tree.
 */
function resolveIconPath(): string {
  if (app.isPackaged) {
    // In packaged app, extraResource copies files to the resources directory
    return path.join(process.resourcesPath, 'icon.png');
  }

  // Dev fallback: source assets directory
  return path.join(__dirname, '../../src/assets/icon.png');
}

/**
 * Create the system tray with a context menu.
 * Single-click on the tray icon toggles window visibility.
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  const iconPath = resolveIconPath();
  let trayIcon = nativeImage.createFromPath(iconPath);

  // Windows tray: 32x32 looks sharp on standard and HiDPI displays
  // macOS tray: 22x22 template
  const traySize = process.platform === 'darwin' ? 22 : 32;
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: traySize, height: traySize });
  }

  tray = new Tray(trayIcon);

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
