// === FILE PURPOSE ===
// Zod validation schemas for IPC input types.
// Each schema mirrors a TypeScript interface from shared/types.ts.
// Used by the IPC validation wrapper to validate incoming data at runtime.

// === DEPENDENCIES ===
// zod v3.25.76+

// === VERIFICATION STATUS ===
// Schemas verified against types.ts interfaces — all input types covered.

import { z } from 'zod';

// ============================================================================
// Reusable primitives
// ============================================================================

const uuid = z.string().uuid();

// ============================================================================
// Enum schemas (mirror union types from types.ts)
// ============================================================================

export const cardPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const cardRelationshipTypeSchema = z.enum(['blocks', 'depends_on', 'related_to']);

export const actionItemStatusSchema = z.enum(['pending', 'approved', 'dismissed', 'converted']);

export const aiProviderNameSchema = z.enum(['openai', 'anthropic', 'ollama', 'kimi']);

export const ideaStatusSchema = z.enum(['new', 'exploring', 'active', 'archived']);

export const effortLevelSchema = z.enum(['trivial', 'small', 'medium', 'large', 'epic']);

export const impactLevelSchema = z.enum(['minimal', 'low', 'medium', 'high', 'critical']);

export const meetingStatusSchema = z.enum(['recording', 'processing', 'completed']);

export const meetingTemplateTypeSchema = z.enum([
  'none', 'standup', 'retro', 'planning', 'brainstorm', 'one_on_one',
]);

export const exportFormatSchema = z.enum(['json', 'csv']);

export const transcriptionProviderTypeSchema = z.enum(['local', 'deepgram', 'assemblyai']);

export const transcriptionApiKeyProviderSchema = z.enum(['deepgram', 'assemblyai']);

export const brainstormSessionStatusSchema = z.enum(['active', 'archived']);

export const autoBackupFrequencySchema = z.enum(['daily', 'weekly', 'off']);

// ============================================================================
// Common
// ============================================================================

export const idParamSchema = uuid;

// ============================================================================
// Projects
// ============================================================================

export const createProjectInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  color: z.string().max(50).optional(),
  hourlyRate: z.number().nullable().optional(),
});

export const updateProjectInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  hourlyRate: z.number().nullable().optional(),
});

// ============================================================================
// Boards
// ============================================================================

export const createBoardInputSchema = z.object({
  projectId: uuid,
  name: z.string().min(1).max(200),
});

export const updateBoardInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

// ============================================================================
// Columns
// ============================================================================

// NOTE: CreateColumnInput does NOT have a position field — the handler auto-calculates it.
export const createColumnInputSchema = z.object({
  boardId: uuid,
  name: z.string().min(1).max(200),
});

export const updateColumnInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
  color: z.string().max(7).nullable().optional(),
});

export const columnReorderSchema = z.array(z.string().uuid());

// ============================================================================
// Cards
// ============================================================================

export const createCardInputSchema = z.object({
  columnId: uuid,
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: cardPrioritySchema.optional(),
});

export const updateCardInputSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: cardPrioritySchema.optional(),
  dueDate: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  archived: z.boolean().optional(),
  columnId: uuid.optional(),
  position: z.number().int().min(0).optional(),
  recurrenceType: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).nullable().optional(),
  recurrenceEndDate: z.string().nullable().optional(),
});

/** Used by the cards:move handler (id is a separate param, so only columnId + position here) */
export const cardMoveSchema = z.object({
  columnId: uuid,
  position: z.number().int().min(0),
});

export const createCardTemplateSchema = z.object({
  projectId: uuid.nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: cardPrioritySchema.optional(),
  labelNames: z.array(z.string().max(100)).max(20).nullable().optional(),
});

// ============================================================================
// Labels
// ============================================================================

export const createLabelInputSchema = z.object({
  projectId: uuid,
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(50),
});

export const updateLabelInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().min(1).max(50).optional(),
});

// ============================================================================
// Card Comments
// ============================================================================

export const createCardCommentInputSchema = z.object({
  cardId: uuid,
  content: z.string().min(1).max(10000),
});

/** For card:updateComment — the content parameter (id is separate) */
export const commentContentSchema = z.string().min(1).max(10000);

// ============================================================================
// Card Relationships
// ============================================================================

export const createCardRelationshipInputSchema = z.object({
  sourceCardId: uuid,
  targetCardId: uuid,
  type: cardRelationshipTypeSchema,
});

// ============================================================================
// Card Attachments
// ============================================================================

/** For card:openAttachment — validates the file path parameter */
export const filePathSchema = z.string().min(1);

// ============================================================================
// AI Providers
// ============================================================================

export const createAIProviderInputSchema = z.object({
  name: aiProviderNameSchema,
  displayName: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional(),
});

export const updateAIProviderInputSchema = z.object({
  displayName: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// Ideas
// ============================================================================

export const createIdeaInputSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  projectId: uuid.optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
});

export const updateIdeaInputSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  projectId: uuid.nullable().optional(),
  status: ideaStatusSchema.optional(),
  effort: effortLevelSchema.nullable().optional(),
  impact: impactLevelSchema.nullable().optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
});

export const convertIdeaToCardInputSchema = z.object({
  ideaId: uuid,
  columnId: uuid,
});

// ============================================================================
// Meetings
// ============================================================================

export const createMeetingInputSchema = z.object({
  title: z.string().min(1).max(500),
  projectId: uuid.optional(),
  template: meetingTemplateTypeSchema.optional(),
  prepBriefing: z.string().optional(),
  transcriptionLanguage: z.string().max(10).optional(),
});

export const updateMeetingInputSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  projectId: uuid.nullable().optional(),
  endedAt: z.string().optional(),
  audioPath: z.string().optional(),
  status: meetingStatusSchema.optional(),
});

