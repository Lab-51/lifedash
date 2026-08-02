// @vitest-environment jsdom
// LOCAL-RT.1 Task 4: the built-in (bundled llama.cpp) runtime is offered as a
// provider with no key to paste, no base URL to guess, and an honest readiness
// check — `ai:check-builtin` is a pure read, so opening this form never spawns it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const checkBuiltinRuntime = vi.fn();
const checkOllama = vi.fn().mockResolvedValue({ running: false, models: [] });
const checkLmStudio = vi.fn().mockResolvedValue({ running: false, models: [] });
const createAIProvider = vi.fn().mockResolvedValue({});

vi.stubGlobal('electronAPI', {
  checkBuiltinRuntime,
  checkOllama,
  checkLmStudio,
  createAIProvider,
  getAIProviders: vi.fn().mockResolvedValue([]),
  openExternal: vi.fn(),
});

const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: AddProviderForm } = await import('../AddProviderForm');

const READY = { binaryPresent: true, modelsDir: 'C:/models', models: ['Qwen3-4B-Q4_K_M'], runtime: {} };

beforeEach(() => {
  vi.clearAllMocks();
  checkBuiltinRuntime.mockResolvedValue(READY);
  useSettingsStore.setState({ createProvider: vi.fn().mockResolvedValue({}) } as never);
});

describe('AddProviderForm — built-in runtime option', () => {
  it('offers Built-in AI with a no-API-key description', () => {
    render(<AddProviderForm onClose={vi.fn()} />);

    expect(screen.getByText('Built-in AI')).toBeInTheDocument();
    expect(screen.getByText('Runs on this computer — no API key')).toBeInTheDocument();
  });

  it('hides the API key and base URL fields once Built-in AI is selected', async () => {
    render(<AddProviderForm onClose={vi.fn()} />);
    // OpenAI is the initial selection, so both fields start visible.
    expect(screen.getByText('API Key')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Built-in AI'));

    await waitFor(() => expect(screen.queryByText('API Key')).not.toBeInTheDocument());
    // The sidecar's port is probed per spawn, so a base URL field would be a lie.
    expect(screen.queryByText(/Base URL/)).not.toBeInTheDocument();
    expect(screen.getByText(/No API key needed/)).toBeInTheDocument();
  });

  it('reports how many models are downloaded without starting the runtime', async () => {
    render(<AddProviderForm onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Built-in AI'));

    expect(await screen.findByText(/1 model downloaded and ready/)).toBeInTheDocument();
    expect(checkBuiltinRuntime).toHaveBeenCalledTimes(1);
  });

  it('points at Settings → Local AI when the runtime has no models yet', async () => {
    checkBuiltinRuntime.mockResolvedValue({ ...READY, models: [] });
    render(<AddProviderForm onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Built-in AI'));

    expect(await screen.findByText(/No models downloaded yet/)).toBeInTheDocument();
  });

  it('says so plainly when the bundled runtime binary is missing from the install', async () => {
    checkBuiltinRuntime.mockResolvedValue({ ...READY, binaryPresent: false, models: [] });
    render(<AddProviderForm onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Built-in AI'));

    expect(await screen.findByText(/bundled runtime is not available in this install/)).toBeInTheDocument();
  });

  it('submits without an API key', async () => {
    const createProvider = vi.fn().mockResolvedValue({});
    const onClose = vi.fn();
    useSettingsStore.setState({ createProvider } as never);
    render(<AddProviderForm onClose={onClose} />);

    fireEvent.click(screen.getByText('Built-in AI'));
    fireEvent.click(screen.getByRole('button', { name: /Add Provider/ }));

    await waitFor(() => expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'builtin' })));
    expect(createProvider.mock.calls[0][0].apiKey).toBeUndefined();
  });
});
