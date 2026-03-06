// === FILE PURPOSE ===
// IPC handlers for database backup, restore, and data export operations.
//
// === DEPENDENCIES ===
// - backupService (backup/restore/delete/list/clean/settings)
// - exportService (exportAllData, writeJSON, tableToCsv)
// - Electron dialog (file/folder pickers)
//
// === LIMITATIONS ===
// - Backup/restore requires Docker running
// - Export dialog blocks until user selects file/folder

import { BrowserWindow, ipcMain, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  getAutoBackupSettings,
  updateAutoBackupSettings,
} from '../services/backupService';
import { exportAllData, writeJSON, tableToCsv } from '../services/exportService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  filePathSchema,
  exportOptionsSchema,
  autoBackupSettingsUpdateSchema,
} from '../../shared/validation/schemas';


export function registerBackupHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('backup:create', async () => {

    return createBackup(mainWindow);
  });

  ipcMain.handle('backup:list', async () => {

    return listBackups();
  });

  ipcMain.handle('backup:restore', async (_event, filePath: unknown) => {

    const validPath = validateInput(filePathSchema, filePath);
    return restoreBackup(validPath, mainWindow);
  });

  ipcMain.handle('backup:restore-from-file', async () => {

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Backup File',
      filters: [{ name: 'SQL Backup', extensions: ['sql'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return;
    return restoreBackup(result.filePaths[0], mainWindow);
  });

  ipcMain.handle('backup:delete', async (_event, fileName: unknown) => {

    const validFileName = validateInput(filePathSchema, fileName);
    return deleteBackup(validFileName);
  });

  ipcMain.handle('backup:export', async (_event, options: unknown) => {

    const input = validateInput(exportOptionsSchema, options);
    const data = await exportAllData(input.tables);
    const tables = Object.keys(data);

    if (input.format === 'json') {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Data as JSON',
        defaultPath: `living-dashboard-export-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const size = await writeJSON(data, result.filePath);
      return {
        filePath: result.filePath,
        format: 'json' as const,
        tables,
        sizeBytes: size,
      };
    } else {
      // CSV: show folder picker, write one file per table
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Export Folder for CSV Files',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const dir = result.filePaths[0];
      let totalSize = 0;
      for (const [name, rows] of Object.entries(data)) {
        const csv = tableToCsv(rows);
        const fp = path.join(dir, `${name}.csv`);
        await fs.promises.writeFile(fp, csv, 'utf-8');
        totalSize += Buffer.byteLength(csv);
      }
      return {
        filePath: dir,
        format: 'csv' as const,
        tables,
        sizeBytes: totalSize,
      };
    }
  });

  // Auto-backup settings
  ipcMain.handle('backup:auto-settings-get', async () => {

    return getAutoBackupSettings();
  });

  ipcMain.handle(
    'backup:auto-settings-update',
    async (_event, partialSettings: unknown) => {
  
      const input = validateInput(autoBackupSettingsUpdateSchema, partialSettings);
      return updateAutoBackupSettings(input);
    },
  );
}
