// === FILE PURPOSE ===
// IPC handler for the Digital Twin profile (V3.3 + V3.3.5 "Deep Creation").
// Exposes:
//   - Profile CRUD from twinProfileService — read the whole profile and a
//     section-level patch (now including the `brief` section).
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

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as twinProfileService from '../services/twinProfileService';
import * as twinMemoryService from '../services/twinMemoryService';
import { draftSection } from '../services/twinInterviewService';
import * as twinDeepInterviewService from '../services/twinDeepInterviewService';
import * as twinResearchService from '../services/twinResearchService';
import * as twinWebResearchService from '../services/twinWebResearchService';
import { resolveTaskModel } from '../services/ai-provider';
import { isFrontierProvider } from '../../shared/types/ai';
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

const briefSchema = z.object({
  statement: z.string().optional(),
});

const identitySchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  seniority: z.string().optional(),
});

const domainSchema = z.object({
  industry: z.string().optional(),
  company: z.string().optional(),
  focus: z.string().optional(),
});

const projectSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  projectId: z.string().optional(),
});

const personSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  org: z.string().optional(),
});

const vocabularyTermSchema = z.object({
  term: z.string(),
  meaning: z.string(),
});

const preferencesSchema = z.object({
  tone: z.string().optional(),
  language: z.string().optional(),
  cardTitleStyle: z.string().optional(),
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
        return twinProfileService.updateProfileSection('projects', validateInput(z.array(projectSchema), value));
      case 'people':
        return twinProfileService.updateProfileSection('people', validateInput(z.array(personSchema), value));
      case 'vocabulary':
        return twinProfileService.updateProfileSection(
          'vocabulary',
          validateInput(z.array(vocabularyTermSchema), value),
        );
      case 'goals':
        return twinProfileService.updateProfileSection('goals', validateInput(z.array(z.string()), value));
      case 'preferences':
        return twinProfileService.updateProfileSection('preferences', validateInput(preferencesSchema, value));
    }
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

  // Creation-model gate descriptor — drives the wizard's mode-fork SOTA notice.
  // Derived from resolveTaskModel('twin_interview') + the frontier-provider set.
  ipcMain.handle('twin:get-creation-model', async () => {
    const resolved = await resolveTaskModel('twin_interview');
    if (!resolved) {
      return { providerLabel: 'No model configured', modelLabel: '', isLocal: false, isFrontier: false };
    }
    const isLocal = resolved.providerName === 'ollama' || resolved.providerName === 'lmstudio';
    return {
      providerLabel: resolved.providerName,
      modelLabel: resolved.model,
      isLocal,
      isFrontier: isFrontierProvider(resolved.providerName),
    };
  });
}
