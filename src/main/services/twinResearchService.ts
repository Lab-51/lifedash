// === FILE PURPOSE ===
// Digital Twin "Build from my history" service (V3.3.5 — Task 3). Mines the
// user's OWN local data (recent meeting transcript excerpts, briefs, project
// names/descriptions, and card titles) into a reviewable profile draft, so the
// twin can be bootstrapped from what the app already knows. Exactly these four
// corpus kinds are what the consent descriptor enumerates and what a mining run
// sends — nothing else leaves the machine (see finding #6.3).
// Two entry points:
//   - getResearchHistoryInfo() — the CONSENT DESCRIPTOR (corpus counts + which
//     model would run and whether it is local), computed WITHOUT sending anything
//     to a model. This is a HARD privacy requirement: the renderer must be able to
//     show exactly what would be read, and whether it leaves the device, BEFORE
//     the user consents. Nothing but DB reads happen here.
//   - researchHistory() — the mining pass. Per-section, schema-constrained
//     extraction through the `twin_interview` task type with validate-retry-skip
//     discipline (one retry, then skip that section). Partial results are success:
//     it returns whatever sections succeeded plus the sources it drew from, or a
//     `skipped` result when there is no model / nothing could be extracted.
//
// The service NEVER passes the wizard's free-form brief: the IPC channel
// (twin:research-history) is deliberately argument-free so the renderer cannot
// smuggle extra prompt content past the consent descriptor, and a user building
// their twin from history has usually not authored a saved brief yet. Mining is
// driven purely by the assembled corpus.
//
// assembleCorpus + mineProfile are exported (not just the IPC entry points) so
// V3.4's "bootstrap from history" can reuse the same corpus assembly + mining
// without going through the consent-gated IPC path.
//
// === DEPENDENCIES ===
// zod, ai-provider (resolveTaskModel/generate), db/connection (getDb),
// db/schema (meetings/transcripts/meetingBriefs/projects/cards), logger,
// shared/types/twin (frozen contracts).

import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { resolveTaskModel, generate, type ResolvedProvider } from './ai-provider';
import { createLogger } from './logger';
import { getDb } from '../db/connection';
import { meetings, transcripts, meetingBriefs, projects, cards } from '../db/schema';
import type {
  TwinProfileSections,
  TwinResearchHistoryInfo,
  TwinResearchResult,
  TwinSourceHint,
} from '../../shared/types/twin';
import type { AITaskType } from '../../shared/types/ai';

const log = createLogger('TwinResearch');

// --- corpus caps + budgets (bound context so a big history can't blow the model) ---
const MAX_MEETINGS = 10; // most-recent meetings whose transcripts we excerpt
const PER_MEETING_EXCERPT_CHARS = 1200; // per-meeting transcript excerpt budget
const MAX_BRIEFS = 10;
const PER_BRIEF_CHARS = 800;
const MAX_PROJECTS = 25;
const MAX_CARDS = 30;
const MAX_SPEAKERS = 10;
const MAX_CONTEXT_CHARS = 4000; // per-section extraction context budget
// Per-section outputs are small JSON, but this task is meant for SOTA models — every
// current frontier model is a REASONING model whose reasoning tokens count against this
// budget, so a low cap (e.g. 700) gets consumed by reasoning and leaves 0 tokens for the
// JSON (finishReason 'length', empty text). Keep it generous so reasoning + JSON both fit.
const MAX_OUTPUT_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Corpus assembly (pure DB reads — NO model call)
// ---------------------------------------------------------------------------

interface CorpusMeeting {
  id: string;
  title: string;
  dateLabel: string;
  excerpt: string;
}
interface CorpusBrief {
  id: string;
  /** The meeting the brief summarizes, for attribution. */
  label: string;
  summary: string;
}
interface CorpusProject {
  id: string;
  name: string;
  description: string | null;
}
interface CorpusCard {
  id: string;
  title: string;
}

/** The user's own history distilled into bounded, attributable pieces. */
export interface Corpus {
  meetings: CorpusMeeting[];
  briefs: CorpusBrief[];
  projects: CorpusProject[];
  cards: CorpusCard[];
  /**
   * Frequent speakers across the recent meetings (most frequent first). NOTE: the
   * diarizer emits generic labels ("Speaker 1"/"Speaker 2"), not real names, so this
   * is assembled for potential attribution/reuse but is deliberately NOT sent to any
   * model during mining — see the `people` miner (finding #6.3).
   */
  speakers: string[];
}

