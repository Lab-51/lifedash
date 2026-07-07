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

import { pgTable, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import type {
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
  identity: jsonb('identity').$type<TwinIdentity>().notNull().default({}),
  domain: jsonb('domain').$type<TwinDomain>().notNull().default({}),
  projects: jsonb('projects').$type<TwinProject[]>().notNull().default([]),
  people: jsonb('people').$type<TwinPerson[]>().notNull().default([]),
  vocabulary: jsonb('vocabulary').$type<TwinVocabularyTerm[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  preferences: jsonb('preferences').$type<TwinPreferences>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
