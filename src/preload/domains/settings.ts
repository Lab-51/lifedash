// === Preload bridge: Settings and AI providers ===
import { ipcRenderer } from 'electron';
import type { CreateAIProviderInput, LlamaRuntimeSnapshot, UpdateAIProviderInput } from '../../shared/types';

export const settingsBridge = {
  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  deleteSetting: (key: string) => ipcRenderer.invoke('settings:delete', key),
  pickRecordingsFolder: () => ipcRenderer.invoke('settings:pick-recordings-folder'),
  getDefaultRecordingsPath: () => ipcRenderer.invoke('settings:get-default-recordings-path'),
  getProxy: () => ipcRenderer.invoke('settings:getProxy'),
  applyProxy: () => ipcRenderer.invoke('settings:applyProxy'),
  factoryReset: () => ipcRenderer.invoke('settings:factory-reset'),

  // AI Providers
  getAIProviders: () => ipcRenderer.invoke('ai:list-providers'),
  createAIProvider: (data: CreateAIProviderInput) => ipcRenderer.invoke('ai:create-provider', data),
  updateAIProvider: (id: string, data: UpdateAIProviderInput) => ipcRenderer.invoke('ai:update-provider', id, data),
  deleteAIProvider: (id: string) => ipcRenderer.invoke('ai:delete-provider', id),
  testAIConnection: (id: string) => ipcRenderer.invoke('ai:test-connection', id),
  isEncryptionAvailable: () => ipcRenderer.invoke('ai:encryption-available'),

  // AI Usage
  getAIUsage: () => ipcRenderer.invoke('ai:get-usage'),
  getAIUsageSummary: () => ipcRenderer.invoke('ai:get-usage-summary'),
  getAIUsageDaily: () => ipcRenderer.invoke('ai:get-usage-daily'),

  // Ollama health check
  checkOllama: () => ipcRenderer.invoke('ai:check-ollama'),

  // LM Studio health check
  checkLmStudio: () => ipcRenderer.invoke('ai:check-lmstudio'),

  // Built-in (bundled llama.cpp) runtime readiness — inspection only, never starts it
  checkBuiltinRuntime: () => ipcRenderer.invoke('ai:check-builtin'),

  // Stop the built-in runtime on the user's command; resolves with the new status.
  stopBuiltinRuntime: () => ipcRenderer.invoke('ai:stop-builtin'),

  // One combined pull for initial local-runtime state (configured / binaryPresent /
  // runtime status / speed + context telemetry). Inspection only — never starts it.
  getRuntimeSnapshot: () => ipcRenderer.invoke('ai:get-runtime-snapshot'),

  // Main pushes the SAME snapshot on lifecycle transitions, after each completed
  // generation (so tok/s is fresh), and when the builtin provider row is added,
  // enabled, disabled or removed. Returns an unsubscribe fn.
  onRuntimeStatus: (callback: (snapshot: LlamaRuntimeSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: LlamaRuntimeSnapshot) => callback(snapshot);
    ipcRenderer.on('ai:runtime-status', handler);
    return () => {
      ipcRenderer.removeListener('ai:runtime-status', handler);
    };
  },
};
