// === Backup, export, and auto-backup configuration types ===

export interface BackupInfo {
  fileName: string;
  filePath: string;
  createdAt: string; // ISO timestamp
  sizeBytes: number;
}

export interface BackupProgress {
  phase: 'starting' | 'dumping' | 'saving' | 'restoring' | 'complete' | 'failed';
  message: string;
  error?: string;
}

export type ExportFormat = 'json' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  tables?: string[]; // if omitted, export all user-data tables
}

export interface ExportResult {
  filePath: string;
  format: ExportFormat;
  tables: string[];
  sizeBytes: number;
}

export type AutoBackupFrequency = 'daily' | 'weekly' | 'off';

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  retention: number; // number of backups to keep
  lastRun: string | null; // ISO timestamp or null
}
