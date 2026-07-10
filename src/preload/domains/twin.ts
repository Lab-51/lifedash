// === Preload bridge: Digital Twin profile (V3.3 + V3.3.5 "Deep Creation") ===
// Read the singleton profile, patch it one section at a time (incl. the new
// `brief` section), draft one structured section from a free-form answer
// (Quick-form "Interview me"), and the deep-creation channels: multi-turn
// interview, history mining, web research, and the creation-model gate.
import { ipcRenderer } from 'electron';
import type {
  TwinProfile,
  TwinProfileSections,
  TwinProfileKey,
  TwinProfileSectionKey,
  TwinInterviewDraft,
  TwinInterviewNextPayload,
  TwinInterviewNextResult,
  TwinInterviewSynthesizePayload,
  TwinInterviewSynthesizeResult,
  TwinResearchHistoryInfo,
  TwinResearchResult,
  TwinWebResearchPayload,
  TwinWebResearchResult,
  TwinRoleResearchPayload,
  TwinRoleResearchResult,
  TwinCreationModel,
  TwinFact,
  TwinMemoryListFilter,
} from '../../shared/types';

export const twinBridge = {
  twinGetProfile: (): Promise<TwinProfile | null> => ipcRenderer.invoke('twin:get-profile'),
  twinUpdateProfileSection: <K extends TwinProfileKey>(
    section: K,
    value: TwinProfileSections[K],
  ): Promise<TwinProfile> => ipcRenderer.invoke('twin:update-profile-section', section, value),
  twinDraftSection: <K extends TwinProfileSectionKey>(section: K, answer: string): Promise<TwinInterviewDraft<K>> =>
    ipcRenderer.invoke('twin:draft-section', section, answer),

  // Deep creation (V3.3.5)
  twinInterviewNext: (payload: TwinInterviewNextPayload): Promise<TwinInterviewNextResult> =>
    ipcRenderer.invoke('twin:interview-next', payload),
  twinInterviewSynthesize: (payload: TwinInterviewSynthesizePayload): Promise<TwinInterviewSynthesizeResult> =>
    ipcRenderer.invoke('twin:interview-synthesize', payload),
  twinResearchHistoryInfo: (): Promise<TwinResearchHistoryInfo> => ipcRenderer.invoke('twin:research-history-info'),
  twinResearchHistory: (): Promise<TwinResearchResult> => ipcRenderer.invoke('twin:research-history'),
  twinResearchWeb: (payload: TwinWebResearchPayload): Promise<TwinWebResearchResult> =>
    ipcRenderer.invoke('twin:research-web', payload),
  twinResearchRole: (payload: TwinRoleResearchPayload): Promise<TwinRoleResearchResult> =>
    ipcRenderer.invoke('twin:research-role', payload),
  twinGetCreationModel: (): Promise<TwinCreationModel> => ipcRenderer.invoke('twin:get-creation-model'),

  // Living memory (V3.4) — list / forget / restore learned facts.
  twinMemoryList: (filter?: TwinMemoryListFilter): Promise<TwinFact[]> =>
    ipcRenderer.invoke('twin:memory-list', filter),
  twinMemoryForget: (factId: string): Promise<TwinFact | null> => ipcRenderer.invoke('twin:memory-forget', factId),
  twinMemoryRestore: (factId: string): Promise<TwinFact | null> => ipcRenderer.invoke('twin:memory-restore', factId),
};
