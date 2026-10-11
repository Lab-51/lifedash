// === FILE PURPOSE ===
// GATED live eval of the brief extraction pipeline (BRIEF-QUAL.1 Task 5) against
// a REAL model: extracts the synthetic long fixture (briefEvalFixtures.ts) with
// the REAL `extractMeetingStructure`, scores it with `scoreStructure`, then runs
// ONE real writer call and scores the rendered markdown secondarily. Mirrors
// `ai-provider.builtin.live.test.ts` EXACTLY for the mock set and gating —
// only `../secure-storage`, `../logger`, `electron`, `../../db/connection`,
// `../../db/schema` and `drizzle-orm` are mocked; `ai-provider.ts`,
// `briefExtractionService.ts` and (for the `builtin` tier) `llamaRuntimeService`
// run FOR REAL against whatever the environment provides.
//
// SKIPPED BY DEFAULT so `npm test` stays green without any of this configured.
// Machine-local, NOT a CI gate — run explicitly, one tier at a time:
//
//   builtin (bundled llama.cpp sidecar):
//     Git Bash:
//       BRIEF_EVAL=1 BRIEF_EVAL_TIER=builtin BRIEF_EVAL_MODEL=Qwen3-4B-Q4_K_M \
//       LIFEDASH_LLAMA_BIN=resources/llama/cpu/llama-server.exe \
//       LIFEDASH_LLAMA_MODELS_DIR="$APPDATA/lifedash/llm-models" \
//       npx vitest run briefPipeline.live
//     PowerShell (env vars set in System Properties do NOT reach an already-open
//     terminal — set them in THIS session):
//       $env:BRIEF_EVAL='1'; $env:BRIEF_EVAL_TIER='builtin'; $env:BRIEF_EVAL_MODEL='Qwen3-4B-Q4_K_M';
//       $env:LIFEDASH_LLAMA_BIN='resources/llama/cpu/llama-server.exe';
//       $env:LIFEDASH_LLAMA_MODELS_DIR="$env:APPDATA/lifedash/llm-models";
//       npx vitest run briefPipeline.live
//
//   lmstudio (a locally running LM Studio server):
//     Git Bash:
//       BRIEF_EVAL=1 BRIEF_EVAL_TIER=lmstudio BRIEF_EVAL_BASE_URL=http://localhost:1234/v1 \
//       npx vitest run briefPipeline.live
//     PowerShell:
//       $env:BRIEF_EVAL='1'; $env:BRIEF_EVAL_TIER='lmstudio'; $env:BRIEF_EVAL_BASE_URL='http://localhost:1234/v1';
//       npx vitest run briefPipeline.live
//
//   openai | anthropic | google (a real cloud API key, never written anywhere):
//     Git Bash:
//       BRIEF_EVAL=1 BRIEF_EVAL_TIER=openai BRIEF_EVAL_API_KEY=sk-... BRIEF_EVAL_MODEL=gpt-5-mini \
//       npx vitest run briefPipeline.live
//     PowerShell:
//       $env:BRIEF_EVAL='1'; $env:BRIEF_EVAL_TIER='openai'; $env:BRIEF_EVAL_API_KEY='sk-...'; $env:BRIEF_EVAL_MODEL='gpt-5-mini';
//       npx vitest run briefPipeline.live
//
// Thresholds (FAIL the test): extraction recall per category >= 0.90 (cloud),
// >= 0.80 (lmstudio), >= 0.70 (builtin); inventedOwners === 0 and
// wrongOwners === 0 on EVERY tier. Writer recall is REPORTED only — the plan's
// acceptance gate is on the structure (AI-CTX.1 (h): the live suite measures
// models, it does not get to grade itself down to whatever a weak tier produces).
//
// Since BRIEF-QUAL.2 the writer's reported recall is EXPECTED to sit below 1.0 by
// design: the writer judges which topics and which details are worth the reader's
// two minutes, and the record it left out is kept and shown as full notes. Read
// the two numbers separately — writerRecall(topics) below 1.0 is the feature
// working, while writerRecall(decisions) and writerRecall(commitments) should
// still be ≈ 1.0, because completeness for those two never moved. A low
// decisions/commitments recall is a real regression; a low topics recall is not.
//
// BRIEF-EVID.1 adds four evidence numbers — quotedRate, anchoredRate,
// unsupportedCount, anchoredCorrectly — that are REPORTED AND NOT GATED, on
// purpose. Nothing has measured them yet, and the two constants they exist to
// tune (evidenceAnchorService's MIN_OVERLAP_SCORE and MIN_OVERLAP_TOKENS) are
// reasoned rather than measured. LOCAL-QUAL.1 Task 5 is the precedent: set a bar
// FROM a measurement run, never from a guess. Read them as: quotedRate = is the
// model quoting at all; anchoredRate = are its quotes real; anchoredCorrectly =
// when it quotes a known item, does the anchor land on the right line.
//
// Per-tier bars live in ONE table, `TIER_BARS` below (see its own doc comment for
// each value's provenance). To let a MEASUREMENT run complete and print its
// numbers regardless of the current bar (e.g. capturing builtin's real baseline
// for Task 5), override the resolved bar for a single run — this affects only
// pass/fail, never whether the suite RUNS (only BRIEF_EVAL=1 controls that):
//   BRIEF_EVAL_BAR=0 BRIEF_EVAL=1 BRIEF_EVAL_TIER=builtin ... npx vitest run briefPipeline.live
//
// TWIN-LOOP Task 5 adds a second test, the TWIN ON/OFF ARM: the same transcript
// (LONG_FIXTURE plus three informational lines naming two non-roster people and an
// unusual-spelled term, fixtures/briefEvalTwin.ts) is extracted and written twice —
// OFF = empty twin tables (today's path), ON = a synthetic profile + ten synthetic
// learned facts (6 about this meeting, 4 unrelated, unrelated ones newest) read
// through the REAL getProfile / buildProfileContext / known-terms path with only the
// two twin table reads stubbed. It prints both arms side by side and writes
// .eval/live-twin-<tier>-<model>-<ts>.json. MEASUREMENT ONLY — no recall bar is asserted
// (set one from a run, never from a guess). The default command above runs BOTH tests;
// to run one, add vitest's -t filter: `-t "twin on/off"` for the twin arm only, or
// `-t "extracts the long fixture"` for the original test only. Same env vars, e.g.:
//     Git Bash:    BRIEF_EVAL=1 BRIEF_EVAL_TIER=lmstudio BRIEF_EVAL_BASE_URL=http://localhost:1234/v1 \
//                  npx vitest run briefPipeline.live -t "twin on/off"
//     PowerShell:  $env:BRIEF_EVAL='1'; $env:BRIEF_EVAL_TIER='lmstudio'; $env:BRIEF_EVAL_BASE_URL='http://localhost:1234/v1';
//                  npx vitest run briefPipeline.live -t "twin on/off"

