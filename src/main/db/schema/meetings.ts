// === FILE PURPOSE ===
// Schema definitions for meetings, transcripts, meeting briefs, and action items.
// Meetings can optionally belong to a project.
// Transcripts store time-indexed text segments from recordings.
// Meeting briefs store AI-generated summaries.
// Action items can be converted to cards on a board.

import { pgTable, uuid, varchar, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { cards } from './cards';

export const meetingStatusEnum = pgEnum('meeting_status', ['recording', 'processing', 'completed']);

export const meetingTemplateEnum = pgEnum('meeting_template', [
  'none',
  'standup',
  'retro',
  'planning',
  'brainstorm',
  'one_on_one',
]);

export const meetings = pgTable('meetings', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull(),
  template: meetingTemplateEnum('template').default('none').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  audioPath: text('audio_path'),
  status: meetingStatusEnum('status').default('recording').notNull(),
  prepBriefing: text('prep_briefing'),
  transcriptionLanguage: varchar('transcription_language', { length: 10 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    startTime: integer('start_time').notNull(), // milliseconds from recording start
    endTime: integer('end_time').notNull(),
    speaker: varchar('speaker', { length: 50 }), // nullable — null means not diarized
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('transcripts_meeting_id_idx').on(table.meetingId)],
);

export const meetingBriefs = pgTable('meeting_briefs', {
  id: uuid('id').defaultRandom().primaryKey(),
  meetingId: uuid('meeting_id')
    .notNull()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const actionItemStatusEnum = pgEnum('action_item_status', ['pending', 'approved', 'dismissed', 'converted']);

export const actionItems = pgTable(
  'action_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    status: actionItemStatusEnum('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('action_items_meeting_id_idx').on(table.meetingId),
    index('action_items_status_idx').on(table.status),
  ],
);
