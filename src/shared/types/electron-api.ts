// === ElectronAPI interface exposed to renderer via contextBridge ===

import type { DatabaseStatus } from './common';
import type {
  Project, Board, Column, Card, CardPriority,
  Label, CreateProjectInput, UpdateProjectInput,
  CreateBoardInput, UpdateBoardInput,
  CreateColumnInput, UpdateColumnInput,
  CreateCardInput, UpdateCardInput,
} from './projects';
import type {
  CardComment, CardRelationship, CardActivity, CardAttachment,
  CardChecklistItem, CardTemplate,
  CreateCardCommentInput, CreateCardRelationshipInput,
  CreateLabelInput, UpdateLabelInput,
} from './cards';
import type {
  AIProvider, AIConnectionTestResult,
  AIUsageEntry, AIUsageSummary, AIUsageDaily,
  CreateAIProviderInput, UpdateAIProviderInput,
} from './ai';
import type {
  Meeting, TranscriptSegment, TranscriptSearchResult, MeetingBrief,
  MeetingTemplateType, RecordingState, MeetingPrepData,
  CreateMeetingInput, UpdateMeetingInput,
} from './meetings';
import type {
  ActionItem, ActionItemStatus,
  ConvertActionToCardResult, MeetingWithTranscript,
} from './intelligence';
import type { WhisperModel, WhisperDownloadProgress } from './whisper';
import type {
  Idea, CreateIdeaInput, UpdateIdeaInput,
  ConvertIdeaToProjectResult, ConvertIdeaToCardResult, IdeaAnalysis,
} from './ideas';
import type {
  BrainstormSession, BrainstormMessage,
  BrainstormSessionWithMessages, BrainstormSessionStatus,
  CreateBrainstormSessionInput,
} from './brainstorm';
import type {
  BackupInfo, BackupProgress,
  ExportOptions, ExportResult,
  AutoBackupSettings,
} from './backup';
import type { ProjectPlan, TaskBreakdown } from './tasks';
import type { NotificationPreferences } from './notifications';
import type { TranscriptionProviderType, TranscriptionProviderStatus } from './transcription';
import type { MeetingAnalytics } from './analytics';
import type { FocusSession, FocusDailyData, FocusSessionWithCard, FocusPeriodStats, FocusTimeReport } from './focus';
import type { GamificationStats, Achievement, XpEventType, XpDailyData } from './gamification';
import type { CardAgentMessage, AgentAction } from './card-agent';
import type { ProjectAgentMessage, ProjectAgentAction } from './project-agent';
import type { LicenseInfo } from './license';
import type { AgentInsight, BackgroundAgentPreferences, InsightType, InsightStatus } from './background-agent';

/** API exposed to the renderer via contextBridge in preload.ts */
export interface ElectronAPI {
  platform: NodeJS.Platform;
  appVersion: string;

  // Window controls
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  windowSetAlwaysOnTop: (value: boolean) => Promise<boolean>;
  windowIsAlwaysOnTop: () => Promise<boolean>;
  onWindowMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;
  recordingSetState: (isRecording: boolean) => Promise<void>;
  onRecordingForceStop: (callback: () => void) => () => void;

  // Database
  getDatabaseStatus: () => Promise<DatabaseStatus>;

  // Projects
  getProjects: () => Promise<Project[]>;
  createProject: (data: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectInput) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<Project>;

  // Boards
  getBoards: (projectId: string) => Promise<Board[]>;
  createBoard: (data: CreateBoardInput) => Promise<Board>;
  updateBoard: (id: string, data: UpdateBoardInput) => Promise<Board>;
  deleteBoard: (id: string) => Promise<void>;

  // Columns
  getColumns: (boardId: string) => Promise<Column[]>;
  createColumn: (data: CreateColumnInput) => Promise<Column>;
  updateColumn: (id: string, data: UpdateColumnInput) => Promise<Column>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (boardId: string, columnIds: string[]) => Promise<void>;

  // Cards
  getAllCards: () => Promise<Array<{
    id: string;
    columnId: string;
    title: string;
    description: string | null;
    priority: string;
    archived: boolean;
    completed: boolean;
    updatedAt: string;
    projectId: string;
  }>>;
  getCardsByBoard: (boardId: string) => Promise<Card[]>;
  createCard: (data: CreateCardInput) => Promise<Card>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<{ card: Card; spawnedCard: Card | null }>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (id: string, columnId: string, position: number) => Promise<Card>;

