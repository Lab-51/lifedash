// === FILE PURPOSE ===
// Shared type definitions used across main, preload, and renderer processes.

/** Database connection status returned by db:status IPC handler */
export interface DatabaseStatus {
  connected: boolean;
  message: string;
}

/** API exposed to the renderer via contextBridge in preload.ts */
export interface ElectronAPI {
  platform: NodeJS.Platform;

  // Window controls
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;

  // Database
  getDatabaseStatus: () => Promise<DatabaseStatus>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
