// === Preload bridge: Embedding (V3.4) — semantic-index status + backfill/rebuild
// controls for the Settings "Semantic index" section. ===
import { ipcRenderer } from 'electron';
import type { EmbeddingStatus } from '../../shared/types';

// Re-export so existing importers of this module keep resolving the type; the
// single definition now lives in shared/types/embedding.ts (also used by ElectronAPI).
export type { EmbeddingStatus };

export const embeddingBridge = {
  getEmbeddingStatus: (): Promise<EmbeddingStatus> => ipcRenderer.invoke('embedding:status'),
  startEmbeddingBackfill: (): Promise<void> => ipcRenderer.invoke('embedding:backfill'),
  rebuildEmbeddingIndex: (): Promise<void> => ipcRenderer.invoke('embedding:rebuild'),
  dismissEmbeddingBackfill: (): Promise<void> => ipcRenderer.invoke('embedding:dismiss-backfill'),
};