import { describe, it, expect, vi, afterAll } from 'vitest';
import type { Mock } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';

vi.mock('../secure-storage', () => ({ decryptString: vi.fn((b: string) => b) }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getLogDirectory: () => process.env.LIFEDASH_LLAMA_LOG_DIR || process.cwd(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key' },
  aiProviders: { __table: 'aiProviders', id: 'id', enabled: 'enabled' },
  aiUsage: { __table: 'aiUsage' },
  // TWIN-LOOP Task 5: the two tables the twin arm reads (profile + learned facts).
  twinProfile: { __table: 'twinProfile', id: 'id' },
  twinFacts: { __table: 'twinFacts', status: 'status', category: 'category', createdAt: 'createdAt' },
  TWIN_PROFILE_ID: 'singleton',
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
}));

import { generate, type ResolvedProvider } from '../ai-provider';
import { extractMeetingStructure } from '../briefExtractionService';
import { getDb } from '../../db/connection';
import { stop } from '../llamaRuntimeService';
import { LONG_FIXTURE, scoreStructure, proseRecall } from './fixtures/briefEvalFixtures';
import {
  SYNTHETIC_TWIN_FACTS,
  SYNTHETIC_TWIN_PROFILE,
  countInjectedFacts,
  countSpellingHits,
  twinSpellings,
  withTwinArmLines,
} from './fixtures/briefEvalTwin';

