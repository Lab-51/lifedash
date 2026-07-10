// === FILE PURPOSE ===
// Schema for the Brain's first SEMANTIC layer (V3.4 Task 6): flat `entities`
// (people + topics resolved from a finished session) and the `entity_links`
// join that threads each entity across the sessions it appeared in.
//
// === WHY FLAT (no entity↔entity relationships) ===
// Typed relationships between entities ("Person X owns Project Y") exceed what a
// local 14B model can extract reliably (the known research cliff) — that is a
// LATER, possibly cloud-escalated phase. v3 deliberately stops at flat
// person/topic entities linked to sessions. Do NOT add an entity-entity table.
//
// === DEDUPE KEY ===
// `normalizedName` is UNIQUE — the lowercased/whitespace-collapsed lookup key
// entityService uses for insert-or-get, so "Acme Corp" and "acme corp" resolve to
// ONE entity row. `name` keeps the display form of whichever spelling was seen.
//
// === entity_links ===
// The (entityId, meetingId) join is the entity's PROVENANCE — every link ties an
// entity to a real session it was extracted from. Composite primary key so a
// re-extraction of the same session is idempotent (ON CONFLICT DO NOTHING).

import { pgTable, uuid, varchar, timestamp, index, pgEnum, primaryKey } from 'drizzle-orm/pg-core';
import { meetings } from './meetings';
import type { TwinEntityKind } from '../../../shared/types/twin';

/** Person vs topic — mirrors the frozen `TwinEntityKind` (Task 1). */
export const entityKindEnum = pgEnum('entity_kind', ['person', 'topic']);

export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Display form (the spelling first seen); `normalizedName` is the dedupe key.
  name: varchar('name', { length: 255 }).notNull(),
  // Lowercased/whitespace-collapsed dedupe + lookup key. UNIQUE so insert-or-get
  // (ON CONFLICT DO NOTHING on this column) resolves spelling variants to one row.
  normalizedName: varchar('normalized_name', { length: 255 }).notNull().unique(),
  kind: entityKindEnum('kind').$type<TwinEntityKind>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const entityLinks = pgTable(
  'entity_links',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    // cascade: a link is pure provenance — if its source session is deleted the
    // link goes with it (the entity itself survives if other sessions reference it).
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Composite PK = one link per (entity, session) → re-extraction is idempotent.
    primaryKey({ columns: [table.entityId, table.meetingId] }),
    // Reverse lookup: all entities for a given session (the PK already covers the
    // entity → sessions direction).
    index('entity_links_meeting_idx').on(table.meetingId),
  ],
);
