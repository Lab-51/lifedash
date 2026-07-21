// === FILE PURPOSE ===
// Meetings settings section for the Settings page (General tab).
// Exposes the global auto-push toggle so users can disable automatic
// card creation after recordings finish, plus the GUARD.1 inactivity
// auto-stop toggle + threshold that gate the recording auto-stop guard.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge), SETTINGS_KEY_AUTO_PUSH
// constant, shared recording auto-stop setting keys/clamp helper.

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import {
  SETTING_AUTO_STOP_ENABLED,
  SETTING_AUTO_STOP_MINUTES,
  DEFAULT_AUTO_STOP_MINUTES,
  AUTO_STOP_MINUTES_MIN,
  AUTO_STOP_MINUTES_MAX,
  clampAutoStopMinutes,
} from '../../../shared/types/recording';

const SETTINGS_KEY_AUTO_PUSH = 'meetings:autoPushEnabled';

export default function MeetingsSection() {
  const [autoPushEnabled, setAutoPushEnabled] = useState<boolean | null>(null);
  const [autoStopEnabled, setAutoStopEnabled] = useState<boolean | null>(null);
  const [autoStopMinutes, setAutoStopMinutes] = useState<number>(DEFAULT_AUTO_STOP_MINUTES);
  const [loading, setLoading] = useState(true);

  const loadSetting = useCallback(async () => {
    try {
      const [rawPush, rawStopEnabled, rawStopMinutes] = await Promise.all([
        window.electronAPI.getSetting(SETTINGS_KEY_AUTO_PUSH),
        window.electronAPI.getSetting(SETTING_AUTO_STOP_ENABLED),
        window.electronAPI.getSetting(SETTING_AUTO_STOP_MINUTES),
      ]);
      // null or undefined means the key was never written — default is true
      setAutoPushEnabled(rawPush !== 'false');
      setAutoStopEnabled(rawStopEnabled !== 'false');
      setAutoStopMinutes(clampAutoStopMinutes(parseInt(rawStopMinutes ?? '', 10)));
    } catch (err) {
      console.error('Failed to load meetings settings:', err);
      setAutoPushEnabled(true);
      setAutoStopEnabled(true);
      setAutoStopMinutes(DEFAULT_AUTO_STOP_MINUTES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSetting();
  }, [loadSetting]);

  const handleToggle = async (checked: boolean) => {
    // Optimistic update
    setAutoPushEnabled(checked);
    try {
      await window.electronAPI.setSetting(SETTINGS_KEY_AUTO_PUSH, checked ? 'true' : 'false');
    } catch (err) {
      console.error('Failed to save meetings:autoPushEnabled setting:', err);
      // Revert on failure
      setAutoPushEnabled(!checked);
    }
  };

  const handleAutoStopToggle = async (checked: boolean) => {
    // Optimistic update (mirrors handleToggle above)
    setAutoStopEnabled(checked);
    try {
      await window.electronAPI.setSetting(SETTING_AUTO_STOP_ENABLED, checked ? 'true' : 'false');
    } catch (err) {
      console.error('Failed to save recording:autoStopEnabled setting:', err);
      // Revert on failure
      setAutoStopEnabled(!checked);
    }
  };

  const handleAutoStopMinutesChange = async (raw: string) => {
    const value = parseInt(raw, 10);
    // Ignore out-of-range/invalid keystrokes rather than clamping mid-typing —
    // the input's min/max already constrain what most browsers will submit.
    if (!Number.isFinite(value) || value < AUTO_STOP_MINUTES_MIN || value > AUTO_STOP_MINUTES_MAX) return;
    const previous = autoStopMinutes;
    setAutoStopMinutes(value);
    try {
      await window.electronAPI.setSetting(SETTING_AUTO_STOP_MINUTES, String(clampAutoStopMinutes(value)));
    } catch (err) {
      console.error('Failed to save recording:autoStopMinutes setting:', err);
      setAutoStopMinutes(previous);
    }
  };

  if (loading || autoPushEnabled === null || autoStopEnabled === null) {
    return (
      <div className="flex items-center justify-center py-4 text-surface-500">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto-push toggle */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={autoPushEnabled}
          onChange={(e) => handleToggle(e.target.checked)}
          aria-label="Auto-push action items to Inbox"
          className="mt-0.5 w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0 shrink-0"
        />
        <div>
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Auto-push action items</span>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            When a recording finishes, extracted action items are automatically added as cards to the project's Inbox
            column. You can reject any card you don't want.
          </p>
        </div>
      </label>
      {!autoPushEnabled && (
        <p className="text-xs text-amber-400/80 pl-7">
          Auto-push is off. Use the Approve button inside each meeting to manually push action items as cards.
        </p>
      )}

      {/* Inactivity auto-stop toggle (GUARD.1) */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={autoStopEnabled}
          onChange={(e) => handleAutoStopToggle(e.target.checked)}
          aria-label="Auto-stop recording when no audio is detected"
          className="mt-0.5 w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0 shrink-0"
        />
        <div>
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            Auto-stop recording when no audio is detected
          </span>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Warns you first, then automatically stops and saves the recording after a period of silence.
          </p>
        </div>
      </label>
      <div className="flex items-center gap-2 pl-7 text-xs text-[var(--color-text-secondary)]">
        <span className={autoStopEnabled ? '' : 'opacity-50'}>after</span>
        <input
          type="number"
          min={AUTO_STOP_MINUTES_MIN}
          max={AUTO_STOP_MINUTES_MAX}
          value={autoStopMinutes}
          disabled={!autoStopEnabled}
          onChange={(e) => handleAutoStopMinutesChange(e.target.value)}
          aria-label="Minutes of silence before auto-stop"
          className="w-14 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-1
                   text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)]
                   disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className={autoStopEnabled ? '' : 'opacity-50'}>minutes of silence</span>
      </div>
    </div>
  );
}
