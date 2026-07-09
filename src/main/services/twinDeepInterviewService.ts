// === FILE PURPOSE ===
// Digital Twin DEEP interview service (V3.3.5 — "Deep Creation", Task 2).
// The deep interview is a multi-turn, conversational profile build: given the
// user's brief + the Q&A so far, it asks the next best question (interviewNext),
// then synthesizes the whole conversation into a profile draft the user edits
// (interviewSynthesize). It is DISTINCT from twinInterviewService.draftSection,
// which does single-shot per-section extraction for the Quick-form "Interview me"
// — that file is untouched by this feature.
//
// === DESIGN / FAILURE TOLERANCE ===
// Both entry points route through the ONE-SHOT generate path (ai-provider.generate,
// NOT streaming) tagged `taskType: 'twin_interview'` — invoke-per-turn: each turn
// is a small request -> JSON response. They mirror twinInterviewService /
// liveTriageService's validate-retry-skip discipline exactly:
//   - validate the parsed JSON against a zod schema,
//   - retry ONCE with the rejection reason appended,
//   - then SKIP gracefully ({ status: 'skipped', reason: 'failed' }).
// They NEVER throw for AI reasons: no model configured -> 'no-model'; any
// generation/parse failure -> 'failed'; a generation call that throws skips
// immediately (a network failure is not a JSON problem, so it does not burn the
// retry). Every failure degrades to the manual wizard path.
//
// interviewNext also enforces a HARD CAP of 8 questions (counted from qa.length)
// and returns { status: 'done' } either at that cap or when the model reports it
// has enough coverage. interviewSynthesize produces a Partial<TwinProfileSections>
// draft across all 7 draftable sections + a refined brief; NOTHING is saved here —
// the wizard seeds its editable review from the draft and the user saves there.
//
// === DEPENDENCIES ===
// zod, ai-provider (resolveTaskModel/generate), logger, shared/types/twin.

import { z } from 'zod';
import { resolveTaskModel, generate, type ResolvedProvider } from './ai-provider';
import { createLogger } from './logger';
import type {
  TwinInterviewNextPayload,
  TwinInterviewNextResult,
  TwinInterviewSynthesizePayload,
  TwinInterviewSynthesizeResult,
  TwinProfileSections,
} from '../../shared/types/twin';

const log = createLogger('TwinDeepInterview');

/** Hard cap on interview questions — finish (synthesize) once this many are asked. */
const MAX_QUESTIONS = 8;

// Output-token budgets. These MUST be generous because the deep interview is meant
// for state-of-the-art models — and every current frontier model (GPT-5/o-series,
// Gemini 2.5/3, Claude thinking) is a REASONING model whose internal reasoning tokens
// count against this same budget. A tiny cap (e.g. 256) is entirely consumed by
// reasoning, leaving 0 tokens for the visible JSON answer (finishReason 'length',
// empty text) — the interview then skips to the manual fallback. 4096/8192 give the
// model room to reason AND emit the answer. (Mirrors ai-provider REASONING_MIN_TOKENS.)
const MAX_QUESTION_TOKENS = 4096; // small JSON answer + reasoning headroom
const MAX_SYNTHESIS_TOKENS = 8192; // full 7-section profile JSON + reasoning headroom

// ---------------------------------------------------------------------------
// Shared validate-retry-skip generate loop (mirrors liveTriageService.generateDrafts)
// ---------------------------------------------------------------------------

/** Strip an optional ```json fence and trim — same cleaning both anchors use. */
function stripFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Generate against the twin_interview model and validate the output with `parse`,
 * retrying ONCE (rejection reason appended) then skipping. Returns null when both
 * attempts fail OR the generation call throws — the caller maps null to a
 * `{ status: 'skipped', reason: 'failed' }` result. `parse` MUST throw (with a
 * terse reason) on malformed output, exactly like twinInterviewService.parseDraft.
 */
