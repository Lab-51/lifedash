// === FILE PURPOSE ===
// Which provider/model the SUMMARIZATION task (the meeting brief) is actually
// routed to, derived in the RENDERER from what the settings store already holds —
// no new IPC. Used by the wrap-up hero's "Writing your brief…" banner, which must
// name the engine so a multi-minute local run reads as working rather than hung.
//
// Pure and store-free on purpose: the routing rule is the interesting part and it
// deserves its own tests.
//
// === DEPENDENCIES ===
// shared AI types only.

import type { AIProvider, AITaskType, TaskModelConfig } from '../../shared/types';

/** The provider (and, when known, the model) the SUMMARIZATION task routes to. */
export interface SummarizationRoute {
  /** `displayName || name` — the same label Settings → Task models shows. */
  label: string;
  /** null when the route came from the first-enabled-provider fallback, whose
   *  default model name lives in a main-process-only table. */
  model: string | null;
}

/**
 * Mirror of main's `resolveTaskModel('summarization')`
 * (src/main/services/ai-provider.ts) for the two steps whose inputs the renderer
 * already has:
 *   1. `ai.taskModels.summarization`, falling back to `live_assistant`'s config
 *      when its own is unset (TASK_MODEL_FALLBACKS: every chat task inherits
 *      live_assistant), and only when that provider is still ENABLED;
 *   2. otherwise the first enabled provider.
 *
 * Step 2's model comes from main's private DEFAULT_MODELS table, so `model` is
 * null there and the caller must name the provider ALONE rather than guess.
 *
 * Returns null only when no provider is enabled — which is exactly the state in
 * which nothing will ever generate, so the caller must not promise anything.
 */
export function resolveSummarizationRoute(
  providers: AIProvider[],
  taskModelsJson: string | undefined,
): SummarizationRoute | null {
  let configured: Partial<Record<AITaskType, TaskModelConfig>> | null = null;
  try {
    if (taskModelsJson) configured = JSON.parse(taskModelsJson) as Partial<Record<AITaskType, TaskModelConfig>>;
  } catch {
    // Malformed JSON — fall through to the first-enabled-provider step, exactly
    // as resolveTaskModel does.
  }

  const entry = configured?.summarization ?? configured?.live_assistant;
  if (entry) {
    const provider = providers.find((p) => p.id === entry.providerId && p.enabled);
    if (provider) return { label: provider.displayName || provider.name, model: entry.model };
  }

  const fallback = providers.find((p) => p.enabled);
  return fallback ? { label: fallback.displayName || fallback.name, model: null } : null;
}