const LIVE = process.env.BRIEF_EVAL === '1';
const PROVIDER_ID = 'brief-eval-provider';
const MEETING_TITLE = 'Kestrel Analytics Quarterly Review';

type Tier = 'builtin' | 'lmstudio' | 'openai' | 'anthropic' | 'google';

/** Per-tier recall bars (FAIL the test below this) — provenance for each value:
 *  - `openai` (shared by `anthropic`/`google` — all three are "cloud" tiers with
 *    one target): 0.90, a CALIBRATION TARGET. Unmeasured: no real cloud run's
 *    numbers have been captured against this bar yet.
 *  - `lmstudio`: 0.80, a CALIBRATION TARGET. Unmeasured for the same reason.
 *  - `builtin`: 0.40 — SET FROM MEASUREMENT (LOCAL-QUAL.1 Task 5, 2026-08-24):
 *    Qwen3-14B-Q4_K_M via the Vulkan sidecar, 4 passes, BRIEF_EVAL_BAR=0
 *    measurement run → extractRecall topics/decisions/commitments
 *    0.57/0.71/0.50, inventedOwners 0, wrongOwners 0 (full record incl. missed
 *    lists: .eval/live-builtin-Qwen3-14B-Q4_K_M-2026-08-24T07-44-11-473Z.json).
 *    Floor 0.50 minus a run-variance margin → 0.40: a bar the installed model
 *    actually passes while a real regression still fails. Single-run baseline —
 *    re-set only from a new measurement, never by hand. */
const TIER_BARS = {
  openai: 0.9,
  lmstudio: 0.8,
  builtin: 0.4,
} as const;

/** `anthropic`/`google` share `TIER_BARS.openai` — the same cloud calibration
 *  target, just two more members of `Tier` than `TIER_BARS` has keys for. */
function barFor(tier: Tier): number {
  if (tier === 'lmstudio') return TIER_BARS.lmstudio;
  if (tier === 'builtin') return TIER_BARS.builtin;
  return TIER_BARS.openai;
}

/** `BRIEF_EVAL_BAR` overrides the resolved tier's bar for a single run — lets a
 *  measurement pass complete and print its numbers without failing on the
 *  current (possibly aspirational) bar. Only a valid float overrides; unset or
 *  unparsable falls back to the tier's own bar from `TIER_BARS`. */
function resolveBar(tier: Tier): number {
  const raw = process.env.BRIEF_EVAL_BAR;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return barFor(tier);
}

function resolveTier(): Tier | null {
  const raw = process.env.BRIEF_EVAL_TIER;
  return raw === 'builtin' || raw === 'lmstudio' || raw === 'openai' || raw === 'anthropic' || raw === 'google'
    ? raw
    : null;
}

/** Build the `ResolvedProvider` for one tier straight from env — no `resolveTaskModel`
 *  DB lookup, per the story (the model tier is chosen by the person running this,
 *  not by whatever is configured in a dev database). */
function buildProvider(tier: Tier): ResolvedProvider {
  const model = process.env.BRIEF_EVAL_MODEL || 'default';
  switch (tier) {
    case 'builtin':
      return {
        providerId: PROVIDER_ID,
        providerName: 'builtin',
        apiKeyEncrypted: null,
        baseUrl: null,
        model,
        temperature: 0.3,
      };
    case 'lmstudio':
      return {
        providerId: PROVIDER_ID,
        providerName: 'lmstudio',
        apiKeyEncrypted: null,
        baseUrl: process.env.BRIEF_EVAL_BASE_URL || 'http://localhost:1234/v1',
        model: 'default',
        temperature: 0.3,
      };
    case 'openai':
    case 'anthropic':
    case 'google':
      return {
        providerId: PROVIDER_ID,
        providerName: tier,
        apiKeyEncrypted: process.env.BRIEF_EVAL_API_KEY ?? null,
        baseUrl: null,
        model,
        temperature: 0.3,
      };
  }
}

