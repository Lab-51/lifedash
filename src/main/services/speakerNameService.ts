// === FILE PURPOSE ===
// Resolves transcript speaker LABELS (`Me`, `Speaker 2`) to participant NAMES,
// and stores the user's own corrections (SPEAKER.1 Task 4).
//
// The result is a map on the meeting row (`meetings.speaker_names`), applied at
// RENDER and PROMPT time. The labels on the transcript rows are never rewritten,
// so a wrong resolution is one click to undo, re-running diarization cannot
// destroy a name, and the raw evidence stays intact.
//
// === HOW IT WORKS ===
// resolveSpeakerNames(meetingId) runs two stages over the labels that do NOT yet
// have a name:
//   1. DETERMINISTIC — a vocative/introduction: a labelled speaker whose NEXT
//      line, spoken by SOMEONE ELSE, ADDRESSES exactly one roster name ("Thanks,
//      Marta"). Addressing means an address POSITION — line start, line end, or
//      right after a cue word; a mid-sentence mention ("I'll ask Marta to look")
//      is not evidence about who just spoke. Ambiguous evidence (two roster names
//      addressed in that line, or two different names pointing at the same label)
//      resolves to nothing.
//   2. ONE roster-constrained model call, taskType 'summarization' — so a
//      local-only user stays local (GUARD.1) and per-task routing applies. Its
//      output is filtered to confidence >= 0.8 AND a name that is actually on the
//      roster; the ROSTER's spelling wins, never the model's.
//
// ENTITY-NAME.1's rule holds: automate facts, guess nothing. A name is written
// only on evidence, and an EXISTING entry is NEVER overwritten — a user rename
// is the last word until the user clears it.
//
// === DEPENDENCIES ===
// drizzle-orm, db/connection (getDb), db/schema (meetings/transcripts),
// participantRosterService (buildRoster — names only, never emails),
// entityService (normalizeEntityName — the same fold key used everywhere),
// ai-provider (resolveTaskModel + generate), promptBudget (the shared line shape
// and chunk arithmetic), shared/utils/llm-json.
//
// === LIMITATIONS ===
// - NEVER throws: a provider error, an unparseable reply or a missing provider
//   all degrade to "whatever the deterministic stage found" (AI-RESIL.1).
// - The model sees only as much of the transcript as ONE chunk budget allows —
//   the opening of the meeting, which is where introductions happen.

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection';
import { meetings, transcripts } from '../db/schema';
import { buildRoster } from './participantRosterService';
import { normalizeEntityName } from './entityService';
import { generate, resolveTaskModel } from './ai-provider';
import { chunkBudget, chunkSegments, formatLine, type PromptLineSegment } from './promptBudget';
import { parseModelJson } from '../../shared/utils/llm-json';
import { createLogger } from './logger';
import type { SpeakerNameMap } from '../../shared/types/meetings';

const log = createLogger('SpeakerNames');

/** Below this the model's own answer is not evidence, it is a guess. */
const MIN_CONFIDENCE = 0.8;

type LabelledSegment = PromptLineSegment & { speaker: string | null };

/** What ONE model answer looks like. `name: null` is a legitimate answer — it is
 *  the model saying the transcript does not identify that speaker. */
const ModelAnswerSchema = z.object({
  label: z.string(),
  name: z.string().nullable().optional(),
  confidence: z.number(),
});
const ModelAnswersSchema = z.array(ModelAnswerSchema);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** The stored map, normalized to an object (null column -> {}). */
async function readMap(meetingId: string): Promise<SpeakerNameMap> {
  const db = getDb();
  const [row] = await db
    .select({ speakerNames: meetings.speakerNames })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  return row?.speakerNames ?? {};
}

async function writeMap(meetingId: string, map: SpeakerNameMap): Promise<void> {
  const db = getDb();
  await db.update(meetings).set({ speakerNames: map }).where(eq(meetings.id, meetingId));
}

/**
 * Set (or, with `name: null`, clear) ONE speaker's display name. The user's own
 * correction — it always wins, and clearing is what makes a later automatic
 * resolution able to fill that label in again.
 *
 * Returns the full map as stored, so the caller never has to guess the result.
 */
export async function renameSpeaker(meetingId: string, label: string, name: string | null): Promise<SpeakerNameMap> {
  const key = label.trim();
  if (!key) throw new Error('Speaker label is required');
  const map = { ...(await readMap(meetingId)) };
  const value = name?.trim();
  if (value) map[key] = value;
  else delete map[key];
  await writeMap(meetingId, map);
  return map;
}

// ---------------------------------------------------------------------------
// Stage 1 — deterministic (vocatives / introductions)
// ---------------------------------------------------------------------------

/** Normalized word tokens of a line — punctuation dropped, so "Thanks, Marta!"
 *  and "thanks marta" tokenize identically. */
