// === Preload bridge: Background Agent ===
import { ipcRenderer } from 'electron';
import type {
  BackgroundAgentPreferences,
  AgentInsight,
  InsightType,
  InsightStatus,
} from '../../shared/types/background-agent';

export const backgroundAgentBridge = {
  backgroundAgentGetPreferences: (): Promise<BackgroundAgentPreferences> =>
    ipcRenderer.invoke('background-agent:get-preferences'),

  backgroundAgentUpdatePreferences: (prefs: Partial<BackgroundAgentPreferences>): Promise<void> =>
    ipcRenderer.invoke('background-agent:update-preferences', prefs),

  backgroundAgentGetInsights: (
    projectId: string,
    options?: { status?: InsightStatus; type?: InsightType; limit?: number },
  ): Promise<AgentInsight[]> => ipcRenderer.invoke('background-agent:get-insights', projectId, options),

  backgroundAgentGetAllInsights: (projectIds?: string[], limit?: number): Promise<AgentInsight[]> =>
    ipcRenderer.invoke('background-agent:get-all-insights', projectIds, limit),

  backgroundAgentGetNewCount: (): Promise<number> => ipcRenderer.invoke('background-agent:get-new-count'),

  backgroundAgentMarkRead: (id: string): Promise<void> => ipcRenderer.invoke('background-agent:mark-read', id),

  backgroundAgentDismiss: (id: string): Promise<void> => ipcRenderer.invoke('background-agent:dismiss', id),

  backgroundAgentMarkActedOn: (id: string): Promise<void> => ipcRenderer.invoke('background-agent:mark-acted-on', id),

  backgroundAgentRunNow: (): Promise<{ ran: boolean; reason: string }> =>
    ipcRenderer.invoke('background-agent:run-now'),

  backgroundAgentGetDailyUsage: (): Promise<{ date: string; tokensUsed: number }> =>
    ipcRenderer.invoke('background-agent:get-daily-usage'),

  onBackgroundAgentNewInsights: (callback: (data: { projectId: string; count: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { projectId: string; count: number }) => callback(data);
    ipcRenderer.on('background-agent:new-insights', handler);
    return () => {
      ipcRenderer.removeListener('background-agent:new-insights', handler);
    };
  },
};
