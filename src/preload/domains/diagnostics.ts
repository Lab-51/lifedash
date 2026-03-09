// === Preload bridge: Diagnostics IPC events ===
import { ipcRenderer } from 'electron';

export const diagnosticsBridge = {
  diagnosticsGetCrashReportsEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('diagnostics:get-crash-reports-enabled'),

  diagnosticsSetCrashReportsEnabled: (value: boolean): Promise<void> =>
    ipcRenderer.invoke('diagnostics:set-crash-reports-enabled', value),
};
