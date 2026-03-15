// === FILE PURPOSE ===
// IPC handlers for intel feed operations (sources, items, briefs, summarization).

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as intelFeedService from '../services/intelFeedService';
import * as intelBriefService from '../services/intelBriefService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  createIntelSourceInputSchema,
  updateIntelSourceInputSchema,
  addManualItemInputSchema,
  intelDateFilterSchema,
  intelBriefTypeSchema,
} from '../../shared/validation/schemas';

export function registerIntelFeedHandlers(): void {
  ipcMain.handle('intel:sources:list', async () => {
    return intelFeedService.getSources();
  });

  ipcMain.handle('intel:sources:create', async (_event, data: unknown) => {
    const input = validateInput(createIntelSourceInputSchema, data);
    return intelFeedService.createSource(input);
  });

  ipcMain.handle('intel:sources:update', async (_event, id: unknown, data: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const input = validateInput(updateIntelSourceInputSchema, data);
    return intelFeedService.updateSource(validId, input);
  });

  ipcMain.handle('intel:sources:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelFeedService.deleteSource(validId);
  });

  ipcMain.handle('intel:items:list', async (_event, filter: unknown) => {
    const validFilter = validateInput(intelDateFilterSchema, filter);
    return intelFeedService.getItems(validFilter);
  });

  ipcMain.handle('intel:items:markRead', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelFeedService.markRead(validId);
  });

  ipcMain.handle('intel:items:bookmark', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelFeedService.toggleBookmark(validId);
  });

  ipcMain.handle('intel:items:addManual', async (_event, data: unknown) => {
    const input = validateInput(addManualItemInputSchema, data);
    return intelFeedService.addManualItem(input);
  });

  ipcMain.handle('intel:fetchAll', async () => {
    return intelFeedService.fetchAllSources();
  });

  ipcMain.handle('intel:seedDefaults', async () => {
    return intelFeedService.seedDefaultSources();
  });

  // Brief generation & retrieval
  ipcMain.handle('intel:brief:generate', async (_event, type: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    return intelBriefService.generateBrief(validType);
  });

  ipcMain.handle('intel:brief:get', async (_event, type: unknown, date: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    const validDate = validateInput(z.string(), date);
    return intelBriefService.getBrief(validType, validDate);
  });

  ipcMain.handle('intel:brief:latest', async (_event, type: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    return intelBriefService.getLatestBrief(validType);
  });

  // Article content extraction
  ipcMain.handle('intel:item:fetchContent', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelFeedService.fetchArticleContent(validId);
  });

  // Article summarization
  ipcMain.handle('intel:item:summarize', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelBriefService.summarizeArticle(validId);
  });
}
