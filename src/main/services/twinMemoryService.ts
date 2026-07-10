// === FILE PURPOSE ===
// Digital Twin living memory (V3.4). Owns the twin_facts lifecycle:
//   - extractFacts()  — learn discrete facts from a finished session (post-session hook)
//   - listFacts()     — read facts for the memory-management UI
//   - forgetFact()    — mark a fact 'forgotten' (excluded from injection, restorable)
//   - restoreFact()   — bring a forgotten fact back to 'active'
//   - isLearningPaused() — the main-side read of the learning-pause gate
//
// === HOW EXTRACTION WORKS (V3.4 Task 2) ===
// A single post-session hook (learningPostSessionHook, self-registered on import)
// runs extractFacts after every brief. Extraction reads ONLY already-distilled,
// already-model-routed data — the session's brief + the suggestions the user
// ACCEPTED live — never the raw transcript. It routes through the `twin_learning`
// task and REUSES twinResearchService.generateValidated (the twin domain's one
// validate-retry-skip pipeline — no second pipeline). Learned facts are deduped
// (normalized-equality, mirroring the triage discipline) against existing ACTIVE
// facts + within the batch, capped at ~5/session, and stored with provenance
// (sourceMeetingId). The whole pass is gated by isLearningPaused() and can never
// throw into the dispatcher (defensive + error-isolated), so a learning failure
// never harms brief generation.
//
// === DEPENDENCIES ===
// drizzle-orm, db/connection (getDb), db/schema (settings/twinFacts/meetingBriefs/
// liveSuggestions), ai-provider (resolveTaskModel), twinResearchService
// (generateValidated — the shared extraction helper), postSessionDispatcher
// (registerPostSessionHook), shared twin types.

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection';
import { settings, twinFacts, meetingBriefs, liveSuggestions } from '../db/schema';
import { createLogger } from './logger';
import { resolveTaskModel } from './ai-provider';
import { generateValidated } from './twinResearchService';
import { registerPostSessionHook, type PostSessionHook } from './postSessionDispatcher';
import { TWIN_LEARNING_PAUSED_SETTING_KEY } from '../../shared/types/twin';
import type { TwinFact, TwinFactCategory, TwinFactStatus, TwinMemoryListFilter } from '../../shared/types/twin';

const log = createLogger('TwinMemory');

/** Max facts learned per session — keeps memory growth bounded and signal high. */
const TWIN_FACT_CAP = 5;

/** Bound the extraction context so a big brief + many accepted items can't blow
 *  the model's window (the twin_learning ≥4096 output floor handles the reply). */
const MAX_EXTRACTION_CONTEXT_CHARS = 6000;

const FACT_CATEGORIES = ['person', 'project', 'preference', 'domain', 'commitment'] as const;

/** Outcome of a per-session fact-extraction pass. `skipped` never hard-fails the
 *  post-session dispatcher; `facts` carries the newly learned (active) facts. */
export interface ExtractFactsResult {
  status: 'ok' | 'skipped';
  /** Why nothing was learned (only present on `skipped`). */
  reason?: 'no-model' | 'failed' | 'paused';
  facts: TwinFact[];
}

