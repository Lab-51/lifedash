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
// buildProfileContext serializes each non-empty section into a labeled block,
// orders blocks by a per-task priority, and hard-trims at section boundaries:
// it includes blocks from highest priority down and stops at the first block that
// would exceed the char budget — dropping that block and every lower-priority one.
// It NEVER truncates mid-block, so the model never sees a half-sentence. When no
// profile exists (or nothing fits) it returns '' so injection is a pure no-op.
//
// === DEPENDENCIES ===
// db/connection (getDb), db/schema (twinProfile, TWIN_PROFILE_ID).

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { twinProfile, TWIN_PROFILE_ID } from '../db/schema';
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
 * Deterministically serialize a profile into a budgeted, task-prioritized
 * context string. Pure (no DB) so it is trivially testable. Blocks are emitted
 * in the task's priority order; the first block that would overflow the budget —
 * and every lower-priority block after it — is dropped (hard trim at section
 * boundaries, never mid-block). Returns '' when nothing to say / nothing fits.
 */
export function serializeProfileContext(
  profile: TwinProfileSections,
  taskType: AITaskType,
  charBudget?: number,
): string {
  const category = TASK_CATEGORY[taskType] ?? 'assistant';
  const budget = charBudget ?? DEFAULT_BUDGET[category];

  const blocks: string[] = [];
  for (const key of SECTION_PRIORITY[category]) {
    const block = SECTION_FORMATTERS[key](profile);
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) return '';

  const kept: string[] = [];
  for (const block of blocks) {
    const candidate = [CONTEXT_HEADER, ...kept, block].join('\n\n');
    if (candidate.length <= budget) kept.push(block);
    else break; // drop this and all lower-priority blocks
  }
  if (kept.length === 0) return '';

  return [CONTEXT_HEADER, ...kept].join('\n\n');
}

/**
 * Build the twin profile context string for a given task, ready to append to a
 * system prompt. Returns '' when no profile exists, so callers can inject
 * unconditionally without a null check. `charBudget` overrides the per-task
 * default (triage ~800, assistant ~1500, brief ~1200).
 */
export async function buildProfileContext(taskType: AITaskType, charBudget?: number): Promise<string> {
  const profile = await getProfile();
  if (!profile) return '';
  return serializeProfileContext(profile, taskType, charBudget);
}
