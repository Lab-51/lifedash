// === FILE PURPOSE ===
// Shared built-in card templates — single source of truth used across
// CardDetailModal, BoardColumn, and BoardColumnModern.

import type { CardPriority } from '../../shared/types';

export interface BuiltinTemplate {
  id: string;
  name: string;
  icon: string;
  priority: CardPriority;
  description: string;
}

/** Built-in templates (always available, not DB-backed). */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'bug',
    name: 'Bug Report',
    icon: '\u{1F41B}',
    priority: 'high',
    description:
      '<h2>Steps to Reproduce</h2><ol><li></li></ol><h2>Expected Behavior</h2><p></p><h2>Actual Behavior</h2><p></p><h2>Environment</h2><p></p>',
  },
  {
    id: 'feature',
    name: 'Feature Request',
    icon: '\u2728',
    priority: 'medium',
    description:
      '<h2>User Story</h2><p>As a [user], I want [goal] so that [benefit].</p><h2>Acceptance Criteria</h2><ul><li></li></ul><h2>Notes</h2><p></p>',
  },
  {
    id: 'action',
    name: 'Meeting Action',
    icon: '\u{1F4CB}',
    priority: 'medium',
    description:
      '<h2>Meeting</h2><p></p><h2>Action Required</h2><p></p><h2>Assignee</h2><p></p><h2>Due Date</h2><p></p>',
  },
  {
    id: 'note',
    name: 'Quick Note',
    icon: '\u{1F4DD}',
    priority: 'low',
    description: '<p></p>',
  },
  {
    id: 'research',
    name: 'Research Task',
    icon: '\u{1F50D}',
    priority: 'medium',
    description:
      '<h2>Topic</h2><p></p><h2>Key Questions</h2><ul><li></li></ul><h2>Findings</h2><p></p><h2>Next Steps</h2><p></p>',
  },
];
