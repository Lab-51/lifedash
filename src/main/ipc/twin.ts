// === FILE PURPOSE ===
// IPC handler for the Digital Twin profile (V3.3 Tasks 3-4). Exposes the profile
// CRUD from twinProfileService to the renderer — a read of the whole profile
// and a section-level patch (the interview/edit UI saves one section at a
// time; see twinProfileService.updateProfileSection) — plus the creation
// wizard's optional AI-assist extraction (twin:draft-section, delegating to
// twinInterviewService — the only AI here). The extraction handler NEVER
// rejects for AI reasons: twinInterviewService returns a `skipped` result the
// wizard renders as "fill manually", so an unconfigured/failing model can never
// block the flow. IPC stays thin — modeled on brain.ts.

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as twinProfileService from '../services/twinProfileService';
import { draftSection } from '../services/twinInterviewService';
import { validateInput } from '../../shared/validation/ipc-validator';
import type { TwinProfileSectionKey } from '../../shared/types/twin';

// --- per-section value schemas (mirror shared/types/twin.ts shapes) ---

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

const sectionKeySchema = z.enum(['identity', 'domain', 'projects', 'people', 'vocabulary', 'goals', 'preferences']);

// The free-form interview answer — bounded so a runaway paste can't blow the
// local model's context. min(1) because an empty answer has nothing to extract.
const interviewAnswerSchema = z.string().trim().min(1).max(4000);

export function registerTwinHandlers(): void {
  ipcMain.handle('twin:get-profile', async () => {
    return twinProfileService.getProfile();
  });

  ipcMain.handle('twin:update-profile-section', async (_event, section: unknown, value: unknown) => {
    const key = validateInput(sectionKeySchema, section) as TwinProfileSectionKey;

    // Switch (not a schema lookup table) so each branch stays correlated to its
    // own value type for updateProfileSection's generic signature — no `any`.
    switch (key) {
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

  // Creation-wizard AI assist (V3.3 Task 4) — draft one section's fields from a
  // free-form answer. Returns a discriminated result ({ ok, draft } | { skipped,
  // reason }); it never throws for AI reasons, so the wizard degrades to manual.
  ipcMain.handle('twin:draft-section', async (_event, section: unknown, answer: unknown) => {
    const key = validateInput(sectionKeySchema, section) as TwinProfileSectionKey;
    const text = validateInput(interviewAnswerSchema, answer);
    return draftSection(key, text);
  });
}
