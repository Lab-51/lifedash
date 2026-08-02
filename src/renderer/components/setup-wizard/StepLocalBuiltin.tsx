// === FILE PURPOSE ===
// Setup wizard, built-in-AI branch: what this machine reports, a tier-ranked
// shortlist of models it can run, an explicit pick that downloads with live
// progress, and the hand-off that lets the wizard route `live_assistant` (and
// embeddings) at the built-in runtime once the file is actually on disk.
//
// === DEPENDENCIES ===
// useLocalModels (one view read + push-event progress), the Settings → Local AI
// row / filter-bar / runtime-card components and their format helpers,
// ./localBuiltin (pure derivations), HudSelect, ConfirmDialog.
//
// === CONTRACT NOTES ===
// - Composition only. Every row, badge, progress bar and the hedged best-match
//   rationale come from the Task 4 components; none of that copy is restated.
// - Optional by construction: mounting costs one `local-models:view` read plus
//   the runtime card's `status()` poll — both pure reads. No download and no
//   settings write happens without a click, so Back and Skip leave the app
//   exactly as it was.
// - The Download click IS the pick. Finishing stays disabled until that model's
//   file is on disk, because an undownloaded model is not routable.

import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Cloud, Cpu, Loader2 } from 'lucide-react';
import type { CatalogModel } from '../../../shared/types/localModels';
import { useLocalModels } from '../../hooks/useLocalModels';
import { ConfirmDialog } from '../ConfirmDialog';
import HudSelect from '../HudSelect';
import CatalogModelRow from '../settings/local-ai/CatalogModelRow';
import LocalAIFilterBar, { ANY, applyFilters, type CatalogFilters } from '../settings/local-ai/LocalAIFilterBar';
import LocalRuntimeCard from '../settings/local-ai/LocalRuntimeCard';
import { NO_TOOL_CALLING_CONSEQUENCE, bestMatchRationale, formatSize, regionLabel } from '../settings/local-ai/format';
import {
  SHORTLIST_SIZE,
  modelPool,
  rankForShortlist,
  routableModels,
  toolCallingVerdict,
  type BuiltinAssignment,
  type RoutableModel,
  type ToolCallingVerdict,
} from './localBuiltin';

export interface StepLocalBuiltinProps {
  /** The explicit pick, handed up only once its file is on disk. */
  onFinish: (pick: BuiltinAssignment) => void;
  /** Honest escape hatch when no built-in model can do what the user needs. */
  onUseCloud: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface PendingDelete {
  modelId: string;
  fileName: string;
  sizeBytes: number;
  displayName: string;
}

const LINK_BUTTON = 'text-xs text-[var(--color-accent)] hover:underline';

/** Name + origin of a model, e.g. "Qwen3 4B (Q4_K_M) — China". */
const nameWithOrigin = (m: CatalogModel) => `${m.displayName} — ${regionLabel(m.originCountry)}`;

/**
 * The tool-calling reality for this machine + these filters. Under 16 GB of RAM
 * the only built-in model that can drive Digital Twin actions is Chinese-origin,
 * which collides head-on with the policy motivation behind the origin filter.
 * The user is told plainly what they can and cannot get, and is offered cloud.
 */
function ToolCallingSteer({ verdict, onUseCloud }: { verdict: ToolCallingVerdict; onUseCloud: () => void }) {
  if (verdict.kind === 'ok') return null;
  return (
    <div className="mt-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <p className="flex items-start gap-1.5 text-xs text-amber-400 break-words">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="break-words">
          {verdict.kind === 'filtered-out'
            ? `None of the models shown can call tools. The only one this machine can run that does is ${verdict.excluded
                .map(nameWithOrigin)
                .join(', ')} — excluded by your current filters.`
            : 'No built-in model available to this machine can call tools.'}
        </span>
      </p>
      <p className="mt-1.5 text-xs text-[var(--color-text-secondary)] break-words">
        So your options are honest ones: download a model below — {NO_TOOL_CALLING_CONSEQUENCE} — or use a cloud
        provider, which can.
      </p>
      <button type="button" onClick={onUseCloud} className={`mt-2 flex items-center gap-1.5 ${LINK_BUTTON}`}>
        <Cloud size={12} aria-hidden="true" />
        Use a cloud provider instead
      </button>
    </div>
  );
}

/** The capped shortlist and its one visible click to the rest. */
function Shortlist({
  models,
  expanded,
  onToggle,
  renderRow,
}: {
  models: CatalogModel[];
  expanded: boolean;
  onToggle: () => void;
  renderRow: (model: CatalogModel) => ReactNode;
}) {
  if (models.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)] break-words">No models match the current filters.</p>;
  }
  return (
    <>
      <ul className="space-y-2">{(expanded ? models : models.slice(0, SHORTLIST_SIZE)).map(renderRow)}</ul>
      {models.length > SHORTLIST_SIZE && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={`mt-2 flex items-center gap-1 ${LINK_BUTTON}`}
        >
          {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          {expanded ? 'Show fewer' : `Show all ${models.length} models`}
        </button>
      )}
    </>
  );
}

