// @vitest-environment jsdom
// LOCAL-RT.1 Task 4: Settings → Local AI. Covers the three things this surface can
// get dangerously wrong — (1) claiming a model can drive the Digital Twin when its
// GGUF chat template cannot call tools, (2) auto-selecting or auto-downloading a
// model instead of merely highlighting one, and (3) losing an in-flight download
// across a remount — plus filters, delete-with-reclaim and the unsupported state.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CatalogModel, LocalModelDownloadProgress, LocalModelsView } from '../../../../shared/types/localModels';
import bundledCatalog from '../../../../../catalog/models.json';

// --- Bridge mock -------------------------------------------------------------
const getLocalModelsView = vi.fn();
const downloadLocalModel = vi.fn().mockResolvedValue({});
const pauseLocalModelDownload = vi.fn().mockResolvedValue(true);
const cancelLocalModelDownload = vi.fn().mockResolvedValue(true);
const deleteLocalModel = vi.fn().mockResolvedValue({ freedBytes: 9_001_752_960 });
const unregisterCustomLocalModel = vi.fn().mockResolvedValue(true);
const registerCustomLocalModel = vi.fn().mockResolvedValue({});
const openLocalModelsFolder = vi.fn().mockResolvedValue(undefined);
const pickLocalModelFile = vi.fn().mockResolvedValue(null);
const checkBuiltinRuntime = vi.fn();
const stopBuiltinRuntime = vi.fn();
const getSetting = vi.fn().mockResolvedValue(null);
const setSetting = vi.fn().mockResolvedValue(undefined);

let progressListener: ((p: LocalModelDownloadProgress) => void) | null = null;
const onLocalModelProgress = vi.fn((cb: (p: LocalModelDownloadProgress) => void) => {
  progressListener = cb;
  return () => {
    progressListener = null;
  };
});

vi.stubGlobal('electronAPI', {
  getLocalModelsView,
  downloadLocalModel,
  pauseLocalModelDownload,
  cancelLocalModelDownload,
  deleteLocalModel,
  unregisterCustomLocalModel,
  registerCustomLocalModel,
  openLocalModelsFolder,
  pickLocalModelFile,
  onLocalModelProgress,
  checkBuiltinRuntime,
  stopBuiltinRuntime,
  getSetting,
  setSetting,
});

const { default: LocalAISection } = await import('../LocalAISection');

// --- Fixtures ----------------------------------------------------------------
function model(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    displayName: overrides.id,
    vendor: 'Vendor',
    originCountry: 'US',
    license: 'Apache-2.0',
    role: 'chat',
    parameters: '7B',
    files: [
      { quant: 'Q4_K_M', url: `https://example.test/${overrides.id}-Q4_K_M.gguf`, sha256: 'x', sizeBytes: 1_000 },
    ],
    minRamGB: 8,
    languages: ['*'],
    toolCalling: false,
    contextLength: 40960,
    ...overrides,
  };
}

const QWEN = model({
  id: 'qwen3-14b',
  displayName: 'Qwen3 14B (Q4_K_M)',
  vendor: 'Alibaba',
  originCountry: 'CN',
  parameters: '14B',
  toolCalling: true,
  minRamGB: 24,
});
const GEMMA = model({
  id: 'gemma-3-12b-it',
  displayName: 'Gemma 3 12B Instruct (Q4_K_M)',
  vendor: 'Google',
  originCountry: 'US',
  license: 'Gemma',
  parameters: '12B',
  toolCalling: false,
  minRamGB: 16,
});
const EMBED = model({
  id: 'embeddinggemma-300m',
  displayName: 'EmbeddingGemma 300M (Q8_0)',
  vendor: 'Google',
  originCountry: 'US',
  license: 'Gemma',
  role: 'embedding',
  parameters: '300M',
  minRamGB: 4,
});

