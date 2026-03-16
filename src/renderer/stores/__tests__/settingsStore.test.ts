import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electronAPI on globalThis, then alias window = globalThis so store code
// that reads window.electronAPI works without replacing the entire window object.
vi.stubGlobal('electronAPI', {
  getAIProviders: vi.fn().mockResolvedValue([]),
  createAIProvider: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: 'p-new', ...data })),
  updateAIProvider: vi.fn().mockImplementation((id: string, data: any) => Promise.resolve({ id, ...data })),
  deleteAIProvider: vi.fn().mockResolvedValue(undefined),
  testAIConnection: vi.fn().mockResolvedValue({ success: true }),
  getAllSettings: vi.fn().mockResolvedValue({}),
  setSetting: vi.fn().mockResolvedValue(undefined),
  isEncryptionAvailable: vi.fn().mockResolvedValue(true),
});
vi.stubGlobal('window', globalThis);

// Must import after stubGlobal
const { useSettingsStore } = await import('../settingsStore');

const initialState = {
  providers: [],
  settings: {},
  loading: false,
  error: null,
  connectionTests: {},
  encryptionAvailable: null,
};

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialState);
    vi.clearAllMocks();
  });

  it('has correct initial state defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.providers).toEqual([]);
    expect(state.settings).toEqual({});
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.connectionTests).toEqual({});
    expect(state.encryptionAvailable).toBeNull();
  });

  it('loadProviders fetches and sets providers', async () => {
    const mockProviders = [
      { id: 'p1', name: 'OpenAI', enabled: true },
      { id: 'p2', name: 'Anthropic', enabled: false },
    ];
    vi.mocked(window.electronAPI.getAIProviders).mockResolvedValueOnce(mockProviders as any);

    await useSettingsStore.getState().loadProviders();

    const state = useSettingsStore.getState();
    expect(state.providers).toEqual(mockProviders);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadProviders sets error on failure', async () => {
    vi.mocked(window.electronAPI.getAIProviders).mockRejectedValueOnce(new Error('Network error'));

    await useSettingsStore.getState().loadProviders();

    const state = useSettingsStore.getState();
    expect(state.error).toBe('Network error');
    expect(state.loading).toBe(false);
    expect(state.providers).toEqual([]);
  });

  it('setSetting updates a single setting without affecting others', async () => {
    useSettingsStore.setState({
      settings: { theme: 'dark', language: 'en' },
    });

    await useSettingsStore.getState().setSetting('theme', 'light');

    const settings = useSettingsStore.getState().settings;
    expect(settings['theme']).toBe('light');
    expect(settings['language']).toBe('en');
    expect(window.electronAPI.setSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('multiple settings can be updated independently', async () => {
    await useSettingsStore.getState().setSetting('key1', 'val1');
    await useSettingsStore.getState().setSetting('key2', 'val2');

    const settings = useSettingsStore.getState().settings;
    expect(settings['key1']).toBe('val1');
    expect(settings['key2']).toBe('val2');
  });

  it('createProvider appends to providers list and returns the provider', async () => {
    useSettingsStore.setState({
      providers: [{ id: 'p1', name: 'Existing', enabled: true }] as any,
    });

    const input = { name: 'NewProvider', type: 'openai', apiKey: 'sk-xxx', enabled: true };
    const result = await useSettingsStore.getState().createProvider(input as any);

    const providers = useSettingsStore.getState().providers;
    expect(providers).toHaveLength(2);
    expect(providers[1].name).toBe('NewProvider');
    expect(result.id).toBe('p-new');
  });

  it('deleteProvider removes provider from list', async () => {
    useSettingsStore.setState({
      providers: [
        { id: 'p1', name: 'A', enabled: true },
        { id: 'p2', name: 'B', enabled: false },
      ] as any,
    });

    await useSettingsStore.getState().deleteProvider('p1');

    const providers = useSettingsStore.getState().providers;
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('p2');
  });

  it('hasAnyEnabledProvider returns true when at least one provider is enabled', () => {
    useSettingsStore.setState({
      providers: [
        { id: 'p1', name: 'A', enabled: false },
        { id: 'p2', name: 'B', enabled: true },
      ] as any,
    });

    expect(useSettingsStore.getState().hasAnyEnabledProvider()).toBe(true);
  });

  it('hasAnyEnabledProvider returns false when no providers are enabled', () => {
    useSettingsStore.setState({
      providers: [{ id: 'p1', name: 'A', enabled: false }] as any,
    });

    expect(useSettingsStore.getState().hasAnyEnabledProvider()).toBe(false);
  });

  it('getTaskModels parses JSON from settings and returns null for missing key', () => {
    expect(useSettingsStore.getState().getTaskModels()).toBeNull();

    const models = { summarize: { provider: 'p1', model: 'gpt-4' } };
    useSettingsStore.setState({
      settings: { 'ai.taskModels': JSON.stringify(models) },
    });

    expect(useSettingsStore.getState().getTaskModels()).toEqual(models);
  });

  it('getTaskModels returns null for invalid JSON', () => {
    useSettingsStore.setState({
      settings: { 'ai.taskModels': 'not-valid-json' },
    });

    expect(useSettingsStore.getState().getTaskModels()).toBeNull();
  });

  it('testConnection sets loading then result on success', async () => {
    const result = { success: true };
    vi.mocked(window.electronAPI.testAIConnection).mockResolvedValueOnce(result);

    await useSettingsStore.getState().testConnection('p1');

    const tests = useSettingsStore.getState().connectionTests;
    expect(tests['p1']).toEqual({ loading: false, result });
  });

  it('checkEncryption sets encryptionAvailable', async () => {
    vi.mocked(window.electronAPI.isEncryptionAvailable).mockResolvedValueOnce(false);

    await useSettingsStore.getState().checkEncryption();

    expect(useSettingsStore.getState().encryptionAvailable).toBe(false);
  });
});
