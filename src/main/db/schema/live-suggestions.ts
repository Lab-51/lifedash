// === FILE PURPOSE ===
// Schema definition for the live_suggestions table (LIVE.2).
// Proactive proposals produced by the in-meeting triage loop: action items,
// decisions, questions, and (LIVE.3) "create project" proposals the user can
// one-tap accept later.
//
// WHY its own table (not action_items): live proposals have a different lifecycle
// (proposed DURING the meeting vs extracted AFTER) and feed the post-meeting
// dedupe. Conflating them would corrupt the MEET-INTEL.1 auto-flow.
// Mirrors the meetings.ts schema conventions.

import { pgTable, uuid, varchar, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { meetings } from './meetings';
import { cards } from './cards';
import { projects } from './projects';

export const liveSuggestionTypeEnum = pgEnum('live_suggestion_type', [
  'action_item',
  'decision',
  'question',
  'project',
]);

export const liveSuggestionStatusEnum = pgEnum('live_suggestion_status', ['proposed', 'accepted', 'dismissed']);

export const liveSuggestions = pgTable(
  'live_suggestions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    type: liveSuggestionTypeEnum('type').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    status: liveSuggestionStatusEnum('status').default('proposed').notNull(),
    // Set when a proposal is accepted into a card (Task 2). set null on card delete.
    acceptedCardId: uuid('accepted_card_id').references(() => cards.id, { onDelete: 'set null' }),
    // Set when a 'project' proposal is accepted — the project it created + linked (LIVE.3).
    // Symmetric provenance with acceptedCardId; set null on project delete mirrors that convention.
    acceptedProjectId: uuid('accepted_project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('live_suggestions_meeting_id_idx').on(table.meetingId)],
);
