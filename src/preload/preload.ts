// === FILE PURPOSE ===
// Preload script — runs before renderer process loads.
// Exposes a safe API to the renderer via contextBridge.
// All IPC communication goes through domain bridge modules,
// keeping contextIsolation intact and nodeIntegration disabled.

import { contextBridge } from 'electron';
import { version as appVersion } from '../../package.json';
import { windowBridge } from './domains/window';
import { databaseBridge } from './domains/database';
import { projectsBridge } from './domains/projects';
import { cardDetailsBridge } from './domains/card-details';
import { settingsBridge } from './domains/settings';
import { meetingsBridge } from './domains/meetings';
import { ideasBridge } from './domains/ideas';
import { brainstormBridge } from './domains/brainstorm';
import { backupBridge } from './domains/backup';
import { taskStructuringBridge } from './domains/task-structuring';
import { notificationsBridge } from './domains/notifications';
import { transcriptionBridge } from './domains/transcription';
import { appBridge } from './domains/app';
import { dashboardBridge } from './domains/dashboard';
import { focusBridge } from './domains/focus';
import { gamificationBridge } from './domains/gamification';
import { cardAgentBridge } from './domains/card-agent';
import { projectAgentBridge } from './domains/project-agent';
import { meetingAgentBridge } from './domains/meeting-agent';
import { liveSuggestionsBridge } from './domains/live-suggestions';

import { backgroundAgentBridge } from './domains/background-agent';
import { voiceInputBridge } from './domains/voice-input';
import { recoveryBridge } from './domains/recovery';
import { diagnosticsBridge } from './domains/diagnostics';
import { syncBridge } from './domains/sync';
import { intelFeedBridge } from './domains/intel-feed';
import { searchBridge } from './domains/search';
import { brainBridge } from './domains/brain';
import { twinBridge } from './domains/twin';
import { embeddingBridge } from './domains/embedding';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion,
  isTestMode: process.env.NODE_ENV === 'test',
  ...windowBridge,
  ...databaseBridge,
  ...projectsBridge,
  ...cardDetailsBridge,
  ...settingsBridge,
  ...meetingsBridge,
  ...ideasBridge,
  ...brainstormBridge,
  ...backupBridge,
  ...taskStructuringBridge,
  ...notificationsBridge,
  ...transcriptionBridge,
  ...appBridge,
  ...dashboardBridge,
  ...focusBridge,
  ...gamificationBridge,
  ...cardAgentBridge,
  ...projectAgentBridge,
  ...meetingAgentBridge,
  ...liveSuggestionsBridge,
  ...backgroundAgentBridge,
  ...voiceInputBridge,
  ...recoveryBridge,
  ...diagnosticsBridge,
  ...syncBridge,
  ...intelFeedBridge,
  ...searchBridge,
  ...brainBridge,
  ...twinBridge,
  ...embeddingBridge,
});
