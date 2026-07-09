// === FILE PURPOSE ===
// Digital Twin web-research service (V3.3.5 — Task 4 + orchestrated deep creation).
// Two entry points share one PROVIDER-NATIVE, server-side web search (Vercel AI SDK
// provider tools), each cited by the source URLs the model actually used:
//   - researchWeb  — company + industry -> public domain/vocabulary enrichment;
//   - researchRole — role + company + industry (+ brief) -> a fuller cited role dossier
//     (domain, vocabulary, typical goals, refined identity) PLUS a prose roleContext
//     that seeds the gap-focused deep interview (never fabricated people/projects).
// No scraping, no bespoke search API:
// enrichment exists exactly where the configured provider's installed adapter
// exposes a web-search tool, and degrades to an honest `unsupported` everywhere
// else. Same validate-retry-skip discipline as twinInterviewService.
//
// === PREFLIGHT (verified against node_modules, do NOT trust memory) ===
// Installed: ai@6, @ai-sdk/anthropic@3, @ai-sdk/openai@3, @ai-sdk/google@3 (provider
// spec v3). Each frontier adapter exposes a usable server-side web-search tool:
//   - anthropic → anthropic.tools.webSearch_20250305()  (web_search server tool)
//   - openai    → openai.tools.webSearch()               (Responses API — the default call)
//   - google    → google.tools.googleSearch()            (search grounding)
// generateText surfaces the sources as result.steps[].sources (url sources carry
// { sourceType:'url', url, title? }), which become the citations. So web research
// IS supported for the frontier providers; kimi/ollama/lmstudio (OpenAI-compatible
// /chat/completions, no web-search tool) resolve as `unsupported`.
//
// === DEPENDENCIES ===
// ai (generateText, stepCountIs), @ai-sdk/{anthropic,openai,google}, zod,
// ai-provider (resolveTaskModel — READ ONLY, resolution reused, not edited),
// secure-storage (decryptString), logger. Shared frozen contracts in shared/types/twin.

import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { resolveTaskModel, type ResolvedProvider } from './ai-provider';
import { decryptString } from './secure-storage';
import { createLogger } from './logger';
import type { AIProviderName } from '../../shared/types';
import type {
  TwinWebResearchPayload,
  TwinWebResearchResult,
  TwinRoleResearchPayload,
  TwinRoleResearchResult,
  TwinProfileSections,
  TwinCitation,
} from '../../shared/types/twin';

const log = createLogger('TwinWebResearch');

// Output budget. The draft is small, but this runs on SOTA cloud models — every current
// frontier model is a REASONING model whose reasoning tokens count against this budget,
// and the call also spends tokens across the multi-step web-search loop. A low cap gets
// consumed before any visible answer (finishReason 'length', empty text), so keep it
// generous enough for reasoning + the search summary + the extracted JSON.
const MAX_OUTPUT_TOKENS = 8192;
/** Cap the search→answer loop so a call can't run away (search, maybe re-search, then answer). */
const MAX_SEARCH_STEPS = 4;
/** Anthropic's per-call web-search cap. */
const MAX_WEB_SEARCHES = 5;

/**
 * Providers whose INSTALLED @ai-sdk adapter exposes a server-side web-search tool
 * we can pass to generateText (verified in the preflight above). These are exactly
 * today's FRONTIER_PROVIDERS, which is why the section gates its visibility on
 * `twin:get-creation-model`'s `isFrontier` flag — the build-time capability and the
 * UI gate stay consistent. kimi/ollama/lmstudio have no such tool → `unsupported`.
 */
const WEB_SEARCH_PROVIDERS = new Set<AIProviderName>(['openai', 'anthropic', 'google']);

/** Whether web research is currently supported, and if not, why. */
export interface TwinWebResearchSupport {
  supported: boolean;
  reason: string;
}

/**
 * Report whether the resolved twin-creation model can do server-side web research.
 * Resolves the same provider the rest of twin creation uses (`twin_interview`) and
 * checks its adapter's capability — no cloud call, no data leaves the machine.
 * Signature frozen.
 */
