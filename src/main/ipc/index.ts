// === FILE PURPOSE ===
// Central registration point for all IPC handlers.
// Call registerIpcHandlers() once after the main window is created.

import { BrowserWindow } from 'electron';
import { registerWindowControlHandlers } from './window-controls';
import { registerDatabaseHandlers } from './database';
import { registerProjectHandlers } from './projects';
import { registerCardHandlers } from './cards';

/**
 * Register all IPC handlers for the given main window.
 * This should be called once during app initialization.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerWindowControlHandlers(mainWindow);
  registerDatabaseHandlers();
  registerProjectHandlers();
  registerCardHandlers();
}
