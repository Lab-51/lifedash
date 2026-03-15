// === Preload bridge: Intel Feed ===
import { ipcRenderer } from 'electron';
import type {
  CreateIntelSourceInput,
  UpdateIntelSourceInput,
  AddManualItemInput,
  IntelDateFilter,
} from '../../shared/types';

export const intelFeedBridge = {
  getIntelSources: () => ipcRenderer.invoke('intel:sources:list'),
  createIntelSource: (data: CreateIntelSourceInput) => ipcRenderer.invoke('intel:sources:create', data),
  updateIntelSource: (id: string, data: UpdateIntelSourceInput) => ipcRenderer.invoke('intel:sources:update', id, data),
  deleteIntelSource: (id: string) => ipcRenderer.invoke('intel:sources:delete', id),
  getIntelItems: (filter: IntelDateFilter) => ipcRenderer.invoke('intel:items:list', filter),
  markIntelItemRead: (id: string) => ipcRenderer.invoke('intel:items:markRead', id),
  toggleIntelItemBookmark: (id: string) => ipcRenderer.invoke('intel:items:bookmark', id),
  addManualIntelItem: (data: AddManualItemInput) => ipcRenderer.invoke('intel:items:addManual', data),
  fetchAllIntelSources: () => ipcRenderer.invoke('intel:fetchAll'),
  seedIntelDefaults: () => ipcRenderer.invoke('intel:seedDefaults'),

  // Intel Brief & Summarization
  intelGenerateBrief: (type: string) => ipcRenderer.invoke('intel:brief:generate', type),
  intelGetBrief: (type: string, date: string) => ipcRenderer.invoke('intel:brief:get', type, date),
  intelGetLatestBrief: (type: string) => ipcRenderer.invoke('intel:brief:latest', type),
  intelSummarizeItem: (id: string) => ipcRenderer.invoke('intel:item:summarize', id),
  intelFetchArticleContent: (id: string) => ipcRenderer.invoke('intel:item:fetchContent', id),
  intelBriefChat: (briefContent: string, messages: { role: string; content: string }[]) =>
    ipcRenderer.invoke('intel:brief:chat', briefContent, messages),
};
