// === Preload bridge: Settings and AI providers ===
import { ipcRenderer } from 'electron';
import type { CreateAIProviderInput, UpdateAIProviderInput } from '../../shared/types';

export const settingsBridge = {
  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  deleteSetting: (key: string) => ipcRenderer.invoke('settings:delete', key),
  pickRecordingsFolder: () => ipcRenderer.invoke('settings:pick-recordings-folder'),
  getDefaultRecordingsPath: () => ipcRenderer.invoke('settings:get-default-recordings-path'),
  getProxy: () => ipcRenderer.invoke('settings:getProxy'),
  applyProxy: () => ipcRenderer.invoke('settings:applyProxy'),

  // AI Providers
  getAIProviders: () => ipcRenderer.invoke('ai:list-providers'),
  createAIProvider: (data: CreateAIProviderInput) =>
    ipcRenderer.invoke('ai:create-provider', data),
  updateAIProvider: (id: string, data: UpdateAIProviderInput) =>
    ipcRenderer.invoke('ai:update-provider', id, data),
  deleteAIProvider: (id: string) => ipcRenderer.invoke('ai:delete-provider', id),
  testAIConnection: (id: string) => ipcRenderer.invoke('ai:test-connection', id),
  isEncryptionAvailable: () => ipcRenderer.invoke('ai:encryption-available'),

  // AI Usage
  getAIUsage: () => ipcRenderer.invoke('ai:get-usage'),
  getAIUsageSummary: () => ipcRenderer.invoke('ai:get-usage-summary'),
  getAIUsageDaily: () => ipcRenderer.invoke('ai:get-usage-daily'),

  // Ollama health check
  checkOllama: () => ipcRenderer.invoke('ai:check-ollama'),
};