// ============================================================================
// Meeting Intelligence
// ============================================================================

export const updateActionItemInputSchema = z.object({
  status: actionItemStatusSchema,
});

export const convertActionToCardInputSchema = z.object({
  actionItemId: uuid,
  columnId: uuid,
});

// ============================================================================
// Brainstorm
// ============================================================================

export const createBrainstormSessionInputSchema = z.object({
  title: z.string().min(1).max(500),
  projectId: uuid.optional(),
});

export const updateBrainstormSessionInputSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  status: brainstormSessionStatusSchema.optional(),
});

/** For brainstorm:send-message — validates the content parameter (sessionId is separate) */
export const brainstormMessageContentSchema = z.string().min(1).max(50000);

// ============================================================================
// Backup & Export
// ============================================================================

export const exportOptionsSchema = z.object({
  format: exportFormatSchema,
  tables: z.array(z.string().min(1)).optional(),
});

export const autoBackupSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: autoBackupFrequencySchema.optional(),
  retention: z.number().int().min(1).max(100).optional(),
  lastRun: z.string().nullable().optional(),
});

// ============================================================================
// Notifications
// ============================================================================

export const notificationPreferencesUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  dueDateReminders: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
  dailyDigestHour: z.number().int().min(0).max(23).optional(),
  recordingReminders: z.boolean().optional(),
});

// ============================================================================
// Settings (key-value store)
// ============================================================================

export const settingKeySchema = z.string().min(1).max(200);
export const settingValueSchema = z.string().max(50000);

// ============================================================================
// Task Structuring
// ============================================================================

/** For task-structuring:quick-plan — name parameter */
export const taskStructuringNameSchema = z.string().min(1).max(500);

/** For task-structuring:generate-plan description and quick-plan description */
export const taskStructuringDescriptionSchema = z.string().max(10000);

// ============================================================================
// Whisper
// ============================================================================

/** For whisper:download-model — model file name */
export const whisperModelNameSchema = z.string().min(1).max(200);

// ============================================================================
// Card Checklist Items
// ============================================================================

// ============================================================================
// Card Agent
// ============================================================================

/** For card-agent:send-message — validates the content parameter */
export const cardAgentMessageContentSchema = z.string().min(1).max(10000);

/** For project-agent:send-message — validates the content parameter */
export const projectAgentMessageContentSchema = z.string().min(1).max(10000);

// ============================================================================
// Card Checklist Items
// ============================================================================

export const addChecklistItemSchema = z.object({
  cardId: uuid,
  title: z.string().min(1).max(500),
});

export const updateChecklistItemSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(500).optional(),
  completed: z.boolean().optional(),
});

export const reorderChecklistItemsSchema = z.object({
  cardId: uuid,
  itemIds: z.array(uuid),
});

export const addChecklistItemsBatchSchema = z.object({
  cardId: uuid,
  titles: z.array(z.string().min(1).max(500)).min(1).max(50),
});

// ============================================================================
// Focus
// ============================================================================

export const focusSaveSessionSchema = z.object({
  cardId: uuid.optional(),
  projectId: uuid.optional(),
  durationMinutes: z.number().int().positive(),
  note: z.string().max(5000).optional(),
  billable: z.boolean().optional(),
});

export const focusGetDailySchema = z.number().int().positive().optional();

export const focusGetHistorySchema = z.object({
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().positive().optional(),
}).optional();

export const focusGetTimeReportSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  projectId: uuid.optional(),
  billableOnly: z.boolean().optional(),
});

export const focusUpdateSessionSchema = z.object({
  projectId: uuid.nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  billable: z.boolean().optional(),
});

export const focusDeleteSessionSchema = uuid;

// ============================================================================
// Gamification
// ============================================================================

export const xpEventTypeSchema = z.enum([
  'focus_session', 'card_create', 'card_complete', 'checklist_complete',
  'project_create', 'project_archive', 'ai_plan', 'meeting_complete',
  'meeting_brief', 'action_convert', 'idea_create', 'idea_convert',
  'idea_analyze', 'brainstorm_start', 'brainstorm_export', 'ai_standup',
  'ai_description', 'ai_breakdown',
]);

export const gamificationGetDailySchema = z.number().int().positive().optional();

// ============================================================================
// Window Controls / Boolean param
// ============================================================================

export const booleanParamSchema = z.boolean();

// ============================================================================
// Notifications (show)
// ============================================================================

export const notificationShowTitleSchema = z.string().min(1).max(200);
export const notificationShowBodySchema = z.string().max(1000);

// ============================================================================
// Recovery (drafts)
// ============================================================================

export const recoveryDraftSchema = z.object({
  cardId: uuid,
  field: z.string().min(1).max(200),
  value: z.string().max(50000),
  projectId: uuid.optional(),
});

export const recoveryDraftClearCardIdSchema = uuid;
export const recoveryDraftClearFieldSchema = z.string().min(1).max(200);

// ============================================================================
// Voice Input
// ============================================================================

export const voiceAudioBufferSchema = z.custom<ArrayBuffer>(
  (val) => val != null && typeof (val as ArrayBuffer).byteLength === 'number' && (val as ArrayBuffer).byteLength > 0,
  { message: 'No audio data received' },
);

// ============================================================================
// Intel Feed
// ============================================================================

export const createIntelSourceInputSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(1000),
  type: z.enum(['rss', 'manual']).optional(),
});

export const updateIntelSourceInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
});

export const addManualItemInputSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().max(500).optional(),
  description: z.string().optional(),
});

export const intelDateFilterSchema = z.enum(['today', 'week', 'all']);

export const intelBriefTypeSchema = z.enum(['daily', 'weekly']);
