// === FILE PURPOSE ===
// Settings → AI & Models → "Local AI": browse the GGUF catalog for the bundled
// llama.cpp runtime, filter it by origin and license, download / pause / resume /
// cancel with live progress, delete with disk reclaim, add your own GGUF, and
// watch the runtime's status.
//
// === DEPENDENCIES ===
// React, lucide-react, useLocalModels (view + push-event progress), ConfirmDialog,
// ./local-ai/* (row, filter bar, runtime card, custom-model form, format helpers).
//
// === CONTRACT NOTES ===
// - NO SILENT DEFAULT: the hardware tier only HIGHLIGHTS a model with hedged copy.
//   Nothing here selects or downloads a model without an explicit click.
// - Rendering this section costs one `local-models:view` read plus the runtime
//   card's one-time `ai:get-runtime-snapshot` pull (then push-driven from
//   `ai:runtime-status`). Neither spawns the runtime; neither starts a transfer.

import { useMemo, useState } from 'react';
import { AlertTriangle, Cpu, FolderOpen, Loader2, Plus, RefreshCw } from 'lucide-react';
import type {
  CatalogModel,
  CatalogModelStatus,
  LocalModelDownloadProgress,
  ModelRole,
} from '../../../shared/types/localModels';
import { useLocalModels } from '../../hooks/useLocalModels';
import { ConfirmDialog } from '../ConfirmDialog';
import CatalogModelRow from './local-ai/CatalogModelRow';
import CustomModelForm from './local-ai/CustomModelForm';
import EnableBuiltinCard from './local-ai/EnableBuiltinCard';
import LocalAIFilterBar, { ANY, applyFilters, type CatalogFilters } from './local-ai/LocalAIFilterBar';
import LocalRuntimeCard from './local-ai/LocalRuntimeCard';
import { bestMatchRationale, formatSize } from './local-ai/format';

const ROLE_SECTIONS: { role: ModelRole; title: string; blurb: string }[] = [
  { role: 'chat', title: 'Chat models', blurb: 'Summaries, agents and the in-meeting assistant.' },
  {
    role: 'embedding',
    title: 'Embedding models',
    blurb: 'Semantic search and Twin memory. One multilingual model is enough.',
  },
];

const TOOLBAR_BUTTON =
  'flex items-center gap-1.5 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 px-2.5 py-1 rounded-lg text-xs transition-colors';

/** A user-registered entry, as opposed to a curated catalog one. */
const isCustom = (model: CatalogModel) => model.id.startsWith('custom-');

interface PendingDelete {
  modelId: string;
  fileName: string;
  sizeBytes: number;
  displayName: string;
  custom: boolean;
}

interface RowHandlers {
  onDownload: (model: CatalogModel, quant: string) => void;
  onPause: (model: CatalogModel, key: string) => void;
  onCancel: (model: CatalogModel, key: string) => void;
  onDelete: (model: CatalogModel, fileName: string, sizeBytes: number) => void;
  onRemove: (model: CatalogModel) => void;
}

function LocalAIToolbar({
  loading,
  onAddCustom,
  onRefresh,
}: {
  loading: boolean;
  onAddCustom: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onAddCustom} className={TOOLBAR_BUTTON}>
        <Plus size={13} aria-hidden="true" />
        Add your own GGUF
      </button>
      <button onClick={() => void window.electronAPI?.openLocalModelsFolder?.()} className={TOOLBAR_BUTTON}>
        <FolderOpen size={13} aria-hidden="true" />
        Open folder
      </button>
      <button onClick={onRefresh} disabled={loading} aria-label="Refresh the model catalog" className={TOOLBAR_BUTTON}>
        {loading ? (
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw size={13} aria-hidden="true" />
        )}
        Refresh
      </button>
    </div>
  );
}