/** Truncate to a char budget at a soft boundary, appending an ellipsis. */
function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

/** A stable YYYY-MM-DD label for a meeting date (empty when unparseable). */
function toDateLabel(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Read the user's recent history into a bounded corpus. Pure DB reads (meetings,
 * transcripts, briefs, projects, cards) — never contacts a model — so it is safe
 * to call for the consent descriptor before the user has agreed to anything.
 */
export async function assembleCorpus(): Promise<Corpus> {
  const db = getDb();

  const meetingRows = await db
    .select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt })
    .from(meetings)
    .orderBy(desc(meetings.startedAt))
    .limit(MAX_MEETINGS);
  const meetingIds = meetingRows.map((m) => m.id);

  const transcriptRows = meetingIds.length
    ? await db
        .select({
          meetingId: transcripts.meetingId,
          content: transcripts.content,
          speaker: transcripts.speaker,
        })
        .from(transcripts)
        .where(inArray(transcripts.meetingId, meetingIds))
        .orderBy(asc(transcripts.startTime))
    : [];

  const briefRows = meetingIds.length
    ? await db
        .select({ id: meetingBriefs.id, meetingId: meetingBriefs.meetingId, summary: meetingBriefs.summary })
        .from(meetingBriefs)
        .where(inArray(meetingBriefs.meetingId, meetingIds))
        .orderBy(desc(meetingBriefs.createdAt))
    : [];

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, description: projects.description })
    .from(projects)
    .where(and(eq(projects.archived, false), eq(projects.system, false)))
    .orderBy(desc(projects.updatedAt))
    .limit(MAX_PROJECTS);

  const cardRows = await db
    .select({ id: cards.id, title: cards.title })
    .from(cards)
    .where(eq(cards.archived, false))
    .orderBy(desc(cards.updatedAt))
    .limit(MAX_CARDS);

  // Group transcript segments per meeting + tally speaker frequency in one pass.
  const segmentsByMeeting = new Map<string, string[]>();
  const speakerCounts = new Map<string, number>();
  for (const t of transcriptRows) {
    const content = t.content?.trim();
    if (content) {
      const arr = segmentsByMeeting.get(t.meetingId) ?? [];
      arr.push(content);
      segmentsByMeeting.set(t.meetingId, arr);
    }
    const speaker = t.speaker?.trim();
    if (speaker) speakerCounts.set(speaker, (speakerCounts.get(speaker) ?? 0) + 1);
  }

  const titleById = new Map(meetingRows.map((m) => [m.id, m.title]));

  // Only meetings with actual transcript content become excerpts (excerptCount).
  const meetingsOut: CorpusMeeting[] = [];
  for (const m of meetingRows) {
    const segs = segmentsByMeeting.get(m.id);
    if (!segs || segs.length === 0) continue;
    meetingsOut.push({
      id: m.id,
      title: m.title,
      dateLabel: toDateLabel(m.startedAt),
      excerpt: clip(segs.join(' '), PER_MEETING_EXCERPT_CHARS),
    });
  }

  const briefsOut: CorpusBrief[] = briefRows
    .filter((b) => b.summary?.trim())
    .slice(0, MAX_BRIEFS)
    .map((b) => ({
      id: b.id,
      label: titleById.get(b.meetingId) ?? 'Meeting brief',
      summary: clip(b.summary, PER_BRIEF_CHARS),
    }));

  const speakers = [...speakerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SPEAKERS)
    .map(([name]) => name);

  return {
    meetings: meetingsOut,
    briefs: briefsOut,
    projects: projectRows.map((p) => ({ id: p.id, name: p.name, description: p.description })),
    cards: cardRows.map((c) => ({ id: c.id, title: c.title })),
    speakers,
  };
}

/** True when there is nothing at all to mine (short-circuits the model calls). */
function isCorpusEmpty(c: Corpus): boolean {
  return c.meetings.length === 0 && c.briefs.length === 0 && c.projects.length === 0 && c.cards.length === 0;
}

