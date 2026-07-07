// === Digital Twin profile types (V3.3) ===
// The twin profile is a single-row store describing the professional the
// assistant works for. It is authored via a structured, multi-step interview
// (source of truth; AI only drafts field values) and injected into the
// assistant / triage / brief prompts as compact context.
//
// Shared with the renderer because the interview form reads/writes these
// section shapes directly. Section-level patch semantics matter: the UI saves
// one section at a time (see twinProfileService.updateProfileSection).

/** Who the user is. */
export interface TwinIdentity {
  name?: string;
  role?: string;
  seniority?: string;
}

/** The user's professional context. */
export interface TwinDomain {
  industry?: string;
  company?: string;
  focus?: string;
}

/** A project the user works on. Free text; optionally linked to a real project id. */
export interface TwinProject {
  name: string;
  description?: string;
  /** Optional link to an existing projects.id row. */
  projectId?: string;
}

/** A person the user regularly works with. */
export interface TwinPerson {
  name: string;
  role?: string;
  org?: string;
}

/** A domain term and what it means, so the assistant speaks the user's language. */
export interface TwinVocabularyTerm {
  term: string;
  meaning: string;
}

/** How the user likes the assistant to communicate and produce output. */
export interface TwinPreferences {
  tone?: string;
  language?: string;
  cardTitleStyle?: string;
}

/** The editable sections of the twin profile — one jsonb column each. */
export interface TwinProfileSections {
  identity: TwinIdentity;
  domain: TwinDomain;
  projects: TwinProject[];
  people: TwinPerson[];
  vocabulary: TwinVocabularyTerm[];
  goals: string[];
  preferences: TwinPreferences;
}

/** Union of the section keys — used for section-level patch APIs. */
export type TwinProfileSectionKey = keyof TwinProfileSections;

/** The full profile as returned to callers (sections + last-updated timestamp). */
export interface TwinProfile extends TwinProfileSections {
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Creation-wizard AI assist (V3.3 Task 4)
// ---------------------------------------------------------------------------

/** Why an AI-assist draft was skipped — drives the wizard's non-blocking message. */
export type TwinInterviewSkipReason = 'no-model' | 'failed';

/**
 * Result of an optional AI-assist interview turn for one section. The wizard's
 * form is the source of truth: an `ok` result carries a DRAFT the user edits
 * before saving; a `skipped` result means "fill the fields manually" (no model
 * configured, or extraction failed after one retry) and NEVER blocks the flow.
 */
export type TwinInterviewDraft<K extends TwinProfileSectionKey = TwinProfileSectionKey> =
  | { status: 'ok'; draft: TwinProfileSections[K] }
  | { status: 'skipped'; reason: TwinInterviewSkipReason };
