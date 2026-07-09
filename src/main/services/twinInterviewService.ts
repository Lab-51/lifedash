// === FILE PURPOSE ===
// Digital Twin creation-wizard AI assist (V3.3 Task 4). Extracts DRAFT field
// values for ONE profile section from a short free-form answer, using the
// `twin_interview` task type (falls back to the live_assistant model). This is
// a one-shot request -> JSON response, so it uses a plain invoke-style call
// (ai-provider.generate) — NOT the streaming meeting-agent infra — mirroring
// liveTriageService's validate-retry-skip discipline:
//   - validate the parsed JSON against the section's zod schema,
//   - retry ONCE with the rejection reason appended,
//   - then SKIP gracefully (return { status: 'skipped', reason: 'failed' }).
// It NEVER throws into the wizard: no model configured -> 'no-model'; any
// generation/parse failure -> 'failed'. The wizard stays fully usable manually.
//
// === DEPENDENCIES ===
// zod, ai-provider (resolveTaskModel/generate), logger.

import { z } from 'zod';
import { resolveTaskModel, generate } from './ai-provider';
import { createLogger } from './logger';
import type { TwinProfileSectionKey, TwinProfileSections, TwinInterviewDraft } from '../../shared/types/twin';

const log = createLogger('TwinInterview');

// Output-token budget. A section draft is tiny, but the `twin_interview` task is
// meant for state-of-the-art models, and every current frontier model is a REASONING
// model whose reasoning tokens count against this budget — a low cap (e.g. 512) can be
// fully consumed by reasoning, leaving 0 tokens for the JSON (finishReason 'length',
// empty text) and forcing a skip. Keep it generous so reasoning + the draft both fit.
const MAX_OUTPUT_TOKENS = 4096;

const BASE_SYSTEM = `You help a professional fill in ONE section of their profile from a short free-form answer.
Rules:
- Extract ONLY details the answer actually states — never invent or infer beyond it.
- If the answer contains nothing relevant to this section, return the empty value (an empty object {} or empty array []).
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

// --- per-section extraction schemas + output specs (mirror shared/types/twin.ts) ---

interface SectionExtraction {
  /** Validates the parsed model output; its inferred type IS the section value. */
  schema: z.ZodTypeAny;
  /** Appended after "Return " in the system prompt — the exact JSON shape wanted. */
  outputSpec: string;
}

const SECTION_EXTRACTION: Record<TwinProfileSectionKey, SectionExtraction> = {
  identity: {
    schema: z.object({ name: z.string(), role: z.string(), seniority: z.string() }).partial(),
    outputSpec: 'a JSON object: { "name"?: string, "role"?: string, "seniority"?: string }.',
  },
  domain: {
    schema: z.object({ industry: z.string(), company: z.string(), focus: z.string() }).partial(),
    outputSpec: 'a JSON object: { "industry"?: string, "company"?: string, "focus"?: string }.',
  },
  preferences: {
    schema: z.object({ tone: z.string(), language: z.string(), cardTitleStyle: z.string() }).partial(),
    outputSpec:
      'a JSON object: { "tone"?: string, "language"?: string, "cardTitleStyle"?: string } (cardTitleStyle = how card/task titles should read, e.g. "imperative").',
  },
  projects: {
    schema: z.array(z.object({ name: z.string().min(1), description: z.string().optional() })),
    outputSpec: 'a JSON array of { "name": string, "description"?: string }.',
  },
  people: {
    schema: z.array(z.object({ name: z.string().min(1), role: z.string().optional(), org: z.string().optional() })),
    outputSpec: 'a JSON array of { "name": string, "role"?: string, "org"?: string }.',
  },
  vocabulary: {
    schema: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })),
    outputSpec: 'a JSON array of { "term": string, "meaning": string }.',
  },
  goals: {
    schema: z.array(z.string().min(1)),
    outputSpec: 'a JSON array of strings, each a short goal or priority.',
  },
};

/**
 * Strip an optional ```json fence, parse, and validate against the section
 * schema. Throws (with a terse reason) on malformed output so the caller can
 * retry once then skip — identical discipline to liveTriageService.parseSuggestions.
 */
function parseDraft(raw: string, schema: z.ZodTypeAny): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new Error('Output was not valid JSON');
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(`JSON did not match the required schema: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  return result.data;
}

/**
 * Draft one profile section from a free-form answer. Guaranteed not to reject:
 * every failure degrades to a `skipped` result so the wizard stays usable.
 *   - no provider configured        -> { status: 'skipped', reason: 'no-model' }
 *   - generation/parse fails (x2)    -> { status: 'skipped', reason: 'failed' }
 *   - success                        -> { status: 'ok', draft }
 */
export async function draftSection<K extends TwinProfileSectionKey>(
  section: K,
  answer: string,
): Promise<TwinInterviewDraft<K>> {
  const provider = await resolveTaskModel('twin_interview');
  if (!provider) {
    log.debug('No AI provider configured for twin_interview — wizard stays manual');
    return { status: 'skipped', reason: 'no-model' };
  }

  const { schema, outputSpec } = SECTION_EXTRACTION[section];
  const system = `${BASE_SYSTEM}\n\nReturn ${outputSpec}`;
  let prompt = answer;

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
        maxTokens: provider.maxTokens ?? MAX_OUTPUT_TOKENS,
      });
      text = result.text ?? '';
    } catch (err) {
      // Generation/network failure — not a JSON problem; skip (don't burn the retry).
      log.debug('Twin interview generation call failed:', err instanceof Error ? err.message : err);
      return { status: 'skipped', reason: 'failed' };
    }

    try {
      const draft = parseDraft(text, schema) as TwinProfileSections[K];
      return { status: 'ok', draft };
    } catch (parseErr) {
      const reason = parseErr instanceof Error ? parseErr.message : 'invalid output';
      if (attempt === 0) {
        log.debug(`Twin interview output invalid (${reason}) — retrying once`);
        prompt = `${answer}\n\nYour previous reply was rejected: ${reason}. Reply with ONLY the JSON.`;
        continue;
      }
      log.info(`Twin interview output invalid after retry (${reason}) — skipping`);
      return { status: 'skipped', reason: 'failed' };
    }
  }
  return { status: 'skipped', reason: 'failed' };
}
