// === FILE PURPOSE ===
// Zustand store for app settings and AI provider state management.
// Provides reactive data access for the Settings page and any future
// components that need provider configuration (brainstorming, meetings).
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI (preload bridge)

import { create } from 'zustand';
import type {
  AIProvider,
  CreateAIProviderInput,
  UpdateAIProviderInput,
  AIConnectionTestResult,
  TaskModelConfig,
  AITaskType,
} from '../../shared/types';

interface ConnectionTestState {
  loading: boolean;
  result: AIConnectionTestResult | null;
}

interface SettingsStore {
  // State
  providers: AIProvider[];
  settings: Record<string, string>;
  loading: boolean;
  error: string | null;
  connectionTests: Record<string, ConnectionTestState>;
  encryptionAvailable: boolean | null;

  // Provider actions
  loadProviders: () => Promise<void>;
  createProvider: (data: CreateAIProviderInput) => Promise<AIProvider>;
  updateProvider: (id: string, data: UpdateAIProviderInput) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<void>;

  // Settings actions
  loadSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;

  // Encryption
  checkEncryption: () => Promise<void>;

  // Task model helpers
  getTaskModels: () => Record<AITaskType, TaskModelConfig> | null;
  setTaskModels: (models: Record<AITaskType, TaskModelConfig>) => Promise<void>;

  // Provider helpers
  hasAnyEnabledProvider: () => boolean;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: [],
  settings: {},
  loading: false,
  error: null,
  connectionTests: {},
  encryptionAvailable: null,

  loadProviders: async () => {
    set({ loading: true, error: null });
    try {
      const providers = await window.electronAPI.getAIProviders();
      set({ providers, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load providers',
        loading: false,
      });
    }
  },

  createProvider: async (data) => {
    const provider = await window.electronAPI.createAIProvider(data);
    set({ providers: [...get().providers, provider] });
    return provider;
  },

  updateProvider: async (id, data) => {
    const updated = await window.electronAPI.updateAIProvider(id, data);
    set({
      providers: get().providers.map((p) => (p.id === id ? updated : p)),
    });
  },

  deleteProvider: async (id) => {
    await window.electronAPI.deleteAIProvider(id);
    set({
      providers: get().providers.filter((p) => p.id !== id),
    });
  },

  testConnection: async (id) => {
    set({
      connectionTests: {
        ...get().connectionTests,
        [id]: { loading: true, result: null },
      },
    });
    try {
      const result = await window.electronAPI.testAIConnection(id);
      set({
        connectionTests: {
          ...get().connectionTests,
          [id]: { loading: false, result },
        },
      });
    } catch (error) {
      set({
        connectionTests: {
          ...get().connectionTests,
          [id]: {
            loading: false,
            result: {
              success: false,
              error: error instanceof Error ? error.message : 'Test failed',
            },
          },
        },
      });
    }
  },

  loadSettings: async () => {
    try {
      const settings = await window.electronAPI.getAllSettings();
      set({ settings });
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  },

  setSetting: async (key, value) => {
    await window.electronAPI.setSetting(key, value);
    set({ settings: { ...get().settings, [key]: value } });
  },

  checkEncryption: async () => {
    const available = await window.electronAPI.isEncryptionAvailable();
    set({ encryptionAvailable: available });
  },

  getTaskModels: () => {
    const json = get().settings['ai.taskModels'];
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  },

  setTaskModels: async (models) => {
    const json = JSON.stringify(models);
    await get().setSetting('ai.taskModels', json);
  },

  hasAnyEnabledProvider: () => {
    return get().providers.some((p) => p.enabled);
  },
}));
