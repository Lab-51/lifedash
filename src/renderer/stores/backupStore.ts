// === FILE PURPOSE ===
// Zustand store for backup management state and actions.
// Connects renderer UI to the backup/export IPC API.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI

import { create } from 'zustand';
import type {
  BackupInfo,
  BackupProgress,
  ExportOptions,
  ExportResult,
  AutoBackupSettings,
} from '../../shared/types';

interface BackupState {
  backups: BackupInfo[];
  loading: boolean;
  error: string | null;
  progress: BackupProgress | null;
  autoSettings: AutoBackupSettings | null;
  // Actions
  loadBackups: () => Promise<void>;
  createBackup: () => Promise<void>;
  restoreBackup: (filePath: string) => Promise<void>;
  restoreFromFile: () => Promise<void>;
  deleteBackup: (fileName: string) => Promise<void>;
  exportData: (options: ExportOptions) => Promise<ExportResult | null>;
  loadAutoSettings: () => Promise<void>;
  updateAutoSettings: (settings: Partial<AutoBackupSettings>) => Promise<void>;
  setProgress: (progress: BackupProgress | null) => void;
  clearError: () => void;
}

export const useBackupStore = create<BackupState>((set, get) => ({
  backups: [],
  loading: false,
  error: null,
  progress: null,
  autoSettings: null,

  loadBackups: async () => {
    set({ loading: true, error: null });
    try {
      const backups = await window.electronAPI.backupList();
      set({ backups, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load backups',
        loading: false,
      });
    }
  },

  createBackup: async () => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.backupCreate();
      await get().loadBackups();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Backup failed',
        loading: false,
      });
    }
  },

  restoreBackup: async (filePath: string) => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.backupRestore(filePath);
      await get().loadBackups();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Restore failed',
        loading: false,
      });
    }
  },

  restoreFromFile: async () => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.backupRestoreFromFile();
      await get().loadBackups();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Restore failed',
        loading: false,
      });
    }
  },

  deleteBackup: async (fileName: string) => {
    set({ error: null });
    try {
      await window.electronAPI.backupDelete(fileName);
      await get().loadBackups();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  },

  exportData: async (options: ExportOptions) => {
    try {
      const result = await window.electronAPI.backupExport(options);
      return result;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Export failed' });
      return null;
    }
  },

  loadAutoSettings: async () => {
    try {
      const autoSettings = await window.electronAPI.backupAutoSettingsGet();
      set({ autoSettings });
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('LICENSE_REQUIRED'))) {
        console.error('Failed to load auto-backup settings:', err);
      }
    }
  },

  updateAutoSettings: async (settings: Partial<AutoBackupSettings>) => {
    try {
      await window.electronAPI.backupAutoSettingsUpdate(settings);
      await get().loadAutoSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to update settings',
      });
    }
  },

  setProgress: (progress: BackupProgress | null) => set({ progress }),
  clearError: () => set({ error: null }),
}));
