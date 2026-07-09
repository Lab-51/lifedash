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

/**
 * The user's own free-form specification of who their twin is (V3.3.5). Unlike
 * the structured sections, this is a single short statement the user writes in
 * their own words; it seeds the deep-creation flows (interview / history / web)
 * and is injected at HIGH priority for every task category because it steers
 * everything. Optional so the column default `{}` stays valid.
 */
export interface TwinBrief {
  statement?: string;
}

/** The editable sections of the twin profile — one jsonb column each. */
export interface TwinProfileSections {
  brief: TwinBrief;
  identity: TwinIdentity;
  domain: TwinDomain;
  projects: TwinProject[];
  people: TwinPerson[];
  vocabulary: TwinVocabularyTerm[];
  goals: string[];
  preferences: TwinPreferences;
}

/**
 * The sections the wizard's "Interview me" AI can DRAFT from a free-form answer.
 * Excludes `brief` — the brief is the user's own specification, authored directly
 * and never AI-extracted. twinInterviewService's per-section extraction (and every
 * per-section draft API) is keyed by exactly this set, so it stays the 7 structured
 * sections even as `brief` joins TwinProfileSections.
 */
export type TwinProfileSectionKey = Exclude<keyof TwinProfileSections, 'brief'>;

/** Every patchable section key including `brief` — the full section-patch surface. */
export type TwinProfileKey = keyof TwinProfileSections;

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

// ---------------------------------------------------------------------------
// Deep creation — interview / history mining / web research (V3.3.5)
//
// These are the shared contracts the V3.3.5 "Deep Creation" batch compiles
// against: the deep multi-turn interview (Task 2), history mining (Task 3), web
// research (Task 4), and the creation-model gate (Tasks 5-6). Every result is a
// discriminated union with a `skipped` arm so no deep path can ever hard-fail —
// the same validate-retry-skip discipline the rest of the twin domain uses.
// ---------------------------------------------------------------------------

/** Why a deep-creation step produced no result — drives a non-blocking notice.
 *  (The batch-era placeholder stub reason is gone now that every deep path ships a
 *  real implementation — services return only 'no-model' or 'failed'.) */
export type TwinCreationSkipReason = 'no-model' | 'failed';

/** One turn of the deep interview: a question the app asked and the user's answer. */
export interface TwinQATurn {
  question: string;
  answer: string;
}

/** Where a history-mined draft value came from, so the user can trust/trace it. */
export interface TwinSourceHint {
  kind: 'meeting' | 'brief' | 'project' | 'card';
  id: string;
  label: string;
}

/** A web-research citation backing a drafted value. */
export interface TwinCitation {
  title: string;
  url: string;
}

// --- interview channel payloads + results ---

/** Payload for `twin:interview-next` — asks for the next interview question. */
export interface TwinInterviewNextPayload {
  /** The user's free-form brief (their own specification). May be empty. */
  brief: string;
  /** Sections drafted so far this session (informs what to ask next). */
  profileSoFar: Partial<TwinProfileSections>;
  /** The interview so far. */
  qa: TwinQATurn[];
  /**
   * Researched role/industry background (from `twin:research-role`) when the orchestrated
   * deep flow ran research FIRST. Optional — when present the interview targets the GAPS
   * research can't know (the user's real projects/people/goals/preferences) instead of
   * re-asking generic role basics; absent, the interview behaves exactly as before.
   */
  roleContext?: string;
}

/** Result of `twin:interview-next`. `done` when the interview has enough. */
export type TwinInterviewNextResult =
  | { status: 'ok'; question: string }
  | { status: 'done' }
  | { status: 'skipped'; reason: TwinCreationSkipReason };

/** Payload for `twin:interview-synthesize` — turn the Q&A into a profile draft. */
export interface TwinInterviewSynthesizePayload {
  brief: string;
  qa: TwinQATurn[];
  /** Researched role background (see TwinInterviewNextPayload.roleContext) so synthesis
   *  focuses on what the interview revealed rather than re-deriving generic role facts. */
  roleContext?: string;
}

/** Result of `twin:interview-synthesize` — a draft the user edits before saving. */
export type TwinInterviewSynthesizeResult =
  | { status: 'ok'; draft: Partial<TwinProfileSections> }
  | { status: 'skipped'; reason: TwinCreationSkipReason };

// --- history-mining channel results ---

/**
 * Consent descriptor for `twin:research-history-info`. Computed WITHOUT sending
 * anything to any model, so the renderer can show exactly what would be read and
 * whether it would leave the machine (cloud model) before the user consents.
 */
export interface TwinResearchHistoryInfo {
  excerptCount: number;
  briefCount: number;
  projectCount: number;
  cardCount: number;
  /** Human-readable label of the model that would do the mining. */
  providerLabel: string;
  /** True when that model runs on-device (no data leaves the machine). */
  isLocal: boolean;
}

/** Result of `twin:research-history` — a draft plus the sources it drew from. */
export type TwinResearchResult =
  | { status: 'ok'; draft: Partial<TwinProfileSections>; sources: TwinSourceHint[] }
  | { status: 'skipped'; reason: TwinCreationSkipReason };

// --- web-research channel payload + result ---

/** Payload for `twin:research-web`. */
export interface TwinWebResearchPayload {
  company: string;
  industry: string;
}

/**
 * Result of `twin:research-web`. `unsupported` when the resolved model has no web
 * capability (distinct from `skipped`, which is a runtime failure/absence).
 */
export type TwinWebResearchResult =
  | { status: 'ok'; draft: Partial<TwinProfileSections>; citations: TwinCitation[] }
  | { status: 'unsupported' }
  | { status: 'skipped'; reason: TwinCreationSkipReason };

// --- role-research channel payload + result (orchestrated deep creation) ---

/** Payload for `twin:research-role` — the orchestrated deep flow's role-dossier research.
 *  The user's role/company/industry (seeded from the brief/profile) drive a cited web
 *  search; empty strings are allowed (the service uses whatever is provided + the brief). */
export interface TwinRoleResearchPayload {
  role: string;
  company: string;
  industry: string;
  brief: string;
}

/**
 * A full role-dossier research result: cited, editable STRUCTURED findings the user confirms
 * (domain industry/company/focus, domain vocabulary, typical role goals/priorities, and a
 * refined identity role/seniority) PLUS a prose `roleContext` summary of the role/industry
 * background. The structured `draft` merges into the profile; `roleContext` seeds the
 * gap-focused interview and is shown to the user. Generic "typical people/projects" are
 * deliberately NOT force-fit into the real `people`/`projects` sections — those come from
 * the interview/history so the twin is never populated with fabricated colleagues.
 */
export interface TwinRoleResearchDraft {
  draft: Partial<TwinProfileSections>;
  roleContext: string;
  citations: TwinCitation[];
}

/**
 * Result of `twin:research-role`. `unsupported` when the resolved model has no web-search
 * capability (mirrors web research); `skipped` is a runtime failure/absence.
 */
export type TwinRoleResearchResult =
  | { status: 'ok'; result: TwinRoleResearchDraft }
  | { status: 'unsupported' }
  | { status: 'skipped'; reason: TwinCreationSkipReason };

/**
 * Resolved creation model descriptor for `twin:get-creation-model`. Drives the
 * wizard's mode-fork SOTA notice: deep paths want a frontier cloud model, so the
 * fork warns (never blocks) when `isFrontier` is false.
 */
export interface TwinCreationModel {
  providerLabel: string;
  modelLabel: string;
  isLocal: boolean;
  isFrontier: boolean;
}
