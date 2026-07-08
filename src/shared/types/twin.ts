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
