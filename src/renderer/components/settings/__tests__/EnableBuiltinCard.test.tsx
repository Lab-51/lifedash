// @vitest-environment jsdom
// LOCAL-RT.2b: the download → dead-end gap. Downloading a GGUF from the Settings
// catalog created NO `builtin` provider row (only the setup wizard did), so the
// file sat on disk unrouted and — once the status-bar indicator shipped — the
// user had no visible signal either, because visibility keys on that row.
// These tests pin the four things this card can get wrong: showing when it
// shouldn't, offering an undownloaded model, duplicating a provider row the user
// already has, and clobbering task models the user set themselves.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CatalogModel, LocalModelsView } from '../../../../shared/types/localModels';
import type { LlamaRuntimeSnapshot } from '../../../../shared/types/ai';

const store = vi.hoisted(() => ({
  providers: [] as { id: string; name: string; enabled: boolean }[],
  createProvider: vi.fn(),
  updateProvider: vi.fn().mockResolvedValue(undefined),
  loadProviders: vi.fn().mockResolvedValue(undefined),
  getTaskModels: vi.fn(),
  setTaskModels: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

const getRuntimeSnapshot = vi.fn();
let runtimeStatusCb: ((s: LlamaRuntimeSnapshot) => void) | null = null;
const onRuntimeStatus = vi.fn((cb: (s: LlamaRuntimeSnapshot) => void) => {
  runtimeStatusCb = cb;
  return vi.fn();
});
vi.stubGlobal('electronAPI', { getRuntimeSnapshot, onRuntimeStatus });

const { default: EnableBuiltinCard } = await import('../local-ai/EnableBuiltinCard');

// --- Fixtures ----------------------------------------------------------------
function model(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    displayName: overrides.id,
    vendor: 'Vendor',
    originCountry: 'US',
    license: 'Apache-2.0',
    role: 'chat',
    parameters: '4B',
    files: [{ quant: 'Q4_K_M', url: `https://example.test/${overrides.id}.gguf`, sha256: 'x', sizeBytes: 1_000 }],
    minRamGB: 8,
    languages: ['*'],
    toolCalling: false,
    contextLength: 40960,
    ...overrides,
  };
}

const QWEN = model({ id: 'qwen3-4b', displayName: 'Qwen3 4B (Q4_K_M)', originCountry: 'CN', toolCalling: true });
const GEMMA = model({ id: 'gemma-3-12b-it', displayName: 'Gemma 3 12B Instruct (Q4_K_M)', toolCalling: false });
const EMBED = model({ id: 'embeddinggemma-300m', displayName: 'EmbeddingGemma 300M (Q8_0)', role: 'embedding' });

/** `downloaded` drives routability — only files on disk may be offered. */
function view(downloadedIds: string[] = ['qwen3-4b'], models = [QWEN, GEMMA, EMBED]): LocalModelsView {
  return {
    catalog: { catalogVersion: 1, updatedAt: '2026-08-01T00:00:00.000Z', models },
    source: 'bundled',
    fetchedAt: '2026-08-01T00:00:00.000Z',
    tier: { totalRamGB: 32, platform: 'win32', gpuSignal: 'vulkan', recommendedModelIds: [] },
    statuses: models.map((m) => ({
      modelId: m.id,
      runtimeSupported: true,
      recommended: false,
      fitsRam: true,
      downloaded: downloadedIds.includes(m.id),
      files: m.files.map((f) => ({
        quant: f.quant,
        fileName: `${m.id}-${f.quant}.gguf`,
        runtimeModelId: `${m.id}-${f.quant}`,
        sizeBytes: f.sizeBytes,
        downloaded: downloadedIds.includes(m.id),
      })),
    })),
    downloads: [],
    modelsDir: 'C:\\models',
    pinnedRuntimeTag: 'b10219',
  };
}

const ROLE = { running: false, starting: false, modelId: null, baseUrl: null, pid: null, lastUsedAt: null, crashes: 0 };

function snapshot(configured: boolean): LlamaRuntimeSnapshot {
  return {
    configured,
    binaryPresent: true,
    runtime: {
      running: false,
      backend: null,
      binaryAvailable: true,
      loadedModels: [],
      chat: ROLE,
      embedding: ROLE,
      idleStopMinutes: 15,
    },
    telemetry: { latest: null, byModel: {}, context: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeStatusCb = null;
  store.providers = [];
  store.createProvider.mockResolvedValue({ id: 'prov-new', name: 'builtin', enabled: true });
  store.getTaskModels.mockReturnValue(undefined);
  getRuntimeSnapshot.mockResolvedValue(snapshot(false));
});

describe('EnableBuiltinCard — when it shows', () => {
  it('offers activation when a chat model is downloaded but no builtin provider exists', async () => {
    render(<EnableBuiltinCard view={view()} onActivated={vi.fn()} />);

    expect(await screen.findByText('Downloaded, but not switched on yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use Qwen3 4B \(Q4_K_M\) for local AI/ })).toBeInTheDocument();
  });

  it('stays hidden once an enabled builtin provider exists', async () => {
    getRuntimeSnapshot.mockResolvedValue(snapshot(true));
    render(<EnableBuiltinCard view={view()} onActivated={vi.fn()} />);

    await waitFor(() => expect(getRuntimeSnapshot).toHaveBeenCalled());
    expect(screen.queryByText('Downloaded, but not switched on yet')).not.toBeInTheDocument();
  });

  it('stays hidden when nothing is downloaded — an absent file is not routable', async () => {
    render(<EnableBuiltinCard view={view([])} onActivated={vi.fn()} />);

    await waitFor(() => expect(getRuntimeSnapshot).toHaveBeenCalled());
    expect(screen.queryByText('Downloaded, but not switched on yet')).not.toBeInTheDocument();
  });

  it('disappears without a remount when a provider-CRUD push flips configured true', async () => {
    render(<EnableBuiltinCard view={view()} onActivated={vi.fn()} />);
    await screen.findByText('Downloaded, but not switched on yet');

    runtimeStatusCb?.(snapshot(true));

    await waitFor(() => expect(screen.queryByText('Downloaded, but not switched on yet')).not.toBeInTheDocument());
  });

  it('names the consequence when the only downloaded model cannot tool-call', async () => {
    render(<EnableBuiltinCard view={view(['gemma-3-12b-it'])} onActivated={vi.fn()} />);

    expect(await screen.findByText(/cannot run Digital Twin actions/)).toBeInTheDocument();
  });
});

describe('EnableBuiltinCard — what activation writes', () => {
  it('creates the builtin provider and routes live_assistant plus embedding to the downloaded files', async () => {
    const onActivated = vi.fn();
    render(<EnableBuiltinCard view={view(['qwen3-4b', 'embeddinggemma-300m'])} onActivated={onActivated} />);
    fireEvent.click(await screen.findByRole('button', { name: /for local AI/ }));

    await waitFor(() => expect(store.setTaskModels).toHaveBeenCalled());
    expect(store.createProvider).toHaveBeenCalledWith({ name: 'builtin' });
    expect(store.setTaskModels).toHaveBeenCalledWith({
      live_assistant: { providerId: 'prov-new', model: 'qwen3-4b-Q4_K_M' },
      embedding: { providerId: 'prov-new', model: 'embeddinggemma-300m-Q4_K_M' },
    });
    expect(onActivated).toHaveBeenCalled();
  });

  it('MERGES over stored task models instead of replacing them', async () => {
    store.getTaskModels.mockReturnValue({ meeting_summary: { providerId: 'openai-1', model: 'gpt-4o' } });
    render(<EnableBuiltinCard view={view()} onActivated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /for local AI/ }));

    await waitFor(() => expect(store.setTaskModels).toHaveBeenCalled());
    expect(store.setTaskModels.mock.calls[0][0]).toMatchObject({
      meeting_summary: { providerId: 'openai-1', model: 'gpt-4o' },
      live_assistant: { providerId: 'prov-new', model: 'qwen3-4b-Q4_K_M' },
    });
  });

  it('re-enables an existing disabled builtin row rather than adding a duplicate', async () => {
    store.providers = [{ id: 'prov-old', name: 'builtin', enabled: false }];
    render(<EnableBuiltinCard view={view()} onActivated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /for local AI/ }));

    await waitFor(() => expect(store.updateProvider).toHaveBeenCalledWith('prov-old', { enabled: true }));
    expect(store.createProvider).not.toHaveBeenCalled();
    expect(store.setTaskModels).toHaveBeenCalledWith({
      live_assistant: { providerId: 'prov-old', model: 'qwen3-4b-Q4_K_M' },
    });
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    store.createProvider.mockRejectedValue(new Error('provider table locked'));
    render(<EnableBuiltinCard view={view()} onActivated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /for local AI/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('provider table locked');
  });
});
