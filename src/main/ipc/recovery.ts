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

  ipcMain.handle('recovery:save-draft', (_event, draft: { cardId: string; field: string; value: string; projectId?: string }) => {
    if (!draft || typeof draft.cardId !== 'string' || typeof draft.field !== 'string' || typeof draft.value !== 'string') {
      throw new Error('Invalid draft: cardId, field, and value are required strings');
    }
    saveCardDraft(draft);
  });

  ipcMain.handle('recovery:clear-draft', (_event, cardId: string, field: string) => {
    if (typeof cardId !== 'string' || typeof field !== 'string') {
      throw new Error('Invalid input: cardId and field are required strings');
    }
    clearCardDraft(cardId, field);
  });
}
