// === Common types shared across all domains ===

/** Database connection status returned by db:status IPC handler */
export interface DatabaseStatus {
  connected: boolean;
  message: string;
}