async function generateValidated<T>(
  provider: ResolvedProvider,
  system: string,
  basePrompt: string,
  maxTokens: number,
  parse: (raw: string) => T,
): Promise<T | null> {
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const result = await generate({
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiKeyEncrypted: provider.apiKeyEncrypted,
        baseUrl: provider.baseUrl,
        model: provider.model,
        taskType: 'twin_interview',
        prompt,
        system,
        temperature: provider.temperature ?? 0,
        maxTokens: provider.maxTokens ?? maxTokens,
      });
      text = result.text ?? '';
    } catch (err) {
      // Generation/network failure — not a JSON problem; skip (don't burn the retry).
      log.debug('Twin deep interview generation call failed:', err instanceof Error ? err.message : err);
      return null;
    }

    try {
      return parse(text);
    } catch (parseErr) {
      const reason = parseErr instanceof Error ? parseErr.message : 'invalid output';
      if (attempt === 0) {
        log.debug(`Twin deep interview output invalid (${reason}) — retrying once`);
        prompt = `${basePrompt}\n\nYour previous reply was rejected: ${reason}. Reply with ONLY the JSON.`;
        continue;
      }
      log.info(`Twin deep interview output invalid after retry (${reason}) — skipping`);
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// interviewNext — one adaptive question per turn
// ---------------------------------------------------------------------------

const NEXT_SYSTEM = `You conduct a focused, adaptive interview to build a professional's "digital twin" profile that an assistant will use on their behalf.
Ask the SINGLE most valuable next question given the brief and the answers so far.
Rules:
- Exactly ONE question at a time. Keep it short, concrete, and easy to answer.
- Target what is still MISSING or SHALLOW: who they are, their industry/company/focus, their key projects, the people they work with, domain vocabulary, their goals, and how they like the assistant to communicate.
- NEVER repeat or lightly reword a question already asked.
- Set "done": true when you have enough to draft a solid profile, or when few useful questions remain.
Respond with ONLY this JSON (no prose, no markdown fences):
{ "done": boolean, "question"?: string }
"question" is REQUIRED (a non-empty string) whenever "done" is false.`;

const nextQuestionSchema = z.object({
  done: z.boolean(),
  question: z.string().trim().min(1).optional(),
});

/** Parse result of the next-question turn: either finished, or the next question. */
type NextParsed = { done: true } | { done: false; question: string };

/**
 * Parse+validate a next-question reply. Throws (terse reason) on malformed output
 * — including `done:false` with no question — so generateValidated retries once.
 */
function parseNextQuestion(raw: string): NextParsed {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(raw));
  } catch {
    throw new Error('Output was not valid JSON');
  }
  const result = nextQuestionSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`JSON did not match the required schema: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  if (result.data.done) return { done: true };
  const question = result.data.question?.trim();
  if (!question) throw new Error('"done" was false but no question was provided');
  return { done: false, question };
}

/** Render the brief + known-so-far + transcript into the per-turn prompt. */
function buildNextPrompt(payload: TwinInterviewNextPayload): string {
  const brief = payload.brief.trim() || '(none provided)';
  const known = Object.keys(payload.profileSoFar).length ? JSON.stringify(payload.profileSoFar) : '(nothing yet)';
  const transcript = payload.qa.length
    ? payload.qa.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer.trim() || '(skipped)'}`).join('\n\n')
    : '(no questions asked yet)';
  const asked = payload.qa.length;
  const remaining = Math.max(0, MAX_QUESTIONS - asked);
  const lines = [
    `The user's brief (their own words): ${brief}`,
    '',
    `What we already know (JSON): ${known}`,
    '',
    'Interview so far:',
    transcript,
    '',
    `Questions asked: ${asked}. You may ask at most ${remaining} more.`,
  ];
  const roleContext = payload.roleContext?.trim();
  if (roleContext) {
    // Web research already covered the generic role basics. Steer the model to the GAPS.
    lines.unshift(
      'Researched role/industry BACKGROUND (already known from web research — do NOT re-ask these generic role basics). ' +
        'Ask about the GAPS only the user knows: their REAL projects, the ACTUAL people they work with, their SPECIFIC goals, and how they want the assistant to communicate:',
      roleContext,
      '',
    );
  }
  return lines.join('\n');
}

/**
 * Ask the next interview question. Returns `done` at the 8-question hard cap or
 * when the model reports sufficient coverage; `skipped` when no model is
 * configured ('no-model') or generation/validation fails after one retry
 * ('failed'); otherwise `{ ok, question }`. Never throws for AI reasons.
 */
export async function interviewNext(payload: TwinInterviewNextPayload): Promise<TwinInterviewNextResult> {
  // Hard cap: once 8 questions have been asked, we are done regardless of the model.
  if (payload.qa.length >= MAX_QUESTIONS) return { status: 'done' };

  const provider = await resolveTaskModel('twin_interview');
  if (!provider) {
    log.debug('No AI provider configured for twin_interview — deep interview degrades to manual');
    return { status: 'skipped', reason: 'no-model' };
  }

  const parsed = await generateValidated(
    provider,
    NEXT_SYSTEM,
    buildNextPrompt(payload),
    MAX_QUESTION_TOKENS,
    parseNextQuestion,
  );
  if (!parsed) return { status: 'skipped', reason: 'failed' };
  if (parsed.done) return { status: 'done' };
  return { status: 'ok', question: parsed.question };
}

