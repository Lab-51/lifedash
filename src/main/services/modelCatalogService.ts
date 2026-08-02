// === FILE PURPOSE ===
// Resolves the local-model catalog (cached remote -> GitHub raw -> bundled snapshot),
// computes a v1 hardware tier from total RAM + platform + whisper's GPU signal, gates
// entries whose minRuntimeTag exceeds the pinned llama.cpp build, and stores
// user-registered custom GGUFs. Read-only with respect to model files.
//
// === DEPENDENCIES ===
// node:fs, node:os, node:path, global fetch, zod (via localModelSchemas),
// ./llamaRuntimeConfig (getModelsDir/listAvailableModels — Task 2 helpers, reused),
// ./whisperModelManager (getBackend — the existing GPU signal)
//
// === SYNC SAFETY (standing project rule) ===
// A failed, timed-out, malformed, or empty remote catalog NEVER means "these models
// no longer exist". Every failure path degrades to the cached copy and then to the
// bundled snapshot, and no code path here deletes a downloaded model file.
//
// === LIMITATIONS ===
// - Tiering uses total system RAM, not VRAM. A VRAM probe was deliberately deferred
//   as unverified, so recommendation copy must stay hedged.
// - Nothing here runs at boot: the first call is a user opening Settings → Local AI.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getModelsDir, listAvailableModels } from './llamaRuntimeConfig';
import { getBackend } from './whisperModelManager';
import { modelCatalogSchema } from '../../shared/validation/localModelSchemas';
import bundledCatalogJson from '../../../catalog/models.json';
import {
  fileNameForUrl,
  runtimeModelIdForUrl,
  type CatalogFileStatus,
  type CatalogModel,
  type CatalogModelStatus,
  type HardwareTier,
  type LocalModelsView,
  type ModelCatalog,
  type RegisterCustomModelInput,
  type ResolvedCatalog,
} from '../../shared/types/localModels';

export type { RegisterCustomModelInput };

/** Repo-versioned catalog on the default branch. Public repo — verified serving raw at curation time. */
const REMOTE_CATALOG_URL = 'https://raw.githubusercontent.com/Lab-51/lifedash/main/catalog/models.json';
const REMOTE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = 'catalog-cache.json';
const CUSTOM_FILE = 'custom-models.json';

/** The llama.cpp release Task 1 pinned and Task 2 ships. minRuntimeTag is compared to this. */
export const PINNED_RUNTIME_TAG = 'b10219';

const cachePath = (): string => path.join(getModelsDir(), CACHE_FILE);
const customPath = (): string => path.join(getModelsDir(), CUSTOM_FILE);

// --- Sources ------------------------------------------------------------------

let bundledMemo: ModelCatalog | null = null;

/** The snapshot compiled into the app. Parsed once, lazily — never at import time. */
export function bundledCatalog(): ModelCatalog {
  if (!bundledMemo) bundledMemo = modelCatalogSchema.parse(bundledCatalogJson);
  return bundledMemo;
}

interface CacheEnvelope {
  fetchedAt: string;
  catalog: unknown;
}

function readCache(): { catalog: ModelCatalog; fetchedAt: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8')) as CacheEnvelope;
    const parsed = modelCatalogSchema.safeParse(raw.catalog);
    if (!parsed.success || parsed.data.models.length === 0) return null;
    return { catalog: parsed.data, fetchedAt: raw.fetchedAt };
  } catch {
    return null;
  }
}

async function writeCache(catalog: ModelCatalog, fetchedAt: string): Promise<void> {
  try {
    await fsp.mkdir(getModelsDir(), { recursive: true });
    await fsp.writeFile(cachePath(), JSON.stringify({ fetchedAt, catalog } satisfies CacheEnvelope), 'utf-8');
  } catch {
    // A read-only or full disk must not break catalog browsing.
  }
}

