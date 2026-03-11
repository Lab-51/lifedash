// === FILE PURPOSE ===
// Hook that subscribes to sync IPC events from the main process.
// Returns real-time sync status, auth state, and error details.
// On mount: fetches initial state. Subscribes to sync:status-changed and sync:error events.

// === DEPENDENCIES ===
// react (useState, useEffect, useCallback), window.electronAPI (preload bridge)

import { useState, useEffect, useCallback } from 'react';
import type { SyncStatus, AuthState } from '../../shared/types/sync';

export interface SyncStatusState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  user: AuthState['user'];
  isEnabled: boolean;
  isAuthenticated: boolean;
  errorDetails: string | null;
  loading: boolean;
}

export interface SyncStatusHook extends SyncStatusState {
  /** Re-fetch auth state and sync status from the main process. */
  refresh: () => Promise<void>;
}

/**
 * Format a timestamp as a relative time string (e.g. "just now", "2 minutes ago").
 * Returns null if the input is null.
 */
export function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function useSyncStatus(): SyncStatusHook {
  const [state, setState] = useState<SyncStatusState>({
    status: 'disconnected',
    lastSyncedAt: null,
    user: null,
    isEnabled: false,
    isAuthenticated: false,
    errorDetails: null,
    loading: true,
  });

  const loadInitialState = useCallback(async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.syncGetAuthState) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const [auth, status] = await Promise.all([
        window.electronAPI.syncGetAuthState(),
        window.electronAPI.syncGetStatus(),
      ]);
      setState({
        status,
        lastSyncedAt: auth.lastSyncedAt,
        user: auth.user,
        isEnabled: auth.isAuthenticated && status !== 'disconnected',
        isAuthenticated: auth.isAuthenticated,
        errorDetails: null,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to load sync state:', err);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    loadInitialState();
  }, [loadInitialState]);

  // Subscribe to sync:status-changed events from main process
  useEffect(() => {
    if (!window.electronAPI?.onSyncStatusChanged) return;

    return window.electronAPI.onSyncStatusChanged((data) => {
      setState(prev => ({
        ...prev,
        status: data.status as SyncStatus,
        lastSyncedAt: data.lastSyncedAt || prev.lastSyncedAt,
        errorDetails: data.status === 'error' ? prev.errorDetails : null,
      }));
    });
  }, []);

  // Subscribe to sync:error events from main process
  useEffect(() => {
    if (!window.electronAPI?.onSyncError) return;

    return window.electronAPI.onSyncError((data) => {
      setState(prev => ({
        ...prev,
        status: 'error',
        errorDetails: `${data.table}: ${data.error}`,
      }));
    });
  }, []);

  return { ...state, refresh: loadInitialState };
}

export default useSyncStatus;
