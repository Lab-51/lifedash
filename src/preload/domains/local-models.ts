// === Preload bridge: Local (bundled-runtime) GGUF models ===
import { ipcRenderer } from 'electron';
import type {
  CatalogModel,
  LocalModelDownloadProgress,
  LocalModelsView,
  RegisterCustomModelInput,
} from '../../shared/types/localModels';

export const localModelsBridge = {
  /** Catalog + hardware tier + per-model status + in-flight downloads. `force` re-fetches the remote catalog. */
  getLocalModelsView: (force = false): Promise<LocalModelsView> => ipcRenderer.invoke('local-models:view', force),

  downloadLocalModel: (input: { modelId: string; quant?: string }): Promise<LocalModelDownloadProgress> =>
    ipcRenderer.invoke('local-models:download', input),
  pauseLocalModelDownload: (key: string): Promise<boolean> => ipcRenderer.invoke('local-models:pause', key),
  cancelLocalModelDownload: (key: string): Promise<boolean> => ipcRenderer.invoke('local-models:cancel', key),
  listLocalModelDownloads: (): Promise<LocalModelDownloadProgress[]> => ipcRenderer.invoke('local-models:downloads'),
  clearFinishedLocalModelDownloads: (): Promise<void> => ipcRenderer.invoke('local-models:clear-finished'),

  /** Delete one downloaded .gguf; resolves with the reclaimed bytes. */
  deleteLocalModel: (fileName: string): Promise<{ freedBytes: number }> =>
    ipcRenderer.invoke('local-models:delete', fileName),

  registerCustomLocalModel: (input: RegisterCustomModelInput): Promise<CatalogModel> =>
    ipcRenderer.invoke('local-models:register-custom', input),
  unregisterCustomLocalModel: (modelId: string): Promise<boolean> =>
    ipcRenderer.invoke('local-models:unregister-custom', modelId),

  /** Native .gguf picker for "add my own model"; resolves null when cancelled. */
  pickLocalModelFile: (): Promise<string | null> => ipcRenderer.invoke('local-models:pick-file'),

  openLocalModelsFolder: (): Promise<void> => ipcRenderer.invoke('local-models:open-folder'),

  onLocalModelProgress: (callback: (progress: LocalModelDownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: LocalModelDownloadProgress) => callback(progress);
    ipcRenderer.on('local-models:progress', handler);
    return () => {
      ipcRenderer.removeListener('local-models:progress', handler);
    };
  },
};