export async function checkSupport(): Promise<TwinWebResearchSupport> {
  const provider = await resolveTaskModel('twin_interview');
  if (!provider) {
    return { supported: false, reason: 'No AI model is configured for twin creation, so web research is unavailable.' };
  }
  if (!WEB_SEARCH_PROVIDERS.has(provider.providerName)) {
    return {
      supported: false,
      reason:
        `The configured provider "${provider.providerName}" has no server-side web-search tool in the installed SDK. ` +
        `Web research needs a frontier cloud provider (OpenAI, Anthropic, or Google).`,
    };
  }
  return {
    supported: true,
    reason: `${provider.providerName} exposes a native server-side web-search tool (ai@6 / @ai-sdk/${provider.providerName}).`,
  };
}

// --- schema-constrained extraction (mirrors shared/types/twin.ts: domain + vocabulary) ---

const webDraftSchema = z.object({
  domain: z.object({ industry: z.string(), company: z.string(), focus: z.string() }).partial().optional(),
  vocabulary: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })).optional(),
});

// The role dossier extends the web draft with TYPICAL role goals, a refined identity
// (role/seniority), and a prose roleContext summary. It deliberately has NO people/projects
// keys, so any the model emits are stripped by zod — real colleagues/projects come only from
// the interview/history, never from generic role research.
const roleDraftSchema = z.object({
  domain: z.object({ industry: z.string(), company: z.string(), focus: z.string() }).partial().optional(),
  vocabulary: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })).optional(),
  goals: z.array(z.string().min(1)).optional(),
  identity: z.object({ role: z.string(), seniority: z.string() }).partial().optional(),
  roleContext: z.string().optional(),
});

/** True when any own value of the object is a non-blank string. */
function hasAnyText(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((v) => typeof v === 'string' && v.trim().length > 0);
}

/** Strip an optional ```json fence, trim, and JSON.parse; throws (terse reason) on empty/invalid. */
function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) throw new Error('Output was empty');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Output was not valid JSON');
  }
}

const SYSTEM = `You research a company and its industry using the web-search tool, then extract PUBLIC, verifiable context to enrich a professional's profile.
Rules:
- Use the web-search tool to find current, public information about the company and its industry.
- Extract ONLY facts supported by the sources you actually found — never invent, infer beyond them, or pad.
- Prefer durable, widely-agreed facts: what the company does, its sector and focus; standard industry vocabulary and acronyms with plain-language meanings.
- If you cannot find reliable public information, return empty values (an empty object {} / empty array []).
After searching, respond with ONLY the JSON described below — no prose, no markdown code fences.
Return a JSON object: { "domain"?: { "industry"?: string, "company"?: string, "focus"?: string }, "vocabulary"?: Array<{ "term": string, "meaning": string }> }.`;

/** Build the research prompt from the (user-entered) company/industry strings. */
function buildPrompt(payload: TwinWebResearchPayload): string {
  const lines: string[] = [];
  const company = payload.company.trim();
  const industry = payload.industry.trim();
  if (company) lines.push(`Company: ${company}`);
  if (industry) lines.push(`Industry: ${industry}`);
  return `Research the following and enrich the profile's domain context and vocabulary.\n${lines.join('\n')}`;
}

/**
 * Validate the (fence-stripped) JSON against the draft schema and keep only the
 * sections the model actually populated. Throws (with a terse reason) on malformed/
 * empty output so the caller can retry once then skip — identical discipline to
 * twinInterviewService.parseDraft.
 */
