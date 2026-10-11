// === FILE PURPOSE ===
// IPC handler for the Digital Twin profile (V3.3 + V3.3.5 "Deep Creation").
// Exposes:
//   - Profile CRUD from twinProfileService — read the whole profile, a
//     section-level patch (now including the `brief` section), and the wizard's
//     all-or-nothing save of every section (twin:save-profile, one transaction).
//   - The Quick-form "Interview me" per-section extraction (twin:draft-section →
//     twinInterviewService — the 7 structured sections only; brief is authored
//     directly).
//   - The DEEP-creation channels (V3.3.5), thin handlers that zod-validate and
//     delegate to their services: multi-turn interview, history mining, web
//     research, and the creation-model gate descriptor.
//
// Every AI-touching handler delegates to a service that returns a discriminated
// result ({ ok … } | { skipped, reason } | …) and NEVER throws for AI reasons, so
// the wizard degrades gracefully. IPC stays thin — modeled on brain.ts.
//   - twin:memory-list-forgotten / twin:memory-purge / twin:memory-purge-all-
//     forgotten (TWIN-LOOP.2 Task 3) — the Forgotten list and "Delete
//     permanently" (erases a forgotten fact's text, keeps a fingerprint).
//   - twin:build-memory-graph (TWIN-GRAPH.2 Task 1) — the twin's own tiered
//     memory graph (core -> category hub -> fact), a structural DB read via
//     twinGraphService (no AI, no input). See that file's header for why it is
//     a SIBLING of brainGraphService rather than an extension of it.

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as twinProfileService from '../services/twinProfileService';
import * as twinMemoryService from '../services/twinMemoryService';
import * as twinGraphService from '../services/twinGraphService';
import { draftSection } from '../services/twinInterviewService';
import * as twinDeepInterviewService from '../services/twinDeepInterviewService';
import * as twinResearchService from '../services/twinResearchService';
import * as twinWebResearchService from '../services/twinWebResearchService';
import { resolveTaskModel, getTwinLearningModelInfo } from '../services/ai-provider';
import { isFrontierProvider, isLocalProvider } from '../../shared/types/ai';
import { validateInput } from '../../shared/validation/ipc-validator';
import type {
  TwinProfileKey,
  TwinProfileSectionKey,
  TwinInterviewNextPayload,
  TwinInterviewSynthesizePayload,
  TwinWebResearchPayload,
  TwinRoleResearchPayload,
  TwinMemoryListFilter,
} from '../../shared/types/twin';

// --- per-section value schemas (mirror shared/types/twin.ts shapes) ---
//
// Every string and list is bounded (TWIN-LOOP.2): these values reach the DB and then
// every prompt budget, so an oversized paste is refused here, before anything is
// written. The limits are deliberately generous - far above any real profile.
//   short  200   - one-line fields: names, roles, org/company/industry, a term
//   text  4000   - free text: the brief, descriptions, meanings, goals, tone/style
//   list   500   - entries per list section
const SHORT_MAX = 200;
const TEXT_MAX = 4000;
const LIST_MAX = 500;
const shortStr = z.string().max(SHORT_MAX);
const textStr = z.string().max(TEXT_MAX);

const briefSchema = z.object({
  statement: textStr.optional(),
});

const identitySchema = z.object({
  name: shortStr.optional(),
  role: shortStr.optional(),
  seniority: shortStr.optional(),
});

const domainSchema = z.object({
  industry: shortStr.optional(),
  company: shortStr.optional(),
  focus: textStr.optional(),
});

const projectSchema = z.object({
  name: shortStr,
  description: textStr.optional(),
  projectId: shortStr.optional(),
});

const personSchema = z.object({
  name: shortStr,
  role: shortStr.optional(),
  org: shortStr.optional(),
});

const vocabularyTermSchema = z.object({
  term: shortStr,
  meaning: textStr,
});

const preferencesSchema = z.object({
  tone: textStr.optional(),
  language: shortStr.optional(),
  cardTitleStyle: textStr.optional(),
});

const projectsSchema = z.array(projectSchema).max(LIST_MAX);
const peopleSchema = z.array(personSchema).max(LIST_MAX);
const vocabularySchema = z.array(vocabularyTermSchema).max(LIST_MAX);
const goalsSchema = z.array(textStr).max(LIST_MAX);

// The whole profile (twin:save-profile) - the same pieces as the per-section patch,
// all eight required: the wizard always sends the full set.
const fullProfileSchema = z.object({
  brief: briefSchema,
  identity: identitySchema,
  domain: domainSchema,
  projects: projectsSchema,
  people: peopleSchema,
  vocabulary: vocabularySchema,
  goals: goalsSchema,
  preferences: preferencesSchema,
});

// The full patch surface accepts `brief`; the per-section draft ("Interview me")
// covers only the 7 structured sections (brief is the user's own free text).
const patchSectionKeySchema = z.enum([
  'brief',
  'identity',
  'domain',
  'projects',
  'people',
  'vocabulary',
  'goals',
  'preferences',
]);
const draftSectionKeySchema = z.enum([
  'identity',
  'domain',
  'projects',
  'people',
  'vocabulary',
  'goals',
  'preferences',
]);