// ---------------------------------------------------------------------------
// Extraction prompt + schema
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM = `You distill a professional's finished meeting into a few DURABLE facts worth remembering long-term about the user's world — the people they work with, their projects, their stated preferences, their domain, and commitments they made.
Rules:
- Extract ONLY facts clearly supported by the provided brief and confirmed items — never invent, guess, or infer beyond them.
- Each fact is ONE short, self-contained sentence that will still be true and useful in FUTURE meetings — avoid meeting-specific ephemera (e.g. "the call started late", "we reviewed the deck").
- Prefer durable, reusable knowledge over one-off details.
- Do NOT repeat anything already listed under "Already known" below.
- Return AT MOST 5 facts. If nothing durable is worth remembering, return an empty array [].
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

const EXTRACTION_OUTPUT_SPEC =
  'a JSON array of { "fact": string, "category": "person"|"project"|"preference"|"domain"|"commitment" } — at most 5 durable facts.';

/** Validates the model's output; malformed/over-cap-shape output is rejected by
 *  generateValidated's retry-then-skip discipline. */
const extractedFactsSchema = z.array(
  z.object({
    fact: z.string().min(1),
    category: z.enum(FACT_CATEGORIES),
  }),
);

interface ExtractedFact {
  fact: string;
  category: TwinFactCategory;
}

/** Accepted live-suggestion (the user one-tap-confirmed it during the meeting). */
interface AcceptedItem {
  type: string;
  title: string;
  description: string | null;
}

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Row mapping + dedupe
// ---------------------------------------------------------------------------

/** Normalize a raw twin_facts row into the public shape (Date -> ISO string). */
function rowToFact(row: typeof twinFacts.$inferSelect): TwinFact {
  return {
    id: row.id,
    fact: row.fact,
    category: row.category,
    sourceMeetingId: row.sourceMeetingId,
    status: row.status,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

/** Case/whitespace/trailing-punctuation-insensitive key for dedupe (mirrors the
 *  triage discipline — lowercased-title matching — extended for sentence facts). */
function normalizeFact(fact: string): string {
  return fact
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;,]+$/g, '')
    .trim();
}

/**
 * Drop candidates that duplicate an existing KNOWN fact (ACTIVE **or FORGOTTEN**)
 * or an earlier candidate in this same batch (normalized-equality — same Set
 * discipline as triage), then cap at ~5/session. Forgotten facts are included so a
 * fact the user explicitly Forgot is never silently re-learned as a new active row;
 * they are used as a post-generation FILTER only — never disclosed to the model
 * (they are NOT added to the prompt's "Already known" list). Preserves the model's
 * ordering for the survivors.
 */
function dedupeFacts(candidates: ExtractedFact[], existingKnown: string[]): ExtractedFact[] {
  const seen = new Set(existingKnown.map(normalizeFact));
  const out: ExtractedFact[] = [];
  for (const c of candidates) {
    const fact = c.fact.trim();
    if (!fact) continue;
    const key = normalizeFact(fact);
    if (!key || seen.has(key)) continue; // dedupe vs existing active + within batch
    seen.add(key);
    out.push({ fact, category: c.category });
    if (out.length >= TWIN_FACT_CAP) break; // ~5-cap per session
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source-material loaders (pure DB reads — the distilled inputs to extraction)
// ---------------------------------------------------------------------------

/** The most recent brief summary for the session (the distilled input). */
async function loadBriefSummary(db: Db, meetingId: string): Promise<string> {
  const [row] = await db
    .select({ summary: meetingBriefs.summary })
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, meetingId))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);
  return row?.summary ?? '';
}

/** Suggestions the user ACCEPTED live during the meeting (already model-routed —
 *  the consent-consistent, distilled second input; NOT the raw transcript). */
async function loadAcceptedSuggestions(db: Db, meetingId: string): Promise<AcceptedItem[]> {
  const rows = await db
    .select({ type: liveSuggestions.type, title: liveSuggestions.title, description: liveSuggestions.description })
    .from(liveSuggestions)
    .where(and(eq(liveSuggestions.meetingId, meetingId), eq(liveSuggestions.status, 'accepted')));
  return rows.map((r) => ({ type: r.type, title: r.title, description: r.description }));
}

/** Every currently-ACTIVE fact's text — feeds BOTH the prompt exclusion list and
 *  the post-parse dedupe. */
async function loadActiveFactStrings(db: Db): Promise<string[]> {
  const rows = await db.select({ fact: twinFacts.fact }).from(twinFacts).where(eq(twinFacts.status, 'active'));
  return rows.map((r) => r.fact);
}

/** Every FORGOTTEN fact's text — feeds the post-parse dedupe ONLY (never the
 *  prompt), so a fact the user explicitly Forgot is not silently re-learned and
 *  its content is never re-surfaced to the model. */
async function loadForgottenFactStrings(db: Db): Promise<string[]> {
  const rows = await db.select({ fact: twinFacts.fact }).from(twinFacts).where(eq(twinFacts.status, 'forgotten'));
  return rows.map((r) => r.fact);
}

/** Assemble the bounded extraction context from the distilled inputs + the
 *  do-not-repeat exclusion list. Returns '' when there is no source material. */
function buildExtractionContext(briefSummary: string, accepted: AcceptedItem[], knownFacts: string[]): string {
  const blocks: string[] = [];
  const brief = briefSummary.trim();
  if (brief) blocks.push(`Meeting brief:\n${brief}`);
  if (accepted.length > 0) {
    const lines = accepted.map((a) =>
      a.description ? `- [${a.type}] ${a.title}: ${a.description}` : `- [${a.type}] ${a.title}`,
    );
    blocks.push(`Confirmed live during the meeting:\n${lines.join('\n')}`);
  }
  if (knownFacts.length > 0) {
    blocks.push(`Already known (do NOT repeat these):\n${knownFacts.map((f) => `- ${f}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Learn discrete, provenanced facts from a finished session and persist them to
 * twin_facts. Input is the session's brief + the user's ACCEPTED live suggestions
 * (already distilled + model-routed — never the raw transcript). Routes through
 * `twin_learning` and REUSES twinResearchService.generateValidated. Gated by
 * isLearningPaused(); defensive — NEVER throws (so it can never harm the brief),
 * returning `skipped` on any absence/failure. No fabricated facts.
 */
export async function extractFacts(meetingId: string): Promise<ExtractFactsResult> {
  try {
    if (await isLearningPaused()) {
      log.debug('extractFacts — learning paused; no-op (no extraction)');
      return { status: 'skipped', reason: 'paused', facts: [] };
    }

    const provider = await resolveTaskModel('twin_learning');
    if (!provider) return { status: 'skipped', reason: 'no-model', facts: [] };

    const db = getDb();
    const [briefSummary, accepted] = await Promise.all([
      loadBriefSummary(db, meetingId),
      loadAcceptedSuggestions(db, meetingId),
    ]);
    if (!briefSummary.trim() && accepted.length === 0) {
      // Nothing distilled to learn from (no brief, nothing accepted live).
      return { status: 'skipped', reason: 'failed', facts: [] };
    }

    // Active facts feed BOTH the model's "Already known" exclusion list AND the
    // dedupe. Forgotten facts feed the dedupe ONLY — so a Forgotten fact is neither
    // re-learned nor re-disclosed to the model.
    const [existingActive, forgotten] = await Promise.all([loadActiveFactStrings(db), loadForgottenFactStrings(db)]);
    const context = buildExtractionContext(briefSummary, accepted, existingActive).slice(
      0,
      MAX_EXTRACTION_CONTEXT_CHARS,
    );

    const parsed = await generateValidated({
      provider,
      taskType: 'twin_learning',
      system: `${EXTRACTION_SYSTEM}\n\nReturn ${EXTRACTION_OUTPUT_SPEC}`,
      context,
      schema: extractedFactsSchema,
      label: `Fact extraction (meeting ${meetingId})`,
    });
    if (parsed == null) return { status: 'skipped', reason: 'failed', facts: [] };

    const deduped = dedupeFacts(parsed as ExtractedFact[], [...existingActive, ...forgotten]);
    if (deduped.length === 0) return { status: 'ok', facts: [] };

    const inserted = await db
      .insert(twinFacts)
      .values(
        deduped.map((c) => ({
          fact: c.fact,
          category: c.category,
          sourceMeetingId: meetingId, // provenance on EVERY learned fact
          status: 'active' as const,
        })),
      )
      .returning();

    log.info(`Learned ${inserted.length} fact(s) from meeting ${meetingId}`);
    return { status: 'ok', facts: inserted.map(rowToFact) };
  } catch (err) {
    // Defensive: extraction can NEVER throw into the post-session dispatcher, so a
    // learning failure can never fail or delay brief generation.
    log.error('extractFacts failed — no facts learned this session:', err);
    return { status: 'skipped', reason: 'failed', facts: [] };
  }
}

/**
 * List learned facts for the memory-management UI (twin:memory-list), newest
 * first. No filter ⇒ all facts (active + forgotten) so the UI can restore
 * forgotten ones; `status`/`category` narrow the result.
 */
export async function listFacts(filter?: TwinMemoryListFilter): Promise<TwinFact[]> {
  const db = getDb();
  const conditions = [];
  if (filter?.status) conditions.push(eq(twinFacts.status, filter.status));
  if (filter?.category) conditions.push(eq(twinFacts.category, filter.category));

  const rows = await db
    .select()
    .from(twinFacts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(twinFacts.createdAt));
  return rows.map(rowToFact);
}

/** Set a fact's lifecycle status and return the updated fact (null if not found). */
async function setFactStatus(factId: string, status: TwinFactStatus): Promise<TwinFact | null> {
  const db = getDb();
  const [row] = await db.update(twinFacts).set({ status }).where(eq(twinFacts.id, factId)).returning();
  return row ? rowToFact(row) : null;
}

/**
 * Mark a fact 'forgotten' so it is excluded from injection but kept for restore
 * (twin:memory-forget). Returns the updated fact, or null when not found.
 */
export async function forgetFact(factId: string): Promise<TwinFact | null> {
  return setFactStatus(factId, 'forgotten');
}

/**
 * Restore a forgotten fact back to 'active' (twin:memory-restore). Returns the
 * updated fact, or null when not found.
 */
export async function restoreFact(factId: string): Promise<TwinFact | null> {
  return setFactStatus(factId, 'active');
}

/**
 * Whether per-session learning is paused. Reads the generic settings surface (no
 * dedicated channel) — the renderer toggles TWIN_LEARNING_PAUSED_SETTING_KEY via
 * settings:set. This is a REAL implementation (not a stub): it gates BOTH
 * extraction (here) and injection (twinProfileService). Defensive — any read
 * error means "not paused".
 */
export async function isLearningPaused(): Promise<boolean> {
  try {
    const db = getDb();
    const [row] = await db.select().from(settings).where(eq(settings.key, TWIN_LEARNING_PAUSED_SETTING_KEY));
    return row?.value === 'true';
  } catch (err) {
    log.error('Failed to read learning-pause setting — treating as not paused:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Post-session wiring (self-registered — no shared boot/index file is edited)
// ---------------------------------------------------------------------------

/**
 * The post-session hook: learn facts from the just-finished session. A thin
 * wrapper so the frozen `extractFacts(meetingId)` signature stays the public
 * surface. Exported so tests can re-register it after resetting the dispatcher.
 */
export const learningPostSessionHook: PostSessionHook = async (ctx) => {
  await extractFacts(ctx.meetingId);
};

// Self-register on module import. twinMemoryService is boot-imported via the
// frozen memory IPC (src/main/ipc/twin.ts) AND via twinProfileService (which
// imports it for injection gating), so importing this module wires fact
// extraction onto the post-session dispatcher WITHOUT editing any shared
// boot/index file (Task 4 shares none of these). registerPostSessionHook only
// pushes a function reference — no DB/AI work happens at import time. ES-module
// caching guarantees exactly ONE registration no matter how many importers.
registerPostSessionHook(learningPostSessionHook);
