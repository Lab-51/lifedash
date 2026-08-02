// === FILE PURPOSE ===
// The action controls for ONE offered quant of a catalog model: download / pause /
// resume / cancel with a live progress bar, or delete once the file is on disk.
// Split out of CatalogModelRow so each piece stays inside the project's
// complexity budget and the button states are testable on their own.
//
// === DEPENDENCIES ===
// React, lucide-react (icons reused from the app's existing vocabulary),
// shared localModels types, ./format helpers.

import { Download, Loader2, Pause, Play, Trash2, X } from 'lucide-react';
import type { CatalogFileStatus, LocalModelDownloadProgress } from '../../../../shared/types/localModels';
import { formatRate, formatSize } from './format';

const BUTTON =
  'flex items-center gap-1 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg text-xs transition-colors';
const DANGER_BUTTON =
  'flex items-center gap-1 border border-[var(--color-border)] hover:border-red-500/50 text-[var(--color-text-secondary)] hover:text-red-400 disabled:opacity-50 px-2.5 py-1 rounded-lg text-xs transition-colors';

export interface ModelFileActionsProps {
  modelName: string;
  file: CatalogFileStatus;
  downloadKey: string;
  progress?: LocalModelDownloadProgress;
  /** Quant label, shown only when the model offers more than one. */
  showQuant: boolean;
  busy: boolean;
  /** True when the pinned runtime cannot load this model at all. */
  unsupported: boolean;
  onDownload: (quant: string) => void;
  onPause: (key: string) => void;
  onCancel: (key: string) => void;
  onDelete: (fileName: string, sizeBytes: number) => void;
}

/** Live bytes / total / rate under an in-flight transfer. */
function TransferReadout({ progress, modelName }: { progress: LocalModelDownloadProgress; modelName: string }) {
  const rate = formatRate(progress.bytesPerSecond);
  return (
    <>
      <div
        role="progressbar"
        aria-label={`Download progress for ${modelName}`}
        aria-valuenow={Math.round(progress.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="w-40 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-[var(--color-accent)] rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
        />
      </div>
      <span className="text-[0.625rem] text-[var(--color-text-muted)] font-data tabular-nums">
        {formatSize(progress.receivedBytes)}
        {progress.totalBytes > 0 ? ` / ${formatSize(progress.totalBytes)}` : ''}
        {rate ? ` · ${rate}` : ''}
      </span>
    </>
  );
}

/** Pause-or-resume plus cancel, shown only while a transfer is live. */
function ActiveControls({
  progress,
  modelName,
  downloadKey,
  quant,
  busy,
  onDownload,
  onPause,
  onCancel,
}: {
  progress: LocalModelDownloadProgress;
  modelName: string;
  downloadKey: string;
  quant: string;
  busy: boolean;
  onDownload: (quant: string) => void;
  onPause: (key: string) => void;
  onCancel: (key: string) => void;
}) {
  const paused = progress.state === 'paused';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[0.6875rem] text-[var(--color-accent-dim)] font-data tabular-nums">
        {progress.state === 'verifying' ? 'Verifying…' : `${Math.round(progress.percent)}%`}
      </span>
      <button
        onClick={() => (paused ? onDownload(quant) : onPause(downloadKey))}
        disabled={busy}
        aria-label={`${paused ? 'Resume' : 'Pause'} downloading ${modelName}`}
        className={BUTTON}
      >
        {paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        onClick={() => onCancel(downloadKey)}
        disabled={busy}
        aria-label={`Cancel downloading ${modelName}`}
        className={DANGER_BUTTON}
      >
        <X size={12} aria-hidden="true" />
        Cancel
      </button>
    </div>
  );
}

export default function ModelFileActions({
  modelName,
  file,
  downloadKey,
  progress,
  showQuant,
  busy,
  unsupported,
  onDownload,
  onPause,
  onCancel,
  onDelete,
}: ModelFileActionsProps) {
  const active = !!progress && progress.state !== 'ready' && progress.state !== 'error';

  return (
    <div className="flex flex-col items-end gap-1">
      {showQuant && <span className="text-[0.625rem] text-[var(--color-text-muted)]">{file.quant}</span>}

      {active && progress ? (
        <ActiveControls
          progress={progress}
          modelName={modelName}
          downloadKey={downloadKey}
          quant={file.quant}
          busy={busy}
          onDownload={onDownload}
          onPause={onPause}
          onCancel={onCancel}
        />
      ) : file.downloaded ? (
        <button
          onClick={() => onDelete(file.fileName, file.sizeBytes)}
          disabled={busy}
          aria-label={`Delete ${modelName} from disk`}
          className={DANGER_BUTTON}
        >
          <Trash2 size={12} aria-hidden="true" />
          Delete
        </button>
      ) : (
        <button
          onClick={() => onDownload(file.quant)}
          disabled={busy || unsupported}
          aria-label={`Download ${modelName}`}
          className={BUTTON}
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={12} aria-hidden="true" />
          )}
          Download
        </button>
      )}

      {active && progress && <TransferReadout progress={progress} modelName={modelName} />}

      {progress?.state === 'error' && (
        <span className="max-w-[16rem] text-[0.625rem] text-red-400 text-right break-words overflow-hidden">
          {progress.error ?? 'Download failed.'}
        </span>
      )}
    </div>
  );
}
