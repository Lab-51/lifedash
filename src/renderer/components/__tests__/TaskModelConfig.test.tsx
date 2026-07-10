// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AIProvider } from '../../../shared/types';

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
