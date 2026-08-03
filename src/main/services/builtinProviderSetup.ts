// === FILE PURPOSE ===
// Makes a freshly downloaded GGUF actually usable, automatically. Before this,
// downloading a model created NO `builtin` provider row — only the setup wizard
// did — so the catalog dead-ended: nothing routed to the file, and the status
// indicator (which keys on that row) stayed silent. Deliberately downloading a
// specific multi-GB model IS an explicit act of intent, so the provider row is
// created for the user rather than asked for.
//
// === DEPENDENCIES ===
// db (aiProviders, settings), shared ai types. No renderer, no IPC, no spawning.
//
// === CONTRACT NOTES ===
// - NEVER overwrites an existing task assignment. Enabling a provider is purely
//   additive; re-pointing `live_assistant` at a new model is not — it would
//   silently steal a working setup (LM Studio, a cloud provider, or another
//   local model) on what the user experienced as "a download finished". Empty
//   slots are filled; occupied slots are left alone for the user to change in
//   Settings → Model Assignments or via EnableBuiltinCard.
// - Creating a row spawns NOTHING. The sidecar still starts only on a routed
//   request (LOCAL-RT.1's optionality contract is untouched).
// - Idempotent: safe to call after every download.

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiProviders, settings } from '../db/schema';
import { listAvailableModels } from './llamaRuntimeConfig';
import { inferredRoleForFileName } from '../../shared/types/localModels';
import type { AITaskType, TaskModelConfig } from '../../shared/types';
import type { ModelRole } from '../../shared/types/localModels';

const TASK_MODELS_KEY = 'ai.taskModels';

/** Which task slot a downloaded role fills when that slot is still empty.
 *  Only these two: resolveTaskModel inherits `live_assistant` for live_triage /
 *  twin_interview / twin_learning / knowledge_qa and falls back to the first
 *  enabled provider for the rest, so writing more rows would add no routing
 *  while overwriting more of the user's own choices. Same rule the wizard's
 *  `builtinTaskModelPatch` follows. */
const SLOT_FOR_ROLE: Record<ModelRole, AITaskType> = {
  chat: 'live_assistant' as AITaskType,
  embedding: 'embedding' as AITaskType,
};

/** Create the `builtin` row, or re-enable a disabled one. Returns its id and
 *  whether visibility changed (a new or newly-enabled row). */
async function ensureBuiltinProvider(): Promise<{ id: string; changed: boolean }> {
  const db = getDb();
  const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.name, 'builtin')).limit(1);

  if (existing) {
    if (existing.enabled) return { id: existing.id, changed: false };
    await db.update(aiProviders).set({ enabled: true }).where(eq(aiProviders.id, existing.id));
    return { id: existing.id, changed: true };
  }

  // `enabled` defaults to true in the schema; baseUrl stays null on purpose —
  // the built-in runtime's origin is per-spawn and resolved at request time.
  const [created] = await db
    .insert(aiProviders)
    .values({ name: 'builtin', displayName: 'Built-in AI', baseUrl: null })
    .returning({ id: aiProviders.id });
  return { id: created.id, changed: true };
}

/** Fill the role's task slot only if nothing is assigned to it yet. */
async function fillEmptySlot(providerId: string, role: ModelRole, runtimeModelId: string): Promise<boolean> {
  const db = getDb();
  const slot = SLOT_FOR_ROLE[role];
  const [row] = await db.select().from(settings).where(eq(settings.key, TASK_MODELS_KEY)).limit(1);

  let current: Record<string, TaskModelConfig> = {};
  if (row) {
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object') current = parsed as Record<string, TaskModelConfig>;
    } catch {
      // Unreadable value: treat as empty rather than destroying it — the write
      // below only adds this one key, so a malformed blob is replaced by a
      // valid one instead of being compounded.
    }
  }

  if (current[slot]) return false; // Occupied — the user's choice wins.

  const next = JSON.stringify({ ...current, [slot]: { providerId, model: runtimeModelId } });
  await db
    .insert(settings)
    .values({ key: TASK_MODELS_KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } });
  return true;
}

/**
 * Called when a download finishes. Ensures the built-in provider exists and is
 * enabled, and routes the model only into a slot the user has not already
 * filled. Returns true when something the UI cares about changed, so the caller
 * can push a fresh runtime snapshot.
 */
export async function activateBuiltinAfterDownload(runtimeModelId: string, role: ModelRole): Promise<boolean> {
  const { id, changed } = await ensureBuiltinProvider();
  const routed = await fillEmptySlot(id, role, runtimeModelId);
  return changed || routed;
}

/**
 * Startup reconciliation: models downloaded BEFORE auto-activation existed
 * would otherwise stay dead forever, since nothing re-runs on an old file.
 * Treats "a GGUF is already on disk" exactly like "a download just finished" —
 * same function, same never-overwrite rule.
 *
 * Runs only when a model file is actually present, so an install with no models
 * writes nothing. Reads the filesystem only; spawns nothing.
 */
export async function reconcileBuiltinFromDisk(): Promise<boolean> {
  const files = listAvailableModels();
  if (files.length === 0) return false;

  // `id` is already the runtime model id (the filename stem) — never re-derived
  // here, same rule the renderer follows. Chat first so `live_assistant` gets
  // the model a user is most likely to want, not whichever name sorts first.
  const ordered = [...files].sort(
    (a, b) =>
      Number(inferredRoleForFileName(a.file) === 'embedding') - Number(inferredRoleForFileName(b.file) === 'embedding'),
  );

  let changed = false;
  for (const { id, file } of ordered) {
    if (await activateBuiltinAfterDownload(id, inferredRoleForFileName(file))) changed = true;
  }
  return changed;
}