  // Card comments
  getCardComments: (cardId: string) => Promise<CardComment[]>;
  addCardComment: (input: CreateCardCommentInput) => Promise<CardComment>;
  updateCardComment: (id: string, content: string) => Promise<CardComment>;
  deleteCardComment: (id: string) => Promise<void>;
  // Card relationships
  getCardRelationships: (cardId: string) => Promise<CardRelationship[]>;
  getRelationshipsByBoard: (boardId: string) => Promise<CardRelationship[]>;
  addCardRelationship: (input: CreateCardRelationshipInput) => Promise<CardRelationship>;
  deleteCardRelationship: (id: string) => Promise<void>;
  // Card activity log
  getCardActivities: (cardId: string) => Promise<CardActivity[]>;

  // Card Attachments
  getCardAttachments: (cardId: string) => Promise<CardAttachment[]>;
  addCardAttachment: (cardId: string) => Promise<CardAttachment | null>;
  deleteCardAttachment: (id: string) => Promise<void>;
  openCardAttachment: (filePath: string) => Promise<void>;

  // Card Checklist Items
  getChecklistItems: (cardId: string) => Promise<CardChecklistItem[]>;
  addChecklistItem: (cardId: string, title: string) => Promise<CardChecklistItem>;
  updateChecklistItem: (id: string, updates: { title?: string; completed?: boolean }) => Promise<CardChecklistItem>;
  deleteChecklistItem: (id: string) => Promise<void>;
  reorderChecklistItems: (cardId: string, itemIds: string[]) => Promise<void>;
  addChecklistItemsBatch: (cardId: string, titles: string[]) => Promise<CardChecklistItem[]>;

  // Card AI
  generateCardDescription: (cardId: string) => Promise<{ description: string }>;

  // Card Templates
  getCardTemplates: (projectId?: string) => Promise<CardTemplate[]>;
  createCardTemplate: (input: { projectId?: string | null; name: string; description?: string | null; priority?: CardPriority; labelNames?: string[] | null }) => Promise<CardTemplate>;
  deleteCardTemplate: (id: string) => Promise<void>;
  saveCardAsTemplate: (cardId: string, name?: string) => Promise<CardTemplate>;

  // Labels
  getLabels: (projectId: string) => Promise<Label[]>;
  createLabel: (data: CreateLabelInput) => Promise<Label>;
  updateLabel: (id: string, data: UpdateLabelInput) => Promise<Label>;
  deleteLabel: (id: string) => Promise<void>;
  attachLabel: (cardId: string, labelId: string) => Promise<void>;
  detachLabel: (cardId: string, labelId: string) => Promise<void>;

  // Settings
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;
  getAllSettings: () => Promise<Record<string, string>>;
  deleteSetting: (key: string) => Promise<void>;
  pickRecordingsFolder: () => Promise<string | null>;
  getDefaultRecordingsPath: () => Promise<string>;
  getProxy: () => Promise<{ url: string; noProxy: string } | null>;
  applyProxy: () => Promise<void>;

  // AI Providers
  getAIProviders: () => Promise<AIProvider[]>;
  createAIProvider: (data: CreateAIProviderInput) => Promise<AIProvider>;
  updateAIProvider: (id: string, data: UpdateAIProviderInput) => Promise<AIProvider>;
  deleteAIProvider: (id: string) => Promise<void>;
  testAIConnection: (id: string) => Promise<AIConnectionTestResult>;
  isEncryptionAvailable: () => Promise<boolean>;

  // AI Usage
  getAIUsage: () => Promise<AIUsageEntry[]>;
  getAIUsageSummary: () => Promise<AIUsageSummary>;
  getAIUsageDaily: () => Promise<AIUsageDaily[]>;

  // Ollama health check
  checkOllama: () => Promise<{ running: boolean; models: string[] }>;

  // Meetings
  getMeetings: () => Promise<Meeting[]>;
  getMeeting: (id: string) => Promise<MeetingWithTranscript | null>;
  createMeeting: (data: CreateMeetingInput) => Promise<Meeting>;
  updateMeeting: (id: string, data: UpdateMeetingInput) => Promise<Meeting>;
  deleteMeeting: (id: string) => Promise<void>;
  getActionItemCounts: (meetingIds: string[]) => Promise<Record<string, number>>;
  meetingsGetPendingActionCount: () => Promise<number>;
  searchTranscripts: (query: string, limit?: number) => Promise<TranscriptSearchResult[]>;
  meetingsGeneratePrep: (projectId: string) => Promise<MeetingPrepData>;

  // Recording
  startRecording: (meetingId: string) => Promise<void>;
  stopRecording: () => Promise<string>;
  sendAudioChunk: (buffer: ArrayBuffer) => void;
  enableLoopbackAudio: () => Promise<void>;
  disableLoopbackAudio: () => Promise<void>;
  onRecordingState: (callback: (state: RecordingState) => void) => () => void;
  onTranscriptSegment: (callback: (segment: TranscriptSegment) => void) => () => void;

