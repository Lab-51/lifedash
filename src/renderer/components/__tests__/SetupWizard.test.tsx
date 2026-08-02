// @vitest-environment jsdom
// LOCAL-RT.1 Task 5 — the setup wizard after the local-first rework. Covers the
// branch structure (local is the headline, LM Studio / Ollama demoted to a
// bring-your-own sub-option, cloud intact), the `ai.taskModels` payload the
// built-in path writes once a model is on disk, and the hard optionality rule:
// leaving at ANY step downloads nothing and changes no configuration.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { AIProvider } from '../../../shared/types';
import { IDLE_RUNTIME, makeView, runtimeIdOf } from '../setup-wizard/__tests__/localModelsFixture';

const setSetting = vi.fn().mockResolvedValue(undefined);
const getAllSettings = vi.fn().mockResolvedValue({});
const createAIProvider = vi.fn();
const getAIProviders = vi.fn().mockResolvedValue([]);
const deleteAIProvider = vi.fn().mockResolvedValue(undefined);
const testAIConnection = vi.fn();
const checkOllama = vi.fn().mockResolvedValue({ running: false, models: [] });
const checkLmStudio = vi.fn().mockResolvedValue({ running: true, models: ['qwen/qwen3-8b'] });
const getLocalModelsView = vi.fn();
const downloadLocalModel = vi.fn().mockResolvedValue({});

vi.stubGlobal('electronAPI', {
  setSetting,
  getSetting: vi.fn().mockResolvedValue(null),
  getAllSettings,
  createAIProvider,
  getAIProviders,
  deleteAIProvider,
  testAIConnection,
  checkOllama,
  checkLmStudio,
  openExternal: vi.fn(),
  isEncryptionAvailable: vi.fn().mockResolvedValue(true),
  getLocalModelsView,
  downloadLocalModel,
  pauseLocalModelDownload: vi.fn().mockResolvedValue(true),
  cancelLocalModelDownload: vi.fn().mockResolvedValue(true),
  deleteLocalModel: vi.fn().mockResolvedValue({ freedBytes: 0 }),
  checkBuiltinRuntime: vi.fn().mockResolvedValue(IDLE_RUNTIME),
  stopBuiltinRuntime: vi.fn(),
  onLocalModelProgress: vi.fn(() => () => {}),
});

const { default: SetupWizard } = await import('../SetupWizard');
const { useSettingsStore } = await import('../../stores/settingsStore');

const BUILTIN_PROVIDER: AIProvider = {
  id: 'prov-builtin',
  name: 'builtin',
  displayName: null,
  enabled: true,
  hasApiKey: false,
  baseUrl: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function renderWizard() {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <SetupWizard onClose={onClose} />
    </MemoryRouter>,
  );
  return onClose;
}

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));

/** welcome → the branching step. */
function gotoBranch() {
  click(/Set up AI now/);
}

/** welcome → branching → the built-in model step, waiting for the catalogue. */
async function gotoBuiltin() {
  gotoBranch();
  click(/Set up the built-in AI/);
  await screen.findByText(/Your machine reports/);
}

/** Choose an already-downloaded model in the built-in step's picker. */
async function pickModel(optionName: string) {
  click('Model to use for the in-meeting assistant');
  fireEvent.click(await screen.findByRole('button', { name: optionName }));
}

/** Every ai.taskModels write the wizard performed, newest last. */
const taskModelWrites = () =>
  setSetting.mock.calls.filter((c) => c[0] === 'ai.taskModels').map((c) => JSON.parse(c[1] as string));

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ providers: [], settings: {} });
  createAIProvider.mockResolvedValue(BUILTIN_PROVIDER);
  testAIConnection.mockResolvedValue({ success: true, latencyMs: 120 });
  getLocalModelsView.mockResolvedValue(makeView({ totalRamGB: 8, downloaded: ['qwen3-4b', 'embeddinggemma-300m'] }));
});

describe('SetupWizard — local is the headline, not the advanced option', () => {
  it('leads with running AI on this computer and drops the terminal/expert framing', () => {
    renderWizard();
    gotoBranch();

    const options = screen.getAllByText(
      /Private — AI runs on this computer|Cloud — I have an API key|Help me get a cloud API key/,
    );
    expect(options.map((el) => el.textContent?.slice(0, 12))).toEqual(['Private — AI', 'Cloud — I ha', 'Help me get ']);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.queryByText(/advanced/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/terminal usage/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/technical users/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/16 GB\+ RAM/)).not.toBeInTheDocument();
  });

  it('keeps LM Studio and Ollama as the bring-your-own sub-option of the local path', async () => {
    renderWizard();
    gotoBranch();

    click('LM Studio');

    expect(await screen.findByText('Configure LM Studio')).toBeInTheDocument();
    await waitFor(() => expect(checkLmStudio).toHaveBeenCalled());
    expect(await screen.findByText('LM Studio is running')).toBeInTheDocument();
  });

  it('still routes Ollama to its existing tutorial + detection flow', async () => {
    renderWizard();
    gotoBranch();

    click('Ollama');

    expect(await screen.findByText('Configure Ollama')).toBeInTheDocument();
    expect(screen.getByText('How to set up Ollama:')).toBeInTheDocument();
    await waitFor(() => expect(checkOllama).toHaveBeenCalled());
  });

  it('leaves both cloud paths intact', async () => {
    renderWizard();
    gotoBranch();
    click(/Cloud — I have an API key/);
    expect(await screen.findByText('Choose a provider')).toBeInTheDocument();

    click('Back');
    click(/Help me get a cloud API key/);
    expect(await screen.findByText('Get an API key')).toBeInTheDocument();
  });

  it('shows the built-in model step under its own indicator label', async () => {
    renderWizard();
    await gotoBuiltin();

    expect(screen.getByText('AI on this computer')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.queryByText('Configure')).not.toBeInTheDocument();
  });
});

