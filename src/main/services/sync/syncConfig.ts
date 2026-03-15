// Shared configuration, types, and utility functions for the sync engine.
// Defines the table registry, column mappings, and row transformation helpers.

import {
  projects,
  boards,
  columns,
  cards,
  labels,
  cardLabels,
  cardComments,
  cardChecklistItems,
  meetings,
  meetingBriefs,
  actionItems,
  ideas,
  ideaTags,
  brainstormSessions,
  brainstormMessages,
} from '../../db/schema';

// --- Constants ---

export const SYNC_INTERVAL_MS = 60_000; // 60 seconds
export const DEBOUNCE_DELAY_MS = 5_000; // 5 seconds
export const PULL_DEBOUNCE_MS = 5_000; // 5 seconds — max once per 5s for realtime-triggered pulls
export const PULL_BATCH_LIMIT = 500; // Max rows to pull per table per cycle
export const BATCH_SIZE = 100;
export const SETTINGS_KEY_SYNC_ENABLED = 'sync.enabled';
export const SETTINGS_KEY_LAST_SYNCED = 'sync.lastSyncedAt';
export const PULL_TRACKING_PREFIX = 'pull_'; // sync_tracking key prefix for pull watermarks
export const REALTIME_CHANNEL_NAME = 'sync-signal';

// --- Types ---

/**
 * Describes a table that can be synced. Tables with updatedAt use watermark-based
 * incremental sync; tables without it use createdAt; junction tables do full replace.
 */
export interface SyncTableConfig {
  /** PGlite table name (matches Drizzle schema) */
  name: string;
  /** Drizzle table reference */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drizzleTable: any;
  /** Supabase table name (same as PGlite since both are Postgres) */
  supabaseTable: string;
  /** Which timestamp column to use for watermarking ('updatedAt' | 'createdAt' | null for full sync) */
  watermarkColumn: string | null;
  /** DB column name for the watermark (snake_case as stored in PGlite) */
  watermarkDbColumn: string | null;
  /** Columns to exclude from sync (e.g., audioPath for meetings) */
  excludeColumns: string[];
  /** Whether this is a junction table (full replace on each sync) */
  isJunction: boolean;
  /** For upsert conflict resolution — the primary key column(s) */
  conflictTarget: string;
}

// --- Table registry ---

export const SYNC_TABLES: SyncTableConfig[] = [
  {
    name: 'projects',
    drizzleTable: projects,
    supabaseTable: 'projects',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'boards',
    drizzleTable: boards,
    supabaseTable: 'boards',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'columns',
    drizzleTable: columns,
    supabaseTable: 'columns',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'cards',
    drizzleTable: cards,
    supabaseTable: 'cards',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'labels',
    drizzleTable: labels,
    supabaseTable: 'labels',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'card_labels',
    drizzleTable: cardLabels,
    supabaseTable: 'card_labels',
    watermarkColumn: null,
    watermarkDbColumn: null,
    excludeColumns: [],
    isJunction: true,
    conflictTarget: 'card_id,label_id',
  },
  {
    name: 'card_comments',
    drizzleTable: cardComments,
    supabaseTable: 'card_comments',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'card_checklist_items',
    drizzleTable: cardChecklistItems,
    supabaseTable: 'card_checklist_items',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'meetings',
    drizzleTable: meetings,
    supabaseTable: 'meetings',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: ['audioPath', 'prepBriefing'],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'meeting_briefs',
    drizzleTable: meetingBriefs,
    supabaseTable: 'meeting_briefs',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'action_items',
    drizzleTable: actionItems,
    supabaseTable: 'action_items',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'ideas',
    drizzleTable: ideas,
    supabaseTable: 'ideas',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'idea_tags',
    drizzleTable: ideaTags,
    supabaseTable: 'idea_tags',
    watermarkColumn: null,
    watermarkDbColumn: null,
    excludeColumns: [],
    isJunction: true,
    conflictTarget: 'idea_id,tag',
  },
  {
    name: 'brainstorm_sessions',
    drizzleTable: brainstormSessions,
    supabaseTable: 'brainstorm_sessions',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'brainstorm_messages',
    drizzleTable: brainstormMessages,
    supabaseTable: 'brainstorm_messages',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
];

// --- Column name mapping ---

// Drizzle returns camelCase keys; Supabase expects snake_case DB column names.
// This map converts camelCase property names to their snake_case DB column equivalents.
const CAMEL_TO_SNAKE: Record<string, string> = {
  projectId: 'project_id',
  boardId: 'board_id',
  columnId: 'column_id',
  cardId: 'card_id',
  labelId: 'label_id',
  meetingId: 'meeting_id',
  sessionId: 'session_id',
  ideaId: 'idea_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  audioPath: 'audio_path',
  prepBriefing: 'prep_briefing',
  dueDate: 'due_date',
  hourlyRate: 'hourly_rate',
  recurrenceType: 'recurrence_type',
  recurrenceEndDate: 'recurrence_end_date',
  sourceRecurringId: 'source_recurring_id',
  tableName: 'table_name',
  lastSyncedAt: 'last_synced_at',
  startTime: 'start_time',
  endTime: 'end_time',
  fileName: 'file_name',
  filePath: 'file_path',
  fileSize: 'file_size',
  mimeType: 'mime_type',
  transcriptionLanguage: 'transcription_language',
  labelNames: 'label_names',
};

export function camelToSnake(key: string): string {
  return CAMEL_TO_SNAKE[key] || key;
}

// Reverse map: snake_case -> camelCase (built from CAMEL_TO_SNAKE)
const SNAKE_TO_CAMEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([camel, snake]) => [snake, camel]),
);

export function snakeToCamel(key: string): string {
  return SNAKE_TO_CAMEL[key] || key;
}

// --- Row transformation ---

// Supabase returns timestamps as ISO strings. Drizzle expects Date objects
// for timestamp columns (it calls .toISOString() internally). Convert them here.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

// Known text columns that may contain date-like strings as data values.
const TEXT_COLUMNS = new Set([
  'value',
  'content',
  'body',
  'description',
  'summary',
  'text',
  'transcript',
  'title',
  'name',
  'brief',
  'notes',
  'message',
]);

/**
 * Transform a row from Supabase (snake_case keys) to PGlite/Drizzle (camelCase keys),
 * stripping user_id and excluded columns, and converting ISO date strings to Date objects.
 */
export function transformRowFromRemote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
  excludeColumns: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformed: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    if (key === 'user_id') continue; // user_id only exists in Supabase, not in local PGlite
    const camelKey = snakeToCamel(key);
    if (excludeColumns.includes(camelKey)) continue;

    // Convert ISO date strings to Date objects for timestamp columns
    if (!TEXT_COLUMNS.has(camelKey) && typeof value === 'string' && ISO_DATE_RE.test(value)) {
      transformed[camelKey] = new Date(value);
    } else {
      transformed[camelKey] = value;
    }
  }

  return transformed;
}

/**
 * Transform a row from Drizzle (camelCase keys) to Supabase (snake_case keys),
 * adding user_id and removing excluded columns.
 */
export function transformRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
  userId: string,
  excludeColumns: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformed: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    if (excludeColumns.includes(key)) continue;
    const snakeKey = camelToSnake(key);
    transformed[snakeKey] = value;
  }

  transformed.user_id = userId;
  return transformed;
}