// ---------------------------------------------------------------------------
// Consent descriptor (counts + provider — NO model call)
// ---------------------------------------------------------------------------

/** Provider label + local flag, following the app's local/cloud convention. */
function describeProvider(provider: ResolvedProvider | null): { providerLabel: string; isLocal: boolean } {
  if (!provider) return { providerLabel: 'No model configured', isLocal: false };
  const isLocal = provider.providerName === 'ollama' || provider.providerName === 'lmstudio';
  return { providerLabel: provider.providerName, isLocal };
}

/**
 * Assemble the corpus and report what a mining run WOULD read + which model would
 * run it. Makes ZERO model calls — only DB reads (the corpus) and a provider
 * lookup (also a DB read) — so the renderer can gate consent before any data
 * could leave the machine.
 */
export async function getResearchHistoryInfo(): Promise<TwinResearchHistoryInfo> {
  const corpus = await assembleCorpus();
  const provider = await resolveTaskModel('twin_interview');
  const { providerLabel, isLocal } = describeProvider(provider);
  return {
    excerptCount: corpus.meetings.length,
    briefCount: corpus.briefs.length,
    projectCount: corpus.projects.length,
    cardCount: corpus.cards.length,
    providerLabel,
    isLocal,
  };
}

// ---------------------------------------------------------------------------
// Per-section mining (schema-constrained extraction, validate-retry-skip)
// ---------------------------------------------------------------------------

/** Sections mineable from third-party meeting history. `identity` + `preferences`
 *  are intentionally excluded — they describe the user's own self/voice, which
 *  meeting data cannot supply without fabrication. */
type MineKey = 'domain' | 'projects' | 'people' | 'vocabulary' | 'goals';
const MINE_KEYS: MineKey[] = ['domain', 'projects', 'people', 'vocabulary', 'goals'];

interface SectionMiner {
  /** Validates the parsed model output; its inferred type IS the section value. */
  schema: z.ZodTypeAny;
  /** Appended after "Return " in the system prompt — the exact JSON shape wanted. */
  outputSpec: string;
  /** True when the parsed value carries no usable data (so it isn't counted). */
  isEmpty: (value: unknown) => boolean;
  /** Build the tailored, bounded corpus context this section extracts from. */
  buildContext: (c: Corpus) => string;
}