// ---------------------------------------------------------------------------
// interviewSynthesize — the Q&A -> editable profile draft
// ---------------------------------------------------------------------------

const SYNTHESIZE_SYSTEM = `You turn a completed interview (the user's brief + a series of Q&A) into a structured "digital twin" profile draft the user will review and edit before saving.
Rules:
- Use ONLY what the brief and answers actually state — never invent, guess, or pad. Omit any section you have no information for.
- Ignore skipped/empty answers.
- Refine the brief into a single crisp sentence in "brief.statement".
Respond with ONLY this JSON (no prose, no markdown fences); omit keys you have nothing for:
{
  "brief"?: { "statement"?: string },
  "identity"?: { "name"?: string, "role"?: string, "seniority"?: string },
  "domain"?: { "industry"?: string, "company"?: string, "focus"?: string },
  "projects"?: [{ "name": string, "description"?: string }],
  "people"?: [{ "name": string, "role"?: string, "org"?: string }],
  "vocabulary"?: [{ "term": string, "meaning": string }],
  "goals"?: [string],
  "preferences"?: { "tone"?: string, "language"?: string, "cardTitleStyle"?: string }
}`;

// Every section is optional (the draft is Partial<TwinProfileSections>); unknown
// keys are stripped by zod's default so a stray field never reaches the wizard.
const synthesizeSchema = z.object({
  brief: z.object({ statement: z.string() }).partial().optional(),
  identity: z.object({ name: z.string(), role: z.string(), seniority: z.string() }).partial().optional(),
  domain: z.object({ industry: z.string(), company: z.string(), focus: z.string() }).partial().optional(),
  projects: z.array(z.object({ name: z.string().min(1), description: z.string().optional() })).optional(),
  people: z
    .array(z.object({ name: z.string().min(1), role: z.string().optional(), org: z.string().optional() }))
    .optional(),
  vocabulary: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })).optional(),
  goals: z.array(z.string().min(1)).optional(),
  preferences: z.object({ tone: z.string(), language: z.string(), cardTitleStyle: z.string() }).partial().optional(),
});

/** Parse+validate a synthesized draft; throws (terse reason) on malformed output. */
function parseSynthesis(raw: string): Partial<TwinProfileSections> {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(raw));
  } catch {
    throw new Error('Output was not valid JSON');
  }
  const result = synthesizeSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`JSON did not match the required schema: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  return result.data as Partial<TwinProfileSections>;
}

/** Render the brief + full transcript into the synthesis prompt (skips empty answers). */
function buildSynthesizePrompt(payload: TwinInterviewSynthesizePayload): string {
  const brief = payload.brief.trim() || '(none provided)';
  const answered = payload.qa.filter((t) => t.answer.trim());
  const transcript = answered.length
    ? answered.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer.trim()}`).join('\n\n')
    : '(no answers were given)';
  const lines = [`The user's brief (their own words): ${brief}`, '', 'Interview:', transcript];
  const roleContext = payload.roleContext?.trim();
  if (roleContext) {
    // Background only — synthesis still draws its facts from the brief + answers, and the
    // gap-focused interview is what captured the user's REAL projects/people/goals.
    lines.unshift(
      'Researched role/industry BACKGROUND (from web research — use ONLY to interpret the answers below; base the draft on the brief and answers, and never fabricate people or projects from this background):',
      roleContext,
      '',
    );
  }
  return lines.join('\n');
}

/**
 * Synthesize the interview into a profile draft the user edits before saving.
 * `skipped` when no model is configured ('no-model') or synthesis fails after one
 * retry ('failed'); otherwise `{ ok, draft }`. Never throws for AI reasons.
 */
export async function interviewSynthesize(
  payload: TwinInterviewSynthesizePayload,
): Promise<TwinInterviewSynthesizeResult> {
  const provider = await resolveTaskModel('twin_interview');
  if (!provider) {
    log.debug('No AI provider configured for twin_interview — deep interview synthesis degrades to manual');
    return { status: 'skipped', reason: 'no-model' };
  }

  const draft = await generateValidated(
    provider,
    SYNTHESIZE_SYSTEM,
    buildSynthesizePrompt(payload),
    MAX_SYNTHESIS_TOKENS,
    parseSynthesis,
  );
  if (!draft) return { status: 'skipped', reason: 'failed' };
  return { status: 'ok', draft };
}
