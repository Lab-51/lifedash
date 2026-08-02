// Tests for the local-model catalog service (LOCAL-RT.1 Task 3).
//
// Two jobs here. First, guard the SHIPPED catalog/models.json: it is imported for
// real, zod-validated, and checked against the Task 2 filename<->role invariant, so a
// bad edit fails CI instead of a user's multi-GB download. Second, cover load-order
// fallback, hardware tiering and minRuntimeTag gating.
//
// The real fetch is stubbed (no network in unit tests) and electron/whisper are
// mocked; the filesystem is real, inside LIFEDASH_LLAMA_MODELS_DIR.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The shipped catalog, imported exactly as the app bundles it.
import realCatalogJson from '../../../../catalog/models.json';
import { modelCatalogSchema } from '../../../shared/validation/localModelSchemas';
import { fileNameForUrl, inferredRoleForFileName, runtimeModelIdForUrl } from '../../../shared/types/localModels';
import type { CatalogModel, ModelCatalog } from '../../../shared/types/localModels';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-cat-'));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => tmpRoot, getPath: () => tmpRoot },
}));
// getBackend() is whisper's observed GPU signal — the only hardware input we reuse.
vi.mock('../whisperModelManager', () => ({ getBackend: () => 'vulkan' }));

const modelsDir = path.join(tmpRoot, 'llm-models');
process.env.LIFEDASH_LLAMA_MODELS_DIR = modelsDir;

type CatalogService = typeof import('../modelCatalogService');
let svc: CatalogService;

const cachePath = (): string => path.join(modelsDir, 'catalog-cache.json');

function makeModel(over: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: 'test-model',
    displayName: 'Test Model',
    vendor: 'Test',
    originCountry: 'US',
    license: 'Apache-2.0',
    role: 'chat',
    parameters: '7B',
    files: [
      { quant: 'Q4_K_M', url: 'https://example.com/test-model-Q4_K_M.gguf', sha256: 'a'.repeat(64), sizeBytes: 100 },
    ],
    minRamGB: 16,
    languages: ['en'],
    toolCalling: true,
    contextLength: 8192,
    ...over,
  };
}

const makeCatalog = (models: CatalogModel[]): ModelCatalog => ({
  catalogVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  models,
});

function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

const okResponse = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body }) as unknown;

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(modelsDir, { recursive: true, force: true });
  fs.mkdirSync(modelsDir, { recursive: true });
  svc = await import('../modelCatalogService');
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// --- The shipped catalog ------------------------------------------------------

describe('catalog/models.json (the real shipped file)', () => {
  const parsed = modelCatalogSchema.parse(realCatalogJson);

  it('validates against the ModelCatalog zod schema', () => {
    expect(parsed.models.length).toBeGreaterThan(0);
  });

  it('has a verified 64-hex sha256, a positive size and an https URL for every file', () => {
    for (const model of parsed.models) {
      for (const file of model.files) {
        expect(file.sha256, `${model.id}/${file.quant} sha256`).toMatch(/^[0-9a-f]{64}$/);
        expect(file.sizeBytes, `${model.id}/${file.quant} sizeBytes`).toBeGreaterThan(0);
        expect(file.url, `${model.id}/${file.quant} url`).toMatch(/^https:\/\//);
      }
    }
  });

  it('only names a language the vendor itself names — no inferring coverage from "140+ languages"', () => {
    // The `languages` field drives what a user reads before committing to a
    // multi-GB download, so a code here has to trace to an explicit vendor claim.
    //   Qwen3 — the official blog enumerates 119 languages and names Czech and
    //           Slovak among them, so cs/sk are legitimate.
    //   Gemma 3 — claims "140+ languages" but publishes no list, in either the HF
    //           card or Google's own docs, and its card concedes evaluations were
    //           English-only. Plausible is not the same as claimed: it stays ['*'].
    const langs = (id: string) => parsed.models.find((m) => m.id === id)?.languages ?? [];
    for (const id of ['qwen3-14b', 'qwen3-4b']) {
      expect(langs(id), `${id} should carry the vendor-named Slavic codes`).toEqual(
        expect.arrayContaining(['*', 'cs', 'sk']),
      );
    }
    for (const id of ['gemma-3-12b-it', 'gemma-3-4b-it']) {
      expect(langs(id), `${id}: Google names no individual languages — do not add any`).toEqual(['*']);
    }
  });

  it('agrees with llamaRuntimeConfig: a filename matches /embed/i IFF the model is an embedding model', () => {
    // Task 2 infers the role purely from the filename. A chat GGUF with "embed" in
    // its name would be served as an embedding model (and vice versa) with no error
    // anywhere — this assertion is the only thing standing between us and that.
    for (const model of parsed.models) {
      for (const file of model.files) {
        const fileName = fileNameForUrl(file.url);
        expect(inferredRoleForFileName(fileName), `${model.id} -> ${fileName}`).toBe(model.role);
      }
    }
  });

  it('produces unique catalog ids, filenames and runtime model ids', () => {
    const ids = parsed.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const runtimeIds = parsed.models.flatMap((m) => m.files.map((f) => runtimeModelIdForUrl(f.url).toLowerCase()));
    expect(new Set(runtimeIds).size).toBe(runtimeIds.length);
  });

  it('every file URL ends in .gguf and is pinned to an immutable revision', () => {
    for (const model of parsed.models) {
      for (const file of model.files) {
        expect(fileNameForUrl(file.url)).toMatch(/\.gguf$/i);
        // Pinned to a 40-char commit sha, not `main`, so the bytes behind the URL
        // can never change out from under the recorded sha256.
        expect(file.url, `${model.id} revision`).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      }
    }
  });

  it('ships at least one embedding model and chat models from more than one country', () => {
    expect(parsed.models.some((m) => m.role === 'embedding')).toBe(true);
    const origins = new Set(parsed.models.filter((m) => m.role === 'chat').map((m) => m.originCountry));
    expect(origins.size).toBeGreaterThanOrEqual(3);
    // A low-RAM option must exist or 8-16 GB machines see an empty recommendation.
    expect(parsed.models.some((m) => m.role === 'chat' && m.minRamGB <= 8)).toBe(true);
  });

  it('is the catalog the service returns when nothing else is available', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });
    const resolved = await svc.loadCatalog();
    expect(resolved.source).toBe('bundled');
    expect(resolved.catalog.models.map((m) => m.id)).toEqual(parsed.models.map((m) => m.id));
  });
});

