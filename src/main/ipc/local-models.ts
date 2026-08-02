// === FILE PURPOSE ===
// IPC surface for local (bundled-runtime) GGUF models: browse the catalog, start /
// pause / cancel resumable downloads, delete downloaded files, and register custom
// GGUFs. Progress is pushed to the renderer on 'local-models:progress', mirroring
// whisper's download-progress pattern.
//
// === DEPENDENCIES ===
// electron (ipcMain, BrowserWindow, shell), ../services/modelCatalogService,
// ../services/modelDownloadService, ../../shared/validation/localModelSchemas
//
// === LIMITATIONS ===
// - Nothing here runs at startup. Registration only installs handlers; the first
//   catalog resolution happens when the user opens Settings → Local AI.
// - One active download at a time (the service queues the rest).

import fsp from 'node:fs/promises';
import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as catalogService from '../services/modelCatalogService';
import * as downloadService from '../services/modelDownloadService';
import { getModelsDir } from '../services/llamaRuntimeConfig';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  downloadKeySchema,
  downloadModelInputSchema,
  modelFileNameSchema,
  registerCustomModelInputSchema,
} from '../../shared/validation/localModelSchemas';
import { fileNameForUrl, type LocalModelDownloadProgress } from '../../shared/types/localModels';

/** Guards against a second progress listener if handlers are registered twice. */
let progressBridged = false;

function bridgeProgress(mainWindow: BrowserWindow): void {
  if (progressBridged) return;
  progressBridged = true;
  downloadService.downloadEvents.on('progress', (progress: LocalModelDownloadProgress) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('local-models:progress', progress);
  });
}

export function registerLocalModelHandlers(mainWindow: BrowserWindow): void {
  bridgeProgress(mainWindow);

  // Catalog + hardware tier + per-model status + in-flight downloads, in one call.
  // `force` re-fetches the remote catalog; failures silently degrade to cache/bundled.
  ipcMain.handle('local-models:view', async (_event, force: unknown) => {
    const view = await catalogService.getLocalModelsView({ force: force === true });
    return { ...view, downloads: downloadService.listDownloads() };
  });

  // Start (or resume) a download. Returns the initial progress snapshot.
  ipcMain.handle('local-models:download', async (_event, data: unknown) => {
    const input = validateInput(downloadModelInputSchema, data);
    const hit = await catalogService.findCatalogFile(input.modelId, input.quant);
    if (!hit) throw new Error(`Unknown model "${input.modelId}"${input.quant ? ` (${input.quant})` : ''}.`);
    if (hit.file.url.startsWith('file://')) {
      throw new Error(`"${hit.model.displayName}" is a local file — there is nothing to download.`);
    }
    return downloadService.enqueue({
      key: `${hit.model.id}:${hit.file.quant}`,
      url: hit.file.url,
      fileName: fileNameForUrl(hit.file.url),
      sha256: hit.file.sha256 || undefined,
      sizeBytes: hit.file.sizeBytes || undefined,
    });
  });

  // Stop transferring but keep the partial file for a later resume.
  ipcMain.handle('local-models:pause', async (_event, key: unknown) =>
    downloadService.pause(validateInput(downloadKeySchema, key)),
  );

  // Abandon a download and discard its partial data.
  ipcMain.handle('local-models:cancel', async (_event, key: unknown) =>
    downloadService.cancel(validateInput(downloadKeySchema, key)),
  );

  ipcMain.handle('local-models:downloads', async () => downloadService.listDownloads());

  ipcMain.handle('local-models:clear-finished', async () => downloadService.clearFinished());

  // Delete one downloaded .gguf and report the reclaimed space (Task 4's delete UI).
  ipcMain.handle('local-models:delete', async (_event, fileName: unknown) =>
    downloadService.deleteModelFile(validateInput(modelFileNameSchema, fileName)),
  );

  // Register a user-supplied GGUF by local path or direct URL.
  ipcMain.handle('local-models:register-custom', async (_event, data: unknown) =>
    catalogService.registerCustomModel(validateInput(registerCustomModelInputSchema, data)),
  );

  ipcMain.handle('local-models:unregister-custom', async (_event, modelId: unknown) =>
    catalogService.unregisterCustomModel(validateInput(downloadKeySchema, modelId)),
  );

  // Native picker for "add my own GGUF". Electron 40 dropped File.path, and this
  // app exposes no webUtils bridge, so an absolute path can only come from the
  // main process. Returns null when the user cancels.
  ipcMain.handle('local-models:pick-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a GGUF model file',
      properties: ['openFile'],
      filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  // Models are plain user-visible files by design; let the user open the folder.
  ipcMain.handle('local-models:open-folder', async () => {
    const dir = getModelsDir();
    await fsp.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
}
