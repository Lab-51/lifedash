// === FILE PURPOSE ===
// Data export section for the Settings page.
// Allows exporting all user data as JSON or CSV format.
// API keys are excluded from exports for security.
//
// === DEPENDENCIES ===
// React, zustand (useBackupStore), lucide-react icons

import { useState } from 'react';
import { Download, Check, AlertCircle } from 'lucide-react';
import { useBackupStore } from '../../stores/backupStore';
import type { ExportResult } from '../../../shared/types';

/** Format byte sizes for display */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportSection() {
  const exportData = useBackupStore(s => s.exportData);

  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(true);
    setResult(null);
    setExportError(null);
    try {
      const res = await exportData({ format });
      if (res) {
        setResult(res);
      } else {
        // null result means the user cancelled the save dialog — no error
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-surface-100">Export Data</h2>
        <p className="text-sm text-surface-500">
          Export your data for external use or migration. API keys are excluded for security.
        </p>
      </div>

      {/* Export buttons */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => handleExport('json')}
          disabled={exporting}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-sm transition-colors"
        >
          <Download size={16} />
          Export as JSON
        </button>
        <button
          onClick={() => handleExport('csv')}
          disabled={exporting}
          className="flex items-center gap-2 bg-surface-700 hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed text-surface-200 px-3 py-1.5 rounded-lg text-sm transition-colors"
        >
          <Download size={16} />
          Export as CSV
        </button>
      </div>

      {/* Success message */}
      {result && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <Check size={16} />
          <span>
            Exported {result.tables.length} tables as {result.format.toUpperCase()} ({formatSize(result.sizeBytes)})
          </span>
          <span className="text-xs text-emerald-500/70 ml-1 truncate" title={result.filePath}>
            {result.filePath}
          </span>
        </div>
      )}

      {/* Error message */}
      {exportError && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{exportError}</span>
        </div>
      )}
    </section>
  );
}
