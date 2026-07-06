// === Preload bridge: Meeting Agent (Live Assistant, LIVE.1 Phase A) ===
import { ipcRenderer } from 'electron';
import type { MeetingAgentMessage } from '../../shared/types';

export const meetingAgentBridge = {
  meetingAgentSend: (meetingId: string, content: string) =>
    ipcRenderer.invoke('meeting-agent:send', meetingId, content),

  meetingAgentLoad: (meetingId: string) => ipcRenderer.invoke('meeting-agent:load', meetingId),

  meetingAgentStop: (meetingId: string) => ipcRenderer.invoke('meeting-agent:stop', meetingId),

  onMeetingAgentTextDelta: (callback: (data: { meetingId: string; threadId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { meetingId: string; threadId: string; chunk: string }) =>
      callback(data);
    ipcRenderer.on('meeting-agent:text-delta', handler);
    return () => {
      ipcRenderer.removeListener('meeting-agent:text-delta', handler);
    };
  },

  onMeetingAgentToolCall: (
    callback: (data: { meetingId: string; threadId: string; toolName: string; args: unknown }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { meetingId: string; threadId: string; toolName: string; args: unknown },
    ) => callback(data);
    ipcRenderer.on('meeting-agent:tool-call', handler);
    return () => {
      ipcRenderer.removeListener('meeting-agent:tool-call', handler);
    };
  },

  onMeetingAgentToolResult: (
    callback: (data: { meetingId: string; threadId: string; toolName: string; result: unknown }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { meetingId: string; threadId: string; toolName: string; result: unknown },
    ) => callback(data);
    ipcRenderer.on('meeting-agent:tool-result', handler);
    return () => {
      ipcRenderer.removeListener('meeting-agent:tool-result', handler);
    };
  },

  onMeetingAgentDone: (callback: (data: { assistantMessage: MeetingAgentMessage; threadId: string }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { assistantMessage: MeetingAgentMessage; threadId: string },
    ) => callback(data);
    ipcRenderer.on('meeting-agent:done', handler);
    return () => {
      ipcRenderer.removeListener('meeting-agent:done', handler);
    };
  },

  onMeetingAgentError: (callback: (data: { meetingId: string; threadId: string; error: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { meetingId: string; threadId: string; error: string }) =>
      callback(data);
    ipcRenderer.on('meeting-agent:error', handler);
    return () => {
      ipcRenderer.removeListener('meeting-agent:error', handler);
    };
  },
};
