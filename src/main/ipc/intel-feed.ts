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
  createIntelFeedInputSchema,
  updateIntelFeedInputSchema,
  feedSourcesSchema,
  feedIdsArraySchema,
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

  ipcMain.handle('intel:items:list', async (_event, filter: unknown, extra: unknown) => {
    const validFilter = validateInput(intelDateFilterSchema, filter);
    const validExtra = extra
      ? validateInput(
          z.object({
            searchQuery: z.string().optional(),
            sourceFilter: z.string().uuid().optional(),
            bookmarkFilter: z.boolean().optional(),
          }),
          extra,
        )
      : undefined;
    return intelFeedService.getItems(validFilter, validExtra);
  });

  ipcMain.handle('intel:trending', async () => {
    return intelFeedService.getTrendingTopics();
  });

  ipcMain.handle('intel:bookmark-count', async () => {
    return intelFeedService.getBookmarkCount();
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

  // Feed management (custom curated feeds)
  ipcMain.handle('intel:feeds:list', async () => {
    return intelFeedService.getFeeds();
  });

  ipcMain.handle('intel:feeds:create', async (_event, data: unknown) => {
    const input = validateInput(createIntelFeedInputSchema, data);
    return intelFeedService.createFeed(input);
  });

  ipcMain.handle('intel:feeds:update', async (_event, id: unknown, data: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const input = validateInput(updateIntelFeedInputSchema, data);
    return intelFeedService.updateFeed(validId, input);
  });

  ipcMain.handle('intel:feeds:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelFeedService.deleteFeed(validId);
  });

  ipcMain.handle('intel:feeds:setSources', async (_event, id: unknown, data: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const { sourceIds } = validateInput(feedSourcesSchema, data);
    return intelFeedService.setFeedSources(validId, sourceIds);
  });

  ipcMain.handle('intel:feeds:getSources', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelFeedService.getFeedSourceIds(validId);
  });

  ipcMain.handle('intel:feeds:reorder', async (_event, feedIds: unknown) => {
    const validFeedIds = validateInput(feedIdsArraySchema, feedIds);
    return intelFeedService.reorderFeeds(validFeedIds);
  });

  // Brief generation & retrieval
  ipcMain.handle('intel:brief:generate', async (_event, type: unknown, feedId?: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    const validFeedId = feedId ? validateInput(idParamSchema, feedId) : undefined;
    return intelBriefService.generateBrief(validType, validFeedId);
  });

  ipcMain.handle('intel:brief:get', async (_event, type: unknown, date: unknown, feedId?: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    const validDate = validateInput(z.string(), date);
    const validFeedId = feedId ? validateInput(idParamSchema, feedId) : undefined;
    return intelBriefService.getBrief(validType, validDate, validFeedId);
  });

  ipcMain.handle('intel:brief:latest', async (_event, type: unknown, feedId?: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    const validFeedId = feedId ? validateInput(idParamSchema, feedId) : undefined;
    return intelBriefService.getLatestBrief(validType, validFeedId);
  });

  // Brief chat
  ipcMain.handle('intel:brief:chat', async (_event, briefContent: unknown, messages: unknown) => {
    const validContent = validateInput(z.string(), briefContent);
    const validMessages = validateInput(
      z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
      messages,
    );
    return intelBriefService.chatAboutBrief(validContent, validMessages);
  });

  // Brief pin & history
  ipcMain.handle('intel:brief:toggle-pin', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return intelBriefService.toggleBriefPin(validId);
  });

  ipcMain.handle('intel:brief:history', async (_event, type: unknown, feedId?: unknown) => {
    const validType = validateInput(intelBriefTypeSchema, type);
    const validFeedId = feedId ? validateInput(idParamSchema, feedId) : undefined;
    return intelBriefService.getBriefHistory(validType, validFeedId);
  });

  ipcMain.handle('intel:brief:pinned', async () => {
    return intelBriefService.getPinnedBriefs();
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
