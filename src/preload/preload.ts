// === FILE PURPOSE ===
// Preload script — runs before renderer process loads.
// Exposes a safe API to the renderer via contextBridge.
// All IPC communication goes through this bridge, keeping
// contextIsolation intact and nodeIntegration disabled.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      isMaximized: boolean,
    ) => {
      callback(isMaximized);
    };
    ipcRenderer.on('window:maximize-change', handler);
    // Return cleanup function for React useEffect
    return () => {
      ipcRenderer.removeListener('window:maximize-change', handler);
    };
  },

  // Database
  getDatabaseStatus: () => ipcRenderer.invoke('db:status'),

  // Projects
  getProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (data: any) => ipcRenderer.invoke('projects:create', data),
  updateProject: (id: string, data: any) =>
    ipcRenderer.invoke('projects:update', id, data),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),

  // Boards
  getBoards: (projectId: string) =>
    ipcRenderer.invoke('boards:list', projectId),
  createBoard: (data: any) => ipcRenderer.invoke('boards:create', data),
  updateBoard: (id: string, data: any) =>
    ipcRenderer.invoke('boards:update', id, data),
  deleteBoard: (id: string) => ipcRenderer.invoke('boards:delete', id),

  // Columns
  getColumns: (boardId: string) =>
    ipcRenderer.invoke('columns:list', boardId),
  createColumn: (data: any) => ipcRenderer.invoke('columns:create', data),
  updateColumn: (id: string, data: any) =>
    ipcRenderer.invoke('columns:update', id, data),
  deleteColumn: (id: string) => ipcRenderer.invoke('columns:delete', id),
  reorderColumns: (boardId: string, columnIds: string[]) =>
    ipcRenderer.invoke('columns:reorder', boardId, columnIds),

  // Cards
  getCardsByBoard: (boardId: string) =>
    ipcRenderer.invoke('cards:list-by-board', boardId),
  createCard: (data: any) => ipcRenderer.invoke('cards:create', data),
  updateCard: (id: string, data: any) =>
    ipcRenderer.invoke('cards:update', id, data),
  deleteCard: (id: string) => ipcRenderer.invoke('cards:delete', id),
  moveCard: (id: string, columnId: string, position: number) =>
    ipcRenderer.invoke('cards:move', id, columnId, position),

  // Card comments
  getCardComments: (cardId: string) =>
    ipcRenderer.invoke('card:getComments', cardId),
  addCardComment: (input: { cardId: string; content: string }) =>
    ipcRenderer.invoke('card:addComment', input),
  updateCardComment: (id: string, content: string) =>
    ipcRenderer.invoke('card:updateComment', id, content),
  deleteCardComment: (id: string) =>
    ipcRenderer.invoke('card:deleteComment', id),

  // Card relationships
  getCardRelationships: (cardId: string) =>
    ipcRenderer.invoke('card:getRelationships', cardId),
  addCardRelationship: (input: {
    sourceCardId: string;
    targetCardId: string;
    type: string;
  }) => ipcRenderer.invoke('card:addRelationship', input),
  deleteCardRelationship: (id: string) =>
    ipcRenderer.invoke('card:deleteRelationship', id),

  // Card activities
  getCardActivities: (cardId: string) =>
    ipcRenderer.invoke('card:getActivities', cardId),

  // Labels
  getLabels: (projectId: string) =>
    ipcRenderer.invoke('labels:list', projectId),
  createLabel: (data: any) => ipcRenderer.invoke('labels:create', data),
  updateLabel: (id: string, data: any) =>
    ipcRenderer.invoke('labels:update', id, data),
  deleteLabel: (id: string) => ipcRenderer.invoke('labels:delete', id),
  attachLabel: (cardId: string, labelId: string) =>
    ipcRenderer.invoke('labels:attach', cardId, labelId),
  detachLabel: (cardId: string, labelId: string) =>
    ipcRenderer.invoke('labels:detach', cardId, labelId),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  deleteSetting: (key: string) => ipcRenderer.invoke('settings:delete', key),

  // AI Providers
  getAIProviders: () => ipcRenderer.invoke('ai:list-providers'),
  createAIProvider: (data: any) =>
    ipcRenderer.invoke('ai:create-provider', data),
  updateAIProvider: (id: string, data: any) =>
    ipcRenderer.invoke('ai:update-provider', id, data),
  deleteAIProvider: (id: string) =>
    ipcRenderer.invoke('ai:delete-provider', id),
  testAIConnection: (id: string) =>
    ipcRenderer.invoke('ai:test-connection', id),
  isEncryptionAvailable: () => ipcRenderer.invoke('ai:encryption-available'),

  // AI Usage
  getAIUsage: () => ipcRenderer.invoke('ai:get-usage'),
  getAIUsageSummary: () => ipcRenderer.invoke('ai:get-usage-summary'),

  // Meetings
  getMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id: string) => ipcRenderer.invoke('meetings:get', id),
  createMeeting: (data: any) => ipcRenderer.invoke('meetings:create', data),
  updateMeeting: (id: string, data: any) =>
    ipcRenderer.invoke('meetings:update', id, data),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meetings:delete', id),

  // Recording
  startRecording: (meetingId: string) =>
    ipcRenderer.invoke('recording:start', meetingId),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  sendAudioChunk: (buffer: ArrayBuffer) =>
    ipcRenderer.send('audio:chunk', Buffer.from(buffer)),
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
  onRecordingState: (callback: (state: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: any) => {
      callback(state);
    };
    ipcRenderer.on('recording:state-update', handler);
    return () => {
      ipcRenderer.removeListener('recording:state-update', handler);
    };
  },
  onTranscriptSegment: (callback: (segment: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, segment: any) => {
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
  onWhisperDownloadProgress: (callback: (progress: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => {
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
  updateActionItemStatus: (id: string, status: string) =>
    ipcRenderer.invoke('meetings:update-action-status', id, status),
  convertActionToCard: (actionItemId: string, columnId: string) =>
    ipcRenderer.invoke('meetings:convert-action-to-card', actionItemId, columnId),

  // Ideas
  getIdeas: () => ipcRenderer.invoke('ideas:list'),
  getIdea: (id: string) => ipcRenderer.invoke('ideas:get', id),
  createIdea: (data: any) => ipcRenderer.invoke('ideas:create', data),
  updateIdea: (id: string, data: any) => ipcRenderer.invoke('ideas:update', id, data),
  deleteIdea: (id: string) => ipcRenderer.invoke('ideas:delete', id),
  convertIdeaToProject: (id: string) => ipcRenderer.invoke('ideas:convert-to-project', id),
  convertIdeaToCard: (ideaId: string, columnId: string) =>
    ipcRenderer.invoke('ideas:convert-to-card', ideaId, columnId),
  analyzeIdea: (id: string) => ipcRenderer.invoke('idea:analyze', id),

  // Brainstorm
  getBrainstormSessions: () => ipcRenderer.invoke('brainstorm:list-sessions'),
  getBrainstormSession: (id: string) => ipcRenderer.invoke('brainstorm:get-session', id),
  createBrainstormSession: (data: any) => ipcRenderer.invoke('brainstorm:create-session', data),
  updateBrainstormSession: (id: string, data: any) =>
    ipcRenderer.invoke('brainstorm:update-session', id, data),
  deleteBrainstormSession: (id: string) => ipcRenderer.invoke('brainstorm:delete-session', id),
  sendBrainstormMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke('brainstorm:send-message', sessionId, content),
  onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; chunk: string }) => callback(data);
    ipcRenderer.on('brainstorm:stream-chunk', handler);
    return () => { ipcRenderer.removeListener('brainstorm:stream-chunk', handler); };
  },
  exportBrainstormToIdea: (sessionId: string, messageId: string) =>
    ipcRenderer.invoke('brainstorm:export-to-idea', sessionId, messageId),

  // Backup & Restore
  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (filePath: string) => ipcRenderer.invoke('backup:restore', filePath),
  backupRestoreFromFile: () => ipcRenderer.invoke('backup:restore-from-file'),
  backupDelete: (fileName: string) => ipcRenderer.invoke('backup:delete', fileName),
  backupExport: (options: any) => ipcRenderer.invoke('backup:export', options),
  backupAutoSettingsGet: () => ipcRenderer.invoke('backup:auto-settings-get'),
  backupAutoSettingsUpdate: (settings: any) =>
    ipcRenderer.invoke('backup:auto-settings-update', settings),
  onBackupProgress: (callback: (progress: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) =>
      callback(progress);
    ipcRenderer.on('backup:progress', handler);
    return () => {
      ipcRenderer.removeListener('backup:progress', handler);
    };
  },

  // Task Structuring
  taskStructuringGeneratePlan: (projectId: string, description: string) =>
    ipcRenderer.invoke('task-structuring:generate-plan', projectId, description),
  taskStructuringBreakdown: (cardId: string) =>
    ipcRenderer.invoke('task-structuring:breakdown', cardId),
  taskStructuringQuickPlan: (name: string, description: string) =>
    ipcRenderer.invoke('task-structuring:quick-plan', name, description),
});
