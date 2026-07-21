// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AIProvider, AIProviderName } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Mock window.electronAPI with an auto-stubbing Proxy — TranscriptionProviderSection
// calls several IPC methods on mount; ProviderCard drives state via useSettingsStore
// directly, mirroring TaskModelConfig.test.tsx / SettingsPage.test.tsx.
// ---------------------------------------------------------------------------
const explicitMocks: Record<string, any> = {
  transcriptionGetConfig: vi.fn().mockResolvedValue({
    type: 'deepgram',
    hasDeepgramKey: false,
    hasAssemblyaiKey: false,
    localModelAvailable: false,
  }),
  getWhisperModels: vi.fn().mockResolvedValue([]),
  whisperGetActiveModel: vi.fn().mockResolvedValue(null),
  getWhisperBackend: vi.fn().mockResolvedValue('cpu'),
  getSetting: vi.fn().mockResolvedValue(null),
};

const electronAPIProxy = new Proxy(explicitMocks, {
  get(target, prop) {
    if (prop in target) return target[prop as string];
    if (typeof prop === 'string' && prop.startsWith('on')) {
      const fn = vi.fn().mockReturnValue(() => {});
      target[prop] = fn;
      return fn;
    }
    const fn = vi.fn().mockResolvedValue(null);
    target[prop as string] = fn;
    return fn;
  },
});

vi.stubGlobal('electronAPI', electronAPIProxy);

// ---------------------------------------------------------------------------
// Import store and components AFTER mocking
// ---------------------------------------------------------------------------
const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: ProviderCard, PROVIDER_META } = await import('../ProviderCard');
const { default: TranscriptionProviderSection } = await import('../settings/TranscriptionProviderSection');

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

// Mirrors the AIProviderName union in src/shared/types/ai.ts. If a provider is
// added there without a matching PROVIDER_META entry, the exhaustive Record type
// in ProviderCard.tsx fails to compile (see STORY-5 verification step 3) — this
// runtime test is a second, independent guard against a missing/blank entry.
const ALL_PROVIDER_NAMES: AIProviderName[] = ['openai', 'anthropic', 'google', 'ollama', 'kimi', 'lmstudio'];

describe('ProviderCard — privacy metadata', () => {
  it('classifies every AIProviderName as local or cloud with no gaps', () => {
    for (const name of ALL_PROVIDER_NAMES) {
      const meta = PROVIDER_META[name];
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(['local', 'cloud']).toContain(meta.privacy);
    }
  });

  it('marks local-first providers as local', () => {
    expect(PROVIDER_META.lmstudio.privacy).toBe('local');
    expect(PROVIDER_META.ollama.privacy).toBe('local');
  });

  it('marks hosted providers as cloud', () => {
    expect(PROVIDER_META.openai.privacy).toBe('cloud');
    expect(PROVIDER_META.anthropic.privacy).toBe('cloud');
    expect(PROVIDER_META.google.privacy).toBe('cloud');
    expect(PROVIDER_META.kimi.privacy).toBe('cloud');
  });
});

describe('ProviderCard — privacy pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      connectionTests: {},
      updateProvider: vi.fn().mockResolvedValue(undefined),
      deleteProvider: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('renders a Local pill for a local provider (LM Studio)', () => {
    render(<ProviderCard provider={makeProvider({ name: 'lmstudio' })} />);
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.queryByText('Cloud')).not.toBeInTheDocument();
  });

  it('renders a Cloud pill for a cloud provider (OpenAI)', () => {
    render(<ProviderCard provider={makeProvider({ name: 'openai' })} />);
    expect(screen.getByText('Cloud')).toBeInTheDocument();
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
  });

  it('shows a factual, non-comparative privacy warning on the Kimi card', () => {
    render(<ProviderCard provider={makeProvider({ name: 'kimi' })} />);
    expect(screen.getByText('Cloud')).toBeInTheDocument();
    const warning = screen.getByText(/Moonshot AI/);
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).not.toMatch(/least private|worst|ranking/i);
  });

  it('does not show the Kimi privacy warning on other provider cards', () => {
    render(<ProviderCard provider={makeProvider({ name: 'anthropic' })} />);
    expect(screen.queryByText(/Moonshot AI/)).not.toBeInTheDocument();
  });
});

describe('TranscriptionProviderSection — privacy pills', () => {
  it('shows Local on the Whisper row and Cloud on Deepgram/AssemblyAI rows', async () => {
    render(<TranscriptionProviderSection />);

    const localRow = (await screen.findByText('Local (Whisper)')).closest('div');
    expect(localRow).not.toBeNull();
    expect(within(localRow as HTMLElement).getByText('Local')).toBeInTheDocument();

    const deepgramRow = screen.getByText('Deepgram').closest('div');
    expect(deepgramRow).not.toBeNull();
    expect(within(deepgramRow as HTMLElement).getByText('Cloud')).toBeInTheDocument();

    const assemblyaiRow = screen.getByText('AssemblyAI').closest('div');
    expect(assemblyaiRow).not.toBeNull();
    expect(within(assemblyaiRow as HTMLElement).getByText('Cloud')).toBeInTheDocument();
  });
});
