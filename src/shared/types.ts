// === FILE PURPOSE ===
// Shared type definitions used across main, preload, and renderer processes.

/** Database connection status returned by db:status IPC handler */
export interface DatabaseStatus {
  connected: boolean;
  message: string;
}

// === DOMAIN TYPES (match DB schema, serialized for IPC) ===

export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  priority: CardPriority;
  dueDate: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  labels?: Label[];
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string;
}

// === INPUT TYPES (for create/update operations) ===

export interface CreateProjectInput {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  archived?: boolean;
}

export interface CreateBoardInput {
  projectId: string;
  name: string;
}

export interface UpdateBoardInput {
  name?: string;
  position?: number;
}

export interface CreateColumnInput {
  boardId: string;
  name: string;
}

export interface UpdateColumnInput {
  name?: string;
  position?: number;
}

export interface CreateCardInput {
  columnId: string;
  title: string;
  description?: string;
  priority?: CardPriority;
}

export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  priority?: CardPriority;
  dueDate?: string | null;
  archived?: boolean;
  columnId?: string;
  position?: number;
}

export interface CreateLabelInput {
  projectId: string;
  name: string;
  color: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

// === AI PROVIDER TYPES ===

export type AIProviderName = 'openai' | 'anthropic' | 'ollama';
export type AITaskType = 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis';

/** AI provider as seen by renderer (no decrypted keys — only hasApiKey boolean) */
export interface AIProvider {
  id: string;
  name: AIProviderName;
  displayName: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  baseUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIProviderInput {
  name: AIProviderName;
  displayName?: string;
  apiKey?: string;       // Plain text — encrypted before storage in main process
  baseUrl?: string;
}

export interface UpdateAIProviderInput {
  displayName?: string;
  apiKey?: string;       // Plain text — encrypted before storage
  baseUrl?: string;
  enabled?: boolean;
}

export interface AIConnectionTestResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface AIUsageEntry {
  id: string;
  providerId: string | null;
  model: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  createdAt: string;
}

export interface AIUsageSummary {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
  byTaskType: Record<string, { tokens: number; cost: number }>;
}

/** Per-task model configuration (stored as JSON in settings table) */
export interface TaskModelConfig {
  providerId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// === MEETING TYPES ===

export type MeetingStatus = 'recording' | 'processing' | 'completed';

export interface Meeting {
  id: string;
  projectId: string | null;
  title: string;
  startedAt: string;    // ISO timestamp
  endedAt: string | null;
  audioPath: string | null;
  status: MeetingStatus;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  content: string;
  startTime: number;    // milliseconds from recording start
  endTime: number;
  createdAt: string;
}

export interface MeetingBrief {
  id: string;
  meetingId: string;
  summary: string;
  createdAt: string;
}

export type ActionItemStatus = 'pending' | 'approved' | 'dismissed' | 'converted';

export interface ActionItem {
  id: string;
  meetingId: string;
  cardId: string | null;
  description: string;
  status: ActionItemStatus;
  createdAt: string;
}

// === MEETING INTELLIGENCE TYPES ===

export interface GenerateBriefInput {
  meetingId: string;
}

export interface GenerateActionsInput {
  meetingId: string;
}

export interface UpdateActionItemInput {
  status: ActionItemStatus;
}

export interface ConvertActionToCardInput {
  actionItemId: string;
  columnId: string;
}

export interface ConvertActionToCardResult {
  actionItem: ActionItem;
  cardId: string;
}

export interface CreateMeetingInput {
  title: string;
  projectId?: string;
}

export interface UpdateMeetingInput {
  title?: string;
  projectId?: string | null;
  endedAt?: string;
  audioPath?: string;
  status?: MeetingStatus;
}

/** Meeting with its transcript segments, brief, and action items (for detail view) */
export interface MeetingWithTranscript extends Meeting {
  segments: TranscriptSegment[];
  brief: MeetingBrief | null;
  actionItems: ActionItem[];
}

/** Recording state pushed from main to renderer via events */
export interface RecordingState {
  isRecording: boolean;
  meetingId: string | null;
  elapsed: number;           // seconds since recording started
  lastTranscript: string;    // most recent transcript text
}

// === WHISPER MODEL TYPES ===

export interface WhisperModel {
  name: string;           // e.g., 'base.en'
  fileName: string;       // e.g., 'ggml-base.en.bin'
  size: string;           // Human-readable: '74 MB'
  description: string;
  available: boolean;     // true if downloaded locally
}

export interface WhisperDownloadProgress {
  fileName: string;
  downloaded: number;     // bytes
  total: number;          // bytes
  percent: number;        // 0-100
}

// === IDEA TYPES ===

export type IdeaStatus = 'new' | 'exploring' | 'active' | 'archived';
export type EffortLevel = 'trivial' | 'small' | 'medium' | 'large' | 'epic';
export type ImpactLevel = 'minimal' | 'low' | 'medium' | 'high' | 'critical';

export interface Idea {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: IdeaStatus;
  effort: EffortLevel | null;
  impact: ImpactLevel | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdeaInput {
  title: string;
  description?: string;
  projectId?: string;
  tags?: string[];
}

export interface UpdateIdeaInput {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  status?: IdeaStatus;
  effort?: EffortLevel | null;
  impact?: ImpactLevel | null;
  tags?: string[];
}

export interface ConvertIdeaToCardInput {
  ideaId: string;
  columnId: string;
}

export interface ConvertIdeaToProjectResult {
  idea: Idea;
  projectId: string;
}

export interface ConvertIdeaToCardResult {
  idea: Idea;
  cardId: string;
}

// === BRAINSTORM TYPES ===

export type BrainstormSessionStatus = 'active' | 'archived';
export type BrainstormMessageRole = 'user' | 'assistant';

export interface BrainstormSession {
  id: string;
  projectId: string | null;
  title: string;
  status: BrainstormSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BrainstormMessage {
  id: string;
  sessionId: string;
  role: BrainstormMessageRole;
  content: string;
  createdAt: string;
}

export interface BrainstormSessionWithMessages extends BrainstormSession {
  messages: BrainstormMessage[];
}

export interface CreateBrainstormSessionInput {
  title: string;
  projectId?: string;
}

/** API exposed to the renderer via contextBridge in preload.ts */
export interface ElectronAPI {
  platform: NodeJS.Platform;

