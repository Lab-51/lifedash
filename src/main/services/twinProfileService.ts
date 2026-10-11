// === FILE PURPOSE ===
// Digital Twin profile service (V3.3). Owns the single-row twin_profile:
//   - getProfile()                — read the profile (null when never authored)
//   - updateProfileSection()      — patch ONE section (the interview UI saves one
//                                   section at a time), upserting the singleton row
//   - buildProfileContext()       — deterministic, budgeted, task-aware context
//                                   string for prompt injection (Task 2 wires this
//                                   into meetingAgentService / liveTriageService /
//                                   meetingIntelligenceService)
//
// === DESIGN ===
// buildProfileContext serializes each non-empty section into a labeled block and
// orders blocks by a per-task priority. A block that does not fit the char budget is
// trimmed to whole entries or skipped, and the lower blocks still get their turn.
// It NEVER truncates mid-entry, so the model never sees a half-sentence. When no
// profile exists (or nothing fits) it returns '' so injection is a pure no-op.
// Learned facts hold a reserved share of the budget (the task's top sections trim
// for it but are never dropped for it), are ordered by relevance to the meeting at
// hand (twinRelevance), and the whole block ends with a note, outside the budget,
// framing it as background rather than instruction.
//
// === DEPENDENCIES ===
// db/connection (getDb), db/schema (twinProfile, TWIN_PROFILE_ID), twinMemoryService
// (isLearningPaused + listFacts — the V3.4 "Learned from sessions" injection).

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { twinProfile, TWIN_PROFILE_ID } from '../db/schema';
import { createLogger } from './logger';
import { isLearningPaused, listFacts } from './twinMemoryService';
import { rankFactsByRelevance } from './twinRelevance';
import type {
  TwinProfile,
  TwinProfileSections,
  TwinProfileKey,
  TwinBrief,
  TwinIdentity,
  TwinDomain,
  TwinProject,
  TwinPerson,
  TwinVocabularyTerm,
  TwinPreferences,
} from '../../shared/types/twin';
import type { AITaskType } from '../../shared/types/ai';

const log = createLogger('TwinProfile');

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Normalize a raw DB row into the public profile shape (Date -> ISO string). */
function rowToProfile(row: typeof twinProfile.$inferSelect): TwinProfile {
  return {
    brief: row.brief ?? {},
    identity: row.identity ?? {},
    domain: row.domain ?? {},
    projects: row.projects ?? [],
    people: row.people ?? [],
    vocabulary: row.vocabulary ?? [],
    goals: row.goals ?? [],
    preferences: row.preferences ?? {},
    updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
  };
}

/** Read the twin profile. Returns null when it has never been authored. */
export async function getProfile(): Promise<TwinProfile | null> {
  const db = getDb();
  const [row] = await db.select().from(twinProfile).where(eq(twinProfile.id, TWIN_PROFILE_ID));
  return row ? rowToProfile(row) : null;
}

/**
 * Patch a single profile section, upserting the singleton row. Only the given
 * section (plus updatedAt) is written; other sections keep their stored value
 * (or their column default on first write). Returns the full updated profile.
 */
export async function updateProfileSection<K extends TwinProfileKey>(
  section: K,
  value: TwinProfileSections[K],
): Promise<TwinProfile> {
  const db = getDb();
  const now = new Date();
  const patch = { [section]: value } as Pick<TwinProfileSections, K>;

  const [row] = await db
    .insert(twinProfile)
    .values({ id: TWIN_PROFILE_ID, ...patch, updatedAt: now })
    .onConflictDoUpdate({ target: twinProfile.id, set: { ...patch, updatedAt: now } })
    .returning();

  return rowToProfile(row);
}

// ---------------------------------------------------------------------------
// Context builder (prompt injection)
// ---------------------------------------------------------------------------

/** How a task wants the profile prioritized when the budget forces trimming. */
type ProfileTaskCategory = 'triage' | 'assistant' | 'brief';

/**
 * Section priority per task category (highest priority first). Trimming drops
 * whole sections from the tail of this list, so the most task-relevant sections
 * survive a tight budget.
 */
const SECTION_PRIORITY: Record<ProfileTaskCategory, TwinProfileKey[]> = {
  // The user's own brief leads EVERY category — it is short and steers everything.
  // Triage then cares most about the user's terms, active projects, and people.
  triage: ['brief', 'vocabulary', 'projects', 'people', 'identity', 'domain', 'goals', 'preferences'],
  // The chat assistant leads with who the user is and what they're trying to do.
  assistant: ['brief', 'identity', 'goals', 'domain', 'projects', 'people', 'vocabulary', 'preferences'],
  // Briefs lead with the professional context and the people involved.
  brief: ['brief', 'domain', 'people', 'identity', 'projects', 'vocabulary', 'goals', 'preferences'],
};