function view(overrides: Partial<LocalModelsView> = {}): LocalModelsView {
  const models = overrides.catalog?.models ?? [QWEN, GEMMA, EMBED];
  return {
    catalog: { catalogVersion: 1, updatedAt: '2026-08-01T00:00:00.000Z', models },
    source: 'bundled',
    fetchedAt: '2026-08-01T00:00:00.000Z',
    tier: { totalRamGB: 32, platform: 'win32', gpuSignal: 'vulkan', recommendedModelIds: ['qwen3-14b'] },
    statuses: models.map((m) => ({
      modelId: m.id,
      runtimeSupported: true,
      recommended: false,
      fitsRam: true,
      downloaded: false,
      files: m.files.map((f) => ({
        quant: f.quant,
        fileName: `${m.id}-${f.quant}.gguf`,
        runtimeModelId: `${m.id}-${f.quant}`,
        sizeBytes: f.sizeBytes,
        downloaded: false,
      })),
    })),
    downloads: [],
    modelsDir: 'C:\\Users\\test\\AppData\\Roaming\\LifeDash\\llm-models',
    pinnedRuntimeTag: 'b10219',
    ...overrides,
  };
}

const IDLE_RUNTIME = {
  binaryPresent: true,
  modelsDir: 'C:\\models',
  models: [],
  runtime: {
    running: false,
    backend: null,
    binaryAvailable: true,
    loadedModels: [],
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

/** Open a HudSelect by its accessible name and click one of its options. */
async function pickFromSelect(selectLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: selectLabel }));
  const option = await screen.findByRole('button', { name: optionLabel });
  fireEvent.click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  progressListener = null;
  getLocalModelsView.mockResolvedValue(view());
  checkBuiltinRuntime.mockResolvedValue(IDLE_RUNTIME);
  getSetting.mockResolvedValue(null);
  deleteLocalModel.mockResolvedValue({ freedBytes: 9_001_752_960 });
});

describe('LocalAISection — catalog browsing and filters', () => {
  it('groups the catalog by role and lists every model', async () => {
    render(<LocalAISection />);

    expect(await screen.findByText('Chat models')).toBeInTheDocument();
    expect(screen.getByText('Embedding models')).toBeInTheDocument();
    expect(screen.getByText('Qwen3 14B (Q4_K_M)')).toBeInTheDocument();
    expect(screen.getByText('Gemma 3 12B Instruct (Q4_K_M)')).toBeInTheDocument();
    expect(screen.getByText('EmbeddingGemma 300M (Q8_0)')).toBeInTheDocument();
  });

  it('origin=United States hides the Chinese-origin model (enterprise origin policy)', async () => {
    render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');

    await pickFromSelect('Filter models by country of origin', 'United States');

    await waitFor(() => expect(screen.queryByText('Qwen3 14B (Q4_K_M)')).not.toBeInTheDocument());
    expect(screen.getByText('Gemma 3 12B Instruct (Q4_K_M)')).toBeInTheDocument();
  });

  it('license filter narrows to the matching models only', async () => {
    render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');

    await pickFromSelect('Filter models by license', 'Gemma');

    await waitFor(() => expect(screen.queryByText('Qwen3 14B (Q4_K_M)')).not.toBeInTheDocument());
    expect(screen.getByText('Gemma 3 12B Instruct (Q4_K_M)')).toBeInTheDocument();
    expect(screen.getByText('EmbeddingGemma 300M (Q8_0)')).toBeInTheDocument();
  });
});

