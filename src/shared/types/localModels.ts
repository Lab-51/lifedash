// === FILE PURPOSE ===
// Shared contract for locally-run GGUF models: the model catalog shape, the
// hardware tier that drives recommendations, and download state. Consumed by the
// main-process catalog/download services, the local-models IPC, and the renderer's
// Settings → Local AI screen, so it must stay free of electron/node imports.
//
// === DEPENDENCIES ===
// None (pure types + two pure string helpers).
//
// === CONTRACT NOTES ===
// The block from ModelRole..LocalModelDownloadState is the frozen LOCAL-RT.1
// contract and is implemented verbatim; Tasks 4 and 5 code against it. Everything
// below the "Additive" heading is new surface, not a change to the frozen shapes.

export type ModelRole = 'chat' | 'embedding';
export interface CatalogModelFile {
  quant: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}
export interface CatalogModel {
  id: string; // stable slug, e.g. 'qwen3-14b'
  displayName: string;
  vendor: string; // 'Alibaba', 'Google', 'Microsoft', ...
  originCountry: string; // ISO 3166-1 alpha-2: 'CN', 'US', 'FR', ...
  license: string; // SPDX or vendor terms name: 'Apache-2.0', 'Gemma', ...
  role: ModelRole;
  parameters: string; // '14B', '300M'
  files: CatalogModelFile[]; // one entry per offered quant
  minRamGB: number; // tier gate (total system RAM, v1 heuristic)
  languages: string[]; // ISO 639-1 codes, ['*'] = broadly multilingual
  toolCalling: boolean; // load-bearing for the twin
  contextLength: number;
  minRuntimeTag?: string; // llama.cpp release tag required, if newer than pinned
  notes?: string;
}
export interface ModelCatalog {
  catalogVersion: number;
  updatedAt: string;
  models: CatalogModel[];
}
export interface HardwareTier {
  totalRamGB: number;
  platform: string;
  gpuSignal: 'vulkan' | 'cuda' | 'metal' | 'cpu' | 'unknown';
  recommendedModelIds: string[];
}
export type LocalModelDownloadState = 'queued' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'error';

// === Additive surface (new types, frozen shapes above are untouched) ===========

/**
 * Where a resolved catalog came from. A failed remote fetch degrades to 'cache'
 * and then 'bundled' — it never means "these models were removed".
 */
export type CatalogSource = 'remote' | 'cache' | 'bundled';

/** A resolved catalog plus the provenance the UI shows ("updated 3h ago"). */
export interface ResolvedCatalog {
  catalog: ModelCatalog;
  source: CatalogSource;
  fetchedAt: string;
}

/** Per-file download/installed state for one offered quant. */
export interface CatalogFileStatus {
  quant: string;
  fileName: string;
  /** Runtime model id this file becomes once downloaded (llama.cpp filename-stem convention). */
  runtimeModelId: string;
  sizeBytes: number;
  downloaded: boolean;
}

/** Whether a catalog model can be used on this machine, and why not if it can't. */
export interface CatalogModelStatus {
  modelId: string;
  /** False when minRuntimeTag is newer than the pinned llama.cpp build. */
  runtimeSupported: boolean;
  unavailableReason?: string;
  recommended: boolean;
  fitsRam: boolean;
  downloaded: boolean;
  files: CatalogFileStatus[];
}

/** Progress snapshot for one download; also the payload of the progress event. */
export interface LocalModelDownloadProgress {
  /** Stable job identity: `${catalogModelId}:${quant}`. */
  key: string;
  fileName: string;
  state: LocalModelDownloadState;
  receivedBytes: number;
  /** 0 until the server reports a length. */
  totalBytes: number;
  percent: number;
  bytesPerSecond: number;
  /** Set once verification succeeds — lets custom (unhashed) downloads report their hash. */
  sha256?: string;
  error?: string;
}

/** Input for registering a user-supplied GGUF (exactly one of filePath / url). */
export interface RegisterCustomModelInput {
  displayName: string;
  /** Absolute path to an existing local .gguf — linked (or copied) into the models dir. */
  filePath?: string;
  /** Direct .gguf URL — downloaded through modelDownloadService. */
  url?: string;
  role: ModelRole;
}

/** Everything Settings → Local AI needs in one IPC round trip. */
export interface LocalModelsView {
  catalog: ModelCatalog;
  source: CatalogSource;
  fetchedAt: string;
  tier: HardwareTier;
  statuses: CatalogModelStatus[];
  downloads: LocalModelDownloadProgress[];
  modelsDir: string;
  pinnedRuntimeTag: string;
}

// === Filename <-> model id derivation =========================================
// Task 2 froze two facts: models live in userData/llm-models as plain
// `<modelId>.gguf`, and the model id IS the filename stem. The catalog carries
// URLs, not filenames, so the mapping lives here — one place both processes agree
// on — rather than being re-derived per call site.

/** Final on-disk filename for a catalog file entry (last path segment of its URL). */
export function fileNameForUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0];
  const last = withoutQuery.split('/').pop() ?? '';
  return decodeURIComponent(last);
}

/** Runtime model id a downloaded file will be served under (its filename stem). */
export function runtimeModelIdForUrl(url: string): string {
  const name = fileNameForUrl(url);
  return name.toLowerCase().endsWith('.gguf') ? name.slice(0, -'.gguf'.length) : name;
}

/**
 * Role llamaRuntimeConfig will infer from a filename. Mirrors its
 * EMBEDDING_NAME_PATTERN exactly: an `/embed/i` hit means embedding, nothing else
 * is consulted. Catalog filenames must therefore agree with their declared role —
 * asserted over the whole bundled catalog by modelCatalogService's tests.
 */
export function inferredRoleForFileName(fileName: string): ModelRole {
  return /embed/i.test(fileName) ? 'embedding' : 'chat';
}