function tokenize(text: string): string[] {
  return normalizeEntityName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Tokens that can immediately precede a name being ADDRESSED rather than merely
 * mentioned ("thanks, Marta", "hi Marta", "welcome Marta, ..."). Deliberately
 * limited to genuine greetings, thanks and apologies — a conjunction or particle
 * ("so", "and", "right", "tak", "ano"...) opens ordinary clauses too ("So Marta
 * will handle the rollout") and is not evidence that the NAME is being addressed
 * rather than merely the next clause starting. Written already-folded (lowercase,
 * no diacritics) because `tokenize` folds before comparing. The Czech entries are
 * there because this app's transcripts routinely are Czech; note that Czech
 * vocatives also DECLINE the name itself ("Marto"), which token equality cannot
 * match — those simply do not resolve here, which is the safe direction.
 */
const ADDRESS_CUES = new Set([
  'thanks',
  'thank',
  'hi',
  'hey',
  'hello',
  'ok',
  'okay',
  'sorry',
  'welcome',
  'diky',
  'dekuji',
  'dekujeme',
  'ahoj',
  'promin',
]);

/**
 * True when `nameTokens` appears in an ADDRESS POSITION inside `lineTokens`: at
 * the start of the line, at the end of it, or immediately after an address cue.
 *
 * A bare mid-sentence MENTION is deliberately NOT evidence. "I'll ask Marta Vance
 * to look at it" says nothing about who spoke last — treating it as a vocative
 * would attribute the previous speaker a name on a guess, and that name then
 * renders on the transcript and reaches the extraction prompt as an EXPLICIT
 * owner. ENTITY-NAME.1's rule: automate facts, never guesses.
 */
function addressesName(lineTokens: string[], nameTokens: string[]): boolean {
  if (nameTokens.length === 0 || nameTokens.length > lineTokens.length) return false;
  for (let i = 0; i + nameTokens.length <= lineTokens.length; i++) {
    if (!nameTokens.every((t, j) => lineTokens[i + j] === t)) continue;
    if (i === 0) return true;
    if (i + nameTokens.length === lineTokens.length) return true;
    if (ADDRESS_CUES.has(lineTokens[i - 1])) return true;
  }
  return false;
}

/**
 * A labelled speaker is named when the VERY NEXT line, spoken by a DIFFERENT
 * labelled speaker, addresses exactly one roster name. Exactly one: a line
 * naming two people is not evidence about either. A label that collects two
 * DIFFERENT names across the transcript is contradictory evidence and is
 * dropped rather than resolved to whichever came first.
 */
function resolveDeterministic(segments: LabelledSegment[], rosterNames: string[]): SpeakerNameMap {
  const rosterTokens = rosterNames.map((name) => ({ name, tokens: tokenize(name) }));
  const candidates = new Map<string, Set<string>>();

  for (let i = 0; i + 1 < segments.length; i++) {
    const speaker = segments[i].speaker?.trim();
    const next = segments[i + 1];
    const nextSpeaker = next.speaker?.trim();
    if (!speaker || !nextSpeaker || speaker === nextSpeaker) continue;

    const lineTokens = tokenize(next.content);
    const named = rosterTokens.filter((entry) => addressesName(lineTokens, entry.tokens));
    if (named.length !== 1) continue;

    const forLabel = candidates.get(speaker) ?? new Set<string>();
    forLabel.add(named[0].name);
    candidates.set(speaker, forLabel);
  }

  const resolved: SpeakerNameMap = {};
  for (const [label, names] of candidates) {
    if (names.size === 1) resolved[label] = [...names][0];
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Stage 2 — ONE roster-constrained model call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You identify who the speakers in a meeting transcript are.

Rules:
- You may ONLY use names from the participant list you are given. Never invent a name, never use a name that is not on that list.
- Answer for a speaker label ONLY when the transcript itself identifies that speaker — someone addresses them by name, they introduce themselves, or they are named as the person who just spoke. Turn-taking, topic or tone are NOT evidence.
- "confidence" is 0 to 1 and must reflect the transcript, not your preference. Use null for "name" whenever the transcript does not identify that speaker; a null with low confidence is a correct and useful answer.
- Output ONE JSON array and nothing else: no prose, no explanation, no code fence.

Output format:
[{"label":"Speaker 1","name":"Full Name or null","confidence":0.0}]`;

/** Names ONLY — an attendee email never enters a prompt (privacy rule). */
function buildUserPrompt(labels: string[], rosterNames: string[], lines: string[]): string {
  return [
    `Participants (the ONLY names you may use): ${rosterNames.join(', ')}`,
    `Speaker labels to identify: ${labels.join(', ')}`,
    '',
    'Transcript:',
    lines.join('\n'),
  ].join('\n');
}

/** The opening of the transcript, bounded by the SAME chunk arithmetic the brief
 *  uses — introductions and greetings live at the start, and one chunk is all
 *  this single call is allowed to cost. */
function openingLines(provider: Parameters<typeof chunkBudget>[0], segments: LabelledSegment[]): string[] {
  const [firstChunk] = chunkSegments(segments, chunkBudget(provider, SYSTEM_PROMPT));
  return (firstChunk ?? []).map(formatLine);
}

/**
 * Keep only answers that are EVIDENCE: a label we actually asked about, a
 * confidence at or above the bar, and a name that folds onto a roster entry.
 * The roster's spelling is what gets stored — the model's spelling of a name is
 * not authoritative even when the name itself is right.
 */
function filterAnswers(
  answers: z.infer<typeof ModelAnswersSchema>,
  labels: string[],
  rosterNames: string[],
): SpeakerNameMap {
  const wanted = new Set(labels);
  const byKey = new Map(rosterNames.map((name) => [normalizeEntityName(name), name]));
  const out: SpeakerNameMap = {};
  for (const answer of answers) {
    const label = answer.label.trim();
    const name = answer.name?.trim();
    if (!wanted.has(label) || !name || answer.confidence < MIN_CONFIDENCE) continue;
    const rosterSpelling = byKey.get(normalizeEntityName(name));
    if (rosterSpelling) out[label] = rosterSpelling;
  }
  return out;
}

/** ONE call, fully error-isolated: any failure means "no names from the model",
 *  never a wrong name and never a throw into the meeting view (AI-RESIL.1). */
async function resolveWithModel(
  segments: LabelledSegment[],
  labels: string[],
  rosterNames: string[],
): Promise<SpeakerNameMap> {
  try {
    // taskType 'summarization' so routing, usage logging and the local-only
    // guard all behave exactly as they do for the brief (GUARD.1).
    const provider = await resolveTaskModel('summarization');
    if (!provider) return {};

    const { text } = await generate({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      taskType: 'summarization',
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(labels, rosterNames, openingLines(provider, segments)),
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
    });

    const parsed = ModelAnswersSchema.safeParse(parseModelJson(text ?? ''));
    if (!parsed.success) {
      log.warn('Speaker-name reply did not match the expected shape; no names taken from the model');
      return {};
    }
    return filterAnswers(parsed.data, labels, rosterNames);
  } catch (err) {
    log.error('Speaker-name model call failed; keeping deterministic results only:', err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Resolve names for this meeting's speaker labels and persist the result.
 *
 * Only labels with NO name yet are considered: an existing entry — whether the
 * user typed it or an earlier run wrote it — is never overwritten. Clearing a
 * name (renameSpeaker with null) is what makes a label eligible again.
 *
 * Returns the full stored map. Never throws.
 */
export async function resolveSpeakerNames(meetingId: string): Promise<SpeakerNameMap> {
  const existing = await readMap(meetingId);
  const db = getDb();
  const segments: LabelledSegment[] = await db
    .select({ startTime: transcripts.startTime, content: transcripts.content, speaker: transcripts.speaker })
    .from(transcripts)
    .where(eq(transcripts.meetingId, meetingId))
    .orderBy(asc(transcripts.startTime));

  const labels = [...new Set(segments.map((s) => s.speaker?.trim()).filter((s): s is string => !!s))];
  const unresolved = labels.filter((label) => !existing[label]);
  if (unresolved.length === 0) return existing;

  const rosterNames = (await buildRoster(meetingId)).map((entry) => entry.name);
  if (rosterNames.length === 0) return existing;

  const deterministic = resolveDeterministic(segments, rosterNames);
  const resolved: SpeakerNameMap = {};
  for (const label of unresolved) {
    if (deterministic[label]) resolved[label] = deterministic[label];
  }

  const stillUnknown = unresolved.filter((label) => !resolved[label]);
  if (stillUnknown.length > 0) {
    const fromModel = await resolveWithModel(segments, stillUnknown, rosterNames);
    for (const label of stillUnknown) {
      if (fromModel[label]) resolved[label] = fromModel[label];
    }
  }

  // RE-READ before writing. `existing` was read before the model call, which takes
  // MINUTES on a local tier, and the transcript's rename chip stays live the whole
  // time — so `existing` is stale by now, and writing it back over the whole column
  // would undo a rename made during the wait: a name the user typed for a
  // still-unresolved label would be replaced by the model's answer, and a name the
  // user CLEARED would be resurrected from the stale copy.
  const fresh = await readMap(meetingId);
  if (Object.keys(resolved).length === 0) return fresh;
  // `fresh` LAST: whatever is on the row NOW outranks anything resolved in this
  // run. Losing a user's name is the one failure here that re-running cannot undo.
  const merged = { ...resolved, ...fresh };
  await writeMap(meetingId, merged);
  return merged;
}
