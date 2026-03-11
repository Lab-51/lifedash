// === FILE PURPOSE ===
// TypeScript types for cloud sync feature.
// Used across main process, preload, and renderer.

export type SyncStatus = 'disconnected' | 'syncing' | 'synced' | 'error' | 'offline';

export interface SyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  enabled: boolean;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: { id: string; email: string } | null;
  lastSyncedAt: string | null;
}

export interface SyncEvent {
  type: string;
  table: string;
  count: number;
  timestamp: string;
}
