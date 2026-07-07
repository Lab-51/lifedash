// === FILE PURPOSE ===
// Ordered step configuration for the Twin creation wizard (V3.3 Task 4). One
// entry per interview step (the review step is rendered separately). Each step
// declares its profile section key, heading, icon, whether it is an `object`
// section (a few labeled fields) or a `list` section (repeatable rows), the
// shared FieldDef array, and the free-form "interview me" question shown when
// the user opts into AI assist. Kept as pure config so both the wizard
// orchestrator and the review step iterate the same source.
//
// `goals` is a list section whose stored value is string[] (not objects); the
// wizard maps its single-field `value` rows to/from string[] at the boundary.

import { UserRound, Building2, FolderKanban, Users, BookOpen, Target, SlidersHorizontal } from 'lucide-react';
import type { FieldDef } from './TwinFieldEditors';
import {
  IDENTITY_FIELDS,
  DOMAIN_FIELDS,
  PREFERENCES_FIELDS,
  PROJECT_FIELDS,
  PERSON_FIELDS,
  VOCAB_FIELDS,
  GOAL_FIELDS,
} from './twinFields';
import type { TwinProfileSectionKey } from '../../../shared/types/twin';

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

export interface WizardStep {
  key: TwinProfileSectionKey;
  title: string;
  icon: IconComponent;
  /** `object` -> a few labeled fields; `list` -> repeatable rows. */
  kind: 'object' | 'list';
  fields: FieldDef[];
  /** One-sentence framing shown above the form. */
  blurb: string;
  /** The free-form prompt for the optional AI-assist turn. */
  question: string;
  /** List-only: the "add row" button label. */
  addLabel?: string;
  /** List-only: text shown in the review step when the list is empty. */
  emptyLabel?: string;
}

/**
 * The wizard's working draft — uniform editor shapes (matching TwinFieldEditors):
 * object sections are a flat field map; list sections (incl. goals, whose stored
 * value is string[]) are rows of `value` maps. Converted to/from the concrete
 * TwinProfile section types only at the seed and save boundaries.
 */
export interface WizardDrafts {
  identity: Record<string, string>;
  domain: Record<string, string>;
  preferences: Record<string, string>;
  projects: Record<string, string>[];
  people: Record<string, string>[];
  vocabulary: Record<string, string>[];
  goals: Record<string, string>[];
}

export const WIZARD_STEPS: WizardStep[] = [
  {
    key: 'identity',
    title: 'Identity',
    icon: UserRound,
    kind: 'object',
    fields: IDENTITY_FIELDS,
    blurb: 'Who are you? This grounds every brief, chat reply, and triage suggestion.',
    question: 'Tell me about yourself — your name, your role, and your seniority.',
  },
  {
    key: 'domain',
    title: 'Domain',
    icon: Building2,
    kind: 'object',
    fields: DOMAIN_FIELDS,
    blurb: 'Your professional context — industry, company, and what you focus on.',
    question: 'What industry and company do you work in, and what do you focus on day to day?',
  },
  {
    key: 'projects',
    title: 'Projects',
    icon: FolderKanban,
    kind: 'list',
    fields: PROJECT_FIELDS,
    addLabel: 'Add project',
    emptyLabel: 'No projects added.',
    blurb: 'The projects you are actively working on.',
    question: 'What projects are you working on right now? Name each one with a short description.',
  },
  {
    key: 'people',
    title: 'People',
    icon: Users,
    kind: 'list',
    fields: PERSON_FIELDS,
    addLabel: 'Add person',
    emptyLabel: 'No people added.',
    blurb: 'The people you work with regularly.',
    question: 'Who do you work with regularly? Give names, their roles, and their organizations.',
  },
  {
    key: 'vocabulary',
    title: 'Vocabulary',
    icon: BookOpen,
    kind: 'list',
    fields: VOCAB_FIELDS,
    addLabel: 'Add term',
    emptyLabel: 'No terms added.',
    blurb: 'Domain terms and acronyms so the assistant speaks your language.',
    question: 'Any domain terms or acronyms the assistant should know? Give each term and its meaning.',
  },
  {
    key: 'goals',
    title: 'Goals',
    icon: Target,
    kind: 'list',
    fields: GOAL_FIELDS,
    addLabel: 'Add goal',
    emptyLabel: 'No goals added.',
    blurb: 'What you are trying to achieve — your current priorities.',
    question: 'What are your current goals and priorities?',
  },
  {
    key: 'preferences',
    title: 'Preferences',
    icon: SlidersHorizontal,
    kind: 'object',
    fields: PREFERENCES_FIELDS,
    blurb: 'How you like the assistant to communicate and produce output.',
    question: 'How do you like the assistant to communicate? Tone, language, and how card titles should read.',
  },
];
