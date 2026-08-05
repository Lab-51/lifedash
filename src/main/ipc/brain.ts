// === FILE PURPOSE ===
// IPC handler for the "living brain" mind-map data service (V3.2 Task 1), PLUS
// the per-entity learned-facts surface (BRAIN-UX.1 Task 1) — entity concerns
// stay registered here alongside brain:build-tree rather than a new ipc file.
// brain:build-tree is a structural DB read only (no AI); entity:* facts are a
// separate auditable-memory store from brain:build-tree's tree payload.
//
// === entity:* CONTRACT (BRAIN-UX.1 Tasks 1 + 3) ===
// All three entity:* channels are thin delegations to entityFactService (simple
// queries, matching brain:build-tree's thinness). entity:analyze-history now runs
// the REAL sequential history mining (Task 3): it resolves with honest counts
// (`status: 'ok'`) or REJECTS with a user-facing message when no model is
// configured — never a fabricated success. The handler shape is unchanged from
// Task 1's freeze.
//
// Importing entityFactService also wires its post-session ENTITY-FACT mining hook
// onto the dispatcher (that module imports entityService, so the run order is
// facts → entities → entity facts).
//
// === Post-meeting chat contract (documented here, NOT a new channel) ===
// The Q&A-only post-meeting chat (BRAIN-UX.1 session decision) rides the
// EXISTING `meeting-agent:send` channel (src/main/ipc/meeting-agent.ts) and its
// single per-meeting thread — no new IPC surface. meetingAgentService branches
// its TOOLSET by the meeting's status: `recording`/`processing` meetings keep
// the full live toolset (byte-identical to today); `completed` meetings get a
// read-only Q&A toolset (transcript window/search, meeting context/brief) with
// no side-effect tools (Task 5 wires the branch). The renderer keeps using the
// same send/stream bridge (meetingAgentSend + onMeetingAgentTextDelta/etc.) for
// both phases, so live and post-meeting Q&A form one visible continuum.

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as brainTreeService from '../services/brainTreeService';
import * as brainGraphService from '../services/brainGraphService';
import * as entityFactService from '../services/entityFactService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { entityIdSchema, entityFactIdSchema } from '../../shared/validation/schemas';
// Side-effect import: wires entityService's post-session ENTITY-extraction hook
// onto the dispatcher at boot. entityService imports twinMemoryService, so the
// FACTS hook self-registers first — entities always run AFTER facts.
import '../services/entityService';

const scopeSchema = z.union([z.literal('workspace'), z.object({ meetingId: z.string().uuid() })]);

// TWIN-GRAPH.1 Task 1 — the memory graph's own scope literal ('everything', not
// 'workspace') so it never gets confused with the tree's BrainScope above.
const graphScopeSchema = z.union([z.literal('everything'), z.object({ meetingId: z.string().uuid() })]);

export function registerBrainHandlers(): void {
  ipcMain.handle('brain:build-tree', async (_event, scope: unknown) => {
    const validScope = validateInput(scopeSchema, scope);
    return brainTreeService.buildBrainTree({ scope: validScope });
  });

  // TWIN-GRAPH.1 Task 1 — memory graph (entities + facts + twin ledger + source
  // sessions as one flat graph). Distinct from brain:build-tree above.
  ipcMain.handle('brain:build-graph', async (_event, scope: unknown) => {
    const validScope = validateInput(graphScopeSchema, scope);
    return brainGraphService.buildBrainGraph({ scope: validScope });
  });

  // --- Per-entity learned facts (BRAIN-UX.1 Task 1) ---

  ipcMain.handle('entity:list-facts', async (_event, entityId: unknown) => {
    const id = validateInput(entityIdSchema, entityId);
    return entityFactService.listFacts(id);
  });

  ipcMain.handle('entity:forget-fact', async (_event, factId: unknown) => {
    const id = validateInput(entityFactIdSchema, factId);
    return entityFactService.forgetFact(id);
  });

  ipcMain.handle('entity:analyze-history', async (_event, entityId: unknown) => {
    const id = validateInput(entityIdSchema, entityId);
    return entityFactService.analyzeHistory(id);
  });
}
