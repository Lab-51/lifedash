// === FILE PURPOSE ===
// IPC handlers for diagnostics settings (crash report toggle).

import { ipcMain } from 'electron';
import { isSentryEnabled, enableSentry, disableSentry } from '../services/sentryService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { booleanParamSchema } from '../../shared/validation/schemas';

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle('diagnostics:get-crash-reports-enabled', () => {
    return isSentryEnabled();
  });

  ipcMain.handle('diagnostics:set-crash-reports-enabled', async (_event, value: unknown) => {
    const validValue = validateInput(booleanParamSchema, value);
    if (validValue) {
      await enableSentry();
    } else {
      await disableSentry();
    }
  });
}
