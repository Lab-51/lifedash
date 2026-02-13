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

// --- Advanced Card Types (R16) ---

export type CardRelationshipType = 'blocks' | 'depends_on' | 'related_to';

export interface CardComment {
  id: string;
  cardId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardRelationship {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  type: CardRelationshipType;
  createdAt: string;
  // Joined titles for display
  sourceCardTitle?: string;
  targetCardTitle?: string;
}

export type CardActivityAction =
  | 'created' | 'updated' | 'moved' | 'commented'
  | 'archived' | 'restored' | 'relationship_added' | 'relationship_removed';

export interface CardActivity {
  id: string;
  cardId: string;
  action: CardActivityAction;
  details: string | null;
  createdAt: string;
}

// Input types
export interface CreateCardCommentInput {
  cardId: string;
  content: string;
}

export interface CreateCardRelationshipInput {
  sourceCardId: string;
  targetCardId: string;
  type: CardRelationshipType;
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
export type AITaskType = 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis' | 'task_structuring' | 'transcription';

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

export type MeetingTemplateType = 'none' | 'standup' | 'retro' | 'planning' | 'brainstorm' | 'one_on_one';

export interface MeetingTemplate {
  type: MeetingTemplateType;
  name: string;
  description: string;
  icon: string;           // Lucide icon name
  agenda: string[];       // Suggested agenda items
  aiPromptHint: string;   // Injected into AI summarization prompt
}

export const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    type: 'none',
    name: 'General',
    description: 'No specific template — general meeting',
    icon: 'MessageSquare',
    agenda: [],
    aiPromptHint: '',
  },
  {
    type: 'standup',
    name: 'Daily Standup',
    description: 'Quick status update — what was done, what is planned, any blockers',
    icon: 'Users',
    agenda: ['What I did yesterday', 'What I plan to do today', 'Blockers or concerns'],
    aiPromptHint: 'This is a daily standup meeting. Focus on: (1) work completed since last standup, (2) planned work for today, (3) blockers or impediments. Keep the summary structured around these three areas.',
  },
  {
    type: 'retro',
    name: 'Retrospective',
    description: 'Team reflection — what went well, what to improve, action items',
    icon: 'RotateCcw',
    agenda: ['What went well', 'What could be improved', 'Action items for next sprint'],
    aiPromptHint: 'This is a retrospective meeting. Organize the summary into: (1) What went well — positive outcomes and successes, (2) What could be improved — pain points and challenges, (3) Action items — concrete steps the team agreed to take.',
  },
  {
    type: 'planning',
    name: 'Sprint Planning',
    description: 'Plan upcoming work — priorities, capacity, commitments',
    icon: 'CalendarCheck',
    agenda: ['Sprint goal', 'Priority items for the sprint', 'Capacity and availability', 'Commitments and assignments'],
    aiPromptHint: 'This is a sprint/iteration planning meeting. Focus on: (1) the sprint goal or objectives, (2) which items were prioritized, (3) capacity considerations, (4) who committed to what work. Track any estimated effort or story points mentioned.',
  },
  {
    type: 'brainstorm',
    name: 'Brainstorming',
    description: 'Creative ideation session — explore ideas freely',
    icon: 'Lightbulb',
    agenda: ['Problem statement or opportunity', 'Idea generation', 'Discussion and evaluation', 'Next steps'],
    aiPromptHint: 'This is a brainstorming session. Capture all ideas discussed, even partial ones. Group related ideas together. Note which ideas received the most interest or support. Highlight any novel or unconventional suggestions.',
  },
  {
    type: 'one_on_one',
    name: '1-on-1',
    description: 'One-on-one meeting — feedback, goals, personal development',
    icon: 'UserCheck',
    agenda: ['Check-in and wellbeing', 'Progress on goals', 'Feedback (both directions)', 'Development and growth', 'Action items'],
    aiPromptHint: 'This is a 1-on-1 meeting. Focus on: (1) personal updates and wellbeing, (2) progress on previously set goals, (3) feedback exchanged, (4) career development topics, (5) agreed action items. Be sensitive with personal topics — summarize without including private details.',
  },
];