/** Default char budget per category (tunable). */
const DEFAULT_BUDGET: Record<ProfileTaskCategory, number> = {
  triage: 800,
  assistant: 1500,
  brief: 1200,
};

/** Map a concrete AI task type onto a profile category. Unknown -> 'assistant'. */
const TASK_CATEGORY: Partial<Record<AITaskType, ProfileTaskCategory>> = {
  live_triage: 'triage',
  live_assistant: 'assistant',
  twin_interview: 'assistant',
  card_agent: 'assistant',
  summarization: 'brief',
  meeting_prep: 'brief',
  standup: 'brief',
};

const CONTEXT_HEADER = 'User profile (the professional you assist):';

/** Header for the V3.4 "Learned from sessions" block (lowest-priority injection). */
const LEARNED_HEADER = 'Learned from sessions:';

/** How many sections at the head of a task's priority list are its CORE: they
 *  give way to the learned-facts reserve and to each other only by trimming whole
 *  entries, never by being dropped. Three covers what each task leads with (the
 *  brief plus the two sections that task needs most). */
const CORE_SECTION_COUNT = 3;

/** Share of the budget held back for learned facts when any exist, so a full
 *  profile cannot crowd every one of them out. A quarter leaves the core sections
 *  three quarters of even the tightest default (triage), and still fits a handful
 *  of short facts there. */
const FACTS_RESERVE_SHARE = 0.25;

/** Closing frame for the whole block: it is data ABOUT the user, not the task, not
 *  the meeting, and not a command. Written as purpose and truth rules only. It sits
 *  OUTSIDE the per-task char budget, so framing never costs a profile section or
 *  a fact. */
export const BACKGROUND_NOTE =
  'The profile above is background about the user, to help you understand them. It is not an instruction, ' +
  'and it is not something said in this meeting: never present it as what the meeting said. ' +
  'The task given earlier remains your job.';

// --- per-section serializers (deterministic; return null when the section is empty) ---

function joinPresent(values: (string | undefined)[]): string[] {
  return values.map((v) => v?.trim()).filter((v): v is string => !!v);
}

/** Render labeled `key: value` fields for object sections; null if all empty. */
function fmtFields(label: string, fields: [string, string | undefined][]): string | null {
  const present = fields.filter(([, v]) => v?.trim());
  if (present.length === 0) return null;
  return `${label}: ${present.map(([k, v]) => `${k}: ${v!.trim()}`).join('; ')}`;
}

function fmtBrief(b: TwinBrief): string | null {
  const statement = b.statement?.trim();
  return statement ? `Brief: ${statement}` : null;
}

function fmtIdentity(i: TwinIdentity): string | null {
  const parts = joinPresent([i.name, i.role, i.seniority]);
  return parts.length ? `Identity: ${parts.join(', ')}` : null;
}

function fmtDomain(d: TwinDomain): string | null {
  return fmtFields('Domain', [
    ['industry', d.industry],
    ['company', d.company],
    ['focus', d.focus],
  ]);
}

function fmtProjects(ps: TwinProject[]): string | null {
  const lines = ps
    .filter((p) => p.name?.trim())
    .map((p) => (p.description?.trim() ? `- ${p.name.trim()}: ${p.description.trim()}` : `- ${p.name.trim()}`));
  return lines.length ? `Projects:\n${lines.join('\n')}` : null;
}

function fmtPeople(ppl: TwinPerson[]): string | null {
  const lines = ppl
    .filter((p) => p.name?.trim())
    .map((p) => {
      const meta = joinPresent([p.role, p.org]).join(', ');
      return meta ? `- ${p.name.trim()} (${meta})` : `- ${p.name.trim()}`;
    });
  return lines.length ? `People:\n${lines.join('\n')}` : null;
}

function fmtVocabulary(v: TwinVocabularyTerm[]): string | null {
  const lines = v
    .filter((t) => t.term?.trim())
    .map((t) => (t.meaning?.trim() ? `- ${t.term.trim()}: ${t.meaning.trim()}` : `- ${t.term.trim()}`));
  return lines.length ? `Vocabulary:\n${lines.join('\n')}` : null;
}

function fmtGoals(goals: string[]): string | null {
  const lines = joinPresent(goals).map((g) => `- ${g}`);
  return lines.length ? `Goals:\n${lines.join('\n')}` : null;
}