  // Whisper Models
  getWhisperModels: () => Promise<WhisperModel[]>;
  downloadWhisperModel: (fileName: string) => Promise<string>;
  hasWhisperModel: () => Promise<boolean>;
  whisperGetActiveModel: () => Promise<string | null>;
  onWhisperDownloadProgress: (callback: (progress: WhisperDownloadProgress) => void) => () => void;

  // Meeting Intelligence
  generateBrief: (meetingId: string) => Promise<MeetingBrief>;
  generateActionItems: (meetingId: string) => Promise<ActionItem[]>;
  getMeetingBrief: (meetingId: string) => Promise<MeetingBrief | null>;
  getMeetingActionItems: (meetingId: string) => Promise<ActionItem[]>;
  updateActionItemStatus: (id: string, status: ActionItemStatus) => Promise<ActionItem>;
  convertActionToCard: (actionItemId: string, columnId: string) => Promise<ConvertActionToCardResult>;

  // Ideas
  getIdeas: () => Promise<Idea[]>;
  getIdea: (id: string) => Promise<Idea | null>;
  createIdea: (data: CreateIdeaInput) => Promise<Idea>;
  updateIdea: (id: string, data: UpdateIdeaInput) => Promise<Idea>;
  deleteIdea: (id: string) => Promise<void>;
  convertIdeaToProject: (id: string) => Promise<ConvertIdeaToProjectResult>;
  convertIdeaToCard: (ideaId: string, columnId: string) => Promise<ConvertIdeaToCardResult>;
  analyzeIdea: (id: string) => Promise<IdeaAnalysis>;