/** The twin arm's DB rows. `null` (the default, and the whole of the original
 *  eval) leaves both twin tables EMPTY, which is exactly today's path: getProfile
 *  finds no row and listFacts finds none. */
type TwinRows = { profile: Record<string, unknown>[]; facts: Record<string, unknown>[] };

function twinRowsOn(): TwinRows {
  const now = new Date('2026-10-11T00:00:00Z');
  return {
    profile: [{ brief: {}, goals: [], preferences: {}, projects: [], ...SYNTHETIC_TWIN_PROFILE, updatedAt: now }],
    facts: SYNTHETIC_TWIN_FACTS.map((f, i) => ({
      id: `synthetic-fact-${i}`,
      fact: f.fact,
      label: null,
      category: f.category,
      sourceMeetingId: null,
      sourceMeetingLabel: null,
      status: 'active',
      createdAt: now,
    })),
  };
}

/** DB stub: `generate()` logs usage through `getDb()` regardless of provider,
 *  and the built-in runtime's idle-stop read also goes through it — this seeds
 *  a plausible `aiProviders` row and the `ai.taskModels` setting from env, the
 *  same shape as `ai-provider.builtin.live.test.ts`'s `liveDb()`. The twin arm
 *  stubs ONLY the two twin table reads; the services that consume them are real. */
function liveDb(provider: ResolvedProvider, twin: TwinRows | null = null) {
  return {
    select: () => ({
      from: (table: { __table: string }) => {
        const rows =
          table.__table === 'settings'
            ? [
                {
                  key: 'ai.taskModels',
                  value: JSON.stringify({ summarization: { providerId: PROVIDER_ID, model: provider.model } }),
                },
              ]
            : table.__table === 'aiProviders'
              ? [
                  {
                    id: PROVIDER_ID,
                    name: provider.providerName,
                    apiKeyEncrypted: provider.apiKeyEncrypted,
                    baseUrl: provider.baseUrl,
                    enabled: true,
                  },
                ]
              : table.__table === 'twinProfile'
                ? (twin?.profile ?? [])
                : table.__table === 'twinFacts'
                  ? (twin?.facts ?? [])
                  : [];
        return {
          where: () => Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows) }),
          limit: () => Promise.resolve(rows),
        };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

type Segments = { startTime: number; content: string }[];

/** One arm of the twin comparison: extract, then ONE real writer call, with the DB
 *  stubbed to either an empty twin (OFF — today's path) or the synthetic one (ON).
 *  The writer system prompt goes through the production `injectTwinProfileContext`,
 *  so the ON arm gets exactly the block the product would inject; OFF gets none. */
async function runTwinArm(provider: ResolvedProvider, segments: Segments, twin: TwinRows | null) {
  (getDb as Mock).mockReturnValue(liveDb(provider, twin));
  const { BRIEF_WRITER_PROMPT, injectTwinProfileContext } = await import('../meetingIntelligenceService');
  const { meetingRelevanceText } = await import('../twinRelevance');
  const { loadTwinGlossaryTerms } = await import('../twinGlossaryTerms');

  const extractStart = Date.now();
  const extraction = await extractMeetingStructure({
    provider,
    meeting: { id: 'live-eval-twin', title: MEETING_TITLE, template: 'none', segments },
    roster: LONG_FIXTURE.truth.roster,
    langName: null,
  });
  const extractWallMs = Date.now() - extractStart;
  if (!('structure' in extraction)) throw new Error(`Extraction failed: ${extraction.failureReason}`);
  const { structure } = extraction;

  const system = await injectTwinProfileContext(
    BRIEF_WRITER_PROMPT,
    meetingRelevanceText({ title: MEETING_TITLE, segments }),
  );
  const injectedContext = system.slice(BRIEF_WRITER_PROMPT.length);
  const notes = {
    topics: structure.topics,
    decisions: structure.decisions,
    commitments: structure.commitments,
    openQuestions: structure.openQuestions,
    terms: structure.terms,
  };
  const writerStart = Date.now();
  const writerResult = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt: `Meeting: ${MEETING_TITLE}\n\nStructured notes (authoritative — the complete record of the meeting):\n${JSON.stringify(notes)}`,
    system,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
  });
  const writerWallMs = Date.now() - writerStart;

  const score = scoreStructure(structure, LONG_FIXTURE.truth);
  const spellings = twinSpellings();
  return {
    score,
    structure,
    systemUnchanged: system === BRIEF_WRITER_PROMPT,
    injectedContextChars: injectedContext.length,
    twinTermsOffered: await loadTwinGlossaryTerms(),
    writerRecall: {
      topics: proseRecall(writerResult.text, LONG_FIXTURE.truth.topics),
      decisions: proseRecall(writerResult.text, LONG_FIXTURE.truth.decisions),
      commitments: proseRecall(writerResult.text, LONG_FIXTURE.truth.commitments),
    },
    spellingInBrief: countSpellingHits(writerResult.text, spellings),
    spellingInStructure: countSpellingHits(JSON.stringify(structure), spellings),
    facts: countInjectedFacts(injectedContext, SYNTHETIC_TWIN_FACTS),
    extractWallMs,
    writerWallMs,
  };
}

