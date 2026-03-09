// === FILE PURPOSE ===
// IPC handlers for crash recovery — check, restore, and discard recovery state,
// plus card draft persistence for crash-safe editing.

import { ipcMain } from 'electron';
import {
  hasCrashMarker,
  getRecoveryState,
  clearCrashMarker,
  clearRecoveryState,
  saveCardDraft,
  clearCardDraft,
} from '../services/sessionRecoveryService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  recoveryDraftSchema,
  recoveryDraftClearCardIdSchema,
  recoveryDraftClearFieldSchema,
} from '../../shared/validation/schemas';

export function registerRecoveryHandlers(): void {
  ipcMain.handle('recovery:check', () => {
    return {
      hasCrash: hasCrashMarker(),
      state: getRecoveryState(),
    };
  });

  ipcMain.handle('recovery:restore', () => {
    const state = getRecoveryState();
    clearCrashMarker();
    return state;
  });

  ipcMain.handle('recovery:discard', () => {
    clearRecoveryState();
  });

  ipcMain.handle('recovery:save-draft', (_event, draft: unknown) => {
    const validDraft = validateInput(recoveryDraftSchema, draft);
    saveCardDraft(validDraft);
  });

  ipcMain.handle('recovery:clear-draft', (_event, cardId: unknown, field: unknown) => {
    const validCardId = validateInput(recoveryDraftClearCardIdSchema, cardId);
    const validField = validateInput(recoveryDraftClearFieldSchema, field);
    clearCardDraft(validCardId, validField);
  });
}