// The free-form interview answer — bounded so a runaway paste can't blow the
// local model's context. min(1) because an empty answer has nothing to extract.
const interviewAnswerSchema = z.string().trim().min(1).max(4000);

// --- deep-creation payload schemas ---

// The brief seed is optional/empty-allowed (unlike a per-section answer) but
// bounded. Q&A turns are bounded in count so a runaway history can't blow context.
const briefSeedSchema = z.string().max(4000);
const qaTurnSchema = z.object({ question: z.string(), answer: z.string() });
const qaListSchema = z.array(qaTurnSchema).max(100);

// Researched role/industry background from the orchestrated deep flow — bounded so a
// runaway summary can't blow the interview/synthesis context. Optional (interview-only
// flows omit it).
const roleContextSchema = z.string().max(6000).optional();

const interviewNextSchema = z.object({
  brief: briefSeedSchema,
  // profileSoFar is a partial profile; validated loosely (bounded object) and
  // re-typed for the service — its concrete shape is enforced by the section
  // schemas above when a draft is actually saved.
  profileSoFar: z.record(z.string(), z.unknown()),
  qa: qaListSchema,
  roleContext: roleContextSchema,
});

const interviewSynthesizeSchema = z.object({
  brief: briefSeedSchema,
  qa: qaListSchema,
  roleContext: roleContextSchema,
});

const webResearchSchema = z.object({
  company: z.string().max(200),
  industry: z.string().max(200),
});

// Role-dossier research payload (orchestrated deep creation). Role/company/industry are
// user-entered (bounded); the brief seed is empty-allowed.
const roleResearchSchema = z.object({
  role: z.string().max(200),
  company: z.string().max(200),
  industry: z.string().max(200),
  brief: briefSeedSchema,
});

// --- living-memory (V3.4) schemas ---

const factCategorySchema = z.enum(['person', 'project', 'preference', 'domain', 'commitment']);
const factStatusSchema = z.enum(['active', 'forgotten']);
// Optional list filter; unknown keys stripped. Empty object ⇒ all facts.
const memoryListFilterSchema = z.object({
  status: factStatusSchema.optional(),
  category: factCategorySchema.optional(),
});
// Facts use a uuid primary key (twin_facts.id).
const factIdSchema = z.string().uuid();