/** What will be written, stated before the user commits to writing it. */
function PickSummary({
  routableChat,
  routableEmbedding,
  pickedId,
  onPick,
}: {
  routableChat: RoutableModel[];
  routableEmbedding: RoutableModel[];
  pickedId: string;
  onPick: (id: string) => void;
}) {
  const picked = routableChat.find((m) => m.id === pickedId);
  return (
    <div className="mt-4 pt-3 border-t border-[var(--color-border)] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--color-text-secondary)]">Assistant model</span>
        <div className="w-56">
          {routableChat.length === 0 ? (
            <span className="text-xs text-[var(--color-text-muted)] break-words">
              Download one above to choose it here.
            </span>
          ) : (
            <HudSelect
              value={pickedId}
              onChange={onPick}
              ariaLabel="Model to use for the in-meeting assistant"
              compact
              options={[
                { value: '', label: 'Choose a downloaded model' },
                // Same option wording as Settings → Model Assignments, so the
                // routing consequence is visible at the moment of choosing.
                ...routableChat.map((m) => ({
                  value: m.id,
                  label: `${m.label} — ${m.toolCalling ? 'tool calling' : 'no tool calling'}`,
                })),
              ]}
            />
          )}
        </div>
      </div>

      {picked && !picked.toolCalling && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[0.6875rem] text-amber-400 break-words">
          <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
          <span className="break-words">{NO_TOOL_CALLING_CONSEQUENCE}</span>
        </p>
      )}

      <p className="mt-1.5 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
        {routableEmbedding.length > 0
          ? `Semantic search will use ${routableEmbedding[0].label}.`
          : 'No embedding model downloaded, so semantic search stays off — add one here or later in Settings → AI & Models → Local AI.'}
      </p>
    </div>
  );
}

