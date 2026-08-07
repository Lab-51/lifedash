// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import '@testing-library/jest-dom';
import type { AIProvider } from '../../../shared/types';
import type { TaskModelConfigHandle } from '../TaskModelConfig';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — settingsStore reads from it, but our tests drive
// state directly via useSettingsStore.setState, mirroring LiveAssistantChat.test.tsx.
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  getAIProviders: vi.fn().mockResolvedValue([]),
  setSetting: vi.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Import store and component AFTER mocking
// ---------------------------------------------------------------------------
const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: TaskModelConfig } = await import('../TaskModelConfig');

function makeProvider(overrides: Partial<AIProvider>): AIProvider {
  return {
    id: 'provider-1',
    name: 'openai',
    displayName: null,
    enabled: true,
    hasApiKey: true,
    baseUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const PRIVACY_HINT_TEXT = /Transcripts go to whichever provider you pick/;

describe('TaskModelConfig — Live Assistant row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {},
      getTaskModels: vi.fn().mockReturnValue(null),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('lists Live Assistant among the configurable task types', () => {
    render(<TaskModelConfig providers={[makeProvider({ id: 'openai-1', name: 'openai' })]} />);

    expect(screen.getByText('Live Assistant')).toBeInTheDocument();
    expect(
      screen.getByText('In-meeting AI partner — answers questions and creates cards during recording'),
    ).toBeInTheDocument();
  });

  it('shows the privacy hint when only a cloud provider is configured for Live Assistant', () => {
    const provider = makeProvider({ id: 'openai-1', name: 'openai' });
    useSettingsStore.setState({
      settings: {
        'ai.taskModels': JSON.stringify({ live_assistant: { providerId: 'openai-1', model: 'gpt-5-mini' } }),
      },
      getTaskModels: vi.fn().mockReturnValue({ live_assistant: { providerId: 'openai-1', model: 'gpt-5-mini' } }),
    } as never);

    render(<TaskModelConfig providers={[provider]} />);

    expect(screen.getByText(PRIVACY_HINT_TEXT)).toBeInTheDocument();
  });

  it('hides the privacy hint when a local provider (LM Studio) is configured for Live Assistant', () => {
    const provider = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify({ live_assistant: { providerId: 'lmstudio-1', model: 'default' } }) },
      getTaskModels: vi.fn().mockReturnValue({ live_assistant: { providerId: 'lmstudio-1', model: 'default' } }),
    } as never);

    render(<TaskModelConfig providers={[provider]} />);

    expect(screen.queryByText(PRIVACY_HINT_TEXT)).not.toBeInTheDocument();
  });

  it('shows the privacy hint by default when no provider has been picked for Live Assistant yet', () => {
    render(<TaskModelConfig providers={[makeProvider({ id: 'openai-1', name: 'openai' })]} />);

    expect(screen.getByText(PRIVACY_HINT_TEXT)).toBeInTheDocument();
  });
});

describe('TaskModelConfig — Twin Interview row (V3.3 Task 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {},
      getTaskModels: vi.fn().mockReturnValue(null),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('lists Twin Interview Assist among the configurable task types, so it can be split from Live Assistant', () => {
    render(<TaskModelConfig providers={[makeProvider({ id: 'openai-1', name: 'openai' })]} />);

    expect(screen.getByText('Twin Interview Assist')).toBeInTheDocument();
    expect(screen.getByText(/Interview me.*steps/)).toBeInTheDocument();
  });

  it('does not show the Live Assistant privacy hint on the Twin Interview row', () => {
    render(<TaskModelConfig providers={[makeProvider({ id: 'openai-1', name: 'openai' })]} />);

    // Only one privacy hint on the page (Live Assistant's) — Twin Interview has none.
    expect(screen.getAllByText(PRIVACY_HINT_TEXT)).toHaveLength(1);
  });
});

