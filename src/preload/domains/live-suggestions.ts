// === Preload bridge: Live Suggestions (LIVE.2 Task 2 — accept/dismiss/list;
// Task 5 — live-triage:suggestion event subscription, mirrors the
// onTranscriptSegment pattern in domains/meetings.ts) ===
import { ipcRenderer } from 'electron';
import type { LiveSuggestion } from '../../shared/types';

export const liveSuggestionsBridge = {
  acceptLiveSuggestion: (id: string) => ipcRenderer.invoke('live-suggestions:accept', id),
  dismissLiveSuggestion: (id: string) => ipcRenderer.invoke('live-suggestions:dismiss', id),
  listLiveSuggestions: (meetingId: string) => ipcRenderer.invoke('live-suggestions:list', meetingId),
  onLiveTriageSuggestion: (callback: (suggestion: LiveSuggestion) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, suggestion: LiveSuggestion) => {
      callback(suggestion);
    };
    ipcRenderer.on('live-triage:suggestion', handler);
    return () => {
      ipcRenderer.removeListener('live-triage:suggestion', handler);
    };
  },
};