export default function StepLocalBuiltin({ onFinish, onUseCloud, onBack, onSkip }: StepLocalBuiltinProps) {
  // `local-models:view` is a pure read, and mounting this step IS "the user
  // entered the local branch" — which is why the hook lives here and nowhere
  // else in the wizard.
  const { view, downloads, loading, error, refresh } = useLocalModels();
  const [filters, setFilters] = useState<CatalogFilters>({ origin: ANY, license: ANY });
  const [expanded, setExpanded] = useState(false);
  const [pickedChatId, setPickedChatId] = useState('');
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const chat = useMemo(() => (view ? modelPool(view, 'chat') : { models: [], noneFit: false }), [view]);
  const embedding = useMemo(() => (view ? modelPool(view, 'embedding') : { models: [], noneFit: false }), [view]);
  const recommended = useMemo(() => new Set(view?.tier.recommendedModelIds ?? []), [view]);
  const visibleChat = useMemo(
    () => applyFilters(chat.models, filters).sort(rankForShortlist(recommended)),
    [chat.models, filters, recommended],
  );
  const visibleEmbedding = useMemo(() => applyFilters(embedding.models, filters), [embedding.models, filters]);
  const routableChat = useMemo(() => (view ? routableModels(view, 'chat') : []), [view]);
  const routableEmbedding = useMemo(() => (view ? routableModels(view, 'embedding') : []), [view]);

  const verdict = toolCallingVerdict(chat.models, visibleChat);
  const readyToFinish = routableChat.some((m) => m.id === pickedChatId);

  /** One bridge call with a per-model busy flag and a surfaced failure. */
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

  /**
   * The Download click is also the pick: one explicit action, recorded before the
   * transfer starts so that finishing unlocks for THIS model and no other.
   */
  const handleDownload = (model: CatalogModel, quant: string) => {
    if (model.role === 'chat') {
      const file = view?.statuses.find((s) => s.modelId === model.id)?.files.find((f) => f.quant === quant);
      if (file) setPickedChatId(file.runtimeModelId);
    }
    void run(model.id, () => window.electronAPI.downloadLocalModel({ modelId: model.id, quant }));
  };

  const handleDeleteConfirmed = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    void run(target.modelId, () => window.electronAPI.deleteLocalModel(target.fileName));
  };

  const renderRow = (model: CatalogModel) => (
    <CatalogModelRow
      key={model.id}
      model={model}
      status={view?.statuses.find((s) => s.modelId === model.id)}
      progressByKey={downloads}
      isBestMatch={recommended.has(model.id)}
      rationale={view ? bestMatchRationale(view.tier) : undefined}
      busy={busyModelId === model.id}
      onDownload={(quant) => handleDownload(model, quant)}
      onPause={(key) => void run(model.id, () => window.electronAPI.pauseLocalModelDownload(key))}
      onCancel={(key) => void run(model.id, () => window.electronAPI.cancelLocalModelDownload(key))}
      onDelete={(fileName, sizeBytes) =>
        setPendingDelete({ modelId: model.id, fileName, sizeBytes, displayName: model.displayName })
      }
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1 flex items-center gap-2">
          <Cpu size={16} className="text-[var(--color-accent)]" aria-hidden="true" />
          AI on this computer
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)] break-words">
          {view
            ? `Your machine reports ${view.tier.totalRamGB} GB of memory. The models below are the ones whose stated minimum fits it — pick one and LifeDash downloads it. Nothing leaves this device.`
            : 'Reading the model catalogue…'}
        </p>
      </div>

      <LocalRuntimeCard />

      {(actionError ?? error) && (
        <p className="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-data break-words overflow-hidden">
          {actionError ?? error}
        </p>
      )}

      {loading && !view && (
        <div className="flex items-center justify-center py-6 text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        </div>
      )}

      {view && (
        <>
          <LocalAIFilterBar
            models={[...chat.models, ...embedding.models]}
            filters={filters}
            onChange={setFilters}
            shownCount={visibleChat.length + visibleEmbedding.length}
          />

          {chat.noneFit && (
            <p className="flex items-start gap-1.5 text-xs text-amber-400 break-words">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="break-words">
                No built-in model fits the memory this machine reports. You can still try one, but a cloud provider is
                the option that will work.
              </span>
            </p>
          )}

          <ToolCallingSteer verdict={verdict} onUseCloud={onUseCloud} />

          {/* No scroller of its own: the wizard body scrolls, and nesting a second
              one hides the footer behind an inner scrollbar. */}
          <div className="overflow-hidden">
            <Shortlist
              models={visibleChat}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              renderRow={renderRow}
            />

            {visibleEmbedding.length > 0 && (
              <>
                <p className="mt-3 text-xs text-[var(--color-text-secondary)] break-words">
                  For semantic search across your sessions (small, and it never leaves the device):
                </p>
                <ul className="mt-2 space-y-2">{visibleEmbedding.map(renderRow)}</ul>
              </>
            )}
          </div>

          <PickSummary
            routableChat={routableChat}
            routableEmbedding={routableEmbedding}
            pickedId={pickedChatId}
            onPick={setPickedChatId}
          />
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Back
        </button>
        <button
          onClick={() => onFinish({ chatModelId: pickedChatId, embeddingModelId: routableEmbedding[0]?.id })}
          disabled={!readyToFinish}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 btn-primary clip-corner-cut-sm text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Use this model
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="w-full py-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-center"
      >
        Skip for now — nothing is downloaded or changed
      </button>

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
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