describe('TaskModelConfig — Embedding row privacy hint (V3.4 adversarial fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {},
      getTaskModels: vi.fn().mockReturnValue(null),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  const CLOUD_WARNING = /will be sent to it to be embedded/;
  const ON_DEVICE = /Embeddings stay on your device/;

  it('shows the on-device reassurance (and no cloud warning) when a LOCAL provider is chosen for embedding', () => {
    const provider = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const saved = { embedding: { providerId: 'lmstudio-1', model: 'text-embedding-embeddinggemma-300m' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    render(<TaskModelConfig providers={[provider]} />);

    expect(screen.getByText(ON_DEVICE)).toBeInTheDocument();
    expect(screen.queryByText(CLOUD_WARNING)).not.toBeInTheDocument();
  });

  it('replaces the on-device reassurance with a cloud warning when a CLOUD provider is chosen for embedding', () => {
    const provider = makeProvider({ id: 'openai-1', name: 'openai' });
    const saved = { embedding: { providerId: 'openai-1', model: 'text-embedding-3-small' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    render(<TaskModelConfig providers={[provider]} />);

    // No false on-device assurance for a cloud embedding provider…
    expect(screen.queryByText(ON_DEVICE)).not.toBeInTheDocument();
    // …and an explicit warning that bulk content leaves the device.
    expect(screen.getByText(CLOUD_WARNING)).toBeInTheDocument();
  });
});

describe('TaskModelConfig — Google Gemini provider (V3.3.5 Task 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {},
      getTaskModels: vi.fn().mockReturnValue(null),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('offers a Gemini model from the catalog when a Google provider is selected for a task', () => {
    const google = makeProvider({ id: 'google-1', name: 'google' });
    const saved = { summarization: { providerId: 'google-1', model: 'gemini-2.5-flash' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    render(<TaskModelConfig providers={[google]} />);

    // The selected Gemini model's catalog label is surfaced (HudSelect trigger label
    // is looked up from KNOWN_MODELS.google), proving Gemini is a routable catalog entry.
    expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument();
  });

  it('can route the Twin Interview Assist row to a Gemini model', () => {
    const google = makeProvider({ id: 'google-1', name: 'google' });
    const saved = { twin_interview: { providerId: 'google-1', model: 'gemini-2.5-pro' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    render(<TaskModelConfig providers={[google]} />);

    expect(screen.getByText('Twin Interview Assist')).toBeInTheDocument();
    expect(screen.getByText('Gemini 2.5 Pro (Flagship)')).toBeInTheDocument();
  });
});

describe('TaskModelConfig — Embedding live model dropdown + auto-assign (V3.4)', () => {
  // A loaded chat model (should be filtered out) plus a loaded embedding model whose
  // id deliberately differs from the lmstudio default, so auto-assign picking it
  // proves the live list was consulted rather than the hard-coded fallback.
  const LOADED = ['google/gemma-4-12b-qat', 'text-embedding-bge-m3'];

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-stub the bridge with the live-model probes for this block only. This
    // describe runs last, so the added probes never leak into earlier blocks (which
    // exercise the free-text fallback with no live models mocked).
    vi.stubGlobal('electronAPI', {
      getAIProviders: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn().mockResolvedValue(undefined),
      checkLmStudio: vi.fn().mockResolvedValue({ running: true, models: LOADED }),
      checkOllama: vi.fn().mockResolvedValue({ running: false, models: [] }),
    });
    useSettingsStore.setState({
      settings: {},
      getTaskModels: vi.fn().mockReturnValue(null),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('offers the loaded embedding model as a selectable option and filters out the chat-only id', async () => {
    const provider = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const saved = { embedding: { providerId: 'lmstudio-1', model: '' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    render(<TaskModelConfig providers={[provider]} />);

    // Before live models load the Embedding row is free text; once loaded it becomes
    // a dropdown whose trigger shows the "Select model" placeholder. Open it.
    const trigger = await screen.findByText('Select model');
    fireEvent.click(trigger);

    // The loaded embedding id is a selectable option…
    expect(screen.getByText('text-embedding-bge-m3')).toBeInTheDocument();
    // …the chat-only id is filtered out of the embedding options…
    expect(screen.queryByText('google/gemma-4-12b-qat')).not.toBeInTheDocument();
    // …and a Custom… escape hatch keeps any id typeable.
    expect(screen.getByText(/^Custom/)).toBeInTheDocument();
  });

  it('auto-assign to a LOCAL provider fills Embedding with the loaded embedding id', async () => {
    const provider = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const saved = { embedding: { providerId: 'lmstudio-1', model: '' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[provider]} />);

    // Wait for live models to load (Embedding row becomes a dropdown).
    await screen.findByText('Select model');

    act(() => ref.current!.autoAssign(provider));

    // The loaded embedding id (not the default) is chosen → liveModels was consulted.
    expect(screen.getByText('text-embedding-bge-m3')).toBeInTheDocument();
  });

  it('auto-assign to a CLOUD provider leaves the Embedding assignment untouched (no silent cloud)', async () => {
    const openai = makeProvider({ id: 'openai-1', name: 'openai' });
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const saved = { embedding: { providerId: 'lmstudio-1', model: 'text-embedding-bge-m3' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
    } as never);

    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[openai, lmstudio]} />);

    // Wait for the Embedding dropdown (local + loaded model in options) to render.
    await screen.findByText('text-embedding-bge-m3');

    act(() => ref.current!.autoAssign(openai));

    // Embedding still points at the local model — the cloud sweep left it alone…
    expect(screen.getByText('text-embedding-bge-m3')).toBeInTheDocument();
    // …so the on-device reassurance stays and no cloud warning appears.
    expect(screen.getByText(/Embeddings stay on your device/)).toBeInTheDocument();
    expect(screen.queryByText(/will be sent to it to be embedded/)).not.toBeInTheDocument();
  });
});

describe('TaskModelConfig — built-in runtime provider (LOCAL-RT.1 Task 4)', () => {
  // Two downloaded chat models with opposite tool-calling verdicts, one downloaded
  // embedding model, and one catalog model that is NOT downloaded — the last one
  // must never be offered, because the runtime can only serve files on disk.
  const VIEW = {
    catalog: {
      catalogVersion: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
      models: [
        { id: 'qwen3-4b', displayName: 'Qwen3 4B (Q4_K_M)', role: 'chat', toolCalling: true },
        { id: 'gemma-3-12b-it', displayName: 'Gemma 3 12B Instruct (Q4_K_M)', role: 'chat', toolCalling: false },
        { id: 'embeddinggemma-300m', displayName: 'EmbeddingGemma 300M (Q8_0)', role: 'embedding', toolCalling: false },
        { id: 'phi-4', displayName: 'Phi-4 14B (Q4_K)', role: 'chat', toolCalling: false },
      ],
    },
    source: 'bundled',
    fetchedAt: '2026-08-01T00:00:00.000Z',
    tier: { totalRamGB: 32, platform: 'win32', gpuSignal: 'vulkan', recommendedModelIds: [] },
    statuses: [
      {
        modelId: 'qwen3-4b',
        runtimeSupported: true,
        recommended: false,
        fitsRam: true,
        downloaded: true,
        files: [
          {
            quant: 'Q4_K_M',
            fileName: 'Qwen3-4B-Q4_K_M.gguf',
            runtimeModelId: 'Qwen3-4B-Q4_K_M',
            sizeBytes: 2_497_280_256,
            downloaded: true,
          },
        ],
      },
      {
        modelId: 'gemma-3-12b-it',
        runtimeSupported: true,
        recommended: false,
        fitsRam: true,
        downloaded: true,
        files: [
          {
            quant: 'Q4_K_M',
            fileName: 'gemma-3-12b-it-Q4_K_M.gguf',
            runtimeModelId: 'gemma-3-12b-it-Q4_K_M',
            sizeBytes: 7_300_574_976,
            downloaded: true,
          },
        ],
      },
      {
        modelId: 'embeddinggemma-300m',
        runtimeSupported: true,
        recommended: false,
        fitsRam: true,
        downloaded: true,
        files: [
          {
            quant: 'Q8_0',
            fileName: 'embeddinggemma-300M-Q8_0.gguf',
            runtimeModelId: 'embeddinggemma-300M-Q8_0',
            sizeBytes: 333_590_944,
            downloaded: true,
          },
        ],
      },
      {
        modelId: 'phi-4',
        runtimeSupported: true,
        recommended: false,
        fitsRam: true,
        downloaded: false,
        files: [
          {
            quant: 'Q4_K',
            fileName: 'phi-4-Q4_K.gguf',
            runtimeModelId: 'phi-4-Q4_K',
            sizeBytes: 9_053_114_560,
            downloaded: false,
          },
        ],
      },
    ],
    downloads: [],
    modelsDir: 'C:/models',
    pinnedRuntimeTag: 'b10219',
  };

  const getLocalModelsView = vi.fn();
  const builtin = makeProvider({ id: 'builtin-1', name: 'builtin', displayName: 'Built-in AI', hasApiKey: false });

  /** Captured `local-models:progress` listener, so a test can finish a download. */
  let progressListener: ((p: { key: string; state: string }) => void) | null = null;

  /** Same catalog, but nothing on disk. */
  const EMPTY_VIEW = {
    ...VIEW,
    statuses: VIEW.statuses.map((s) => ({
      ...s,
      downloaded: false,
      files: s.files.map((f) => ({ ...f, downloaded: false })),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    progressListener = null;
    vi.stubGlobal('electronAPI', {
      getAIProviders: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn().mockResolvedValue(undefined),
      checkLmStudio: vi.fn().mockResolvedValue({ running: false, models: [] }),
      checkOllama: vi.fn().mockResolvedValue({ running: false, models: [] }),
      getLocalModelsView,
      onLocalModelProgress: vi.fn((cb: (p: { key: string; state: string }) => void) => {
        progressListener = cb;
        return () => {
          progressListener = null;
        };
      }),
    });
    getLocalModelsView.mockResolvedValue(VIEW);
    useSettingsStore.setState({
      settings: {},
      getTaskModels: vi.fn().mockReturnValue(null),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  function renderWithSaved(saved: Record<string, { providerId: string; model: string }>) {
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
      setTaskModels: vi.fn().mockResolvedValue(undefined),
    } as never);
    return render(<TaskModelConfig providers={[builtin]} />);
  }

  it('offers only DOWNLOADED chat models, labelled with their tool-calling verdict', async () => {
    renderWithSaved({ card_agent: { providerId: 'builtin-1', model: '' } });

    // Open the Card Agent row's model dropdown (the only row with a provider set).
    const trigger = await screen.findByText('Select model');
    fireEvent.click(trigger);

    expect(await screen.findByText('Qwen3 4B (Q4_K_M) — tool calling')).toBeInTheDocument();
    expect(screen.getByText('Gemma 3 12B Instruct (Q4_K_M) — no tool calling')).toBeInTheDocument();
    // phi-4 is in the catalog but not on disk, so it is not routable.
    expect(screen.queryByText(/Phi-4/)).not.toBeInTheDocument();
    // Embedding models never appear as an option in a chat row.
    expect(screen.queryByText('EmbeddingGemma 300M (Q8_0)')).not.toBeInTheDocument();
  });

  it('warns when Live Assistant is routed to a built-in model that cannot call tools', async () => {
    renderWithSaved({ live_assistant: { providerId: 'builtin-1', model: 'gemma-3-12b-it-Q4_K_M' } });

    expect(await screen.findByText(/This model cannot call tools/)).toBeInTheDocument();
  });

  it('shows no warning when Live Assistant is routed to a tool-calling built-in model', async () => {
    renderWithSaved({ live_assistant: { providerId: 'builtin-1', model: 'Qwen3-4B-Q4_K_M' } });

    await screen.findByText('Qwen3 4B (Q4_K_M) — tool calling');
    expect(screen.queryByText(/This model cannot call tools/)).not.toBeInTheDocument();
  });

  it('does not warn on a task that never calls tools (Summarization)', async () => {
    renderWithSaved({ summarization: { providerId: 'builtin-1', model: 'gemma-3-12b-it-Q4_K_M' } });

    await screen.findByText('Gemma 3 12B Instruct (Q4_K_M) — no tool calling');
    expect(screen.queryByText(/This model cannot call tools/)).not.toBeInTheDocument();
  });

  it('offers a downloaded embedding model on the Embedding row', async () => {
    renderWithSaved({ embedding: { providerId: 'builtin-1', model: 'embeddinggemma-300M-Q8_0' } });

    expect(await screen.findByText('embeddinggemma-300M-Q8_0')).toBeInTheDocument();
    expect(screen.getByText(/Embeddings stay on your device/)).toBeInTheDocument();
  });

  it('replaces the free-text box with an honest empty state when nothing is downloaded', async () => {
    getLocalModelsView.mockResolvedValue({
      ...VIEW,
      statuses: VIEW.statuses.map((s) => ({
        ...s,
        downloaded: false,
        files: s.files.map((f) => ({ ...f, downloaded: false })),
      })),
    });
    renderWithSaved({ card_agent: { providerId: 'builtin-1', model: '' } });

    expect(await screen.findByText('No models downloaded yet')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Model name...')).not.toBeInTheDocument();
  });

  it('auto-assign prefers a downloaded TOOL-CALLING model over a larger one that cannot', async () => {
    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[builtin]} />);

    // Wait for the downloaded list to arrive before auto-assigning.
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => ref.current!.autoAssign(builtin));

    // Gemma 12B is the larger file, but only Qwen3 4B can call tools.
    expect((await screen.findAllByText('Qwen3 4B (Q4_K_M) — tool calling')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Gemma 3 12B Instruct (Q4_K_M) — no tool calling')).not.toBeInTheDocument();
    // Embedding is filled from the downloaded embedding model, not a guessed id.
    expect(screen.getByText('embeddinggemma-300M-Q8_0')).toBeInTheDocument();
  });

  it('auto-assign writes nothing when no built-in model is downloaded', async () => {
    getLocalModelsView.mockResolvedValue(EMPTY_VIEW);
    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[builtin]} />);

    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());
    act(() => ref.current!.autoAssign(builtin));

    // No provider was assigned to any row, so no model control renders at all.
    expect(screen.queryByText('No models downloaded yet')).not.toBeInTheDocument();
  });

  it('says why it assigned nothing instead of looking like a dead button', async () => {
    getLocalModelsView.mockResolvedValue(EMPTY_VIEW);
    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[builtin]} />);
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());

    await act(async () => {
      ref.current!.autoAssign(builtin);
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/No built-in models are downloaded yet/i);
  });

  it('picks up a model downloaded AFTER mount — no remount needed', async () => {
    // The real sequence: open Settings with nothing on disk, download a model in the
    // Local AI section on the SAME tab, then hit Auto-assign. Before the shared hook
    // this list was fetched once at mount and stayed empty, so auto-assign silently
    // did nothing — which is exactly what looked broken.
    getLocalModelsView.mockResolvedValue(EMPTY_VIEW);
    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[builtin]} />);
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());

    // Subscribing is the whole mechanism — assert it rather than letting an
    // optional call silently no-op and fail later for a vaguer reason.
    expect(progressListener, 'must subscribe to local-models:progress').not.toBeNull();

    // The download lands, and the main process pushes its terminal progress event.
    getLocalModelsView.mockResolvedValue(VIEW);
    await act(async () => {
      progressListener!({ key: 'qwen3-4b:Q4_K_M', state: 'ready' });
    });
    await act(async () => {
      ref.current!.autoAssign(builtin);
    });

    expect((await screen.findAllByText('Qwen3 4B (Q4_K_M) — tool calling')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not assign a model deleted since mount — it re-reads before assigning', async () => {
    const ref = createRef<TaskModelConfigHandle>();
    render(<TaskModelConfig ref={ref} providers={[builtin]} />);
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // Everything is deleted from the Local AI section; no progress event fires for a
    // delete, so only the pre-assign re-read can catch this.
    getLocalModelsView.mockResolvedValue(EMPTY_VIEW);
    await act(async () => {
      ref.current!.autoAssign(builtin);
    });

    expect(screen.queryByText('Qwen3 4B (Q4_K_M) — tool calling')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/No built-in models are downloaded yet/i);
  });
});

describe('TaskModelConfig — local-chat consolidation guard (AI-RESIL.1 Task 3)', () => {
  // Bundled-catalog shape from useLocalModels, kept EMPTY (nothing downloaded) so a
  // built-in row's own dropdown never renders the raw model id strings these tests
  // configure directly via saved settings — proving any match comes from the banner.
  const EMPTY_BUILTIN_VIEW = {
    catalog: { catalogVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z', models: [] },
    source: 'bundled',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    tier: { totalRamGB: 16, platform: 'win32', gpuSignal: 'cpu', recommendedModelIds: [] },
    statuses: [],
    downloads: [],
    modelsDir: 'C:/models',
    pinnedRuntimeTag: 'b10219',
  };

  const getLocalModelsView = vi.fn();

  // Shared across positive AND negative cases (2026-08-05 learning): a typo here
  // would fail the positive "banner" tests too, so the "no banner" tests can never
  // pass vacuously.
  const CONSOLIDATION_BANNER_TEXT = /different local chat models are configured/;
  const CONSOLIDATE_BUTTON_NAME = /Use one model for all local chat tasks/;

  // The two local families overcommit DIFFERENTLY, and the banner must not claim the
  // wrong mechanism (corrected 2026-08-07). Shared across positive and negative
  // assertions for the same reason as the constants above: a typo would break the
  // positive case too, so "does not say X" can never pass vacuously.
  const CORESIDENCY_TEXT = /stay(?:s)? loaded in memory at the same time/;
  const THRASH_TEXT = /unloads? .*and reloads?/;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('electronAPI', {
      getAIProviders: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn().mockResolvedValue(undefined),
      checkLmStudio: vi.fn().mockResolvedValue({ running: false, models: [] }),
      checkOllama: vi.fn().mockResolvedValue({ running: false, models: [] }),
      getLocalModelsView,
    });
    getLocalModelsView.mockResolvedValue(EMPTY_BUILTIN_VIEW);
  });

  function renderWithSaved(providers: AIProvider[], saved: Record<string, { providerId: string; model: string }>) {
    const setTaskModels = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(saved) },
      getTaskModels: vi.fn().mockReturnValue(saved),
      setTaskModels,
    } as never);
    const utils = render(<TaskModelConfig providers={providers} />);
    return { ...utils, setTaskModels };
  }

  it('shows no banner when zero or one local chat task is configured', () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    renderWithSaved([lmstudio], { live_assistant: { providerId: 'lmstudio-1', model: 'llama-3.1-8b-instruct' } });

    expect(screen.queryByText(CONSOLIDATION_BANNER_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CONSOLIDATE_BUTTON_NAME })).not.toBeInTheDocument();
  });

  it('does not warn when only the embedding task uses a different local model', () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    renderWithSaved([lmstudio], {
      embedding: { providerId: 'lmstudio-1', model: 'text-embedding-bge-m3' },
      live_assistant: { providerId: 'lmstudio-1', model: 'llama-3.1-8b-instruct' },
    });

    expect(screen.queryByText(CONSOLIDATION_BANNER_TEXT)).not.toBeInTheDocument();
  });

  it('warns and names the models when two distinct LM Studio models are configured', () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    renderWithSaved([lmstudio], {
      live_assistant: { providerId: 'lmstudio-1', model: 'llama-3.1-8b-instruct' },
      card_agent: { providerId: 'lmstudio-1', model: 'mistral-nemo-instruct' },
    });

    expect(screen.getByText(CONSOLIDATION_BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/2 different local chat models are configured/)).toBeInTheDocument();
    expect(screen.getByText(/llama-3.1-8b-instruct/)).toBeInTheDocument();
    expect(screen.getByText(/mistral-nemo-instruct/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CONSOLIDATE_BUTTON_NAME })).toBeInTheDocument();
  });

  it('warns when local chat tasks are split across LM Studio and the built-in runtime', async () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const builtin = makeProvider({ id: 'builtin-1', name: 'builtin', hasApiKey: false });
    renderWithSaved([lmstudio, builtin], {
      live_assistant: { providerId: 'lmstudio-1', model: 'llama-3.1-8b-instruct' },
      standup: { providerId: 'builtin-1', model: 'Qwen3-4B-Q4_K_M' },
    });
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());

    expect(screen.getByText(/2 different local chat models are configured/)).toBeInTheDocument();
    expect(screen.getByText(/llama-3.1-8b-instruct/)).toBeInTheDocument();
    expect(screen.getByText(/Qwen3-4B-Q4_K_M/)).toBeInTheDocument();
    // Mixed set: BOTH mechanisms are named, because both are actually happening.
    expect(screen.getByText(CORESIDENCY_TEXT)).toBeInTheDocument();
    expect(screen.getByText(THRASH_TEXT)).toBeInTheDocument();
  });

  // --- Mechanism-accurate copy (AI-RESIL.1 correction, 2026-08-07) -------------------
  // The built-in runtime's LlamaRole is only `chat | embedding`, so every chat task
  // shares ONE sidecar: asking it for a different model STOPS the running process and
  // cold-starts the other (llamaRuntimeService.ensureRunning). Two built-in chat models
  // therefore never co-reside — they thrash. Claiming co-residency there is simply
  // false, and it is the family the reporting user actually runs.

  it('describes THRASHING, not co-residency, when both models are built-in', async () => {
    const builtin = makeProvider({ id: 'builtin-1', name: 'builtin', hasApiKey: false });
    renderWithSaved([builtin], {
      live_assistant: { providerId: 'builtin-1', model: 'Qwen3-4B-Q4_K_M' },
      summarization: { providerId: 'builtin-1', model: 'gemma-3-12b-it-Q4_K_M' },
    });
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());

    expect(screen.getByText(CONSOLIDATION_BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByText(THRASH_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(CORESIDENCY_TEXT)).not.toBeInTheDocument();
  });

  it('describes CO-RESIDENCY, not thrashing, when both models are external (LM Studio)', () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    renderWithSaved([lmstudio], {
      live_assistant: { providerId: 'lmstudio-1', model: 'llama-3.1-8b-instruct' },
      summarization: { providerId: 'lmstudio-1', model: 'mistral-nemo-instruct' },
    });

    expect(screen.getByText(CONSOLIDATION_BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByText(CORESIDENCY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(THRASH_TEXT)).not.toBeInTheDocument();
  });

  it('never warns for a cloud-only configuration, however many distinct models', () => {
    const openai = makeProvider({ id: 'openai-1', name: 'openai' });
    const anthropic = makeProvider({ id: 'anthropic-1', name: 'anthropic' });
    renderWithSaved([openai, anthropic], {
      summarization: { providerId: 'openai-1', model: 'gpt-5.2' },
      brainstorming: { providerId: 'anthropic-1', model: 'claude-opus-4-6' },
      live_assistant: { providerId: 'openai-1', model: 'gpt-5-mini' },
    });

    expect(screen.queryByText(CONSOLIDATION_BANNER_TEXT)).not.toBeInTheDocument();
  });

  it('consolidation rewrites every local chat task to the Live Assistant pair and the banner disappears', async () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const builtin = makeProvider({ id: 'builtin-1', name: 'builtin', hasApiKey: false });
    const { setTaskModels } = renderWithSaved([lmstudio, builtin], {
      live_assistant: { providerId: 'lmstudio-1', model: 'qwen3-14b-instruct' },
      card_agent: { providerId: 'lmstudio-1', model: 'mistral-nemo-instruct' },
      standup: { providerId: 'builtin-1', model: 'Qwen3-4B-Q4_K_M' },
    });
    await waitFor(() => expect(getLocalModelsView).toHaveBeenCalled());
    expect(screen.getByText(/3 different local chat models are configured/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: CONSOLIDATE_BUTTON_NAME }));

    // Rendered content: the banner re-derives from the same draft state and vanishes
    // — there is no separate "dismissed" flag to fake this.
    expect(screen.queryByText(CONSOLIDATION_BANNER_TEXT)).not.toBeInTheDocument();

    // Save calls: the real "Save Assignments" path, proving exactly which tasks were
    // written and with what pair — the Live Assistant anchor, for all three.
    fireEvent.click(screen.getByText('Save Assignments'));
    await waitFor(() => expect(setTaskModels).toHaveBeenCalledTimes(1));
    expect(setTaskModels).toHaveBeenCalledWith({
      live_assistant: { providerId: 'lmstudio-1', model: 'qwen3-14b-instruct' },
      card_agent: { providerId: 'lmstudio-1', model: 'qwen3-14b-instruct' },
      standup: { providerId: 'lmstudio-1', model: 'qwen3-14b-instruct' },
    });
  });

  it('falls back to the most-assigned pair, tie-broken by task-list order, when Live Assistant is not local', async () => {
    const lmstudio = makeProvider({ id: 'lmstudio-1', name: 'lmstudio' });
    const openai = makeProvider({ id: 'openai-1', name: 'openai' });
    // card_agent and standup share modelA (count 2); background_agent alone has
    // modelB (count 1) — modelA must win. live_assistant is cloud, so it is excluded
    // from the count entirely and cannot be the anchor.
    const { setTaskModels } = renderWithSaved([lmstudio, openai], {
      live_assistant: { providerId: 'openai-1', model: 'gpt-5-mini' },
      card_agent: { providerId: 'lmstudio-1', model: 'modelA' },
      standup: { providerId: 'lmstudio-1', model: 'modelA' },
      background_agent: { providerId: 'lmstudio-1', model: 'modelB' },
    });

    fireEvent.click(screen.getByRole('button', { name: CONSOLIDATE_BUTTON_NAME }));
    fireEvent.click(screen.getByText('Save Assignments'));

    await waitFor(() => expect(setTaskModels).toHaveBeenCalledTimes(1));
    expect(setTaskModels).toHaveBeenCalledWith({
      live_assistant: { providerId: 'openai-1', model: 'gpt-5-mini' },
      card_agent: { providerId: 'lmstudio-1', model: 'modelA' },
      standup: { providerId: 'lmstudio-1', model: 'modelA' },
      background_agent: { providerId: 'lmstudio-1', model: 'modelA' },
    });
  });
});
