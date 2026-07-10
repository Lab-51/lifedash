// === FILE PURPOSE ===
// IPC handlers for the V3.4 semantic-index Settings surface (progress, backfill,
// dismiss, rebuild-on-mismatch). Importing this file pulls embeddingService into
// the boot chain, and registerEmbeddingHandlers() self-registers its post-session
// embedding hook via initEmbeddingService() — the disjoint boot path Task 4 owns.

import { ipcMain } from 'electron';
import {
  initEmbeddingService,
  getEmbeddingStatus,
  runBackfill,
  dismissBackfill,
  rebuildIndex,
} from '../services/embeddingService';

export function registerEmbeddingHandlers(): void {
  // Boot-wire the post-session hook (idempotent). Safe here: no DB access at init.
  initEmbeddingService();

  ipcMain.handle('embedding:status', async () => getEmbeddingStatus());

  // Backfill + rebuild are long-running background jobs — kick them off and return
  // immediately so the renderer never blocks; progress is polled via embedding:status.
  ipcMain.handle('embedding:backfill', async () => {
    void runBackfill();
  });

  ipcMain.handle('embedding:rebuild', async () => {
    void rebuildIndex();
  });

  ipcMain.handle('embedding:dismiss-backfill', async () => dismissBackfill());
}