// --- Load order and sync safety ----------------------------------------------

describe('modelCatalogService — load order', () => {
  it('prefers a fresh cache without touching the network', async () => {
    const cached = makeCatalog([makeModel({ id: 'cached-model' })]);
    fs.writeFileSync(cachePath(), JSON.stringify({ fetchedAt: new Date().toISOString(), catalog: cached }));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const resolved = await svc.loadCatalog();
    expect(resolved.source).toBe('cache');
    expect(resolved.catalog.models[0].id).toBe('cached-model');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the remote catalog when the cache is stale, and rewrites the cache', async () => {
    const stale = makeCatalog([makeModel({ id: 'stale-model' })]);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(cachePath(), JSON.stringify({ fetchedAt: old, catalog: stale }));
    const remote = makeCatalog([makeModel({ id: 'remote-model' })]);
    stubFetch(okResponse(remote) as () => Promise<unknown>);

    const resolved = await svc.loadCatalog();
    expect(resolved.source).toBe('remote');
    expect(resolved.catalog.models[0].id).toBe('remote-model');
    expect(JSON.parse(fs.readFileSync(cachePath(), 'utf-8')).catalog.models[0].id).toBe('remote-model');
  });

  it('falls back to the bundled snapshot when the remote fetch fails', async () => {
    stubFetch(async () => {
      throw new Error('ENOTFOUND');
    });
    const resolved = await svc.loadCatalog({ force: true });
    expect(resolved.source).toBe('bundled');
    expect(resolved.catalog.models.length).toBeGreaterThan(0);
  });

  it('falls back to the bundled snapshot on a non-200 remote response', async () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown);
    const resolved = await svc.loadCatalog({ force: true });
    expect(resolved.source).toBe('bundled');
  });

  it('rejects a malformed remote manifest instead of accepting it', async () => {
    stubFetch(okResponse({ catalogVersion: 'one', models: 'nope' }) as () => Promise<unknown>);
    const resolved = await svc.loadCatalog({ force: true });
    expect(resolved.source).toBe('bundled');
    expect(resolved.catalog.models.length).toBeGreaterThan(0);
  });

  // Standing project rule: an empty/failed remote is never "these models were removed".
  it('treats an empty remote model list as a bad response and keeps the cached catalog', async () => {
    const cached = makeCatalog([makeModel({ id: 'still-here' })]);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(cachePath(), JSON.stringify({ fetchedAt: old, catalog: cached }));
    stubFetch(okResponse(makeCatalog([])) as () => Promise<unknown>);

    const resolved = await svc.loadCatalog();
    expect(resolved.source).toBe('cache');
    expect(resolved.catalog.models[0].id).toBe('still-here');
  });

  it('never deletes downloaded model files when the remote catalog fails', async () => {
    const downloaded = path.join(modelsDir, 'Qwen3-4B-Q4_K_M.gguf');
    fs.writeFileSync(downloaded, 'weights');
    stubFetch(async () => {
      throw new Error('offline');
    });

    await svc.loadCatalog({ force: true });
    await svc.getLocalModelsView({ force: true });
    expect(fs.existsSync(downloaded)).toBe(true);
  });

  it('ignores a corrupt cache file rather than throwing', async () => {
    fs.writeFileSync(cachePath(), '{not json');
    stubFetch(async () => {
      throw new Error('offline');
    });
    const resolved = await svc.loadCatalog();
    expect(resolved.source).toBe('bundled');
  });
});

