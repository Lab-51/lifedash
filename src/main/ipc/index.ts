// === FILE PURPOSE ===
// Central registration point for all IPC handlers.
// Call registerIpcHandlers() once after the main window is created.
// Installs a timing wrapper around ipcMain.handle for performance visibility.

import { BrowserWindow, ipcMain, shell } from 'electron';
import { registerWindowControlHandlers } from './window-controls';
import { registerDatabaseHandlers } from './database';
import { registerProjectHandlers } from './projects';
import { registerCardHandlers } from './cards';
import { registerSettingsHandlers } from './settings';
import { registerAIProviderHandlers } from './ai-providers';
import { registerMeetingHandlers } from './meetings';
import { registerRecordingHandlers } from './recording';
import { registerWhisperHandlers } from './whisper';
import { registerMeetingIntelligenceHandlers } from './meeting-intelligence';
import { registerIdeaHandlers } from './ideas';
import { registerBrainstormHandlers } from './brainstorm';
import { registerBackupHandlers } from './backup';
import { registerTaskStructuringHandlers } from './task-structuring';
import { registerNotificationHandlers } from './notifications';
import { registerTranscriptionProviderHandlers } from './transcription-provider';
import { registerDiarizationHandlers } from './diarization';
import { registerDashboardHandlers } from './dashboard';
import { registerFocusHandlers } from './focus';
import { registerGamificationHandlers } from './gamification';
import { registerCardAgentHandlers } from './card-agent';
import { registerProjectAgentHandlers } from './project-agent';

import { registerBackgroundAgentHandlers } from './background-agent';
import { registerVoiceInputHandlers } from './voice-input';
import { registerRecoveryHandlers } from './recovery';
import { registerDiagnosticsHandlers } from './diagnostics';
import { registerSyncHandlers } from './sync';
import { trackTiming } from '../services/performanceTracker';

/**
 * Install a timing wrapper around ipcMain.handle so every IPC handler
 * is automatically instrumented with performance tracking.
 * Must be called once before any registerXxxHandlers() functions.
 */
function installIpcTimingWrapper(): void {
  const originalHandle = ipcMain.handle.bind(ipcMain);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ipcMain as any).handle = (channel: string, listener: (...args: any[]) => any) => {
    return originalHandle(channel, async (...args: any[]) => {
      return trackTiming(`IPC: ${channel}`, () =>
        Promise.resolve(listener(...args)),
      );
    });
  };
}

/**
 * Register all IPC handlers for the given main window.
 * This should be called once during app initialization.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Wrap ipcMain.handle before registering any handlers
  installIpcTimingWrapper();
  registerWindowControlHandlers(mainWindow);
  registerDatabaseHandlers();
  registerProjectHandlers();
  registerCardHandlers();
  registerSettingsHandlers(mainWindow);
  registerAIProviderHandlers();
  registerMeetingHandlers();
  registerRecordingHandlers(mainWindow);
  registerWhisperHandlers(mainWindow);
  registerMeetingIntelligenceHandlers();
  registerIdeaHandlers();
  registerBrainstormHandlers();
  registerBackupHandlers(mainWindow);
  registerTaskStructuringHandlers();
  registerNotificationHandlers();
  registerTranscriptionProviderHandlers();
  registerDiarizationHandlers();
  registerDashboardHandlers();
  registerFocusHandlers();
  registerGamificationHandlers();
  registerCardAgentHandlers();
  registerProjectAgentHandlers();
  registerBackgroundAgentHandlers();
  registerVoiceInputHandlers();
  registerRecoveryHandlers();
  registerDiagnosticsHandlers();
  registerSyncHandlers();

  // App-level: open URL in system browser (not Electron)
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
    }
  });
}