export function registerTwinHandlers(): void {
  ipcMain.handle('twin:get-profile', async () => {
    return twinProfileService.getProfile();
  });

  ipcMain.handle('twin:update-profile-section', async (_event, section: unknown, value: unknown) => {
    const key = validateInput(patchSectionKeySchema, section) as TwinProfileKey;

    // Switch (not a schema lookup table) so each branch stays correlated to its
    // own value type for updateProfileSection's generic signature — no `any`.
    switch (key) {
      case 'brief':
        return twinProfileService.updateProfileSection('brief', validateInput(briefSchema, value));
      case 'identity':
        return twinProfileService.updateProfileSection('identity', validateInput(identitySchema, value));
      case 'domain':
        return twinProfileService.updateProfileSection('domain', validateInput(domainSchema, value));
      case 'projects':
        return twinProfileService.updateProfileSection('projects', validateInput(projectsSchema, value));
      case 'people':
        return twinProfileService.updateProfileSection('people', validateInput(peopleSchema, value));
      case 'vocabulary':
        return twinProfileService.updateProfileSection('vocabulary', validateInput(vocabularySchema, value));
      case 'goals':
        return twinProfileService.updateProfileSection('goals', validateInput(goalsSchema, value));
      case 'preferences':
        return twinProfileService.updateProfileSection('preferences', validateInput(preferencesSchema, value));
    }
  });

  // Wizard save (TWIN-LOOP.2): all eight sections in ONE transaction, so a failed
  // save leaves the previous profile untouched. A payload over the limits is refused
  // by validateInput before anything is written.
  ipcMain.handle('twin:save-profile', async (_event, profile: unknown) => {
    return twinProfileService.saveProfile(validateInput(fullProfileSchema, profile));
  });

  // Quick-form "Interview me" (V3.3) — draft one structured section's fields from
  // a free-form answer. Returns a discriminated result ({ ok, draft } | { skipped,
  // reason }); it never throws for AI reasons, so the wizard degrades to manual.
  ipcMain.handle('twin:draft-section', async (_event, section: unknown, answer: unknown) => {
    const key = validateInput(draftSectionKeySchema, section) as TwinProfileSectionKey;
    const text = validateInput(interviewAnswerSchema, answer);
    return draftSection(key, text);
  });

  // --- Deep creation (V3.3.5) — thin handlers delegating to their services ---

  // Multi-turn deep interview: next question / synthesize the Q&A into a draft.
  ipcMain.handle('twin:interview-next', async (_event, payload: unknown) => {
    const p = validateInput(interviewNextSchema, payload);
    return twinDeepInterviewService.interviewNext(p as unknown as TwinInterviewNextPayload);
  });

  ipcMain.handle('twin:interview-synthesize', async (_event, payload: unknown) => {
    const p = validateInput(interviewSynthesizeSchema, payload);
    return twinDeepInterviewService.interviewSynthesize(p as unknown as TwinInterviewSynthesizePayload);
  });

  // History mining: a no-model consent descriptor, then the mining pass. The
  // renderer shows the consent dialog first when the model is not local; the
  // handler trusts that gate but re-checks provider info inside the service.
  ipcMain.handle('twin:research-history-info', async () => {
    return twinResearchService.getResearchHistoryInfo();
  });

  ipcMain.handle('twin:research-history', async () => {
    return twinResearchService.researchHistory();
  });

  // Stop the in-flight history-mining run (the wizard was closed). Returns whether a
  // run was in flight. Argument-free, like the run itself: there is one run at a time.
  ipcMain.handle('twin:research-cancel', async () => {
    return twinResearchService.cancelResearchHistory();
  });

  // Web research from a company/industry into a cited draft.
  ipcMain.handle('twin:research-web', async (_event, payload: unknown) => {
    const p = validateInput(webResearchSchema, payload) as TwinWebResearchPayload;
    return twinWebResearchService.researchWeb(p);
  });

  // Role-dossier research (orchestrated deep creation): role/company/industry → a cited
  // structured draft + a prose role-context summary that seeds the gap-focused interview.
  ipcMain.handle('twin:research-role', async (_event, payload: unknown) => {
    const p = validateInput(roleResearchSchema, payload) as TwinRoleResearchPayload;
    return twinWebResearchService.researchRole(p);
  });

  // --- Living memory (V3.4) — list / forget / restore learned facts. Thin
  //     handlers delegating to twinMemoryService (the real learning store). ---

  ipcMain.handle('twin:memory-list', async (_event, filter: unknown) => {
    const f = validateInput(memoryListFilterSchema, filter ?? {}) as TwinMemoryListFilter;
    return twinMemoryService.listFacts(f);
  });

  ipcMain.handle('twin:memory-forget', async (_event, factId: unknown) => {
    const id = validateInput(factIdSchema, factId);
    return twinMemoryService.forgetFact(id);
  });

  ipcMain.handle('twin:memory-restore', async (_event, factId: unknown) => {
    const id = validateInput(factIdSchema, factId);
    return twinMemoryService.restoreFact(id);
  });

  // Delete permanently (TWIN-LOOP.2 Task 3). The Forgotten list never includes a
  // purged fact; a purge acts only on a forgotten, not-yet-purged fact (the service
  // enforces that, so a stale or crafted id can never erase an active fact).
  ipcMain.handle('twin:memory-list-forgotten', async () => {
    return twinMemoryService.listFacts({ status: 'forgotten' });
  });

  ipcMain.handle('twin:memory-purge', async (_event, factId: unknown) => {
    const id = validateInput(factIdSchema, factId);
    return twinMemoryService.purgeFact(id);
  });

  ipcMain.handle('twin:memory-purge-all-forgotten', async () => {
    return twinMemoryService.purgeAllForgotten();
  });

  // Label backfill (TWIN-READ.1 Task 1) — user-triggered pass that labels
  // existing facts with no stored label yet. No input, unlike entity:analyze-
  // history: this is the twin's whole ledger, never a single entity. Unlike
  // that channel, this one NEVER rejects on "no model" — twinMemoryService
  // .backfillFactLabels() returns a typed `{ status: 'skipped', reason:
  // 'no-model' }` instead of throwing, because a fact with no stored label
  // still renders via factLabel.ts's derived fallback, so a skipped backfill is
  // a quality regression, never a breakage the caller needs to catch.
  ipcMain.handle('twin:memory-backfill-labels', async () => {
    return twinMemoryService.backfillFactLabels();
  });

  // Twin memory GRAPH (TWIN-GRAPH.2 Task 1) — the whole tiered ledger in one
  // round trip. No input: unlike brain:build-graph there is no scope, this is
  // always the twin's full memory.
  ipcMain.handle('twin:build-memory-graph', async () => {
    return twinGraphService.buildTwinMemoryGraph();
  });

  // Creation-model gate descriptor — drives the wizard's mode-fork SOTA notice.
  // Derived from resolveTaskModel('twin_interview') + the frontier-provider set.
  ipcMain.handle('twin:get-creation-model', async () => {
    const resolved = await resolveTaskModel('twin_interview');
    if (!resolved) {
      return { providerLabel: 'No model configured', modelLabel: '', isLocal: false, isFrontier: false };
    }
    return {
      providerLabel: resolved.providerName,
      modelLabel: resolved.model,
      isLocal: isLocalProvider(resolved.providerName),
      isFrontier: isFrontierProvider(resolved.providerName),
    };
  });

  // Which model the twin's fact learning will run on (TWIN-LOOP.2) — drives the
  // Memory tab's "Learning is off" line. Read-only, no input.
  ipcMain.handle('twin:get-learning-model', async () => {
    return getTwinLearningModelInfo();
  });
}
