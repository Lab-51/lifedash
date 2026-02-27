// === Preload bridge: Project Agent ===
import { ipcRenderer } from 'electron';

export const projectAgentBridge = {
  projectAgentSendMessage: (projectId: string, content: string) =>
    ipcRenderer.invoke('project-agent:send-message', projectId, content),

  projectAgentGetMessages: (projectId: string) =>
    ipcRenderer.invoke('project-agent:get-messages', projectId),

  projectAgentClearMessages: (projectId: string) =>
    ipcRenderer.invoke('project-agent:clear-messages', projectId),

  projectAgentGetMessageCount: (projectId: string) =>
    ipcRenderer.invoke('project-agent:get-message-count', projectId),

  projectAgentAbort: (projectId: string) =>
    ipcRenderer.invoke('project-agent:abort', projectId),

  projectAgentGetModelInfo: () =>
    ipcRenderer.invoke('project-agent:get-model-info'),

  onProjectAgentChunk: (callback: (data: { projectId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { projectId: string; chunk: string }) =>
      callback(data);
    ipcRenderer.on('project-agent:stream-chunk', handler);
    return () => {
      ipcRenderer.removeListener('project-agent:stream-chunk', handler);
    };
  },

  onProjectAgentToolEvent: (callback: (data: {
    projectId: string;
    type: 'call' | 'result';
    toolName: string;
    args?: unknown;
    result?: unknown;
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: {
      projectId: string;
      type: 'call' | 'result';
      toolName: string;
      args?: unknown;
      result?: unknown;
    }) => callback(data);
    ipcRenderer.on('project-agent:tool-event', handler);
    return () => {
      ipcRenderer.removeListener('project-agent:tool-event', handler);
    };
  },
};