type TwinArmResult = Awaited<ReturnType<typeof runTwinArm>>;

function armLine(label: string, r: TwinArmResult, heard: number): string {
  const rc = r.score;
  return [
    `twinArm=${label}`,
    `extractRecall(topics/decisions/commitments)=${rc.topicsRecall.toFixed(2)}/${rc.decisionsRecall.toFixed(2)}/${rc.commitmentsRecall.toFixed(2)}`,
    `writerRecall(topics/decisions/commitments)=${r.writerRecall.topics.toFixed(2)}/${r.writerRecall.decisions.toFixed(2)}/${r.writerRecall.commitments.toFixed(2)}`,
    `inventedOwners=${rc.inventedOwners}`,
    `wrongOwners=${rc.wrongOwners}`,
    `quotedRate=${rc.quotedRate.toFixed(2)}`,
    `anchoredRate=${rc.anchoredRate.toFixed(2)}`,
    `unsupportedCount=${rc.unsupportedCount}`,
    `anchoredCorrectly=${rc.anchoredCorrectly.toFixed(2)}`,
    `spellingExactInBrief=${r.spellingInBrief.exact.length}/${heard}`,
    `spellingNearMissInBrief=${r.spellingInBrief.nearMiss.length}`,
    `spellingExactInStructure=${r.spellingInStructure.exact.length}/${heard}`,
    `spellingNearMissInStructure=${r.spellingInStructure.nearMiss.length}`,
    `factsInjected(relevant/unrelated)=${r.facts.relevantInjected}/${r.facts.relevantTotal} | ${r.facts.unrelatedInjected}/${r.facts.unrelatedTotal}`,
    `injectedContextChars=${r.injectedContextChars}`,
    `extractWallMs=${r.extractWallMs}`,
    `writerWallMs=${r.writerWallMs}`,
  ].join(' | ');
}

afterAll(async () => {
  if (LIVE && resolveTier() === 'builtin') await stop();
});

