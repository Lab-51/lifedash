// Test fixture for the wizard's built-in-AI branch.
//
// Built from the REAL shipped catalog (catalog/models.json) rather than invented
// models, because the collision this branch has to handle honestly — under 16 GB
// of RAM the only tool-calling built-in model is Chinese-origin — is a property
// of the actual catalog. A synthetic fixture could make that problem disappear.
//
// Not a *.test.ts file, so vitest imports it without trying to run it.

import bundledCatalog from '../../../../../catalog/models.json';
import type {
  CatalogModel,
  HardwareTier,
  LocalModelDownloadProgress,
  LocalModelsView,
} from '../../../../shared/types/localModels';
import { fileNameForUrl, runtimeModelIdForUrl } from '../../../../shared/types/localModels';

export const CATALOG_MODELS = bundledCatalog.models as CatalogModel[];

/** The runtime model id a catalog entry becomes on disk (shared helper, not re-derived). */
export function runtimeIdOf(modelId: string): string {
  const model = CATALOG_MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error(`No such catalog model: ${modelId}`);
  return runtimeModelIdForUrl(model.files[0].url);
}

/** Mirrors modelCatalogService.computeHardwareTier's ranking. */
const rank = (a: CatalogModel, b: CatalogModel) =>
  Number(b.toolCalling) - Number(a.toolCalling) || b.minRamGB - a.minRamGB || a.id.localeCompare(b.id);

export interface ViewOptions {
  totalRamGB?: number;
  gpuSignal?: HardwareTier['gpuSignal'];
  /** Catalog model ids whose file is already on disk. */
  downloaded?: string[];
  downloads?: LocalModelDownloadProgress[];
}

export function makeView({
  totalRamGB = 32,
  gpuSignal = 'vulkan',
  downloaded = [],
  downloads = [],
}: ViewOptions = {}): LocalModelsView {
  const eligible = CATALOG_MODELS.filter((m) => m.minRamGB <= totalRamGB);
  const recommendedModelIds = [
    eligible.filter((m) => m.role === 'chat').sort(rank)[0]?.id,
    eligible.filter((m) => m.role === 'embedding').sort(rank)[0]?.id,
  ].filter((id): id is string => !!id);

  return {
    catalog: { catalogVersion: 1, updatedAt: '2026-08-01T00:00:00.000Z', models: CATALOG_MODELS },
    source: 'bundled',
    fetchedAt: '2026-08-01T00:00:00.000Z',
    tier: { totalRamGB, platform: 'win32', gpuSignal, recommendedModelIds },
    statuses: CATALOG_MODELS.map((m) => ({
      modelId: m.id,
      runtimeSupported: true,
      recommended: recommendedModelIds.includes(m.id),
      fitsRam: m.minRamGB <= totalRamGB,
      downloaded: downloaded.includes(m.id),
      files: m.files.map((f) => ({
        quant: f.quant,
        fileName: fileNameForUrl(f.url),
        runtimeModelId: runtimeModelIdForUrl(f.url),
        sizeBytes: f.sizeBytes,
        downloaded: downloaded.includes(m.id),
      })),
    })),
    downloads,
    modelsDir: 'C:\\Users\\test\\AppData\\Roaming\\LifeDash\\llm-models',
    pinnedRuntimeTag: 'b10219',
  };
}

/** `checkBuiltinRuntime` payload for a present-but-idle runtime. */
export const IDLE_RUNTIME = {
  binaryPresent: true,
  modelsDir: 'C:\\models',
  models: [] as string[],
  runtime: {
    running: false,
    backend: null,
    binaryAvailable: true,
    loadedModels: [] as string[],
    chat: { running: false, starting: false, modelId: null, baseUrl: null, pid: null, lastUsedAt: null, crashes: 0 },
    embedding: {
      running: false,
      starting: false,
      modelId: null,
      baseUrl: null,
      pid: null,
      lastUsedAt: null,
      crashes: 0,
    },
    idleStopMinutes: 15,
  },
};

/** `getRuntimeSnapshot` / `ai:runtime-status` payload (LOCAL-RT.2) for a
 *  present-but-idle runtime — reuses `IDLE_RUNTIME.runtime` so the two fixtures
 *  can never disagree about the underlying process state. */
export const IDLE_SNAPSHOT = {
  configured: false,
  binaryPresent: true,
  runtime: IDLE_RUNTIME.runtime,
  telemetry: { latest: null, byModel: {}, context: null },
};
