// === Preload bridge: Search (V3.1 Task 6) -- full-text search across
// sessions/cards/projects. ===
import { ipcRenderer } from 'electron';
import type { SearchResults } from '../../shared/types';

export const searchBridge = {
  search: (query: string): Promise<SearchResults> => ipcRenderer.invoke('search:query', query),
};