const MINE_SYSTEM = `You extract structured profile details for a professional from excerpts of THEIR OWN meeting history, briefs, projects, and tasks.
Rules:
- Extract ONLY details clearly and repeatedly supported by the provided history — never invent, guess, or infer beyond it.
- Prefer recurring, salient details over one-off mentions.
- If the history contains nothing relevant to this section, return the empty value (an empty object {} or empty array []).
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

// --- corpus → text helpers (each returns a possibly-empty block) ---
const excerptsText = (c: Corpus): string =>
  c.meetings.map((m) => `Meeting "${m.title}"${m.dateLabel ? ` (${m.dateLabel})` : ''}:\n${m.excerpt}`).join('\n\n');
const briefsText = (c: Corpus): string => c.briefs.map((b) => `Brief for "${b.label}":\n${b.summary}`).join('\n\n');
const projectsText = (c: Corpus): string =>
  c.projects.map((p) => (p.description?.trim() ? `- ${p.name}: ${p.description.trim()}` : `- ${p.name}`)).join('\n');
const cardsText = (c: Corpus): string => c.cards.map((c2) => `- ${c2.title}`).join('\n');
const meetingTitlesText = (c: Corpus): string => c.meetings.map((m) => `- ${m.title}`).join('\n');

/** Join labeled corpus blocks, dropping the empty ones. */
function joinBlocks(blocks: (string | false)[]): string {
  return blocks.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).join('\n\n');
}

const emptyArray = (v: unknown): boolean => Array.isArray(v) && v.length === 0;
const emptyObject = (v: unknown): boolean =>
  !v || typeof v !== 'object' || Object.values(v as Record<string, unknown>).every((x) => !String(x ?? '').trim());

const MINERS: Record<MineKey, SectionMiner> = {
  domain: {
    schema: z.object({ industry: z.string(), company: z.string(), focus: z.string() }).partial(),
    outputSpec:
      'a JSON object { "industry"?: string, "company"?: string, "focus"?: string } — the professional\'s context.',
    isEmpty: emptyObject,
    buildContext: (c) =>
      joinBlocks([
        c.briefs.length > 0 && `Meeting briefs:\n${briefsText(c)}`,
        c.projects.length > 0 && `Projects:\n${projectsText(c)}`,
        c.meetings.length > 0 && `Meeting excerpts:\n${excerptsText(c)}`,
      ]),
  },
  projects: {
    schema: z.array(z.object({ name: z.string().min(1), description: z.string().optional() })),
    outputSpec:
      'a JSON array of { "name": string, "description"?: string } — the professional\'s active projects/initiatives.',
    isEmpty: emptyArray,
    buildContext: (c) =>
      joinBlocks([
        c.projects.length > 0 && `Projects already tracked:\n${projectsText(c)}`,
        c.cards.length > 0 && `Recent task titles:\n${cardsText(c)}`,
        c.meetings.length > 0 && `Recent meeting titles:\n${meetingTitlesText(c)}`,
      ]),
  },
  people: {
    schema: z.array(z.object({ name: z.string().min(1), role: z.string().optional(), org: z.string().optional() })),
    outputSpec:
      'a JSON array of { "name": string, "role"?: string, "org"?: string } — people the professional works with.',
    isEmpty: emptyArray,
    // Only real names appear in the transcript excerpts. The diarizer's speaker
    // values are generic labels ("Speaker 1"/"Speaker 2"), so a "who spoke" block
    // adds no usable people AND would send data the consent descriptor doesn't
    // enumerate — omitted to keep egress fully disclosed (finding #6.3).
    buildContext: (c) => joinBlocks([c.meetings.length > 0 && `Meeting excerpts:\n${excerptsText(c)}`]),
  },
  vocabulary: {
    schema: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })),
    outputSpec: 'a JSON array of { "term": string, "meaning": string } — domain/jargon terms and what they mean.',
    isEmpty: emptyArray,
    buildContext: (c) =>
      joinBlocks([
        c.meetings.length > 0 && `Meeting excerpts:\n${excerptsText(c)}`,
        c.briefs.length > 0 && `Meeting briefs:\n${briefsText(c)}`,
      ]),
  },
  goals: {
    schema: z.array(z.string().min(1)),
    outputSpec: "a JSON array of strings — the professional's goals or priorities, each a short phrase.",
    isEmpty: emptyArray,
    buildContext: (c) =>
      joinBlocks([
        c.briefs.length > 0 && `Meeting briefs:\n${briefsText(c)}`,
        c.meetings.length > 0 && `Meeting excerpts:\n${excerptsText(c)}`,
      ]),
  },
};

/** Strip an optional ```json fence and JSON.parse. Throws on malformed output. */
function parseJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/** Inputs for {@link generateValidated} — the twin domain's ONE extraction pass. */
export interface GenerateValidatedOptions {
  provider: ResolvedProvider;
  /** Which task routes/floors the call (e.g. 'twin_interview', 'twin_learning'). */
  taskType: AITaskType;
  /** Full system prompt (must already include the "Return <spec>" instruction). */
  system: string;
  /** The bounded extraction context — becomes the user prompt. */
  context: string;
  /** Zod schema the parsed JSON must satisfy; the parsed value is returned. */
  schema: z.ZodTypeAny;
  /** Short label for the log lines (e.g. `History mining "projects"`). */
  label: string;
  /** Override sampling temperature (defaults to the provider's, then 0). */
  temperature?: number;
  /** Override max output tokens (defaults to the provider's, then MAX_OUTPUT_TOKENS). */
  maxTokens?: number;
}

/**
 * The twin domain's shared validate-retry-skip pass: generate → parse+validate
 * against `schema`, retry ONCE with the rejection reason appended, then skip
 * (return null). A generation/network throw skips immediately (it is not a JSON
 * problem, so it does not burn the retry). NEVER throws for AI reasons.
 *
 * Extracted from the history miner so V3.4 fact extraction reuses the exact same
 * discipline instead of standing up a second pipeline (see twinMemoryService).
 */
