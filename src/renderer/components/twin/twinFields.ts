// === FILE PURPOSE ===
// Single source of truth for the Twin profile section field definitions (V3.3).
// Shared by the section cards (TwinPage) and the creation wizard (TwinWizard) so
// the field schema lives in ONE place — add a field once and both surfaces pick
// it up. Pure data (no JSX); the FieldDef shape lives in TwinFieldEditors.
//
// Goals are stored as a plain string[]; the editors work in rows, so a goal is
// modeled here as a single-field row keyed `value` (see GOAL_FIELDS) and mapped
// to/from string[] at the save/seed boundary.

import type { FieldDef } from './TwinFieldEditors';
import { SHORT_MAX, TEXT_MAX } from '../../../shared/twinLimits';

/** The brief is a single free-form statement (the user's own specification). */
export const BRIEF_FIELDS: FieldDef[] = [{ key: 'statement', label: 'Statement', max: TEXT_MAX }];

export const IDENTITY_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', max: SHORT_MAX },
  { key: 'role', label: 'Role', max: SHORT_MAX },
  { key: 'seniority', label: 'Seniority', max: SHORT_MAX },
];

export const DOMAIN_FIELDS: FieldDef[] = [
  { key: 'industry', label: 'Industry', max: SHORT_MAX },
  { key: 'company', label: 'Company', max: SHORT_MAX },
  { key: 'focus', label: 'Focus', max: TEXT_MAX },
];

export const PREFERENCES_FIELDS: FieldDef[] = [
  { key: 'tone', label: 'Tone', max: TEXT_MAX },
  { key: 'language', label: 'Language', max: SHORT_MAX },
  { key: 'cardTitleStyle', label: 'Card title style', max: TEXT_MAX },
];

export const PROJECT_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Project name', required: true, max: SHORT_MAX },
  { key: 'description', label: 'Description', max: TEXT_MAX },
];

export const PERSON_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, max: SHORT_MAX },
  { key: 'role', label: 'Role', max: SHORT_MAX },
  { key: 'org', label: 'Organization', max: SHORT_MAX },
];

export const VOCAB_FIELDS: FieldDef[] = [
  { key: 'term', label: 'Term', required: true, max: SHORT_MAX },
  { key: 'meaning', label: 'Meaning', required: true, max: TEXT_MAX },
];

export const GOAL_FIELDS: FieldDef[] = [{ key: 'value', label: 'Goal', required: true, max: TEXT_MAX }];
