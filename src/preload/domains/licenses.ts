// === Preload bridge: License management ===
import { ipcRenderer } from 'electron';

export const licenseBridge = {
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseCheck: () => ipcRenderer.invoke('license:check'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  licenseGetInfo: () => ipcRenderer.invoke('license:get-info'),
  licenseIsFeatureEnabled: (feature: string) => ipcRenderer.invoke('license:is-feature-enabled', feature),
};