describe('LocalAISection — guided best match, never a silent default', () => {
  it('highlights the tier-recommended model with hedged copy and no auto-download', async () => {
    render(<LocalAISection />);

    expect(await screen.findByText('Likely best for your machine')).toBeInTheDocument();
    const rationale = screen.getByText(/Likely the best fit for your machine/);
    // Hedged on purpose: tiering reads system RAM, never VRAM.
    expect(rationale).toHaveTextContent('32 GB of system RAM');
    expect(rationale).toHaveTextContent('does not measure video memory');
    expect(rationale).toHaveTextContent('not a guarantee');
    expect(rationale).toHaveTextContent('Nothing is downloaded until you choose');
    expect(downloadLocalModel).not.toHaveBeenCalled();
  });

  it('keeps the highlighted row readable — muted text must not stay muted on the accent fill', async () => {
    render(<LocalAISection />);

    const row = (await screen.findByText('Likely best for your machine')).closest('li') as HTMLElement;

    // The highlight paints the row with --color-accent-muted, on which the default
    // --color-text-muted lands at ~1.2:1 — the meta line looked blank. `on-accent-surface`
    // remaps the muted/secondary vars for the whole subtree; without it the row regresses
    // to invisible text.
    expect(row).toHaveClass('bg-[var(--color-accent-muted)]');
    expect(row).toHaveClass('on-accent-surface');

    // The badge cannot reuse the row's own fill or it has no visible pill.
    const badge = screen.getByText('Likely best for your machine');
    expect(badge.className).toContain('bg-[var(--color-accent-subtle)]');
    expect(badge.className).not.toContain('bg-[var(--color-accent-muted)]');

    // The rationale needs the on-muted accent: plain --color-accent is 2.5:1 in light theme.
    expect(screen.getByText(/Likely the best fit for your machine/).className).toContain(
      'text-[var(--color-accent-on-muted)]',
    );
  });

  it('moves the highlight when the hardware tier recommends a different model', async () => {
    getLocalModelsView.mockResolvedValue(
      view({
        tier: { totalRamGB: 16, platform: 'win32', gpuSignal: 'cpu', recommendedModelIds: ['gemma-3-12b-it'] },
      }),
    );
    render(<LocalAISection />);

    const badge = await screen.findByText('Likely best for your machine');
    const row = badge.closest('li');
    expect(within(row as HTMLElement).getByText('Gemma 3 12B Instruct (Q4_K_M)')).toBeInTheDocument();
    expect(screen.getByText(/Likely the best fit/)).toHaveTextContent('16 GB of system RAM');
  });

  it('renders without spawning the runtime or starting any transfer (optional by construction)', async () => {
    render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');

    expect(getLocalModelsView).toHaveBeenCalledWith(false);
    // checkBuiltinRuntime is main-process `status()` — a pure read that never spawns.
    expect(checkBuiltinRuntime).toHaveBeenCalled();
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(registerCustomLocalModel).not.toHaveBeenCalled();
    expect(deleteLocalModel).not.toHaveBeenCalled();
    expect(stopBuiltinRuntime).not.toHaveBeenCalled();
  });
});

describe('LocalAISection — tool-calling honesty', () => {
  it('badges the tool-caller and spells out the consequence for the model that cannot', async () => {
    render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');

    const qwenRow = screen.getByText('Qwen3 14B (Q4_K_M)').closest('li') as HTMLElement;
    expect(within(qwenRow).getByText('Tool calling')).toBeInTheDocument();

    const gemmaRow = screen.getByText('Gemma 3 12B Instruct (Q4_K_M)').closest('li') as HTMLElement;
    expect(within(gemmaRow).getByText('No tool calling')).toBeInTheDocument();
    expect(within(gemmaRow).getByText(/cannot run Digital Twin actions/)).toBeInTheDocument();
  });

  it('does not hide non-tool-calling models — they stay browsable and downloadable', async () => {
    render(<LocalAISection />);
    await screen.findByText('Gemma 3 12B Instruct (Q4_K_M)');

    const gemmaRow = screen.getByText('Gemma 3 12B Instruct (Q4_K_M)').closest('li') as HTMLElement;
    expect(within(gemmaRow).getByRole('button', { name: /Download Gemma/ })).toBeEnabled();
  });

  it('shows no tool-calling badge on embedding models (the concept does not apply)', async () => {
    render(<LocalAISection />);
    await screen.findByText('EmbeddingGemma 300M (Q8_0)');

    const embedRow = screen.getByText('EmbeddingGemma 300M (Q8_0)').closest('li') as HTMLElement;
    expect(within(embedRow).queryByText('Tool calling')).not.toBeInTheDocument();
    expect(within(embedRow).queryByText('No tool calling')).not.toBeInTheDocument();
  });
});