describe('SetupWizard — built-in completion writes the task-model routing', () => {
  it('creates the built-in provider, routes live_assistant + embedding, then tests it', async () => {
    renderWizard();
    await gotoBuiltin();

    await pickModel('Qwen3 4B (Q4_K_M) — tool calling');
    // Nothing has been written yet: the pick alone changes no configuration.
    expect(taskModelWrites()).toEqual([]);

    click(/Use this model/);

    await waitFor(() => expect(createAIProvider).toHaveBeenCalledWith({ name: 'builtin' }));
    await waitFor(() => expect(taskModelWrites()).toHaveLength(1));
    expect(taskModelWrites()[0]).toEqual({
      live_assistant: { providerId: 'prov-builtin', model: runtimeIdOf('qwen3-4b') },
      embedding: { providerId: 'prov-builtin', model: runtimeIdOf('embeddinggemma-300m') },
    });
    expect(testAIConnection).toHaveBeenCalledWith('prov-builtin');
    expect(await screen.findByText('Connection successful!')).toBeInTheDocument();
  });

  it('merges over existing assignments instead of replacing them', async () => {
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify({ summarization: { providerId: 'cloud-1', model: 'gpt-5-mini' } }) },
    });
    renderWizard();
    await gotoBuiltin();

    await pickModel('Qwen3 4B (Q4_K_M) — tool calling');
    click(/Use this model/);

    await waitFor(() => expect(taskModelWrites()).toHaveLength(1));
    expect(taskModelWrites()[0]).toMatchObject({
      summarization: { providerId: 'cloud-1', model: 'gpt-5-mini' },
      live_assistant: { providerId: 'prov-builtin', model: runtimeIdOf('qwen3-4b') },
    });
  });

  it('reuses a built-in provider the user already has rather than adding a duplicate', async () => {
    useSettingsStore.setState({ providers: [{ ...BUILTIN_PROVIDER, id: 'existing-builtin' }] });
    renderWizard();
    await gotoBuiltin();

    await pickModel('Qwen3 4B (Q4_K_M) — tool calling');
    click(/Use this model/);

    await waitFor(() => expect(testAIConnection).toHaveBeenCalledWith('existing-builtin'));
    expect(createAIProvider).not.toHaveBeenCalled();
  });

  it('a failed test returns to the model step without destroying the provider', async () => {
    useSettingsStore.setState({ providers: [{ ...BUILTIN_PROVIDER, id: 'existing-builtin' }] });
    testAIConnection.mockResolvedValue({ success: false, error: 'The bundled runtime binary is missing' });
    renderWizard();
    await gotoBuiltin();

    await pickModel('Qwen3 4B (Q4_K_M) — tool calling');
    click(/Use this model/);

    expect(await screen.findByText('Connection failed')).toBeInTheDocument();
    expect(screen.getByText('The bundled runtime binary is missing')).toBeInTheDocument();

    click(/Fix configuration/);

    expect(await screen.findByText(/Your machine reports/)).toBeInTheDocument();
    expect(deleteAIProvider).not.toHaveBeenCalled();
  });
});

describe('SetupWizard — optional at every step', () => {
  const STEPS: [string, () => Promise<void>][] = [
    ['welcome', async () => {}],
    ['have-key', async () => void gotoBranch()],
    ['local-builtin', gotoBuiltin],
    [
      'pick-provider',
      async () => {
        gotoBranch();
        click(/Cloud — I have an API key/);
        await screen.findByText('Choose a provider');
      },
    ],
    [
      'tutorial',
      async () => {
        gotoBranch();
        click(/Help me get a cloud API key/);
        await screen.findByText('Get an API key');
      },
    ],
    [
      'configure',
      async () => {
        gotoBranch();
        click('LM Studio');
        await screen.findByText('Configure LM Studio');
      },
    ],
  ];

  it.each(STEPS)('closing at the %s step downloads nothing and configures nothing', async (_name, goto) => {
    const onClose = renderWizard();
    await goto();

    click('Close');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The only setting the wizard is allowed to write on the way out.
    expect(setSetting.mock.calls.map((c) => c[0])).toEqual(['setupWizard.completed']);
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(createAIProvider).not.toHaveBeenCalled();
    expect(deleteAIProvider).not.toHaveBeenCalled();
  });

  it('the explicit "Skip for now" on the built-in step is equally inert', async () => {
    const onClose = renderWizard();
    await gotoBuiltin();

    click(/Skip for now — nothing is downloaded or changed/);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(taskModelWrites()).toEqual([]);
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(createAIProvider).not.toHaveBeenCalled();
  });

  it('reaching the built-in step alone starts no transfer and creates no provider', async () => {
    renderWizard();
    await gotoBuiltin();

    expect(getLocalModelsView).toHaveBeenCalledWith(false);
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(createAIProvider).not.toHaveBeenCalled();
    expect(taskModelWrites()).toEqual([]);
    expect(screen.getByRole('button', { name: /Use this model/ })).toBeDisabled();
  });
});
