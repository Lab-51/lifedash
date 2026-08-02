// === FILE PURPOSE ===
// One catalog entry in Settings → Local AI: identity + badges (origin, license,
// size, languages, tool calling), the optional "likely best for your machine"
// highlight and its advisories, plus the per-file controls (delegated to
// ModelFileActions).
//
// === DEPENDENCIES ===
// React, lucide-react (icons reused from the app's existing vocabulary),
// shared localModels types, ./format helpers, ./ModelFileActions.
//
// === CONTRACT NOTES ===
// - The tool-calling badge is deliberately TEXT-first, not a subtle icon: Task 3
//   verified from each shipped GGUF's own chat template that only 4 of 8 chat
//   models can tool-call, and the Digital Twin depends on it. A model that can't
//   is shown, not hidden, with its consequence spelled out.
// - The best-match highlight is a highlight only. This row never auto-selects and
//   never auto-starts a download.
// - The highlight paints the row with --color-accent-muted, on which the app's
//   normal muted text is unreadable (~1.2:1 dark, ~1.8:1 light — it looked like
//   the text had vanished). Secondary text on a highlighted row therefore uses
//   --color-text-on-accent-muted / --color-accent-on-muted, which clear AA in
//   both themes. Anything added here must respect that split.

import { AlertTriangle, Check, Globe, HardDrive, Wrench } from 'lucide-react';
import type {
  CatalogModel,
  CatalogModelStatus,
  LocalModelDownloadProgress,
} from '../../../../shared/types/localModels';
import { NO_TOOL_CALLING_CONSEQUENCE, formatSize, languagesLabel, regionLabel } from './format';
import ModelFileActions from './ModelFileActions';

const BADGE = 'text-[0.625rem] px-1.5 py-0.5 rounded font-medium break-words';
const ADVISORY = 'mt-1.5 flex items-start gap-1.5 text-[0.6875rem] break-words';

export interface CatalogModelRowProps {
  model: CatalogModel;
  status?: CatalogModelStatus;
  /** Live progress per download key (`${modelId}:${quant}`), when one is running. */
  progressByKey: Record<string, LocalModelDownloadProgress>;
  isBestMatch: boolean;
  /** Hedged one-liner; rendered only under the best-match highlight. */
  rationale?: string;
  /** Reclaim note shown after a successful delete, e.g. "Freed 8.4 GB". */
  freedNote?: string;
  busy: boolean;
  onDownload: (quant: string) => void;
  onPause: (key: string) => void;
  onCancel: (key: string) => void;
  onDelete: (fileName: string, sizeBytes: number) => void;
  /** Custom (user-registered) entries only: drop the entry without touching disk. */
  onRemove?: () => void;
}

/** Tool-calling verdict. Prominent by design — see the contract note above. */
function ToolCallingBadge({ toolCalling }: { toolCalling: boolean }) {
  return toolCalling ? (
    <span className={`${BADGE} inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-400`}>
      <Wrench size={10} aria-hidden="true" />
      Tool calling
    </span>
  ) : (
    <span className={`${BADGE} inline-flex items-center gap-1 bg-amber-500/15 text-amber-400`}>
      <AlertTriangle size={10} aria-hidden="true" />
      No tool calling
    </span>
  );
}

/** Vendor / origin / license / size / languages / context, all break-words. */
function ModelMeta({ model }: { model: CatalogModel }) {
  const largest = model.files.reduce((max, f) => Math.max(max, f.sizeBytes), 0);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
      <span className="break-words">{model.vendor}</span>
      <span className="inline-flex items-center gap-1 break-words">
        <Globe size={10} aria-hidden="true" />
        {regionLabel(model.originCountry)}
      </span>
      <span className="break-words">{model.license}</span>
      <span className="break-words">{model.parameters}</span>
      <span className="inline-flex items-center gap-1 break-words">
        <HardDrive size={10} aria-hidden="true" />
        {formatSize(largest)}
      </span>
      <span className="break-words">{languagesLabel(model.languages)}</span>
      {model.contextLength > 0 && (
        <span className="break-words">{Math.round(model.contextLength / 1024)}K context</span>
      )}
    </div>
  );
}

