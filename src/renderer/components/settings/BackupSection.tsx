// === FILE PURPOSE ===
// Backup management section for the Settings page.
// Handles creating/restoring/deleting backups, displaying progress,
// and configuring automatic backup settings.
//
// === DEPENDENCIES ===
// React, zustand (useBackupStore), lucide-react icons

import { useEffect, useState, useRef } from 'react';
import {
  Database,
  Upload,
  Trash2,
  RotateCcw,
  AlertCircle,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { useBackupStore } from '../../stores/backupStore';
import type { AutoBackupFrequency } from '../../../shared/types';

/** Format byte sizes for display */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format ISO date string to human-readable form */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BackupSection() {
  const backups = useBackupStore(s => s.backups);
  const loading = useBackupStore(s => s.loading);
  const error = useBackupStore(s => s.error);
  const progress = useBackupStore(s => s.progress);
  const autoSettings = useBackupStore(s => s.autoSettings);
  const loadBackups = useBackupStore(s => s.loadBackups);
  const createBackup = useBackupStore(s => s.createBackup);
  const restoreBackup = useBackupStore(s => s.restoreBackup);
  const restoreFromFile = useBackupStore(s => s.restoreFromFile);
  const deleteBackup = useBackupStore(s => s.deleteBackup);
  const loadAutoSettings = useBackupStore(s => s.loadAutoSettings);
  const updateAutoSettings = useBackupStore(s => s.updateAutoSettings);
  const clearError = useBackupStore(s => s.clearError);

  // Inline confirmation state
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestoreFile, setConfirmRestoreFile] = useState(false);

  // Timer ref for auto-clearing progress
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load backups and auto-backup settings on mount
  useEffect(() => {
    loadBackups();
    loadAutoSettings();
  }, [loadBackups, loadAutoSettings]);

  // Auto-clear progress after 5 seconds when complete or failed
  useEffect(() => {
    if (progress && (progress.phase === 'complete' || progress.phase === 'failed')) {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      progressTimerRef.current = setTimeout(() => {
        useBackupStore.getState().setProgress(null);
      }, 5000);
    }
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    };
  }, [progress]);

  const isBusy = loading || (progress !== null && progress.phase !== 'complete' && progress.phase !== 'failed');

  const handleRestore = async (filePath: string) => {
    setConfirmRestore(null);
    await restoreBackup(filePath);
  };

  const handleDelete = async (fileName: string) => {
    setConfirmDelete(null);
    await deleteBackup(fileName);
  };

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Database Backups</h2>
        <p className="text-sm text-surface-500">
          Create and manage database backups. Restore from a previous snapshot at any time.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={createBackup}
          disabled={isBusy}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-sm transition-colors"
        >
          <Database size={16} />
          Create Backup
        </button>
        {confirmRestoreFile ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-400">Overwrite current database?</span>
            <button
              onClick={() => setConfirmRestoreFile(false)}
              className="text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { setConfirmRestoreFile(false); restoreFromFile(); }}
              className="text-xs bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 px-2 py-1 rounded transition-colors"
            >
              Confirm
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRestoreFile(true)}
            disabled={isBusy}
            className="flex items-center gap-2 bg-surface-700 hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed text-surface-800 dark:text-surface-200 px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            <Upload size={16} />
            Restore from File...
          </button>
        )}
      </div>

      {/* Progress indicator */}
      {progress && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
            progress.phase === 'complete'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : progress.phase === 'failed'
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
          }`}
        >
          {progress.phase === 'complete' ? (
            <Check size={16} />
          ) : progress.phase === 'failed' ? (
            <AlertCircle size={16} />
          ) : (
            <Loader2 size={16} className="animate-spin" />
          )}
          <span>{progress.message}</span>
          {progress.error && (
            <span className="ml-2 text-red-300">({progress.error})</span>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button onClick={clearError} className="text-red-400 hover:text-red-300 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Backup list */}
      {backups.length > 0 ? (
        <div className="space-y-2 mb-4">
          {backups.map((backup) => (
            <div key={backup.fileName}>
              <div className="bg-surface-100/50 dark:bg-surface-800/50 rounded-lg px-4 py-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                    {backup.fileName}
                  </div>
                  <div className="text-xs text-surface-500 mt-0.5">
                    {formatDate(backup.createdAt)} &middot; {formatSize(backup.sizeBytes)}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => setConfirmRestore(backup.fileName)}
                    disabled={isBusy}
                    className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Restore this backup"
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                  <button
                    onClick={() => setConfirmDelete(backup.fileName)}
                    disabled={isBusy}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Delete this backup"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>

              {/* Restore confirmation */}
              {confirmRestore === backup.fileName && (
                <div className="mt-1 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-300 flex items-center justify-between">
                  <span>
                    This will replace ALL current data. A safety backup will be created first.
                  </span>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => setConfirmRestore(null)}
                      className="text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRestore(backup.filePath)}
                      className="text-xs bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 px-2 py-1 rounded transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              )}

              {/* Delete confirmation */}
              {confirmDelete === backup.fileName && (
                <div className="mt-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300 flex items-center justify-between">
                  <span>Delete this backup?</span>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(backup.fileName)}
                      className="text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 px-2 py-1 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="flex flex-col items-center justify-center text-surface-500 py-6 mb-4">
            <Database size={32} className="mb-2 text-surface-600" />
            <p className="text-sm">No backups yet</p>
            <p className="text-xs text-surface-600 mt-1">
              Create your first backup to protect your data
            </p>
          </div>
        )
      )}

      {/* Info note */}
      <p className="text-xs text-surface-500 mt-4">
        Backups include all database data (projects, boards, cards, meetings, ideas, etc.).
        Audio recording files are not included in backups and must be managed separately.
      </p>

      {/* Auto-backup settings */}
      {autoSettings && (
        <div className="mt-6 p-4 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg">
          <h3 className="text-sm font-medium text-surface-800 dark:text-surface-200 mb-3">Automatic Backups</h3>

          {/* Enable toggle */}
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={autoSettings.enabled}
              onChange={(e) => updateAutoSettings({ enabled: e.target.checked })}
              className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
            />
            <span className="text-sm text-surface-700 dark:text-surface-300">Enable automatic backups</span>
          </label>

          {autoSettings.enabled && (
            <div className="space-y-3 pl-6">
              {/* Frequency */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-surface-400 w-20">Frequency</label>
                <select
                  value={autoSettings.frequency === 'off' ? 'daily' : autoSettings.frequency}
                  onChange={(e) =>
                    updateAutoSettings({ frequency: e.target.value as AutoBackupFrequency })
                  }
                  className=""
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              {/* Retention */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-surface-400 w-20">Keep last</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={autoSettings.retention}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= 50) {
                      updateAutoSettings({ retention: val });
                    }
                  }}
                  className="bg-surface-700 border border-surface-600 text-surface-800 dark:text-surface-200 text-sm rounded-lg px-2 py-1 w-20 focus:ring-primary-500 focus:border-primary-500"
                />
                <span className="text-xs text-surface-500">backups</span>
              </div>

              {/* Last run */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-surface-400 w-20">Last backup</span>
                <span className="text-xs text-surface-500">
                  {autoSettings.lastRun ? formatDate(autoSettings.lastRun) : 'Never'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