describe('LocalAISection — downloads', () => {
  const IN_FLIGHT: LocalModelDownloadProgress = {
    key: 'qwen3-14b:Q4_K_M',
    fileName: 'qwen3-14b-Q4_K_M.gguf',
    state: 'downloading',
    receivedBytes: 4_000_000_000,
    totalBytes: 9_001_752_960,
    percent: 44,
    bytesPerSecond: 12_000_000,
  };

  it('starts a download only on an explicit click, with the model id and quant', async () => {
    render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');

    fireEvent.click(screen.getByRole('button', { name: /Download Qwen3 14B/ }));

    await waitFor(() => expect(downloadLocalModel).toHaveBeenCalledWith({ modelId: 'qwen3-14b', quant: 'Q4_K_M' }));
  });

  it('re-hydrates an in-flight download on mount, so a settings remount never loses progress', async () => {
    getLocalModelsView.mockResolvedValue(view({ downloads: [IN_FLIGHT] }));
    const { unmount } = render(<LocalAISection />);

    expect(await screen.findByRole('progressbar', { name: /Qwen3 14B/ })).toHaveAttribute('aria-valuenow', '44');
    unmount();

    // Remount: progress is a push event, so the seed must come from the view's
    // own downloads list — otherwise the bar would restart at zero.
    render(<LocalAISection />);
    expect(await screen.findByRole('progressbar', { name: /Qwen3 14B/ })).toHaveAttribute('aria-valuenow', '44');
    expect(screen.getByRole('button', { name: /Pause downloading Qwen3 14B/ })).toBeInTheDocument();
  });

  it('advances the bar from the push event and re-attaches the listener after a remount', async () => {
    const { unmount } = render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');
    unmount();

    render(<LocalAISection />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');
    expect(progressListener).not.toBeNull();

    act(() => progressListener?.({ ...IN_FLIGHT, percent: 77, receivedBytes: 7_000_000_000 }));

    expect(await screen.findByRole('progressbar', { name: /Qwen3 14B/ })).toHaveAttribute('aria-valuenow', '77');
  });

  it('offers Resume (not Pause) for a paused transfer and resumes through the download call', async () => {
    getLocalModelsView.mockResolvedValue(view({ downloads: [{ ...IN_FLIGHT, state: 'paused' }] }));
    render(<LocalAISection />);

    const resume = await screen.findByRole('button', { name: /Resume downloading Qwen3 14B/ });
    fireEvent.click(resume);

    await waitFor(() => expect(downloadLocalModel).toHaveBeenCalledWith({ modelId: 'qwen3-14b', quant: 'Q4_K_M' }));
  });

  it('pauses and cancels through their own IPC calls, keyed by `${modelId}:${quant}`', async () => {
    getLocalModelsView.mockResolvedValue(view({ downloads: [IN_FLIGHT] }));
    render(<LocalAISection />);

    fireEvent.click(await screen.findByRole('button', { name: /Pause downloading Qwen3 14B/ }));
    await waitFor(() => expect(pauseLocalModelDownload).toHaveBeenCalledWith('qwen3-14b:Q4_K_M'));

    fireEvent.click(screen.getByRole('button', { name: /Cancel downloading Qwen3 14B/ }));
    await waitFor(() => expect(cancelLocalModelDownload).toHaveBeenCalledWith('qwen3-14b:Q4_K_M'));
  });

  it('surfaces a failed download rather than silently dropping it', async () => {
    getLocalModelsView.mockResolvedValue(
      view({ downloads: [{ ...IN_FLIGHT, state: 'error', error: 'Checksum mismatch' }] }),
    );
    render(<LocalAISection />);

    expect(await screen.findByText('Checksum mismatch')).toBeInTheDocument();
  });
});

describe('LocalAISection — delete with reclaim', () => {
  function downloadedView() {
    const base = view();
    return {
      ...base,
      statuses: base.statuses.map((s) =>
        s.modelId === 'qwen3-14b'
          ? { ...s, downloaded: true, files: s.files.map((f) => ({ ...f, downloaded: true })) }
          : s,
      ),
    };
  }

  it('confirms first, deletes exactly the target file, and reports the reclaimed space', async () => {
    getLocalModelsView.mockResolvedValue(downloadedView());
    render(<LocalAISection />);

    fireEvent.click(await screen.findByRole('button', { name: /Delete Qwen3 14B/ }));
    // Nothing is removed until the user confirms.
    expect(deleteLocalModel).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this model file?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteLocalModel).toHaveBeenCalledWith('qwen3-14b-Q4_K_M.gguf'));
    expect(deleteLocalModel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/8\.4 GB reclaimed/)).toBeInTheDocument();
  });

  it('cancelling the dialog deletes nothing', async () => {
    getLocalModelsView.mockResolvedValue(downloadedView());
    render(<LocalAISection />);

    fireEvent.click(await screen.findByRole('button', { name: /Delete Qwen3 14B/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteLocalModel).not.toHaveBeenCalled();
  });

  it('badges a downloaded model and offers Delete instead of Download', async () => {
    getLocalModelsView.mockResolvedValue(downloadedView());
    render(<LocalAISection />);

    const row = (await screen.findByText('Qwen3 14B (Q4_K_M)')).closest('li') as HTMLElement;
    expect(within(row).getByText('Downloaded')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Download Qwen3 14B/ })).not.toBeInTheDocument();
  });
});

