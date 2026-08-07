// === FILE PURPOSE ===
// Pure logic behind the setup wizard's built-in-AI step: which catalog models
// this machine can honestly run (the shortlist and its ordering), whether a
// tool-calling model is actually reachable under the user's filters, which
// downloaded files are routable, and the `ai.taskModels` entries the wizard
// writes once a model is on disk. Kept out of the component so the
// honesty-critical rules are asserted directly by tests.
//
// === DEPENDENCIES ===
// Shared ai + localModels types only. No React, no IPC.
//
// === CONTRACT NOTES ===
// - Nothing here downloads, spawns or writes. These are all derivations.
// - Only DOWNLOADED files are routable: the built-in runtime can serve nothing
//   else, so an id for a missing file would be a dead assignment.

import type { AITaskType, TaskModelConfig } from '../../../shared/types';
import type { CatalogModel, CatalogModelStatus, LocalModelsView, ModelRole } from '../../../shared/types/localModels';

/** Rows shown before the user expands the rest of the models that fit. */
export const SHORTLIST_SIZE = 3;

const statusOf = (view: LocalModelsView, modelId: string): CatalogModelStatus | undefined =>
  view.statuses.find((s) => s.modelId === modelId);

/** Models of one role the pinned llama.cpp build can load at all. */
export function supportedModels(view: LocalModelsView, role: ModelRole): CatalogModel[] {
  return view.catalog.models.filter((m) => m.role === role && statusOf(view, m.id)?.runtimeSupported === true);
}

/** …and of those, the ones whose stated minimum fits the RAM this machine reports. */
export function fittingModels(view: LocalModelsView, role: ModelRole): CatalogModel[] {
  return supportedModels(view, role).filter((m) => statusOf(view, m.id)?.fitsRam === true);
}

/**
 * What the wizard offers for a role: the models that fit, or — when none do —
 * everything the runtime supports, so a small machine sees an honest (warned)
 * list rather than an empty screen. `noneFit` drives the steer-to-cloud copy.
 */
export function modelPool(view: LocalModelsView, role: ModelRole): { models: CatalogModel[]; noneFit: boolean } {
  const fitting = fittingModels(view, role);
  if (fitting.length > 0) return { models: fitting, noneFit: false };
  const supported = supportedModels(view, role);
  return { models: supported, noneFit: supported.length > 0 };
}

/**
 * Shortlist order: the hardware tier's own recommendation first, then
 * tool-callers (the Digital Twin needs one), then larger models. Deliberately
 * mirrors modelCatalogService.computeHardwareTier's ranking so the wizard can
 * never contradict the recommendation it is displaying.
 */
export function rankForShortlist(recommended: ReadonlySet<string>): (a: CatalogModel, b: CatalogModel) => number {
  return (a, b) =>
    Number(recommended.has(b.id)) - Number(recommended.has(a.id)) ||
    Number(b.toolCalling) - Number(a.toolCalling) ||
    b.minRamGB - a.minRamGB ||
    a.id.localeCompare(b.id);
}

/**
 * Whether a tool-calling chat model is actually reachable.
 *
 * `filtered-out` is the collision this phase must not paper over: under 16 GB of
 * RAM the only tool-calling built-in model is Qwen3 4B, which is Chinese-origin —
 * exactly what an origin policy filter may exclude. The excluded models are
 * returned so the UI can name them instead of vaguely hinting.
 */
export type ToolCallingVerdict = { kind: 'ok' } | { kind: 'filtered-out'; excluded: CatalogModel[] } | { kind: 'none' };

export function toolCallingVerdict(pool: CatalogModel[], visible: CatalogModel[]): ToolCallingVerdict {
  if (visible.some((m) => m.toolCalling)) return { kind: 'ok' };
  const excluded = pool.filter((m) => m.toolCalling);
  return excluded.length > 0 ? { kind: 'filtered-out', excluded } : { kind: 'none' };
}

/** One downloaded GGUF — the only kind the built-in runtime can actually serve. */
export interface RoutableModel {
  /**
   * Runtime model id as derived by the shared `runtimeModelIdForUrl` helper in
   * the main process (modelCatalogService.fileStatuses). Never re-derived here —
   * same rule TaskModelConfig follows.
   */
  id: string;
  label: string;
  toolCalling: boolean;
}

/** Downloaded files of one role, in catalog order. */
export function routableModels(view: LocalModelsView, role: ModelRole): RoutableModel[] {
  const out: RoutableModel[] = [];
  for (const model of view.catalog.models) {
    if (model.role !== role) continue;
    for (const file of statusOf(view, model.id)?.files ?? []) {
      if (!file.downloaded) continue;
      out.push({ id: file.runtimeModelId, label: model.displayName, toolCalling: model.toolCalling });
    }
  }
  return out;
}

/** The explicit pick the wizard hands back once its file is on disk. */
export interface BuiltinAssignment {
  /** Runtime id of the chat model the user chose. */
  chatModelId: string;
  /** Runtime id of a downloaded embedding model, when the user got one. */
  embeddingModelId?: string;
}

/**
 * The `ai.taskModels` entries the built-in path writes — merged over whatever is
 * already stored, never replacing it.
 *
 * Only `live_assistant` and `embedding` are set on purpose: resolveTaskModel
 * (ai-provider.ts) inherits `live_assistant`'s config for EVERY other chat-class
 * task — live_triage, twin_interview, twin_learning, knowledge_qa, summarization,
 * and the rest of AITaskType, excluding only `embedding` (its own row, set above)
 * and `transcription` (not an LLM task) — so writing all fifteen rows here would
 * add no routing while silently overwriting assignments a returning user may
 * have made themselves.
 */
export function builtinTaskModelPatch(
  providerId: string,
  pick: BuiltinAssignment,
): Partial<Record<AITaskType, TaskModelConfig>> {
  const patch: Partial<Record<AITaskType, TaskModelConfig>> = {
    live_assistant: { providerId, model: pick.chatModelId },
  };
  if (pick.embeddingModelId) patch.embedding = { providerId, model: pick.embeddingModelId };
  return patch;
}
