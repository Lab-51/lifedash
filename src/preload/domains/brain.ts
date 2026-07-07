// === Preload bridge: Brain (V3.2 Task 1) — hierarchical mind-map data for the
// whole workspace or a single session. ===
import { ipcRenderer } from 'electron';
import type { BrainScope, BrainTree } from '../../shared/types';

export const brainBridge = {
  buildBrainTree: (scope: BrainScope): Promise<BrainTree> => ipcRenderer.invoke('brain:build-tree', scope),
};