  // Window controls
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;

  // Database
  getDatabaseStatus: () => Promise<DatabaseStatus>;

  // Projects
  getProjects: () => Promise<Project[]>;
  createProject: (data: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectInput) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

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
  getCardsByBoard: (boardId: string) => Promise<Card[]>;
  createCard: (data: CreateCardInput) => Promise<Card>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<Card>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (id: string, columnId: string, position: number) => Promise<Card>;

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

  // Meetings
  getMeetings: () => Promise<Meeting[]>;
  getMeeting: (id: string) => Promise<MeetingWithTranscript | null>;
  createMeeting: (data: CreateMeetingInput) => Promise<Meeting>;
  updateMeeting: (id: string, data: UpdateMeetingInput) => Promise<Meeting>;
  deleteMeeting: (id: string) => Promise<void>;

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

  // Brainstorm
  getBrainstormSessions: () => Promise<BrainstormSession[]>;
  getBrainstormSession: (id: string) => Promise<BrainstormSessionWithMessages | null>;
  createBrainstormSession: (data: CreateBrainstormSessionInput) => Promise<BrainstormSession>;
  updateBrainstormSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) => Promise<BrainstormSession>;
  deleteBrainstormSession: (id: string) => Promise<void>;
  sendBrainstormMessage: (sessionId: string, content: string) => Promise<BrainstormMessage>;
  onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => () => void;
  exportBrainstormToIdea: (sessionId: string, messageId: string) => Promise<Idea>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
