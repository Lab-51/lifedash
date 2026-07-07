// === Preload bridge: Digital Twin profile (V3.3 Tasks 3-4) — read the singleton
// profile, patch it one section at a time, and draft one section from a
// free-form interview answer (optional AI assist; never blocks the wizard). ===
import { ipcRenderer } from 'electron';
import type { TwinProfile, TwinProfileSections, TwinProfileSectionKey, TwinInterviewDraft } from '../../shared/types';

export const twinBridge = {
  twinGetProfile: (): Promise<TwinProfile | null> => ipcRenderer.invoke('twin:get-profile'),
  twinUpdateProfileSection: <K extends TwinProfileSectionKey>(
    section: K,
    value: TwinProfileSections[K],
  ): Promise<TwinProfile> => ipcRenderer.invoke('twin:update-profile-section', section, value),
  twinDraftSection: <K extends TwinProfileSectionKey>(section: K, answer: string): Promise<TwinInterviewDraft<K>> =>
    ipcRenderer.invoke('twin:draft-section', section, answer),
};
