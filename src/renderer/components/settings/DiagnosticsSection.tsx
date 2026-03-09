// === FILE PURPOSE ===
// Diagnostics section for the Settings page.
// Provides access to log files and opt-in crash reporting toggle.

import { useEffect, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';

export default function DiagnosticsSection() {
  const [crashReports, setCrashReports] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.diagnosticsGetCrashReportsEnabled()
      .then((val) => setCrashReports(val))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleOpenLogs = async () => {
    await window.electronAPI.openLogsFolder();
  };

  const handleToggleCrashReports = async (checked: boolean) => {
    const previous = crashReports;
    setCrashReports(checked);
    try {
      await window.electronAPI.diagnosticsSetCrashReportsEnabled(checked);
    } catch {
      setCrashReports(previous);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Access diagnostic information for troubleshooting.
      </p>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Log Files</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Log files are stored locally and auto-deleted after 5 days.
          </p>
        </div>
        <button
          onClick={handleOpenLogs}
          className="flex items-center gap-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-3 py-1.5 text-sm transition-all"
        >
          <FolderOpen size={16} />
          Open Logs Folder
        </button>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Send anonymous crash reports</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 max-w-md">
            Help improve LifeDash by sending crash data when errors occur.
            No meeting content, transcripts, API keys, or personal data is ever included.
          </p>
        </div>
        {loading ? (
          <Loader2 size={16} className="animate-spin text-surface-500" />
        ) : (
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={crashReports}
              onChange={(e) => handleToggleCrashReports(e.target.checked)}
              className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
            />
          </label>
        )}
      </div>
    </div>
  );
}