function parseDraft(raw: string): Partial<TwinProfileSections> {
  const result = webDraftSchema.safeParse(parseJsonObject(raw));
  if (!result.success) {
    throw new Error(`JSON did not match the required schema: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  const draft: Partial<TwinProfileSections> = {};
  const { domain, vocabulary } = result.data;
  if (domain && hasAnyText(domain)) draft.domain = domain;
  if (vocabulary && vocabulary.length > 0) draft.vocabulary = vocabulary;
  return draft;
}

/** Turn the model's url sources into deduped citations (title falls back to the url). */
function collectCitations(sources: readonly unknown[]): TwinCitation[] {
  const seen = new Set<string>();
  const out: TwinCitation[] = [];
  for (const raw of sources) {
    const s = raw as { sourceType?: string; url?: string; title?: string };
    if (s.sourceType !== 'url' || !s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ title: s.title?.trim() || s.url, url: s.url });
  }
  return out;
}

/** Build the provider model + its native web-search tool. Only reached for WEB_SEARCH_PROVIDERS. */
function buildWebModel(provider: ResolvedProvider): { model: LanguageModel; tools: ToolSet } {
  const apiKey = provider.apiKeyEncrypted ? decryptString(provider.apiKeyEncrypted) : '';
  switch (provider.providerName) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return {
        model: anthropic(provider.model) as LanguageModel,
        tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_WEB_SEARCHES }) } as ToolSet,
      };
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey });
      return {
        model: google(provider.model) as LanguageModel,
        tools: { google_search: google.tools.googleSearch({}) } as ToolSet,
      };
    }
    default: {
      // openai — the default call routes to the Responses API, which webSearch needs.
      const openai = createOpenAI({ apiKey });
      return {
        model: openai(provider.model) as LanguageModel,
        tools: { web_search: openai.tools.webSearch({}) } as ToolSet,
      };
    }
  }
}

/**
 * Run the provider-native web-search generate loop with validate-retry-skip: call
 * generateText (bounded search steps), collect url citations, then `parse` the text.
 * On success returns { value, citations }; on a parse failure retries ONCE (rejection
 * reason appended to the prompt) then returns null; a generation/network throw returns
 * null immediately (not a JSON problem — does not burn the retry). Shared by researchWeb
 * and researchRole so both keep byte-identical failure discipline. `parse` MUST throw
 * (a terse reason) on malformed output.
 */
async function runWebSearchLoop<T>(
  model: LanguageModel,
  tools: ToolSet,
  system: string,
  basePrompt: string,
  parse: (raw: string) => T,
): Promise<{ value: T; citations: TwinCitation[] } | null> {
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    let citations: TwinCitation[];
    try {
      const result = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(MAX_SEARCH_STEPS),
        system,
        prompt,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      text = result.text ?? '';
      // Sources accrue per step; the answer step often has none, so aggregate across
      // steps and fall back to the top-level (last-step) sources.
      const stepSources = (result.steps ?? []).flatMap((s) => s.sources ?? []);
      citations = collectCitations(stepSources.length > 0 ? stepSources : (result.sources ?? []));
    } catch (err) {
      // Generation/network failure — not a JSON problem; skip (don't burn the retry).
      log.debug('Web research generation call failed:', err instanceof Error ? err.message : err);
      return null;
    }

    try {
      return { value: parse(text), citations };
    } catch (parseErr) {
      const reason = parseErr instanceof Error ? parseErr.message : 'invalid output';
      if (attempt === 0) {
        log.debug(`Web research output invalid (${reason}) — retrying once`);
        prompt = `${basePrompt}\n\nYour previous reply was rejected: ${reason}. After searching, reply with ONLY the JSON.`;
        continue;
      }
      log.info(`Web research output invalid after retry (${reason}) — skipping`);
      return null;
    }
  }
  return null;
}

/**
 * Research a company/industry on the web into a cited profile draft. Never throws:
 *   - no provider configured            -> { status: 'skipped', reason: 'no-model' }
 *   - provider has no web-search tool    -> { status: 'unsupported' }   (no cloud call)
 *   - generation/parse fails (x2)        -> { status: 'skipped', reason: 'failed' }
 *   - success                            -> { status: 'ok', draft, citations }
 * Signature frozen.
 */
export async function researchWeb(payload: TwinWebResearchPayload): Promise<TwinWebResearchResult> {
  const provider = await resolveTaskModel('twin_interview');
  if (!provider) {
    log.debug('No AI provider configured for twin_interview — web research unavailable');
    return { status: 'skipped', reason: 'no-model' };
  }
  if (!WEB_SEARCH_PROVIDERS.has(provider.providerName)) {
    log.debug(`Provider "${provider.providerName}" has no server-side web-search tool — unsupported`);
    return { status: 'unsupported' };
  }

  const { model, tools } = buildWebModel(provider);
  const outcome = await runWebSearchLoop(model, tools, SYSTEM, buildPrompt(payload), parseDraft);
  if (!outcome) return { status: 'skipped', reason: 'failed' };
  return { status: 'ok', draft: outcome.value, citations: outcome.citations };
}

const ROLE_SYSTEM = `You research a professional's ROLE, their company, and their industry using the web-search tool, then produce a cited role dossier that seeds a "digital twin" profile.
Rules:
- Use the web-search tool to find current, public information about the role, the company, and the industry.
- For "domain" and "vocabulary", extract ONLY facts supported by the sources you actually found — never invent, infer beyond them, or pad.
- For "goals" and "roleContext", describe how this role is COMMONLY understood in this industry, grounded in your sources where possible. These are TYPICAL, generic patterns the user will confirm or prune — NOT claims about this specific person.
- NEVER invent specific colleagues, teammates, or concrete projects, and do NOT output any people or projects — those come only from the user. Do not force generic examples into the profile.
- If you cannot find reliable information for a field, omit it (empty object {} / empty array [] / empty string).
After searching, respond with ONLY the JSON described below — no prose, no markdown code fences.
Return a JSON object:
{
  "domain"?: { "industry"?: string, "company"?: string, "focus"?: string },
  "vocabulary"?: Array<{ "term": string, "meaning": string }>,
  "goals"?: string[],
  "identity"?: { "role"?: string, "seniority"?: string },
  "roleContext"?: string
}
"goals" are the TYPICAL priorities/responsibilities for this role in this industry.
"identity" is a refined role title / seniority derived from the given role.
"roleContext" is a concise 2-4 sentence prose summary of what this role typically involves in this industry: responsibilities, typical stakeholders, and priorities. It is BACKGROUND that seeds an interview — NOT structured people or projects.`;

/** Build the role-dossier prompt from the user's role/company/industry + brief. */
function buildRolePrompt(payload: TwinRoleResearchPayload): string {
  const lines: string[] = [];
  const role = payload.role.trim();
  const company = payload.company.trim();
  const industry = payload.industry.trim();
  const brief = payload.brief.trim();
  if (role) lines.push(`Role: ${role}`);
  if (company) lines.push(`Company: ${company}`);
  if (industry) lines.push(`Industry: ${industry}`);
  if (brief) lines.push(`The user's own brief (their words): ${brief}`);
  return `Research this professional's role, company, and industry, then produce the role dossier.\n${lines.join('\n')}`;
}

/**
 * Validate the (fence-stripped) role-dossier JSON and keep only the populated sections
 * PLUS the prose roleContext. Throws (terse reason) on malformed/empty output. Any
 * people/projects the model emits are dropped (the schema has no such keys), so generic
 * role research can never fabricate real colleagues/projects.
 */
function parseRoleDraft(raw: string): { draft: Partial<TwinProfileSections>; roleContext: string } {
  const result = roleDraftSchema.safeParse(parseJsonObject(raw));
  if (!result.success) {
    throw new Error(`JSON did not match the required schema: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  const { domain, vocabulary, goals, identity, roleContext } = result.data;
  const draft: Partial<TwinProfileSections> = {};
  if (domain && hasAnyText(domain)) draft.domain = domain;
  if (vocabulary && vocabulary.length > 0) draft.vocabulary = vocabulary;
  if (goals && goals.length > 0) draft.goals = goals;
  if (identity && hasAnyText(identity)) draft.identity = identity;
  return { draft, roleContext: roleContext?.trim() ?? '' };
}

/**
 * Role-DOSSIER research for the orchestrated deep-creation flow. Given the user's
 * role/company/industry (+ brief), runs the SAME provider-native web search to produce a
 * FULLER, cited draft — domain (industry/company/focus), domain vocabulary, typical role
 * goals/priorities, and a refined identity role/seniority — PLUS a prose `roleContext`
 * summary of the role/industry background that seeds the gap-focused interview. Generic
 * "typical people/projects" are deliberately NOT synthesized into the real people/projects
 * sections (those come from the interview/history — never fabricated). Same gating +
 * validate-retry-skip as researchWeb: no model → skipped/no-model; no web-search tool →
 * unsupported (no cloud call); failure after one retry → skipped/failed. Signature frozen.
 */
export async function researchRole(payload: TwinRoleResearchPayload): Promise<TwinRoleResearchResult> {
  const provider = await resolveTaskModel('twin_interview');
  if (!provider) {
    log.debug('No AI provider configured for twin_interview — role research unavailable');
    return { status: 'skipped', reason: 'no-model' };
  }
  if (!WEB_SEARCH_PROVIDERS.has(provider.providerName)) {
    log.debug(`Provider "${provider.providerName}" has no server-side web-search tool — unsupported`);
    return { status: 'unsupported' };
  }

  const { model, tools } = buildWebModel(provider);
  const outcome = await runWebSearchLoop(model, tools, ROLE_SYSTEM, buildRolePrompt(payload), parseRoleDraft);
  if (!outcome) return { status: 'skipped', reason: 'failed' };
  return {
    status: 'ok',
    result: { draft: outcome.value.draft, roleContext: outcome.value.roleContext, citations: outcome.citations },
  };
}
