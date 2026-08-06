// === FILE PURPOSE ===
// Schema definition for the twin_profile table (V3.3 — Digital Twin creation).
// A SINGLE-ROW store (keyed by a fixed 'singleton' id) describing the
// professional the assistant works for. Each editable section is its own jsonb
// column so the interview UI can patch one section at a time without rewriting
// the whole profile (see twinProfileService.updateProfileSection).
//
// WHY a single row: there is exactly one user per install. Per-section columns
// (not one blob) keep section-level patches to a single-column UPDATE and make
// the shape legible. Defaults keep an insert that touches only one section valid.

import { pgTable, varchar, jsonb, timestamp, uuid, text, pgEnum, index } from 'drizzle-orm/pg-core';
import { meetings } from './meetings';
import type {
  TwinBrief,
  TwinIdentity,
  TwinDomain,
  TwinProject,
  TwinPerson,
  TwinVocabularyTerm,
  TwinPreferences,
} from '../../../shared/types/twin';

/** The one valid primary-key value — this table holds a single profile row. */
export const TWIN_PROFILE_ID = 'singleton';

export const twinProfile = pgTable('twin_profile', {
  // Fixed singleton id; the service always upserts on this value.
  id: varchar('id', { length: 32 }).primaryKey().default(TWIN_PROFILE_ID),
  // The user's own free-form specification (V3.3.5) — seeds deep creation and
  // injects at high priority for every task category.
  brief: jsonb('brief').$type<TwinBrief>().notNull().default({}),
  identity: jsonb('identity').$type<TwinIdentity>().notNull().default({}),
  domain: jsonb('domain').$type<TwinDomain>().notNull().default({}),
  projects: jsonb('projects').$type<TwinProject[]>().notNull().default([]),
  people: jsonb('people').$type<TwinPerson[]>().notNull().default([]),
  vocabulary: jsonb('vocabulary').$type<TwinVocabularyTerm[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  preferences: jsonb('preferences').$type<TwinPreferences>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// V3.4 — Living memory: per-session learned facts
// ---------------------------------------------------------------------------
// Distinct from the authored twin_profile above: twin_facts are SMALL, discrete
// statements the twin LEARNS from meetings (Task 2 extraction), each traceable to
// its source session and individually forgettable/restorable (user-controlled
// memory — see the twin:memory-* IPC surface). `status` drives forget/restore;
// injection reads only `active` facts.

export const twinFactCategoryEnum = pgEnum('twin_fact_category', [
  'person',
  'project',
  'preference',
  'domain',
  'commitment',
]);

export const twinFactStatusEnum = pgEnum('twin_fact_status', ['active', 'forgotten']);

export const twinFacts = pgTable(
  'twin_facts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fact: text('fact').notNull(),
    // Short (2-4 word) LLM-written display label for graph/list surfaces (TWIN-READ.1
    // Task 1). Nullable is deliberate: every pre-existing row starts unlabelled, and a
    // model that ignores the label field at extraction time must not break extraction
    // — a missing label is simply null. Read ONLY through shared/twin/factLabel.ts's
    // labelFor(), which derives a safe fallback so an unlabelled fact never renders
    // blank. NEVER derived/written here — deriving in code was explicitly rejected on
    // quality grounds (see DECISIONS.md).
    label: text('label'),
    category: twinFactCategoryEnum('category').notNull(),
    // set null (not cascade): MEET-DEL.1 SUPERSEDES the original "a learned fact
    // outlives the deletion of its source session" rationale that used to live
    // here — deleteMeeting's default path now hard-deletes a meeting's facts
    // (forgetting is the default, not an outlived side effect). This FK stays
    // set-null, never cascade, to serve ONLY the explicit "keep these facts" path:
    // the row survives with sourceMeetingId nulled by this constraint and
    // sourceMeetingLabel (below) carrying the provenance the FK can no longer
    // hold. The constraint itself remains the last line of defense — see
    // meetingService.deleteMeeting.
    sourceMeetingId: uuid('source_meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    // Snapshot provenance for a KEPT fact whose source meeting was deleted
    // (MEET-DEL.1): "‹meeting title› — deleted ‹YYYY-MM-DD›". Null for every
    // other fact — including interview-learned facts that never had a source
    // meeting — so `sourceMeetingId IS NULL` alone can never tell "never had a
    // source" apart from "source was deleted and kept". Written once, at delete
    // time, by meetingService.deleteMeeting's keep path; never touched again.
    sourceMeetingLabel: text('source_meeting_label'),
    status: twinFactStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('twin_facts_status_idx').on(table.status),
    index('twin_facts_source_meeting_idx').on(table.sourceMeetingId),
  ],
);