describe.runIf(LIVE)('brief pipeline — LIVE eval against a real model', () => {
  it(
    'extracts the long fixture, scores recall/owners, then scores one real writer pass',
    async () => {
      const tier = resolveTier();
      if (!tier) {
        throw new Error(
          'BRIEF_EVAL=1 requires BRIEF_EVAL_TIER=builtin|lmstudio|openai|anthropic|google — see the file header.',
        );
      }

      const provider = buildProvider(tier);
      (getDb as Mock).mockReturnValue(liveDb(provider));

      const extractStart = Date.now();
      const extraction = await extractMeetingStructure({
        provider,
        meeting: { id: 'live-eval', title: MEETING_TITLE, template: 'none', segments: LONG_FIXTURE.segments },
        roster: LONG_FIXTURE.truth.roster,
        langName: null,
      });
      const extractWallMs = Date.now() - extractStart;

      if (!('structure' in extraction)) {
        throw new Error(`Extraction failed on tier ${tier}: ${extraction.failureReason}`);
      }
      const { structure } = extraction;
      const score = scoreStructure(structure, LONG_FIXTURE.truth);

      // ONE real writer call — story's exact prompt shape, notes without provenance.
      // Dynamic import: meetingIntelligenceService.ts's dependency graph is much
      // larger than this file's mock set covers, and only the constant is needed.
      const { BRIEF_WRITER_PROMPT } = await import('../meetingIntelligenceService');
      const notes = {
        topics: structure.topics,
        decisions: structure.decisions,
        commitments: structure.commitments,
        openQuestions: structure.openQuestions,
        terms: structure.terms,
      };
      const writerPrompt = `Meeting: ${MEETING_TITLE}\n\nStructured notes (authoritative — the complete record of the meeting):\n${JSON.stringify(notes)}`;

      const writerStart = Date.now();
      const writerResult = await generate({
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiKeyEncrypted: provider.apiKeyEncrypted,
        baseUrl: provider.baseUrl,
        model: provider.model,
        taskType: 'summarization',
        prompt: writerPrompt,
        system: BRIEF_WRITER_PROMPT,
        temperature: provider.temperature,
        maxTokens: provider.maxTokens,
      });
      const writerWallMs = Date.now() - writerStart;

      const writerTopicsRecall = proseRecall(writerResult.text, LONG_FIXTURE.truth.topics);
      const writerDecisionsRecall = proseRecall(writerResult.text, LONG_FIXTURE.truth.decisions);
      const writerCommitmentsRecall = proseRecall(writerResult.text, LONG_FIXTURE.truth.commitments);

      console.log(
        [
          `tier=${tier}`,
          `model=${provider.model}`,
          `passes=${structure.provenance.passes}`,
          `extractRecall(topics/decisions/commitments)=${score.topicsRecall.toFixed(2)}/${score.decisionsRecall.toFixed(2)}/${score.commitmentsRecall.toFixed(2)}`,
          `writerRecall(topics/decisions/commitments)=${writerTopicsRecall.toFixed(2)}/${writerDecisionsRecall.toFixed(2)}/${writerCommitmentsRecall.toFixed(2)}`,
          `inventedOwners=${score.inventedOwners}`,
          `wrongOwners=${score.wrongOwners}`,
          // BRIEF-EVID.1 — reported, never gated (see the file header).
          `quotedRate=${score.quotedRate.toFixed(2)}`,
          `anchoredRate=${score.anchoredRate.toFixed(2)}`,
          `unsupportedCount=${score.unsupportedCount}`,
          `anchoredCorrectly=${score.anchoredCorrectly.toFixed(2)}`,
          `extractWallMs=${extractWallMs}`,
          `writerWallMs=${writerWallMs}`,
          // Always printed (not just on failure) so a PASSING run still leaves a
          // reviewable record of exactly what extraction missed, per item.
          `missedTopics=${score.missed.topics.join('; ') || '(none)'}`,
          `missedDecisions=${score.missed.decisions.join('; ') || '(none)'}`,
          `missedCommitments=${score.missed.commitments.join('; ') || '(none)'}`,
        ].join(' | '),
      );

      // Reporter-proof record (LOCAL-QUAL.1 Task 5): vitest can swallow console
      // output from a PASSING test, and a measurement is worthless if only a
      // failure leaves a trace — so the same record is ALSO written as JSON into
      // gitignored .eval/, keyed by tier, model and timestamp.
      mkdirSync('.eval', { recursive: true });
      writeFileSync(
        `.eval/live-${tier}-${provider.model}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        JSON.stringify(
          {
            tier,
            model: provider.model,
            passes: structure.provenance.passes,
            extractRecall: {
              topics: score.topicsRecall,
              decisions: score.decisionsRecall,
              commitments: score.commitmentsRecall,
            },
            writerRecall: {
              topics: writerTopicsRecall,
              decisions: writerDecisionsRecall,
              commitments: writerCommitmentsRecall,
            },
            inventedOwners: score.inventedOwners,
            wrongOwners: score.wrongOwners,
            evidence: {
              quotedRate: score.quotedRate,
              anchoredRate: score.anchoredRate,
              unsupportedCount: score.unsupportedCount,
              anchoredCorrectly: score.anchoredCorrectly,
            },
            extractWallMs,
            writerWallMs,
            missed: score.missed,
            matched: score.matched,
          },
          null,
          2,
        ),
      );

      const threshold = resolveBar(tier);
      expect(score.topicsRecall, `missed topics: ${score.missed.topics.join('; ')}`).toBeGreaterThanOrEqual(threshold);
      expect(score.decisionsRecall, `missed decisions: ${score.missed.decisions.join('; ')}`).toBeGreaterThanOrEqual(
        threshold,
      );
      expect(
        score.commitmentsRecall,
        `missed commitments: ${score.missed.commitments.join('; ')}`,
      ).toBeGreaterThanOrEqual(threshold);
      expect(score.inventedOwners).toBe(0);
      expect(score.wrongOwners).toBe(0);
    },
    30 * 60_000,
  );

  // TWIN-LOOP Task 5 — measurement only: NO bar is asserted on quality, per the
  // project practice of setting a bar FROM a run, never from a guess. The only
  // expectations are plumbing invariants (OFF injects nothing, ON injects something).
  it(
    'twin on/off arm: the same transcript extracted and written with the twin OFF, then ON',
    async () => {
      const tier = resolveTier();
      if (!tier) {
        throw new Error(
          'BRIEF_EVAL=1 requires BRIEF_EVAL_TIER=builtin|lmstudio|openai|anthropic|google — see the file header.',
        );
      }
      const provider = buildProvider(tier);
      const segments = withTwinArmLines(LONG_FIXTURE.segments);
      const transcript = segments.map((s) => s.content).join('\n');
      // Spellings a model could possibly reproduce: the ones the transcript mentions at all.
      const heard = twinSpellings().filter((t) => countSpellingHits(transcript, [t]).absent.length === 0).length;

      const off = await runTwinArm(provider, segments, null);
      const on = await runTwinArm(provider, segments, twinRowsOn());

      console.log(
        [`tier=${tier}`, `model=${provider.model}`, armLine('OFF', off, heard), armLine('ON', on, heard)].join('\n'),
      );

      mkdirSync('.eval', { recursive: true });
      const arm = (r: TwinArmResult) => ({
        extractRecall: {
          topics: r.score.topicsRecall,
          decisions: r.score.decisionsRecall,
          commitments: r.score.commitmentsRecall,
        },
        writerRecall: r.writerRecall,
        inventedOwners: r.score.inventedOwners,
        wrongOwners: r.score.wrongOwners,
        evidence: {
          quotedRate: r.score.quotedRate,
          anchoredRate: r.score.anchoredRate,
          unsupportedCount: r.score.unsupportedCount,
          anchoredCorrectly: r.score.anchoredCorrectly,
        },
        spelling: { heardInTranscript: heard, inBrief: r.spellingInBrief, inStructure: r.spellingInStructure },
        injectedFacts: r.facts,
        injectedContextChars: r.injectedContextChars,
        twinTermsOffered: r.twinTermsOffered,
        extractWallMs: r.extractWallMs,
        writerWallMs: r.writerWallMs,
        missed: r.score.missed,
      });
      writeFileSync(
        `.eval/live-twin-${tier}-${provider.model}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        JSON.stringify({ tier, model: provider.model, off: arm(off), on: arm(on) }, null, 2),
      );

      expect(off.systemUnchanged, 'twin OFF must leave the writer prompt untouched').toBe(true);
      expect(off.twinTermsOffered).toEqual([]);
      expect(on.systemUnchanged, 'twin ON must inject a profile/facts block').toBe(false);
      expect(on.twinTermsOffered.length).toBeGreaterThan(0);
    },
    60 * 60_000,
  );
});
