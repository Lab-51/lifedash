// === Preload bridge: Brainstorm sessions ===
import { ipcRenderer } from 'electron';
import type {
  CreateBrainstormSessionInput, BrainstormSessionStatus,
} from '../../shared/types';

export const brainstormBridge = {
  getBrainstormSessions: () => ipcRenderer.invoke('brainstorm:list-sessions'),
  getBrainstormSession: (id: string) =>
    ipcRenderer.invoke('brainstorm:get-session', id),
  createBrainstormSession: (data: CreateBrainstormSessionInput) =>
    ipcRenderer.invoke('brainstorm:create-session', data),
  updateBrainstormSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) =>
    ipcRenderer.invoke('brainstorm:update-session', id, data),
  deleteBrainstormSession: (id: string) =>
    ipcRenderer.invoke('brainstorm:delete-session', id),
  sendBrainstormMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke('brainstorm:send-message', sessionId, content),
  onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; chunk: string }) =>
      callback(data);
    ipcRenderer.on('brainstorm:stream-chunk', handler);
    return () => {
      ipcRenderer.removeListener('brainstorm:stream-chunk', handler);
    };
  },
  abortBrainstorm: (sessionId: string) => ipcRenderer.invoke('brainstorm:abort', sessionId),
  exportBrainstormToIdea: (sessionId: string, messageId: string) =>
    ipcRenderer.invoke('brainstorm:export-to-idea', sessionId, messageId),
  exportBrainstormToCard: (sessionId: string, messageId: string) =>
    ipcRenderer.invoke('brainstorm:export-to-card', sessionId, messageId),
};
