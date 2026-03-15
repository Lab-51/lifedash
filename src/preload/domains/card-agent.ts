// === Preload bridge: Card Agent ===
import { ipcRenderer } from 'electron';

export const cardAgentBridge = {
  cardAgentGetThreads: (cardId: string) => ipcRenderer.invoke('card-agent:get-threads', cardId),

  cardAgentCreateThread: (cardId: string, title: string) =>
    ipcRenderer.invoke('card-agent:create-thread', cardId, title),

  cardAgentDeleteThread: (threadId: string) => ipcRenderer.invoke('card-agent:delete-thread', threadId),

  cardAgentSendMessage: (cardId: string, content: string, threadId?: string) =>
    ipcRenderer.invoke('card-agent:send-message', cardId, content, threadId),

  cardAgentGetMessages: (cardId: string, threadId?: string) =>
    ipcRenderer.invoke('card-agent:get-messages', cardId, threadId),

  cardAgentClearMessages: (cardId: string) => ipcRenderer.invoke('card-agent:clear-messages', cardId),

  cardAgentGetMessageCount: (cardId: string) => ipcRenderer.invoke('card-agent:get-message-count', cardId),

  cardAgentAbort: (cardId: string) => ipcRenderer.invoke('card-agent:abort', cardId),

  cardAgentGetModelInfo: () => ipcRenderer.invoke('card-agent:get-model-info'),

  onCardAgentChunk: (callback: (data: { cardId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { cardId: string; chunk: string }) => callback(data);
    ipcRenderer.on('card-agent:stream-chunk', handler);
    return () => {
      ipcRenderer.removeListener('card-agent:stream-chunk', handler);
    };
  },

  onCardAgentToolEvent: (
    callback: (data: {
      cardId: string;
      type: 'call' | 'result';
      toolName: string;
      args?: unknown;
      result?: unknown;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        cardId: string;
        type: 'call' | 'result';
        toolName: string;
        args?: unknown;
        result?: unknown;
      },
    ) => callback(data);
    ipcRenderer.on('card-agent:tool-event', handler);
    return () => {
      ipcRenderer.removeListener('card-agent:tool-event', handler);
    };
  },
};