// --- Hardware tiering ---------------------------------------------------------

describe('modelCatalogService — hardware tier', () => {
  const catalog = makeCatalog([
    makeModel({ id: 'tiny', minRamGB: 8, toolCalling: true }),
    makeModel({ id: 'mid', minRamGB: 16, toolCalling: true }),
    makeModel({ id: 'large', minRamGB: 32, toolCalling: true }),
    makeModel({
      id: 'embed',
      role: 'embedding',
      minRamGB: 4,
      toolCalling: false,
      files: [{ quant: 'Q8_0', url: 'https://example.com/embed-Q8_0.gguf', sha256: 'b'.repeat(64), sizeBytes: 10 }],
    }),
  ]);

  const withRam = (gb: number): void => {
    vi.spyOn(os, 'totalmem').mockReturnValue(gb * 1024 ** 3);
  };

  it('recommends the largest fitting chat model plus an embedding model on a 16 GB machine', () => {
    withRam(16);
    const tier = svc.computeHardwareTier(catalog);
    expect(tier.totalRamGB).toBe(16);
    expect(tier.recommendedModelIds).toEqual(['mid', 'embed']);
  });

  it('drops to the small model on an 8 GB machine', () => {
    withRam(8);
    expect(svc.computeHardwareTier(catalog).recommendedModelIds).toEqual(['tiny', 'embed']);
  });

  it('reaches the largest model on a 32 GB machine', () => {
    withRam(32);
    expect(svc.computeHardwareTier(catalog).recommendedModelIds).toEqual(['large', 'embed']);
  });

  it('recommends nothing when no model fits, rather than suggesting one that will not run', () => {
    withRam(2);
    expect(svc.computeHardwareTier(catalog).recommendedModelIds).toEqual([]);
  });

  it('prefers a tool-calling model over a larger one without tool calling', () => {
    withRam(32);
    const mixed = makeCatalog([
      makeModel({ id: 'big-no-tools', minRamGB: 32, toolCalling: false }),
      makeModel({ id: 'smaller-with-tools', minRamGB: 16, toolCalling: true }),
    ]);
    expect(svc.computeHardwareTier(mixed).recommendedModelIds).toEqual(['smaller-with-tools']);
  });

  it('reports the platform and whisper GPU signal', () => {
    withRam(16);
    const tier = svc.computeHardwareTier(catalog);
    expect(tier.platform).toBe(process.platform);
    expect(tier.gpuSignal).toBe('vulkan');
  });

  it('computes a plausible tier from the real machine and the real catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const view = await svc.getLocalModelsView();
    expect(view.tier.totalRamGB).toBeGreaterThan(0);
    expect(['vulkan', 'cuda', 'metal', 'cpu', 'unknown']).toContain(view.tier.gpuSignal);
    expect(view.pinnedRuntimeTag).toBe('b10219');
  });
});

// --- minRuntimeTag gating -----------------------------------------------------

describe('modelCatalogService — minRuntimeTag gating', () => {
  it('allows a model with no minRuntimeTag', () => {
    expect(svc.runtimeSupport(makeModel()).supported).toBe(true);
  });

  it('allows a requirement at or below the pinned tag', () => {
    expect(svc.runtimeSupport(makeModel({ minRuntimeTag: 'b10219' })).supported).toBe(true);
    expect(svc.runtimeSupport(makeModel({ minRuntimeTag: 'b9000' })).supported).toBe(true);
  });

  it('blocks a requirement newer than the pinned tag, with a reason instead of a spawn failure', () => {
    const support = svc.runtimeSupport(makeModel({ minRuntimeTag: 'b99999' }));
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/b99999/);
    expect(support.reason).toMatch(/b10219/);
  });

  it('treats an unparseable tag as unmet rather than assuming compatibility', () => {
    expect(svc.runtimeSupport(makeModel({ minRuntimeTag: 'latest' })).supported).toBe(false);
  });

  it('excludes gated models from recommendations and marks them in the status list', () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(64 * 1024 ** 3);
    const catalog = makeCatalog([makeModel({ id: 'future', minRuntimeTag: 'b99999' }), makeModel({ id: 'usable' })]);
    const tier = svc.computeHardwareTier(catalog);
    expect(tier.recommendedModelIds).toEqual(['usable']);

    const statuses = svc.computeStatuses(catalog, tier);
    const future = statuses.find((s) => s.modelId === 'future')!;
    expect(future.runtimeSupported).toBe(false);
    expect(future.unavailableReason).toContain('b99999');
  });
});