  // Brainstorm
  getBrainstormSessions: () => Promise<BrainstormSession[]>;
  getBrainstormSession: (id: string) => Promise<BrainstormSessionWithMessages | null>;
  createBrainstormSession: (data: CreateBrainstormSessionInput) => Promise<BrainstormSession>;
  updateBrainstormSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) => Promise<BrainstormSession>;
  deleteBrainstormSession: (id: string) => Promise<void>;
  sendBrainstormMessage: (sessionId: string, content: string) => Promise<BrainstormMessage>;
  onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => () => void;
  abortBrainstorm: (sessionId: string) => Promise<void>;
  exportBrainstormToIdea: (sessionId: string, messageId: string) => Promise<Idea>;
  exportBrainstormToCard: (sessionId: string, messageId: string) => Promise<Card>;

  // Backup & Restore
  backupCreate: () => Promise<BackupInfo>;
  backupList: () => Promise<BackupInfo[]>;
  backupRestore: (filePath: string) => Promise<void>;
  backupRestoreFromFile: () => Promise<void>;
  backupDelete: (fileName: string) => Promise<void>;
  backupExport: (options: ExportOptions) => Promise<ExportResult | null>;
  backupAutoSettingsGet: () => Promise<AutoBackupSettings>;
  backupAutoSettingsUpdate: (settings: Partial<AutoBackupSettings>) => Promise<void>;
  onBackupProgress: (callback: (progress: BackupProgress) => void) => () => void;

  // Task Structuring
  taskStructuringGeneratePlan: (projectId: string, description: string) => Promise<ProjectPlan>;
  taskStructuringBreakdown: (cardId: string) => Promise<TaskBreakdown>;
  taskStructuringQuickPlan: (projectName: string, projectDescription: string) => Promise<ProjectPlan>;

  // Notifications
  notificationGetPreferences: () => Promise<NotificationPreferences>;
  notificationUpdatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
  notificationSendTest: () => Promise<void>;
  notificationShow: (title: string, body: string) => Promise<void>;

  // Transcription Provider
  transcriptionGetConfig: () => Promise<TranscriptionProviderStatus>;
  transcriptionSetProvider: (type: TranscriptionProviderType) => Promise<void>;
  transcriptionSetApiKey: (provider: 'deepgram' | 'assemblyai', apiKey: string) => Promise<void>;
  transcriptionTestProvider: (type: TranscriptionProviderType) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;

  // Diarization
  diarizeMeeting: (meetingId: string) => Promise<{ success: boolean; speakers: string[]; error?: string }>;

  // Meeting Analytics
  getMeetingAnalytics: (meetingId: string) => Promise<MeetingAnalytics>;

  // Dashboard
  generateStandup: (projectId?: string) => Promise<{ standup: string }>;
  getActivityData: () => Promise<{ dayCounts: Record<string, number> }>;

  // Focus Sessions
  focusSaveSession: (input: { cardId?: string; projectId?: string; durationMinutes: number; note?: string; billable?: boolean }) =>
    Promise<{ session: FocusSession; stats: GamificationStats; newAchievements: Achievement[] }>;
  focusGetStats: () => Promise<GamificationStats>;
  focusGetDaily: (days?: number) => Promise<FocusDailyData[]>;
  focusGetHistory: (options?: { offset?: number; limit?: number }) =>
    Promise<{ sessions: FocusSessionWithCard[]; total: number }>;
  focusGetPeriodStats: () => Promise<FocusPeriodStats>;
  focusGetTimeReport: (options: { startDate: string; endDate: string; projectId?: string; billableOnly?: boolean }) =>
    Promise<FocusTimeReport>;
  focusUpdateSession: (id: string, input: { projectId?: string | null; note?: string | null; billable?: boolean }) => Promise<void>;
  focusDeleteSession: (id: string) => Promise<void>;

  // Gamification
  gamificationAwardXp: (eventType: XpEventType, entityId?: string) =>
    Promise<{ xpAwarded: number; stats: GamificationStats; newAchievements: Achievement[] }>;
  gamificationGetStats: () => Promise<GamificationStats>;
  gamificationGetAchievements: () => Promise<Achievement[]>;
  gamificationGetDaily: (days?: number) => Promise<XpDailyData[]>;

  // Card Agent
  cardAgentSendMessage: (cardId: string, content: string) =>
    Promise<{ assistantMessage: CardAgentMessage; actions: AgentAction[] } | null>;
  cardAgentGetMessages: (cardId: string) => Promise<CardAgentMessage[]>;
  cardAgentClearMessages: (cardId: string) => Promise<void>;
  cardAgentGetMessageCount: (cardId: string) => Promise<number>;
  cardAgentAbort: (cardId: string) => Promise<void>;
  cardAgentGetModelInfo: () => Promise<{ providerName: string; model: string } | null>;
  onCardAgentChunk: (callback: (data: { cardId: string; chunk: string }) => void) => () => void;
  onCardAgentToolEvent: (callback: (data: {
    cardId: string;
    type: 'call' | 'result';
    toolName: string;
    args?: unknown;
    result?: unknown;
  }) => void) => () => void;

  // Project Agent
  projectAgentSendMessage: (projectId: string, content: string) =>
    Promise<{ assistantMessage: ProjectAgentMessage; actions: ProjectAgentAction[] } | null>;
  projectAgentGetMessages: (projectId: string) => Promise<ProjectAgentMessage[]>;
  projectAgentClearMessages: (projectId: string) => Promise<void>;
  projectAgentGetMessageCount: (projectId: string) => Promise<number>;
  projectAgentAbort: (projectId: string) => Promise<void>;
  projectAgentGetModelInfo: () => Promise<{ providerName: string; model: string } | null>;
  onProjectAgentChunk: (callback: (data: { projectId: string; chunk: string }) => void) => () => void;
  onProjectAgentToolEvent: (callback: (data: {
    projectId: string;
    type: 'call' | 'result';
    toolName: string;
    args?: unknown;
    result?: unknown;
  }) => void) => () => void;

  // License
  licenseActivate: (key: string) => Promise<LicenseInfo>;
  licenseCheck: () => Promise<LicenseInfo>;
  licenseDeactivate: () => Promise<LicenseInfo>;
  licenseGetInfo: () => Promise<LicenseInfo>;
  licenseIsFeatureEnabled: (feature: string) => Promise<boolean>;

  // Background Agent
  backgroundAgentGetPreferences: () => Promise<BackgroundAgentPreferences>;
  backgroundAgentUpdatePreferences: (prefs: Partial<BackgroundAgentPreferences>) => Promise<void>;
  backgroundAgentGetInsights: (projectId: string, options?: { status?: InsightStatus; type?: InsightType; limit?: number }) => Promise<AgentInsight[]>;
  backgroundAgentGetAllInsights: (projectIds?: string[], limit?: number) => Promise<AgentInsight[]>;
  backgroundAgentGetNewCount: () => Promise<number>;
  backgroundAgentMarkRead: (id: string) => Promise<void>;
  backgroundAgentDismiss: (id: string) => Promise<void>;
  backgroundAgentMarkActedOn: (id: string) => Promise<void>;
  backgroundAgentRunNow: () => Promise<{ ran: boolean; reason: string }>;
  backgroundAgentGetDailyUsage: () => Promise<{ date: string; tokensUsed: number }>;
  onBackgroundAgentNewInsights: (callback: (data: { projectId: string; count: number }) => void) => () => void;

  // App-level
  openExternal: (url: string) => Promise<void>;
  onShowCommandPalette: (callback: () => void) => () => void;
  onUpdateStatus: (callback: (data: { status: string; releaseName?: string }) => void) => () => void;
  installUpdate: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