export async function generateValidated(opts: GenerateValidatedOptions): Promise<unknown | null> {
  const { provider, taskType, system, context, schema, label } = opts;
  let prompt = context;

  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const result = await generate({
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiKeyEncrypted: provider.apiKeyEncrypted,
        baseUrl: provider.baseUrl,
        model: provider.model,
        taskType,
        prompt,
        system,
        temperature: opts.temperature ?? provider.temperature ?? 0,
        maxTokens: opts.maxTokens ?? provider.maxTokens ?? MAX_OUTPUT_TOKENS,
      });
      text = result.text ?? '';
    } catch (err) {
      log.debug(`${label} generation failed:`, err instanceof Error ? err.message : err);
      return null;
    }

    try {
      return schema.parse(parseJson(text));
    } catch (parseErr) {
      const reason = parseErr instanceof Error ? parseErr.message : 'invalid output';
      if (attempt === 0) {
        log.debug(`${label} output invalid (${reason}) — retrying once`);
        prompt = `${context}\n\nYour previous reply was rejected: ${reason}. Reply with ONLY the JSON.`;
        continue;
      }
      log.info(`${label} output invalid after retry — skipping`);
      return null;
    }
  }
  return null;
}

/**
 * Mine ONE section with the shared validate-retry-skip discipline (see
 * {@link generateValidated}): retry once on malformed output, then skip.
 */
async function mineSection(provider: ResolvedProvider, key: MineKey, context: string): Promise<unknown | null> {
  const miner = MINERS[key];
  return generateValidated({
    provider,
    taskType: 'twin_interview',
    system: `${MINE_SYSTEM}\n\nReturn ${miner.outputSpec}`,
    context,
    schema: miner.schema,
    label: `History mining "${key}"`,
  });
}

/** The corpus items that fed the mining, for review-time attribution. */
function buildSources(c: Corpus): TwinSourceHint[] {
  return [
    ...c.meetings.map((m) => ({
      kind: 'meeting' as const,
      id: m.id,
      label: m.dateLabel ? `${m.title} · ${m.dateLabel}` : m.title,
    })),
    ...c.briefs.map((b) => ({ kind: 'brief' as const, id: b.id, label: b.label })),
    ...c.projects.map((p) => ({ kind: 'project' as const, id: p.id, label: p.name })),
    ...c.cards.map((cd) => ({ kind: 'card' as const, id: cd.id, label: cd.title })),
  ];
}

/**
 * Mine a profile draft from an assembled corpus. Per-section extraction with
 * per-section skip tolerance: sections that fail (or come back empty) are simply
 * omitted; the run succeeds as long as ANY section produced usable data (partial
 * success is success). Returns `skipped/failed` only when nothing at all could be
 * extracted (including an empty corpus, which short-circuits every model call).
 */
export async function mineProfile(corpus: Corpus, provider: ResolvedProvider): Promise<TwinResearchResult> {
  if (isCorpusEmpty(corpus)) return { status: 'skipped', reason: 'failed' };

  const draft: Partial<Record<MineKey, unknown>> = {};
  let minedAny = false;

  for (const key of MINE_KEYS) {
    const context = clip(MINERS[key].buildContext(corpus), MAX_CONTEXT_CHARS);
    if (!context.trim()) continue; // no source material for this section
    const value = await mineSection(provider, key, context);
    if (value != null && !MINERS[key].isEmpty(value)) {
      draft[key] = value;
      minedAny = true;
    }
  }

  if (!minedAny) return { status: 'skipped', reason: 'failed' };
  // Cast at the boundary: each key/value pair was validated by its section schema.
  return { status: 'ok', draft: draft as Partial<TwinProfileSections>, sources: buildSources(corpus) };
}

/**
 * Mine the user's local history into a profile draft. Resolves the mining model,
 * assembles the corpus, and runs per-section extraction. Never throws for AI
 * reasons: no model -> `skipped/no-model`; nothing extractable -> `skipped/failed`.
 * The IPC layer trusts the renderer's consent gate before calling this.
 */
export async function researchHistory(): Promise<TwinResearchResult> {
  const provider = await resolveTaskModel('twin_interview');
  if (!provider) return { status: 'skipped', reason: 'no-model' };
  const corpus = await assembleCorpus();
  return mineProfile(corpus, provider);
}
