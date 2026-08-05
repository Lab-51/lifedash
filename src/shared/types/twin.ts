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

// ---------------------------------------------------------------------------
// V3.4 — Living memory (learned facts) + entities
//
// The shared contracts the V3.4 learning batch compiles against: the per-session
// facts the twin learns (Task 2), the entities session extraction resolves
// (Task 6), and the memory-management IPC surface (list/forget/restore). Frozen
// here so Tasks 2/3/6 touch no shared type file.
// ---------------------------------------------------------------------------

/** What kind of thing a learned fact is about. Mirrors twin_facts.category. */
export type TwinFactCategory = 'person' | 'project' | 'preference' | 'domain' | 'commitment';

/** Lifecycle of a learned fact. `forgotten` facts are excluded from injection but
 *  kept so the user can restore them. Mirrors twin_facts.status. */
export type TwinFactStatus = 'active' | 'forgotten';

/** A discrete fact the twin learned from a session (V3.4). Individually
 *  forgettable/restorable; `active` facts feed profile injection. */
export interface TwinFact {
  id: string;
  fact: string;
  /** Short (2-4 word) LLM-written display label (TWIN-READ.1 Task 1). Null for a
   *  fact extracted before this column existed, a model that ignored the label
   *  field, or a fact the backfill pass hasn't reached yet. NEVER read directly —
   *  always go through shared/twin/factLabel.ts's labelFor(), which derives a
   *  safe fallback so an unlabelled fact never renders blank. */
  label: string | null;
  category: TwinFactCategory;
  /** The session this was learned from, or null if that session was deleted. */
  sourceMeetingId: string | null;
  status: TwinFactStatus;
  createdAt: string;
}

/** A named thing (person or topic) resolved from a session (Task 6 entity
 *  extraction). `normalizedName` is the dedupe/lookup key (lowercased, trimmed);
 *  `name` is the display form. */
export type TwinEntityKind = 'person' | 'topic';
export interface TwinEntity {
  name: string;
  normalizedName: string;
  kind: TwinEntityKind;
}

// --- entity facts (BRAIN-UX.1 Task 1) — per-entity auditable memory ---

/**
 * A discrete fact the twin learned about a Brain entity (person or topic),
 * scoped to `entities.id` rather than the user's own twin profile. Mirrors the
 * `TwinFact` auditable-memory shape (provenance + one-tap forget) but is its own
 * table (`entity_facts`) — entity knowledge and the twin's self-knowledge are
 * deliberately separate stores. `entity:forget-fact` is a HARD delete (unlike
 * `TwinFact`'s soft forgotten-status), matching the twin-ledger "forget" verb;
 * there is no restore for entity facts.
 */
export interface EntityFact {
  id: string;
  entityId: string;
  content: string;
  /** The session this was learned from — always present (entity_facts.sourceMeetingId is NOT NULL). */
  sourceMeetingId: string;
  /** Denormalized for provenance display (`entity:list-facts` joins meetings.title). Absent only if the join can't resolve it. */
  sourceMeetingTitle?: string;
  createdAt: string;
}

/**
 * Result of `entity:analyze-history` — mines every past session for facts about
 * one entity (sequential mining, dedupe by (entityId, sourceMeetingId), per the
 * BRAIN-UX.1 session decision). `status` discriminates a real run from the
 * Task-1 HONEST STUB: Task 1 always returns `{ status: 'not-implemented', error,
 * minedMeetings: 0, newFacts: 0, skippedMeetings: 0 }` — NEVER a fabricated
 * success count. Task 3 un-stubs the `'ok'` branch with real numbers. Renderer
 * code MUST check `status` before trusting the counts.
 */
export interface AnalyzeEntityHistoryResult {
  status: 'ok' | 'not-implemented';
  minedMeetings: number;
  newFacts: number;
  skippedMeetings: number;
  /** Present only when status is 'not-implemented'. */
  error?: string;
}

// --- memory-management IPC payloads (twin:memory-list / -forget / -restore) ---

/** Optional filter for `twin:memory-list`. Omitted ⇒ the service returns all
 *  facts (both active and forgotten) so the memory UI can show/restore forgotten
 *  ones; pass `status` to narrow. */
export interface TwinMemoryListFilter {
  status?: TwinFactStatus;
  category?: TwinFactCategory;
}

/**
 * Result of one `twinMemoryService.backfillFactLabels()` pass (TWIN-READ.1 Task
 * 1) — labels existing facts that have no stored `label` yet, one bounded chunk
 * per call. `status`/`reason` mirror `ExtractFactsResult`'s discriminated skip
 * shape: `paused` (respects the SAME main-side `twin.learningPaused` gate as
 * extraction) or `no-model` (no AI provider configured) both degrade to a typed
 * no-op — the derived fallback in shared/twin/factLabel.ts covers an unlabelled
 * fact regardless, so a skipped/failed backfill is a quality regression, never a
 * breakage. `remaining` is the honest count of facts still unlabelled after this
 * call — > 0 means calling again continues the backfill (naturally resumable, no
 * cursor to track: each call simply re-queries "still unlabelled").
 */