describe('LocalAISection — unavailable and custom entries', () => {
  it('shows the runtime reason and blocks download for a model needing a newer llama.cpp', async () => {
    // Synthetic: no shipped model declares minRuntimeTag, so the state is exercised
    // with a fixture rather than pretending a real catalog entry triggers it.
    const future = model({ id: 'future-model', displayName: 'Future Model', minRuntimeTag: 'b99999' });
    const base = view({ catalog: { catalogVersion: 1, updatedAt: '', models: [future] } });
    getLocalModelsView.mockResolvedValue({
      ...base,
      statuses: base.statuses.map((s) => ({
        ...s,
        runtimeSupported: false,
        unavailableReason: 'Needs llama.cpp b99999; this build ships b10219.',
      })),
    });
    render(<LocalAISection />);

    expect(await screen.findByText('Needs llama.cpp b99999; this build ships b10219.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Future Model/ })).toBeDisabled();
  });

  it('wraps a very long custom-GGUF name instead of overflowing the row', async () => {
    const longName =
      'my-extremely-long-finetuned-model-name-that-should-wrap-instead-of-overflowing-the-settings-row-Q4_K_M';
    const custom = model({ id: `custom-${longName}`, displayName: longName, vendor: 'custom' });
    getLocalModelsView.mockResolvedValue(view({ catalog: { catalogVersion: 1, updatedAt: '', models: [custom] } }));
    render(<LocalAISection />);

    const name = await screen.findByText(longName);
    expect(name.className).toContain('break-words');
    expect((name.closest('li') as HTMLElement).className).toContain('overflow-hidden');
  });

  it('lets a custom entry be removed from the list without touching disk', async () => {
    const custom = model({ id: 'custom-my-model-q4', displayName: 'My Model', vendor: 'custom' });
    getLocalModelsView.mockResolvedValue(view({ catalog: { catalogVersion: 1, updatedAt: '', models: [custom] } }));
    render(<LocalAISection />);

    fireEvent.click(await screen.findByRole('button', { name: /Remove My Model from the model list/ }));

    await waitFor(() => expect(unregisterCustomLocalModel).toHaveBeenCalledWith('custom-my-model-q4'));
    expect(deleteLocalModel).not.toHaveBeenCalled();
  });
});

describe('LocalAISection — failure handling', () => {
  it('degrades to an error banner when the catalog read fails', async () => {
    getLocalModelsView.mockRejectedValue(new Error('catalog unreadable'));
    render(<LocalAISection />);

    expect(await screen.findByText('catalog unreadable')).toBeInTheDocument();
  });

  it('never crashes the page on a malformed view payload', async () => {
    // The whole Settings page renders this section; a null payload must not take
    // the page down with it (it did, before the guard).
    getLocalModelsView.mockResolvedValue(null);
    render(<LocalAISection />);

    expect(await screen.findByText(/local model catalog could not be read/)).toBeInTheDocument();
    expect(screen.getByText('Local AI')).toBeInTheDocument();
  });

  it('reports a failed action without losing the catalog', async () => {
    downloadLocalModel.mockRejectedValueOnce(new Error('Disk is full'));
    render(<LocalAISection />);

    fireEvent.click(await screen.findByRole('button', { name: /Download Qwen3 14B/ }));

    expect(await screen.findByText('Disk is full')).toBeInTheDocument();
    expect(screen.getByText('Qwen3 14B (Q4_K_M)')).toBeInTheDocument();
  });
});

describe('LocalAISection — runtime card', () => {
  it('reports the stopped state and disables Stop when nothing is running', async () => {
    render(<LocalAISection />);

    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop the built-in runtime' })).toBeDisabled();
  });

  it('reports backend and loaded models while running, and stops on click', async () => {
    checkBuiltinRuntime.mockResolvedValue({
      ...IDLE_RUNTIME,
      models: ['qwen3-14b-Q4_K_M'],
      runtime: {
        ...IDLE_RUNTIME.runtime,
        running: true,
        backend: 'vulkan',
        loadedModels: ['qwen3-14b-Q4_K_M'],
        chat: { ...IDLE_RUNTIME.runtime.chat, running: true, modelId: 'qwen3-14b-Q4_K_M' },
      },
    });
    stopBuiltinRuntime.mockResolvedValue(IDLE_RUNTIME.runtime);
    render(<LocalAISection />);

    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByText(/Backend: vulkan/)).toBeInTheDocument();
    expect(screen.getByText('qwen3-14b-Q4_K_M')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop the built-in runtime' }));

    await waitFor(() => expect(stopBuiltinRuntime).toHaveBeenCalled());
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
  });

  it('shows the starting state while a role is coming up', async () => {
    checkBuiltinRuntime.mockResolvedValue({
      ...IDLE_RUNTIME,
      runtime: { ...IDLE_RUNTIME.runtime, chat: { ...IDLE_RUNTIME.runtime.chat, starting: true } },
    });
    render(<LocalAISection />);

    expect(await screen.findByText('Starting…')).toBeInTheDocument();
  });

  it('persists the idle auto-stop window, with 0 meaning "never stop"', async () => {
    render(<LocalAISection />);

    const input = await screen.findByLabelText('Minutes idle before the built-in runtime stops');
    expect(input).toHaveValue(15);

    fireEvent.change(input, { target: { value: '0' } });

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('localAI.idleStopMinutes', '0'));
    expect(await screen.findByText(/it stays loaded until you stop it/)).toBeInTheDocument();
  });

  it('loads a previously saved idle window', async () => {
    getSetting.mockResolvedValue('45');
    render(<LocalAISection />);

    expect(await screen.findByLabelText('Minutes idle before the built-in runtime stops')).toHaveValue(45);
  });
});

describe('shipped catalog — tool-calling flags match what Task 3 verified per GGUF', () => {
  // Guards the product-honesty claim at its source: these four are the only chat
  // models whose embedded chat template has a tools section. Mistral-7B's model
  // card advertises function calling the shipped GGUF cannot do.
  const TOOL_CALLERS = ['qwen3-14b', 'qwen3-4b', 'mistral-small-3.2-24b', 'llama-3.1-8b'];

  it('marks exactly the four verified chat models as tool-calling', () => {
    const chat = (bundledCatalog.models as CatalogModel[]).filter((m) => m.role === 'chat');
    expect(
      chat
        .filter((m) => m.toolCalling)
        .map((m) => m.id)
        .sort(),
    ).toEqual([...TOOL_CALLERS].sort());
    expect(
      chat
        .filter((m) => !m.toolCalling)
        .map((m) => m.id)
        .sort(),
    ).toEqual(['gemma-3-12b-it', 'gemma-3-4b-it', 'mistral-7b-v0.3', 'phi-4'].sort());
  });
});
