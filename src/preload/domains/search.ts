// === Preload bridge: Search (V3.1 Task 6) -- full-text search across
// sessions/cards/projects. ===
import { ipcRenderer } from 'electron';
import type { SearchResults, SearchAnswer } from '../../shared/types';

export const searchBridge = {
  search: (query: string): Promise<SearchResults> => ipcRenderer.invoke('search:query', query),
  // V3.4 knowledge Q&A "Ask" — explicit action, separate channel from per-keystroke search.
  askKnowledge: (query: string): Promise<SearchAnswer | null> => ipcRenderer.invoke('search:ask', query),
};