// --- Status projection --------------------------------------------------------

describe('modelCatalogService — download status', () => {
  it('marks a model downloaded when its GGUF is present in the models dir', () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 ** 3);
    fs.writeFileSync(path.join(modelsDir, 'test-model-Q4_K_M.gguf'), 'weights');
    const catalog = makeCatalog([makeModel()]);
    const statuses = svc.computeStatuses(catalog, svc.computeHardwareTier(catalog));

    expect(statuses[0].downloaded).toBe(true);
    expect(statuses[0].files[0].fileName).toBe('test-model-Q4_K_M.gguf');
    expect(statuses[0].files[0].runtimeModelId).toBe('test-model-Q4_K_M');
  });

  it('reports not-downloaded and the RAM fit flag when the file is absent', () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 ** 3);
    const catalog = makeCatalog([makeModel({ minRamGB: 32 })]);
    const statuses = svc.computeStatuses(catalog, svc.computeHardwareTier(catalog));
    expect(statuses[0].downloaded).toBe(false);
    expect(statuses[0].fitsRam).toBe(false);
  });
});

// --- Custom GGUFs -------------------------------------------------------------

describe('modelCatalogService — custom GGUF registration', () => {
  const stubOffline = (): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
  };

  it('registers a local file, links it into the models dir and merges it into the view', async () => {
    stubOffline();
    const source = path.join(tmpRoot, 'my-custom-model.gguf');
    fs.writeFileSync(source, 'custom weights');

    const model = await svc.registerCustomModel({ displayName: 'My Model', filePath: source, role: 'chat' });
    expect(model.vendor).toBe('custom');
    expect(model.originCountry).toBe('unknown');
    expect(model.license).toBe('unknown');
    expect(fs.existsSync(path.join(modelsDir, 'my-custom-model.gguf'))).toBe(true);

    const view = await svc.getLocalModelsView();
    expect(view.catalog.models.some((m) => m.id === model.id)).toBe(true);
    expect(view.statuses.find((s) => s.modelId === model.id)?.downloaded).toBe(true);
  });

  it('registers a direct URL without downloading anything yet', async () => {
    stubOffline();
    const model = await svc.registerCustomModel({
      displayName: 'Remote Custom',
      url: 'https://example.com/some-model-Q4_K_M.gguf',
      role: 'chat',
    });
    expect(model.files[0].sha256).toBe(''); // unknown hash: computed and reported, not enforced
    expect(fs.existsSync(path.join(modelsDir, 'some-model-Q4_K_M.gguf'))).toBe(false);
  });

  it('rejects a filename whose /embed/i match contradicts the declared role', async () => {
    stubOffline();
    await expect(
      svc.registerCustomModel({ displayName: 'Bad', url: 'https://example.com/my-embed-model.gguf', role: 'chat' }),
    ).rejects.toThrow(/embed/i);
    await expect(
      svc.registerCustomModel({ displayName: 'Bad', url: 'https://example.com/plain-chat.gguf', role: 'embedding' }),
    ).rejects.toThrow(/embed/i);
  });

  it('rejects a non-gguf file', async () => {
    stubOffline();
    await expect(
      svc.registerCustomModel({ displayName: 'Bad', url: 'https://example.com/model.bin', role: 'chat' }),
    ).rejects.toThrow(/\.gguf/);
  });

  it('unregisters a custom entry without deleting the model file', async () => {
    stubOffline();
    const source = path.join(tmpRoot, 'removable-model.gguf');
    fs.writeFileSync(source, 'weights');
    const model = await svc.registerCustomModel({ displayName: 'Removable', filePath: source, role: 'chat' });

    expect(await svc.unregisterCustomModel(model.id)).toBe(true);
    expect(await svc.unregisterCustomModel(model.id)).toBe(false);
    expect(fs.existsSync(path.join(modelsDir, 'removable-model.gguf'))).toBe(true);
  });
});

// --- findCatalogFile ----------------------------------------------------------

describe('modelCatalogService — findCatalogFile', () => {
  it('resolves a real catalog entry by id and by id+quant, and returns null otherwise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const first = modelCatalogSchema.parse(realCatalogJson).models[0];
    const byId = await svc.findCatalogFile(first.id);
    expect(byId?.file.url).toBe(first.files[0].url);
    expect(await svc.findCatalogFile(first.id, first.files[0].quant)).not.toBeNull();
    expect(await svc.findCatalogFile(first.id, 'no-such-quant')).toBeNull();
    expect(await svc.findCatalogFile('no-such-model')).toBeNull();
  });
});
