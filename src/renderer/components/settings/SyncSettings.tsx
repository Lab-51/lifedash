// === FILE PURPOSE ===
// Cloud Sync section for the Settings page.
// Shows auth state, sign-in/sign-out controls, sync toggle, manual sync button,
// detailed sync status with relative timestamps, error details, and first-run callout.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge), useSyncStatus hook

import { useState, useCallback } from 'react';
import { LogIn, LogOut, RefreshCw, Loader2, Check, AlertCircle, Cloud, Info } from 'lucide-react';
import useSyncStatus, { formatRelativeTime } from '../../hooks/useSyncStatus';
import type { SyncStatus } from '../../../shared/types/sync';

export default function SyncSettings() {
  const sync = useSyncStatus();
  const [signingIn, setSigningIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);

  // Check if we need to show the first-run callout when enabling sync
  const checkFirstRun = useCallback(async () => {
    try {
      const shown = await window.electronAPI.getSetting('sync.firstRunShown');
      if (!shown) {
        setShowFirstRun(true);
      }
    } catch {
      // Ignore — first-run check is non-critical
    }
  }, []);

  const dismissFirstRun = useCallback(async () => {
    setFirstRunDismissed(true);
    setShowFirstRun(false);
    try {
      await window.electronAPI.setSetting('sync.firstRunShown', 'true');
    } catch {
      // Non-critical
    }
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await window.electronAPI.syncSignIn();
      // Re-fetch auth state so the UI reflects the new session
      await sync.refresh();
    } catch (err) {
      console.error('Sign-in failed:', err);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await window.electronAPI.syncSignOut();
      // Re-fetch auth state so the UI reflects sign-out
      await sync.refresh();
    } catch (err) {
      console.error('Sign-out failed:', err);
    }
  };

  const handleToggleSync = async (enabled: boolean) => {
    try {
      await window.electronAPI.syncToggleEnabled(enabled);
      if (enabled) {
        await checkFirstRun();
      }
    } catch (err) {
      console.error('Failed to toggle sync:', err);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await window.electronAPI.syncTriggerNow();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = async () => {
    await handleSyncNow();
  };

  const renderStatusIndicator = () => {
    const status = syncing ? 'syncing' : sync.status;
    switch (status) {
      case 'syncing':
        return (
          <span className="flex items-center gap-1.5 text-xs text-blue-400">
            <Loader2 size={12} className="animate-spin" />
            Syncing...
          </span>
        );
      case 'synced':
        return (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Check size={12} />
            Synced
            {sync.lastSyncedAt && (
              <span className="text-surface-500 ml-1">
                {formatRelativeTime(sync.lastSyncedAt)}
              </span>
            )}
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle size={12} />
            Sync error
          </span>
        );
      case 'offline':
        return (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <Cloud size={12} />
            Offline
          </span>
        );
      default:
        return null;
    }
  };

  if (sync.loading) {
    return (
      <div className="flex items-center justify-center py-6 text-surface-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Sync your data to access it from the LifeDash web companion. Audio recordings stay local.
      </p>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Auth state */}
        {!sync.isAuthenticated ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Sign in to enable cloud sync.
              </p>
            </div>
            <button
              onClick={handleSignIn}
              disabled={signingIn}
              className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-all"
            >
              {signingIn ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <LogIn size={16} />
              )}
              {signingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        ) : (
          <>
            {/* Signed in state */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--color-accent-subtle)] flex items-center justify-center">
                  <span className="text-sm font-medium text-[var(--color-accent)]">
                    {sync.user?.email?.charAt(0).toUpperCase() || '?'}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {sync.user?.email}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {renderStatusIndicator()}
                  </div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 border border-[var(--color-border)] hover:border-red-500/50 text-[var(--color-text-secondary)] hover:text-red-400 px-3 py-1.5 text-sm transition-all"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>

            {/* Sync toggle */}
            <div className="pt-3 border-t border-[var(--color-border)]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sync.isEnabled}
                  onChange={(e) => handleToggleSync(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
                />
                <span className="text-sm font-medium text-[var(--color-text-primary)]">Enable cloud sync</span>
              </label>
              <p className="text-xs text-surface-500 mt-1 ml-6">
                Keep your projects, cards, and meetings in sync with the web companion.
              </p>
            </div>

            {/* First-run callout */}
            {showFirstRun && !firstRunDismissed && sync.isEnabled && (
              <div className="flex items-start gap-3 p-3 bg-[var(--color-accent-subtle)] border border-[var(--color-accent-dim)] rounded text-sm">
                <Info size={16} className="text-[var(--color-accent)] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[var(--color-text-primary)]">
                    Your data will sync to the cloud so you can access it from the web.
                    Audio recordings always stay on your machine.
                  </p>
                  <button
                    onClick={dismissFirstRun}
                    className="text-xs text-[var(--color-accent)] hover:underline mt-1"
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}

            {/* Error details */}
            {sync.status === 'error' && sync.errorDetails && (
              <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm">
                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-400">{sync.errorDetails}</p>
                  <button
                    onClick={handleRetry}
                    disabled={syncing}
                    className="text-xs text-red-400 hover:underline mt-1"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Last synced + Sync Now */}
            {sync.isEnabled && (
              <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
                <div className="text-xs text-surface-500">
                  {sync.lastSyncedAt ? (
                    <>Last synced: {formatRelativeTime(sync.lastSyncedAt) || new Date(sync.lastSyncedAt).toLocaleString()}</>
                  ) : (
                    'Not yet synced'
                  )}
                </div>
                <button
                  onClick={handleSyncNow}
                  disabled={syncing || sync.status === 'syncing'}
                  className="flex items-center gap-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-all"
                >
                  {syncing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