export interface BackfillFactLabelsResult {
  status: 'ok' | 'skipped';
  reason?: 'paused' | 'no-model';
  labeled: number;
  remaining: number;
}

/**
 * The settings key the learning-pause gate rides (the generic key-value settings
 * surface — no dedicated channel). Value is the string `'true'` when paused,
 * anything else (incl. absent) means learning is active. The renderer toggles it
 * via the existing settings:set IPC; main-side reads it via
 * twinMemoryService.isLearningPaused(). Tasks 2/3 both depend on this key.
 */
export const TWIN_LEARNING_PAUSED_SETTING_KEY = 'twin.learningPaused';

// ---------------------------------------------------------------------------
// Twin memory GRAPH (TWIN-GRAPH.2 Task 1) — twin:build-memory-graph
//
// Ledger-centric, NOT the flat entity-centric shape in ./brain.ts's
// BrainGraph (see twinGraphService.ts's file header for the sibling-vs-extend
// decision). Fixed 3-tier structure: one twin core -> one hub per POPULATED
// TwinFactCategory -> every ACTIVE TwinFact. Tier IS the layout depth; no
// fact<->fact edges — the tiers are the structure.
// ---------------------------------------------------------------------------

/** Depth in the fixed 3-tier layout: 0 = the twin core, 1 = a category hub,
 *  2 = a leaf fact. Renderer regions come from `category`, not from `type`. */
export type TwinGraphTier = 0 | 1 | 2;

export type TwinGraphNodeType = 'twin' | 'category' | 'fact';

export interface TwinGraphNode {
  /** STABLE across refetches — `'twin'` for the core, `category:${category}`
   *  for a hub, `fact:${twinFacts.id}` for a leaf. */
  id: string;
  type: TwinGraphNodeType;
  tier: TwinGraphTier;
  /** The SHORT display label — what a node is captioned with at rest. Twin core:
   *  fixed label. Hub: the category, capitalized. Fact: the stored 2-4 word label
   *  resolved through `labelFor()` (TWIN-READ.1 Task 1), which falls back to a
   *  derived short label rather than ever being blank. This is NOT the fact
   *  itself — see `text`. */
  label: string;
  /** Fact nodes only. The FULL fact sentence, verbatim (`twinFacts.fact`) — the
   *  document behind the label, revealed when a node is hovered/focused/inspected
   *  (TWIN-READ.1 Task 3). Absent (not even null) on twin/category nodes, which
   *  have no text beyond their label. Optional so a caller holding an older
   *  payload still typechecks; every reader falls back to `label`. */
  text?: string;
  /** Underlying DB row id: `'singleton'` (twin_profile's fixed id) for the
   *  core, the category string for a hub, `twinFacts.id` for a fact. */
  recordId: string;
  /** The lane this node belongs to. Null only for the twin core. */
  category: TwinFactCategory | null;
  /** Prominence INPUT: edges touching this node in the RETURNED graph (i.e.
   *  computed after the node cap, so it always matches `edges`). Scoring is
   *  the renderer's job — this contract never changes when tuning does. */
  degree: number;
  /** Prominence INPUT: ISO timestamp of the most recent activity relevant to
   *  this node (a fact's own createdAt; a hub's newest fact; the core's
   *  newest fact overall) — null if nothing dates it. */
  newestTimestamp: string | null;
  /** Fact nodes only. The session this was learned from, or null — either the
   *  fact was never sourced from a session, or that session was later deleted
   *  (schema: SET NULL — "a learned fact outlives the deletion of its source
   *  session"). NEVER a fabricated id. Absent (not even null) on twin/category
   *  nodes. */
  sourceMeetingId?: string | null;
  /** Fact nodes only. The source meeting's title, joined in so "learned in
   *  <session>" renders without a second round-trip. Null whenever
   *  `sourceMeetingId` is null (never a guessed title) — render "a past
   *  session" instead. Absent (not even null) on twin/category nodes. */
  sourceMeetingTitle?: string | null;
}

export type TwinGraphEdgeKind = 'twin-hub' | 'hub-fact';

export interface TwinGraphEdge {
  fromId: string;
  toId: string;
  kind: TwinGraphEdgeKind;
}

export interface TwinMemoryGraph {
  nodes: TwinGraphNode[];
  edges: TwinGraphEdge[];
  /** Fact nodes dropped by the node cap — the twin core and category hubs are
   *  NEVER dropped. 0 in the common case (realistic totals are low hundreds
   *  of facts); never silently truncated. */
  droppedCount: number;
}
