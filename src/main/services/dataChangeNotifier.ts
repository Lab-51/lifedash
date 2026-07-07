// === FILE PURPOSE ===
// Broadcasts a `data:changed` event to EVERY renderer window so the visible
// board can debounce-refetch after ANY data mutation. ONE helper, called once
// per mutation site (card IPC handlers, autoPush, live-assistant card creation,
// project creation) — so the "watch the assistant work" live-update behaviour
// can never be silently forgotten at a new mutation site: one import, one call.

// === DEPENDENCIES ===
// electron (BrowserWindow) — broadcast to all windows via getAllWindows().

import { BrowserWindow } from 'electron';

export type DataChangeScope = 'cards' | 'columns' | 'projects';

export interface DataChangePayload {
  scope: DataChangeScope;
  /**
   * The project the change belongs to. The renderer refetches the visible board
   * only when this matches it (or when omitted — "refetch to be safe").
   */
  projectId?: string;
}

/**
 * Emit `data:changed` to all live renderer windows. Guarded so that outside a
 * real Electron runtime (unit tests) it is a no-op instead of throwing —
 * BrowserWindow.getAllWindows only exists inside Electron's main process.
 */
export function notifyDataChanged(payload: DataChangePayload): void {
  if (typeof BrowserWindow?.getAllWindows !== 'function') return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('data:changed', payload);
    }
  }
}