/** One role group (chat / embedding) of the filtered catalog. */
function CatalogRoleSection({
  title,
  blurb,
  models,
  statuses,
  downloads,
  recommended,
  rationale,
  freed,
  busyModelId,
  handlers,
}: {
  title: string;
  blurb: string;
  models: CatalogModel[];
  statuses: CatalogModelStatus[];
  downloads: Record<string, LocalModelDownloadProgress>;
  recommended: Set<string>;
  rationale?: string;
  freed: Record<string, string>;
  busyModelId: string | null;
  handlers: RowHandlers;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <p className="text-xs text-[var(--color-text-muted)] mt-0.5 break-words">{blurb}</p>
      {models.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">No models match the current filters.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {models.map((model) => (
            <CatalogModelRow
              key={model.id}
              model={model}
              status={statuses.find((s) => s.modelId === model.id)}
              progressByKey={downloads}
              isBestMatch={recommended.has(model.id)}
              rationale={rationale}
              freedNote={freed[model.id]}
              busy={busyModelId === model.id}
              onDownload={(quant) => handlers.onDownload(model, quant)}
              onPause={(key) => handlers.onPause(model, key)}
              onCancel={(key) => handlers.onCancel(model, key)}
              onDelete={(fileName, sizeBytes) => handlers.onDelete(model, fileName, sizeBytes)}
              onRemove={isCustom(model) ? () => handlers.onRemove(model) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LocalAISection() {
  const { view, downloads, loading, error, refresh } = useLocalModels();
  const [filters, setFilters] = useState<CatalogFilters>({ origin: ANY, license: ANY });
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [freed, setFreed] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const models = useMemo(() => view?.catalog.models ?? [], [view]);
  const visible = useMemo(() => applyFilters(models, filters), [models, filters]);
  const recommended = new Set(view?.tier.recommendedModelIds ?? []);
  const rationale = view ? bestMatchRationale(view.tier) : undefined;

  /** Run one bridge call with a per-model busy flag and a surfaced failure. */
  const run = async (modelId: string, action: () => Promise<unknown>) => {
    setBusyModelId(modelId);
    setActionError(null);
    try {
      await action();
      await refresh(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That action failed.');
    } finally {
      setBusyModelId(null);
    }
  };

  const handlers: RowHandlers = {
    onDownload: (model, quant) =>
      void run(model.id, () => window.electronAPI.downloadLocalModel({ modelId: model.id, quant })),
    onPause: (model, key) => void run(model.id, () => window.electronAPI.pauseLocalModelDownload(key)),
    onCancel: (model, key) => void run(model.id, () => window.electronAPI.cancelLocalModelDownload(key)),
    onDelete: (model, fileName, sizeBytes) =>
      setPendingDelete({
        modelId: model.id,
        fileName,
        sizeBytes,
        displayName: model.displayName,
        custom: isCustom(model),
      }),
    onRemove: (model) => void run(model.id, () => window.electronAPI.unregisterCustomLocalModel(model.id)),
  };

  const handleDeleteConfirmed = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    await run(target.modelId, async () => {
      const { freedBytes } = await window.electronAPI.deleteLocalModel(target.fileName);
      if (target.custom) await window.electronAPI.unregisterCustomLocalModel(target.modelId);
      setFreed((prev) => ({ ...prev, [target.modelId]: `Deleted — ${formatSize(freedBytes)} reclaimed.` }));
    });
  };

  return (
    <section className="hud-panel-accent clip-corner-cut-sm p-6 overflow-hidden">
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <Cpu size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Local AI</span>
          <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Run models on this computer with the built-in runtime — no account, no API key, nothing leaves the device.
          Downloads are large; you choose what to install.
        </p>
      </div>

      <LocalRuntimeCard />

      {/* The bridge from "downloaded" to "actually used": downloading creates no
          `builtin` provider row, so without this the catalog dead-ends. Hides
          itself once one exists. */}
      {view && <EnableBuiltinCard view={view} onActivated={() => void refresh(false)} />}

      {(actionError ?? error) && (
        <p className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-data break-words overflow-hidden">
          {actionError ?? error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <LocalAIFilterBar models={models} filters={filters} onChange={setFilters} shownCount={visible.length} />
        <LocalAIToolbar
          loading={loading}
          onAddCustom={() => setShowCustomForm((v) => !v)}
          onRefresh={() => void refresh(true)}
        />
      </div>

      {showCustomForm && (
        <div className="mt-3">
          <CustomModelForm
            onAdded={() => {
              setShowCustomForm(false);
              void refresh(false);
            }}
            onCancel={() => setShowCustomForm(false)}
          />
        </div>
      )}

      {loading && !view && (
        <div className="flex items-center justify-center py-6 text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        </div>
      )}

      {view &&
        ROLE_SECTIONS.map(({ role, title, blurb }) => (
          <CatalogRoleSection
            key={role}
            title={title}
            blurb={blurb}
            models={visible.filter((m) => m.role === role)}
            statuses={view.statuses}
            downloads={downloads}
            recommended={recommended}
            rationale={rationale}
            freed={freed}
            busyModelId={busyModelId}
            handlers={handlers}
          />
        ))}

      {view && (
        <p className="mt-4 flex items-start gap-1.5 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
          <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
          <span className="break-words">
            Model licenses above are each vendor’s own — review them before commercial use. Catalog source:{' '}
            {view.source}; runtime build {view.pinnedRuntimeTag}. Files live in{' '}
            <span className="font-data break-words">{view.modelsDir}</span>.
          </span>
        </p>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this model file?"
        message={
          pendingDelete
            ? `${pendingDelete.displayName} will be removed from disk, freeing about ${formatSize(pendingDelete.sizeBytes)}. You can download it again later.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
