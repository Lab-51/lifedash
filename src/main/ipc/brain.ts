// === FILE PURPOSE ===
// IPC handler for the "living brain" mind-map data service (V3.2 Task 1).
// Returns the hierarchical brain-tree payload for either the whole workspace or
// a single session. Structural DB reads only — no AI.

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as brainTreeService from '../services/brainTreeService';
import { validateInput } from '../../shared/validation/ipc-validator';
// Side-effect import: wires entityService's post-session ENTITY-extraction hook
// onto the dispatcher at boot. entityService imports twinMemoryService, so the
// FACTS hook self-registers first — entities always run AFTER facts.
import '../services/entityService';

const scopeSchema = z.union([z.literal('workspace'), z.object({ meetingId: z.string().uuid() })]);

export function registerBrainHandlers(): void {
  ipcMain.handle('brain:build-tree', async (_event, scope: unknown) => {
    const validScope = validateInput(scopeSchema, scope);
    return brainTreeService.buildBrainTree({ scope: validScope });
  });
}