export interface Meeting {
  id: string;
  projectId: string | null;
  title: string;
  template: MeetingTemplateType;
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
  template?: MeetingTemplateType;
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

export interface IdeaAnalysis {
  suggestedEffort: EffortLevel;
  suggestedImpact: ImpactLevel;
  feasibilityNotes: string;
  rationale: string;
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

// === BACKUP & EXPORT TYPES ===

export interface BackupInfo {
  fileName: string;
  filePath: string;
  createdAt: string; // ISO timestamp
  sizeBytes: number;
}

export interface BackupProgress {
  phase: 'starting' | 'dumping' | 'saving' | 'restoring' | 'complete' | 'failed';
  message: string;
  error?: string;
}

export type ExportFormat = 'json' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  tables?: string[]; // if omitted, export all user-data tables
}

export interface ExportResult {
  filePath: string;
  format: ExportFormat;
  tables: string[];
  sizeBytes: number;
}

export type AutoBackupFrequency = 'daily' | 'weekly' | 'off';

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  retention: number; // number of backups to keep
  lastRun: string | null; // ISO timestamp or null
}

// === TASK STRUCTURING TYPES ===

export interface ProjectPillar {
  name: string;
  description: string;
  tasks: PillarTask[];
}

export interface PillarTask {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  effort: 'small' | 'medium' | 'large';
  dependencies?: string[];
}

export interface ProjectMilestone {
  name: string;
  description: string;
  taskTitles: string[];
}

export interface ProjectPlan {
  pillars: ProjectPillar[];
  milestones: ProjectMilestone[];
  summary: string;
}

export interface SubtaskSuggestion {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  effort: 'small' | 'medium' | 'large';
  order: number;
}

export interface TaskBreakdown {
  subtasks: SubtaskSuggestion[];
  notes: string;
}

// === NOTIFICATION TYPES ===

export interface NotificationPreferences {
  enabled: boolean;                // Master toggle
  dueDateReminders: boolean;       // Notify when cards are due within 24h
  dailyDigest: boolean;            // Morning summary of tasks/meetings
  dailyDigestHour: number;         // Hour (0-23) to send daily digest (default: 9)
  recordingReminders: boolean;     // Remind to record upcoming meetings
}

export interface DailyDigestData {
  dueToday: Array<{ title: string; projectName: string }>;
  overdue: Array<{ title: string; projectName: string; dueDate: string }>;
  recentMeetings: Array<{ title: string; date: string }>;
}

// === TRANSCRIPTION PROVIDER TYPES ===

export type TranscriptionProviderType = 'local' | 'deepgram' | 'assemblyai';

export interface TranscriptionProviderConfig {
  type: TranscriptionProviderType;
  deepgramKeyEncrypted?: string;    // Encrypted via safeStorage
  assemblyaiKeyEncrypted?: string;  // Encrypted via safeStorage
}

export interface TranscriptionProviderStatus {
  type: TranscriptionProviderType;
  hasDeepgramKey: boolean;
  hasAssemblyaiKey: boolean;
  localModelAvailable: boolean;
}

/** Result from a cloud transcription provider (Deepgram or AssemblyAI) */
export interface TranscriberResult {
  text: string;
  segments: Array<{ text: string; startMs: number; endMs: number }>;
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

  // Card comments
  getCardComments: (cardId: string) => Promise<CardComment[]>;
  addCardComment: (input: CreateCardCommentInput) => Promise<CardComment>;
  updateCardComment: (id: string, content: string) => Promise<CardComment>;
  deleteCardComment: (id: string) => Promise<void>;
  // Card relationships
  getCardRelationships: (cardId: string) => Promise<CardRelationship[]>;
  addCardRelationship: (input: CreateCardRelationshipInput) => Promise<CardRelationship>;
  deleteCardRelationship: (id: string) => Promise<void>;
  // Card activity log
  getCardActivities: (cardId: string) => Promise<CardActivity[]>;

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
  analyzeIdea: (id: string) => Promise<IdeaAnalysis>;

  // Brainstorm
  getBrainstormSessions: () => Promise<BrainstormSession[]>;
  getBrainstormSession: (id: string) => Promise<BrainstormSessionWithMessages | null>;
  createBrainstormSession: (data: CreateBrainstormSessionInput) => Promise<BrainstormSession>;
  updateBrainstormSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) => Promise<BrainstormSession>;
  deleteBrainstormSession: (id: string) => Promise<void>;
  sendBrainstormMessage: (sessionId: string, content: string) => Promise<BrainstormMessage>;
  onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => () => void;
  exportBrainstormToIdea: (sessionId: string, messageId: string) => Promise<Idea>;

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

  // Transcription Provider
  transcriptionGetConfig: () => Promise<TranscriptionProviderStatus>;
  transcriptionSetProvider: (type: TranscriptionProviderType) => Promise<void>;
  transcriptionSetApiKey: (provider: 'deepgram' | 'assemblyai', apiKey: string) => Promise<void>;
  transcriptionTestProvider: (type: TranscriptionProviderType) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