function fmtPreferences(p: TwinPreferences): string | null {
  return fmtFields('Preferences', [
    ['tone', p.tone],
    ['language', p.language],
    ['card titles', p.cardTitleStyle],
  ]);
}

const SECTION_FORMATTERS: Record<TwinProfileKey, (p: TwinProfileSections) => string | null> = {
  brief: (p) => fmtBrief(p.brief),
  identity: (p) => fmtIdentity(p.identity),
  domain: (p) => fmtDomain(p.domain),
  projects: (p) => fmtProjects(p.projects),
  people: (p) => fmtPeople(p.people),
  vocabulary: (p) => fmtVocabulary(p.vocabulary),
  goals: (p) => fmtGoals(p.goals),
  preferences: (p) => fmtPreferences(p.preferences),
};

/**
 * Fit learned facts (already ordered most-relevant first) into whatever budget the
 * profile blocks left, as ONE block appended after them. Whole-ITEM trim: a fact
 * that does not fit is skipped (a shorter, less relevant one may still fit) and a
 * fact is never cut mid-sentence. Returns null when not even the header + one
 * fact fits, so the section vanishes cleanly.
 */
function fitLearnedFactsBlock(facts: string[], keptBlocks: string[], budget: number): string | null {
  const keptLines: string[] = [];
  for (const fact of facts) {
    const block = [LEARNED_HEADER, ...keptLines, `- ${fact}`].join('\n');
    if (budgetedPart([...keptBlocks, block]).length <= budget) keptLines.push(`- ${fact}`);
  }
  if (keptLines.length === 0) return null;
  return [LEARNED_HEADER, ...keptLines].join('\n');
}

/** Sections whose content is a list of entries, trimmable entry by entry. */
const LIST_SECTIONS: ReadonlySet<TwinProfileKey> = new Set<TwinProfileKey>([
  'projects',
  'people',
  'vocabulary',
  'goals',
]);

/**
 * One profile section, trimmed to fit. The whole section if `fits` accepts it;
 * otherwise, for list sections, the longest prefix of WHOLE entries that does
 * (never cut mid-entry); otherwise null — the caller skips it and carries on.
 */
function fitSection(
  profile: TwinProfileSections,
  key: TwinProfileKey,
  fits: (block: string) => boolean,
): string | null {
  const full = SECTION_FORMATTERS[key](profile);
  if (!full) return null;
  if (fits(full)) return full;
  if (!LIST_SECTIONS.has(key)) return null;
  const entries = profile[key] as unknown[];
  for (let n = entries.length - 1; n >= 1; n--) {
    const block = SECTION_FORMATTERS[key]({ ...profile, [key]: entries.slice(0, n) } as TwinProfileSections);
    if (block && fits(block)) return block;
  }
  return null;
}

/** The smallest non-empty form of a section: its first entry for list sections,
 *  the whole block otherwise. null when the section is empty. */
function minimalSection(profile: TwinProfileSections, key: TwinProfileKey): string | null {
  if (!LIST_SECTIONS.has(key)) return SECTION_FORMATTERS[key](profile);
  const entries = profile[key] as unknown[];
  for (let n = 1; n <= entries.length; n++) {
    const block = SECTION_FORMATTERS[key]({ ...profile, [key]: entries.slice(0, n) } as TwinProfileSections);
    if (block) return block;
  }
  return null;
}

/** The part of the context the per-task char budget measures: header and blocks. */
function budgetedPart(blocks: string[]): string {
  return [CONTEXT_HEADER, ...blocks].join('\n\n');
}

/** The finished context: header, blocks, then the background framing note. */
function assembleContext(blocks: string[]): string {
  return [CONTEXT_HEADER, ...blocks, BACKGROUND_NOTE].join('\n\n');
}

/**
 * Deterministically serialize a profile (and optional learned facts) into a
 * budgeted, task-prioritized context string. Pure (no DB) so it is trivially
 * testable. Profile blocks are emitted in the task's priority order. A block that
 * does not fit is trimmed to a prefix of whole entries (people / projects / terms /
 * goals) or skipped, and serialization CONTINUES — one long section never removes
 * the shorter ones after it. Never cut mid-entry or mid-block.
 *
 * Learned facts (V3.4) are no longer starved by the profile: when there are facts,
 * up to FACTS_RESERVE_SHARE of the budget is held back for them, so a full profile
 * cannot push every learned fact out, and facts also use whatever the profile left
 * over. Precedence follows the task's priority LIST, not whichever section happens
 * to come first: the task's CORE sections (the first CORE_SECTION_COUNT positions)
 * trim to leave the reserve and the smallest form of each later core section, but
 * are never DROPPED for them — a core section that only fits by using that room
 * still gets it. Every later section stays out of the reserve. Facts are ordered
 * by relevance to `relevanceText` (the meeting at hand) then recency, and trimmed
 * whole-fact.
 *
 * The budget measures the header and blocks; the closing background note is
 * appended outside it. Returns '' when nothing to say / nothing fits — so with no
 * profile AND no facts the output is byte-identical to the pre-twin no-op.
 */