/** Fetch + validate the remote catalog. Returns null on ANY failure — never throws. */
async function fetchRemote(): Promise<ModelCatalog | null> {
  try {
    const res = await fetch(REMOTE_CATALOG_URL, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const parsed = modelCatalogSchema.safeParse(await res.json());
    // An empty model list is treated as a bad response, not as "everything was removed".
    if (!parsed.success || parsed.data.models.length === 0) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Resolve the catalog. Order: fresh cache (< 24h) -> remote -> stale cache -> bundled.
 * `force` skips the freshness short-circuit but keeps every fallback intact.
 */
export async function loadCatalog(options: { force?: boolean } = {}): Promise<ResolvedCatalog> {
  const cached = readCache();
  if (!options.force && cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
    return { catalog: cached.catalog, source: 'cache', fetchedAt: cached.fetchedAt };
  }
  const remote = await fetchRemote();
  if (remote) {
    const fetchedAt = new Date().toISOString();
    await writeCache(remote, fetchedAt);
    return { catalog: remote, source: 'remote', fetchedAt };
  }
  if (cached) return { catalog: cached.catalog, source: 'cache', fetchedAt: cached.fetchedAt };
  const bundled = bundledCatalog();
  return { catalog: bundled, source: 'bundled', fetchedAt: bundled.updatedAt };
}

// --- Runtime gating -----------------------------------------------------------

/** llama.cpp release tags are `b<build>`; anything else is unparseable. */
function parseRuntimeTag(tag: string): number | null {
  const match = /^b(\d+)$/.exec(tag.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Whether the pinned runtime can load a model. An unparseable requirement is treated
 * as unmet: surfacing "needs a newer runtime" beats letting llama-server fail at spawn.
 */
export function runtimeSupport(model: CatalogModel): { supported: boolean; reason?: string } {
  if (!model.minRuntimeTag) return { supported: true };
  const required = parseRuntimeTag(model.minRuntimeTag);
  const pinned = parseRuntimeTag(PINNED_RUNTIME_TAG);
  if (required !== null && pinned !== null && pinned >= required) return { supported: true };
  return {
    supported: false,
    reason: `Needs llama.cpp ${model.minRuntimeTag}; this build ships ${PINNED_RUNTIME_TAG}.`,
  };
}

// --- Hardware tier ------------------------------------------------------------

const GPU_SIGNALS = ['vulkan', 'cuda', 'metal', 'cpu'] as const;

function gpuSignal(): HardwareTier['gpuSignal'] {
  const backend = getBackend();
  return (GPU_SIGNALS as readonly string[]).includes(backend) ? (backend as HardwareTier['gpuSignal']) : 'unknown';
}

/**
 * v1 tiering: total system RAM + platform + whisper's observed backend. Produces a
 * *recommendation* only — per the phase decision there is no silent default model and
 * nothing is ever auto-downloaded. Picks the strongest chat model that fits (tool
 * calling first, since the twin needs it) plus the best embedding model that fits.
 */
export function computeHardwareTier(catalog: ModelCatalog): HardwareTier {
  const totalRamGB = Math.round(os.totalmem() / 1024 ** 3);
  const eligible = catalog.models.filter((m) => m.minRamGB <= totalRamGB && runtimeSupport(m).supported);
  const rank = (a: CatalogModel, b: CatalogModel): number =>
    Number(b.toolCalling) - Number(a.toolCalling) || b.minRamGB - a.minRamGB || a.id.localeCompare(b.id);
  const bestChat = eligible.filter((m) => m.role === 'chat').sort(rank)[0];
  const bestEmbedding = eligible.filter((m) => m.role === 'embedding').sort(rank)[0];
  return {
    totalRamGB,
    platform: process.platform,
    gpuSignal: gpuSignal(),
    recommendedModelIds: [bestChat?.id, bestEmbedding?.id].filter((id): id is string => !!id),
  };
}

// --- Per-model status ---------------------------------------------------------

function fileStatuses(model: CatalogModel, downloadedIds: Set<string>): CatalogFileStatus[] {
  return model.files.map((f) => {
    const runtimeModelId = runtimeModelIdForUrl(f.url);
    return {
      quant: f.quant,
      fileName: fileNameForUrl(f.url),
      runtimeModelId,
      sizeBytes: f.sizeBytes,
      downloaded: downloadedIds.has(runtimeModelId.toLowerCase()),
    };
  });
}

/** Availability, RAM fit, recommendation flag and per-quant install state for each model. */
export function computeStatuses(catalog: ModelCatalog, tier: HardwareTier): CatalogModelStatus[] {
  const downloadedIds = new Set(listAvailableModels().map((m) => m.id.toLowerCase()));
  const recommended = new Set(tier.recommendedModelIds);
  return catalog.models.map((model) => {
    const support = runtimeSupport(model);
    const files = fileStatuses(model, downloadedIds);
    return {
      modelId: model.id,
      runtimeSupported: support.supported,
      unavailableReason: support.reason,
      recommended: recommended.has(model.id),
      fitsRam: model.minRamGB <= tier.totalRamGB,
      downloaded: files.some((f) => f.downloaded),
      files,
    };
  });
}

// --- Custom GGUFs -------------------------------------------------------------

function readCustomModels(): CatalogModel[] {
  try {
    const parsed = modelCatalogSchema.safeParse(JSON.parse(fs.readFileSync(customPath(), 'utf-8')));
    return parsed.success ? parsed.data.models : [];
  } catch {
    return [];
  }
}

async function writeCustomModels(models: CatalogModel[]): Promise<void> {
  await fsp.mkdir(getModelsDir(), { recursive: true });
  const doc: ModelCatalog = { catalogVersion: 1, updatedAt: new Date().toISOString(), models };
  await fsp.writeFile(customPath(), JSON.stringify(doc, null, 2), 'utf-8');
}

/**
 * Build the CatalogModel for a user-supplied GGUF. Provenance is honestly unknown, so
 * vendor is 'custom' and origin/license are 'unknown'; size-dependent fields stay 0
 * ("unknown") rather than being guessed.
 *
 * The filename must agree with llamaRuntimeConfig's `/embed/i` role inference or the
 * runtime would serve it under the wrong role — that is rejected here, not at spawn.
 */
export async function registerCustomModel(input: RegisterCustomModelInput): Promise<CatalogModel> {
  const sourceName = input.filePath ? path.basename(input.filePath) : fileNameForUrl(input.url ?? '');
  if (!sourceName.toLowerCase().endsWith('.gguf')) throw new Error('Custom models must be .gguf files.');
  const looksEmbedding = /embed/i.test(sourceName);
  if (looksEmbedding !== (input.role === 'embedding')) {
    throw new Error(
      input.role === 'embedding'
        ? `Embedding model filenames must contain "embed" — rename "${sourceName}" before adding it.`
        : `"${sourceName}" contains "embed", so the runtime would load it as an embedding model. Rename it or add it as an embedding model.`,
    );
  }

  let sizeBytes = 0;
  let url = input.url ?? '';
  if (input.filePath) {
    const st = await fsp.lstat(input.filePath);
    if (!st.isFile()) throw new Error('The selected path is not a file.');
    sizeBytes = st.size;
    await fsp.mkdir(getModelsDir(), { recursive: true });
    const dest = path.join(getModelsDir(), sourceName);
    if (path.resolve(dest) !== path.resolve(input.filePath)) {
      // Hard link first: instant and costs no extra disk on the same volume.
      // Falls back to a real copy across volumes or on filesystems without links.
      try {
        await fsp.link(input.filePath, dest);
      } catch {
        await fsp.copyFile(input.filePath, dest);
      }
    }
    url = `file://${path.resolve(dest).replace(/\\/g, '/')}`;
  }

  const model: CatalogModel = {
    id: `custom-${runtimeModelIdForUrl(url).toLowerCase()}`,
    displayName: input.displayName,
    vendor: 'custom',
    originCountry: 'unknown',
    license: 'unknown',
    role: input.role,
    parameters: 'unknown',
    files: [{ quant: 'custom', url, sha256: '', sizeBytes }],
    minRamGB: 0,
    languages: ['*'],
    toolCalling: false,
    contextLength: 0,
    notes: 'Added by you. Origin, license, context length and tool-calling support are unknown.',
  };

  const existing = readCustomModels().filter((m) => m.id !== model.id);
  await writeCustomModels([...existing, model]);
  return model;
}

/** Forget a custom entry. Never touches the GGUF itself — deletion is an explicit action. */
export async function unregisterCustomModel(modelId: string): Promise<boolean> {
  const existing = readCustomModels();
  const remaining = existing.filter((m) => m.id !== modelId);
  if (remaining.length === existing.length) return false;
  await writeCustomModels(remaining);
  return true;
}

// --- Composed view ------------------------------------------------------------

/** Everything Settings → Local AI needs, catalog + custom entries merged. */
export async function getLocalModelsView(
  options: { force?: boolean } = {},
): Promise<Omit<LocalModelsView, 'downloads'>> {
  const resolved = await loadCatalog(options);
  const merged: ModelCatalog = {
    ...resolved.catalog,
    models: [...resolved.catalog.models, ...readCustomModels()],
  };
  const tier = computeHardwareTier(merged);
  return {
    catalog: merged,
    source: resolved.source,
    fetchedAt: resolved.fetchedAt,
    tier,
    statuses: computeStatuses(merged, tier),
    modelsDir: getModelsDir(),
    pinnedRuntimeTag: PINNED_RUNTIME_TAG,
  };
}

/** Look up one catalog file by model id + quant (quant omitted = first offered). */
export async function findCatalogFile(
  modelId: string,
  quant?: string,
): Promise<{ model: CatalogModel; file: CatalogModel['files'][number] } | null> {
  const { catalog } = await getLocalModelsView();
  const model = catalog.models.find((m) => m.id === modelId);
  if (!model) return null;
  const file = quant ? model.files.find((f) => f.quant === quant) : model.files[0];
  return file ? { model, file } : null;
}

/** Test seam: drop the memoised bundled parse. */
export function __resetForTests(): void {
  bundledMemo = null;
}
