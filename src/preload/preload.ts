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

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion,
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
});
