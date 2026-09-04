// === Preload bridge: Meetings, recording, whisper, intelligence, diarization, analytics ===
import { ipcRenderer } from 'electron';
import type {
  AudioChunkPayload,
  CreateMeetingInput,
  UpdateMeetingInput,
  RecordingState,
  TranscriptSegment,
  TranscriptionProgress,
  DeleteMeetingOptions,
  MeetingDeleteImpact,
  SpeakerNameMap,
} from '../../shared/types';
import type { ActionItemStatus } from '../../shared/types';
import type { WhisperDownloadProgress } from '../../shared/types';

export const meetingsBridge = {
  // Meetings
  getMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id: string) => ipcRenderer.invoke('meetings:get', id),
  createMeeting: (data: CreateMeetingInput) => ipcRenderer.invoke('meetings:create', data),
  updateMeeting: (id: string, data: UpdateMeetingInput) => ipcRenderer.invoke('meetings:update', id, data),
  updateMeetingParticipants: (meetingId: string, participants: string[]) =>
    ipcRenderer.invoke('meetings:update-participants', { meetingId, participants }),
  deleteMeeting: (id: string, opts?: DeleteMeetingOptions) => ipcRenderer.invoke('meetings:delete', id, opts),
  getMeetingDeleteImpact: (id: string) =>
    ipcRenderer.invoke('meetings:get-delete-impact', id) as Promise<MeetingDeleteImpact>,
  getActionItemCounts: (meetingIds: string[]) => ipcRenderer.invoke('meetings:action-item-counts', meetingIds),
  meetingsGetPendingActionCount: () => ipcRenderer.invoke('meetings:pending-action-count'),

  // Recording
  startRecording: (meetingId: string) => ipcRenderer.invoke('recording:start', meetingId),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  // SPEAKER.1: one message per audio callback carrying all three channel views.
  // Fire-and-forget, as before. Buffer.from COPIES each view, which is required
  // anyway because the underlying ArrayBuffers are reused by the next callback.
  sendAudioChunk: (payload: AudioChunkPayload) =>
    ipcRenderer.send('audio:chunk', {
      mixed: Buffer.from(payload.mixed),
      mic: payload.mic ? Buffer.from(payload.mic) : null,
      system: Buffer.from(payload.system),
    }),
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

  onTranscriptionStatus: (callback: (data: { status: string; reason: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; reason: string }) => {
      callback(data);
    };
    ipcRenderer.on('transcription:status-changed', handler);
    return () => {
      ipcRenderer.removeListener('transcription:status-changed', handler);
    };
  },

  onProcessingProgress: (callback: (progress: TranscriptionProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: TranscriptionProgress) => {
      callback(progress);
    };
    ipcRenderer.on('recording:processing-progress', handler);
    return () => {
      ipcRenderer.removeListener('recording:processing-progress', handler);
    };
  },

  // Whisper Models
  getWhisperModels: () => ipcRenderer.invoke('whisper:list-models'),
  downloadWhisperModel: (fileName: string) => ipcRenderer.invoke('whisper:download-model', fileName),
  hasWhisperModel: () => ipcRenderer.invoke('whisper:has-model'),
  whisperGetActiveModel: () => ipcRenderer.invoke('whisper:get-active-model') as Promise<string | null>,
  whisperSetActiveModel: (fileName: string) => ipcRenderer.invoke('whisper:set-active-model', fileName),
  getWhisperBackend: () => ipcRenderer.invoke('whisper:get-backend') as Promise<string>,
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
  generateBrief: (meetingId: string) => ipcRenderer.invoke('meetings:generate-brief', meetingId),
  generateActionItems: (meetingId: string) => ipcRenderer.invoke('meetings:generate-actions', meetingId),
  getMeetingBrief: (meetingId: string) => ipcRenderer.invoke('meetings:get-brief', meetingId),
  getMeetingActionItems: (meetingId: string) => ipcRenderer.invoke('meetings:get-actions', meetingId),
  updateActionItemStatus: (id: string, status: ActionItemStatus) =>
    ipcRenderer.invoke('meetings:update-action-status', id, status),
  convertActionToCard: (actionItemId: string, columnId: string) =>
    ipcRenderer.invoke('meetings:convert-action-to-card', actionItemId, columnId),

  // POST-FLOW.1: fires after EVERY brief persist (success and failure cards,
  // auto and manual paths alike) so the renderer can update in place.
  onBriefReady: (callback: (data: { meetingId: string; failed: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { meetingId: string; failed: boolean }) => {
      callback(data);
    };
    ipcRenderer.on('meeting:brief-ready', handler);
    return () => {
      ipcRenderer.removeListener('meeting:brief-ready', handler);
    };
  },

  // Diarization
  diarizeMeeting: (meetingId: string) => ipcRenderer.invoke('meeting:diarize', meetingId),

  // Speaker names (SPEAKER.1) — both return the FULL stored label -> name map.
  renameSpeaker: (meetingId: string, label: string, name: string | null) =>
    ipcRenderer.invoke('meeting:rename-speaker', { meetingId, label, name }) as Promise<SpeakerNameMap>,
  resolveSpeakerNames: (meetingId: string) =>
    ipcRenderer.invoke('meeting:resolve-speaker-names', meetingId) as Promise<SpeakerNameMap>,

  // Meeting Analytics
  getMeetingAnalytics: (meetingId: string) => ipcRenderer.invoke('meeting:analytics', meetingId),

  // Transcript Search
  searchTranscripts: (query: string, limit?: number) => ipcRenderer.invoke('meetings:search-transcripts', query, limit),

  // Meeting Prep
  meetingsGeneratePrep: (projectId: string) => ipcRenderer.invoke('meetings:generate-prep', projectId),

  // Meeting auto-flow: reassign Unassigned-routed cards to a real project
  reassignFromUnassigned: (meetingId: string, newProjectId: string) =>
    ipcRenderer.invoke('meetings:reassignFromUnassigned', { meetingId, newProjectId }),
};
