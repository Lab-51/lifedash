// === Preload bridge: Meetings, recording, whisper, intelligence, diarization, analytics ===
import { ipcRenderer } from 'electron';
import type {
  CreateMeetingInput, UpdateMeetingInput,
  RecordingState, TranscriptSegment,
} from '../../shared/types';
import type { ActionItemStatus } from '../../shared/types';
import type { WhisperDownloadProgress } from '../../shared/types';

export const meetingsBridge = {
  // Meetings
  getMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id: string) => ipcRenderer.invoke('meetings:get', id),
  createMeeting: (data: CreateMeetingInput) => ipcRenderer.invoke('meetings:create', data),
  updateMeeting: (id: string, data: UpdateMeetingInput) =>
    ipcRenderer.invoke('meetings:update', id, data),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meetings:delete', id),
  getActionItemCounts: (meetingIds: string[]) =>
    ipcRenderer.invoke('meetings:action-item-counts', meetingIds),
  meetingsGetPendingActionCount: () =>
    ipcRenderer.invoke('meetings:pending-action-count'),

  // Recording
  startRecording: (meetingId: string) =>
    ipcRenderer.invoke('recording:start', meetingId),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  sendAudioChunk: (buffer: ArrayBuffer) =>
    ipcRenderer.send('audio:chunk', Buffer.from(buffer)),
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
  onRecordingState: (callback: (state: RecordingState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => {
      callback(state);
    };
    ipcRenderer.on('recording:state-update', handler);
    return () => {
      ipcRenderer.removeListener('recording:state-update', handler);
    };
  },
  onTranscriptSegment: (callback: (segment: TranscriptSegment) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, segment: TranscriptSegment) => {
      callback(segment);
    };
    ipcRenderer.on('recording:transcript-segment', handler);
    return () => {
      ipcRenderer.removeListener('recording:transcript-segment', handler);
    };
  },

  // Whisper Models
  getWhisperModels: () => ipcRenderer.invoke('whisper:list-models'),
  downloadWhisperModel: (fileName: string) =>
    ipcRenderer.invoke('whisper:download-model', fileName),
  hasWhisperModel: () => ipcRenderer.invoke('whisper:has-model'),
  onWhisperDownloadProgress: (callback: (progress: WhisperDownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: WhisperDownloadProgress) => {
      callback(progress);
    };
    ipcRenderer.on('whisper:download-progress', handler);
    return () => {
      ipcRenderer.removeListener('whisper:download-progress', handler);
    };
  },

  // Meeting Intelligence
  generateBrief: (meetingId: string) =>
    ipcRenderer.invoke('meetings:generate-brief', meetingId),
  generateActionItems: (meetingId: string) =>
    ipcRenderer.invoke('meetings:generate-actions', meetingId),
  getMeetingBrief: (meetingId: string) =>
    ipcRenderer.invoke('meetings:get-brief', meetingId),
  getMeetingActionItems: (meetingId: string) =>
    ipcRenderer.invoke('meetings:get-actions', meetingId),
  updateActionItemStatus: (id: string, status: ActionItemStatus) =>
    ipcRenderer.invoke('meetings:update-action-status', id, status),
  convertActionToCard: (actionItemId: string, columnId: string) =>
    ipcRenderer.invoke('meetings:convert-action-to-card', actionItemId, columnId),

  // Diarization
  diarizeMeeting: (meetingId: string) => ipcRenderer.invoke('meeting:diarize', meetingId),

  // Meeting Analytics
  getMeetingAnalytics: (meetingId: string) =>
    ipcRenderer.invoke('meeting:analytics', meetingId),

  // Transcript Search
  searchTranscripts: (query: string, limit?: number) =>
    ipcRenderer.invoke('meetings:search-transcripts', query, limit),

  // Meeting Prep
  meetingsGeneratePrep: (projectId: string) =>
    ipcRenderer.invoke('meetings:generate-prep', projectId),
};