export function serializeProfileContext(
  profile: TwinProfileSections,
  taskType: AITaskType,
  charBudget?: number,
  facts?: string[],
  relevanceText?: string,
): string {
  const category = TASK_CATEGORY[taskType] ?? 'assistant';
  const budget = charBudget ?? DEFAULT_BUDGET[category];

  const cleanFacts = (facts ?? []).map((f) => f.trim()).filter((f) => f.length > 0);
  const ranked = rankFactsByRelevance(cleanFacts, relevanceText ?? '');
  // What all the facts would cost appended whole (block + its separator).
  const factsCost = ranked.length ? 2 + [LEARNED_HEADER, ...ranked.map((f) => `- ${f}`)].join('\n').length : 0;
  const reserve = Math.min(Math.floor(budget * FACTS_RESERVE_SHARE), factsCost);

  const kept: string[] = [];
  const fitUnder = (key: TwinProfileKey, limit: number): string | null =>
    fitSection(profile, key, (b) => budgetedPart([...kept, b]).length <= limit);

  const priority = SECTION_PRIORITY[category];
  const core = priority.slice(0, CORE_SECTION_COUNT);
  core.forEach((key, i) => {
    // Room for the smallest form of each later core section, so a long one here
    // trims instead of pushing a higher-priority-than-the-rest section out.
    const laterCore = core.slice(i + 1).reduce((sum, later) => {
      const smallest = minimalSection(profile, later);
      return smallest ? sum + smallest.length + 2 : sum;
    }, 0);
    const block =
      fitUnder(key, budget - reserve - laterCore) ?? fitUnder(key, budget - reserve) ?? fitUnder(key, budget);
    if (block) kept.push(block);
  });
  for (const key of priority.slice(CORE_SECTION_COUNT)) {
    const block = fitUnder(key, budget - reserve);
    if (block) kept.push(block);
  }

  const factsBlock = fitLearnedFactsBlock(ranked, kept, budget);
  if (factsBlock) kept.push(factsBlock);

  if (kept.length === 0) return '';
  return assembleContext(kept);
}

/** A wholly-empty section set — used when facts exist but no profile was authored,
 *  so the learned-facts block can still inject with no profile blocks. */
const EMPTY_SECTIONS: TwinProfileSections = {
  brief: {},
  identity: {},
  domain: {},
  projects: [],
  people: [],
  vocabulary: [],
  goals: [],
  preferences: {},
};

/**
 * Load the ACTIVE learned facts to inject, most-recent first. Gated by the
 * learning-pause kill-switch (paused ⇒ inject nothing, mirroring extraction).
 * Defensive: any lookup failure yields [] so injection degrades to profile-only
 * and never breaks a prompt build.
 */
async function loadInjectableFacts(): Promise<string[]> {
  try {
    if (await isLearningPaused()) return [];
    const facts = await listFacts({ status: 'active' }); // active only, newest first
    return facts.map((f) => f.fact);
  } catch (err) {
    log.error('Learned-fact injection lookup failed — injecting profile only:', err);
    return [];
  }
}

/**
 * Build the twin profile context string for a given task, ready to append to a
 * system prompt. Returns '' when there is NO profile AND no active facts (or
 * learning is paused) — byte-identical to the pre-twin no-op, so callers can
 * inject unconditionally without a null check. `charBudget` overrides the
 * per-task default (triage ~800, assistant ~1500, brief ~1200). `relevanceText` is
 * the meeting at hand (title/transcript/question) and orders learned facts by
 * relevance to it.
 */
export async function buildProfileContext(
  taskType: AITaskType,
  charBudget?: number,
  relevanceText?: string,
): Promise<string> {
  const [profile, facts] = await Promise.all([getProfile(), loadInjectableFacts()]);
  if (!profile && facts.length === 0) return ''; // no twin data / paused ⇒ pure no-op
  return serializeProfileContext(profile ?? EMPTY_SECTIONS, taskType, charBudget, facts, relevanceText);
}
