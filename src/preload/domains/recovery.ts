// === Preload bridge: Crash recovery IPC ===
import { ipcRenderer } from 'electron';

export const recoveryBridge = {
  checkRecovery: (): Promise<{ hasCrash: boolean; state: unknown }> => ipcRenderer.invoke('recovery:check'),

  restoreSession: (): Promise<unknown> => ipcRenderer.invoke('recovery:restore'),

  discardRecovery: (): Promise<void> => ipcRenderer.invoke('recovery:discard'),

  saveCardDraft: (draft: { cardId: string; field: string; value: string; projectId?: string }): Promise<void> =>
    ipcRenderer.invoke('recovery:save-draft', draft),

  clearCardDraft: (cardId: string, field: string): Promise<void> =>
    ipcRenderer.invoke('recovery:clear-draft', cardId, field),
};
