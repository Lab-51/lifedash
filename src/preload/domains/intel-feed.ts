// === Preload bridge: Intel Feed ===
import { ipcRenderer } from 'electron';
import type {
  CreateIntelSourceInput,
  UpdateIntelSourceInput,
  AddManualItemInput,
  IntelDateFilter,
  CreateIntelFeedInput,
  UpdateIntelFeedInput,
} from '../../shared/types';

export const intelFeedBridge = {
  getIntelSources: () => ipcRenderer.invoke('intel:sources:list'),
  createIntelSource: (data: CreateIntelSourceInput) => ipcRenderer.invoke('intel:sources:create', data),
  updateIntelSource: (id: string, data: UpdateIntelSourceInput) => ipcRenderer.invoke('intel:sources:update', id, data),
  deleteIntelSource: (id: string) => ipcRenderer.invoke('intel:sources:delete', id),
  getIntelItems: (
    filter: IntelDateFilter,
    extra?: { searchQuery?: string; sourceFilter?: string; bookmarkFilter?: boolean },
  ) => ipcRenderer.invoke('intel:items:list', filter, extra),
  getIntelTrendingTopics: () => ipcRenderer.invoke('intel:trending'),
  getIntelBookmarkCount: () => ipcRenderer.invoke('intel:bookmark-count'),
  markIntelItemRead: (id: string) => ipcRenderer.invoke('intel:items:markRead', id),
  toggleIntelItemBookmark: (id: string) => ipcRenderer.invoke('intel:items:bookmark', id),
  addManualIntelItem: (data: AddManualItemInput) => ipcRenderer.invoke('intel:items:addManual', data),
  fetchAllIntelSources: () => ipcRenderer.invoke('intel:fetchAll'),
  seedIntelDefaults: () => ipcRenderer.invoke('intel:seedDefaults'),

  // Intel Feeds (custom curated feeds)
  getIntelFeeds: () => ipcRenderer.invoke('intel:feeds:list'),
  createIntelFeed: (data: CreateIntelFeedInput) => ipcRenderer.invoke('intel:feeds:create', data),
  updateIntelFeed: (id: string, data: UpdateIntelFeedInput) => ipcRenderer.invoke('intel:feeds:update', id, data),
  deleteIntelFeed: (id: string) => ipcRenderer.invoke('intel:feeds:delete', id),
  setIntelFeedSources: (id: string, sourceIds: string[]) =>
    ipcRenderer.invoke('intel:feeds:setSources', id, { sourceIds }),
  getIntelFeedSources: (id: string) => ipcRenderer.invoke('intel:feeds:getSources', id),
  reorderIntelFeeds: (feedIds: string[]) => ipcRenderer.invoke('intel:feeds:reorder', feedIds),

  // Intel Brief & Summarization
  intelGenerateBrief: (type: string, feedId?: string) => ipcRenderer.invoke('intel:brief:generate', type, feedId),
  intelGetBrief: (type: string, date: string, feedId?: string) =>
    ipcRenderer.invoke('intel:brief:get', type, date, feedId),
  intelGetLatestBrief: (type: string, feedId?: string) => ipcRenderer.invoke('intel:brief:latest', type, feedId),
  intelSummarizeItem: (id: string) => ipcRenderer.invoke('intel:item:summarize', id),
  intelFetchArticleContent: (id: string) => ipcRenderer.invoke('intel:item:fetchContent', id),
  intelBriefChat: (briefContent: string, messages: { role: string; content: string }[]) =>
    ipcRenderer.invoke('intel:brief:chat', briefContent, messages),
  intelToggleBriefPin: (id: string) => ipcRenderer.invoke('intel:brief:toggle-pin', id),
  intelGetBriefHistory: (type: string, feedId?: string) => ipcRenderer.invoke('intel:brief:history', type, feedId),
  intelGetPinnedBriefs: () => ipcRenderer.invoke('intel:brief:pinned'),
};