/** Everything that qualifies the choice: consequence, notes, runtime and RAM fit. */
function ModelAdvisories({
  model,
  status,
  freedNote,
}: {
  model: CatalogModel;
  status?: CatalogModelStatus;
  freedNote?: string;
}) {
  const unsupported = status ? !status.runtimeSupported : false;
  return (
    <>
      {model.role === 'chat' && !model.toolCalling && (
        <p className={`${ADVISORY} text-amber-400`}>
          <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
          <span className="break-words">{NO_TOOL_CALLING_CONSEQUENCE}</span>
        </p>
      )}
      {model.notes && <p className="mt-1 text-[0.6875rem] text-[var(--color-text-muted)] break-words">{model.notes}</p>}
      {unsupported && (
        <p className={`${ADVISORY} text-amber-400`}>
          <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
          <span className="break-words">{status?.unavailableReason ?? 'Not supported by the bundled runtime.'}</span>
        </p>
      )}
      {!unsupported && status && !status.fitsRam && (
        <p className="mt-1.5 text-[0.6875rem] text-amber-400 break-words">
          Needs about {model.minRamGB} GB of RAM — more than this machine reports. You can still download it, but expect
          it to be slow or fail to load.
        </p>
      )}
      {freedNote && <p className="mt-1.5 text-[0.6875rem] text-emerald-400 break-words">{freedNote}</p>}
    </>
  );
}

export default function CatalogModelRow({
  model,
  status,
  progressByKey,
  isBestMatch,
  rationale,
  freedNote,
  busy,
  onDownload,
  onPause,
  onCancel,
  onDelete,
  onRemove,
}: CatalogModelRowProps) {
  const unsupported = status ? !status.runtimeSupported : false;

  return (
    <li
      className={`p-3 rounded-lg border overflow-hidden ${
        isBestMatch
          ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-muted)] on-accent-surface'
          : 'border-[var(--color-border)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-[var(--color-text-primary)] break-words">
              {model.displayName}
            </span>
            {isBestMatch && (
              /* accent-subtle, not accent-muted: the row itself is accent-muted,
                 so a same-colour pill has no visible fill. */
              <span className={`${BADGE} bg-[var(--color-accent-subtle)] text-[var(--color-accent-on-muted)]`}>
                Likely best for your machine
              </span>
            )}
            {status?.downloaded && (
              <span className={`${BADGE} inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-400`}>
                <Check size={10} aria-hidden="true" />
                Downloaded
              </span>
            )}
            {model.role === 'chat' && <ToolCallingBadge toolCalling={model.toolCalling} />}
          </div>

          <ModelMeta model={model} />

          {isBestMatch && rationale && (
            <p className="mt-1.5 text-[0.6875rem] text-[var(--color-accent-on-muted)] break-words">{rationale}</p>
          )}

          <ModelAdvisories model={model} status={status} freedNote={freedNote} />
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {(status?.files ?? []).map((file) => (
            <ModelFileActions
              key={`${model.id}:${file.quant}`}
              modelName={model.displayName}
              file={file}
              downloadKey={`${model.id}:${file.quant}`}
              progress={progressByKey[`${model.id}:${file.quant}`]}
              showQuant={model.files.length > 1}
              busy={busy}
              unsupported={unsupported}
              onDownload={onDownload}
              onPause={onPause}
              onCancel={onCancel}
              onDelete={onDelete}
            />
          ))}

          {onRemove && !status?.downloaded && (
            <button
              onClick={onRemove}
              disabled={busy}
              aria-label={`Remove ${model.displayName} from the model list`}
              className="text-[0.6875rem] text-[var(--color-text-muted)] hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              Remove from list
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
