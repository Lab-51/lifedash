// === Preload bridge: Backup and restore ===
import { ipcRenderer } from 'electron';
import type { ExportOptions, BackupProgress, AutoBackupSettings } from '../../shared/types';

export const backupBridge = {
  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (filePath: string) => ipcRenderer.invoke('backup:restore', filePath),
  backupRestoreFromFile: () => ipcRenderer.invoke('backup:restore-from-file'),
  backupDelete: (fileName: string) => ipcRenderer.invoke('backup:delete', fileName),
  backupExport: (options: ExportOptions) => ipcRenderer.invoke('backup:export', options),
  backupAutoSettingsGet: () => ipcRenderer.invoke('backup:auto-settings-get'),
  backupAutoSettingsUpdate: (settings: Partial<AutoBackupSettings>) =>
    ipcRenderer.invoke('backup:auto-settings-update', settings),
  onBackupProgress: (callback: (progress: BackupProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: BackupProgress) => callback(progress);
    ipcRenderer.on('backup:progress', handler);
    return () => {
      ipcRenderer.removeListener('backup:progress', handler);
    };
  },
};
