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

export const IDENTITY_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'seniority', label: 'Seniority' },
];

export const DOMAIN_FIELDS: FieldDef[] = [
  { key: 'industry', label: 'Industry' },
  { key: 'company', label: 'Company' },
  { key: 'focus', label: 'Focus' },
];

export const PREFERENCES_FIELDS: FieldDef[] = [
  { key: 'tone', label: 'Tone' },
  { key: 'language', label: 'Language' },
  { key: 'cardTitleStyle', label: 'Card title style' },
];

export const PROJECT_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Project name', required: true },
  { key: 'description', label: 'Description' },
];

export const PERSON_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'role', label: 'Role' },
  { key: 'org', label: 'Organization' },
];

export const VOCAB_FIELDS: FieldDef[] = [
  { key: 'term', label: 'Term', required: true },
  { key: 'meaning', label: 'Meaning', required: true },
];

export const GOAL_FIELDS: FieldDef[] = [{ key: 'value', label: 'Goal', required: true }];
