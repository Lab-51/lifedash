// === FILE PURPOSE ===
// IPC handlers for diagnostics settings (crash report toggle).

import { ipcMain } from 'electron';
import { isSentryEnabled, enableSentry, disableSentry } from '../services/sentryService';

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle('diagnostics:get-crash-reports-enabled', () => {
    return isSentryEnabled();
  });

  ipcMain.handle('diagnostics:set-crash-reports-enabled', async (_event, value: boolean) => {
    if (value) {
      await enableSentry();
    } else {
      await disableSentry();
    }
  });
}
