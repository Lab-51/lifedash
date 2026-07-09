// === FILE PURPOSE ===
// Small shared presentational bits for the orchestrated Digital Twin "Deep interview"
// flow (V3.3.5): a loading row, a non-blocking info note, and the "AI couldn't
// continue — fill the form instead" fallback. Extracted so DeepInterviewPanel and its
// step sub-components stay simple (eslint complexity budget) and share one look.
//
// === DEPENDENCIES ===
// react (implicit), lucide-react.

import { Loader2, AlertTriangle, Info } from 'lucide-react';

/** A spinner + label used for every transient "working…" phase. */
export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]" role="status">
      <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
      {label}
    </div>
  );
}

/** A quiet, non-blocking note (e.g. "research isn't available — going straight to the
 *  interview"). Announced politely so it isn't missed, but never demands action. */
export function InfoNote({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)] break-words">
      <Info size={14} className="shrink-0 mt-0.5 text-[var(--color-accent-dim)]" aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/** The degrade-to-manual escape hatch: an AI turn couldn't continue, so offer the
 *  Quick form. NEVER blocks — the user always keeps a path forward. When earlier steps
 *  already produced usable work (e.g. a consented cloud role-research dossier), pass
 *  `onKeepPartial` to offer continuing with THAT as the primary action so the work
 *  isn't thrown away; the form fallback stays available as the secondary. */
export function FormFallbackNotice({
  message,
  onUseForm,
  onKeepPartial,
  keepLabel,
}: {
  message: string;
  onUseForm: () => void;
  onKeepPartial?: () => void;
  keepLabel?: string;
}) {
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]" role="status">
        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--color-accent)]" />
        <p className="break-words min-w-0">{message}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {onKeepPartial && (
          <button
            type="button"
            onClick={onKeepPartial}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-all"
          >
            {keepLabel ?? 'Continue with what we found'}
          </button>
        )}
        <button
          type="button"
          onClick={onUseForm}
          className={
            onKeepPartial
              ? 'text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors'
              : 'flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all'
          }
        >
          Fill the form instead
        </button>
      </div>
    </div>
  );
}
