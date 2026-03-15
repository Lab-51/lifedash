// === FILE PURPOSE ===
// Notification preferences section for the Settings page.
// Allows users to toggle notification types, configure daily digest time,
// and send a test notification.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge)

import { useEffect, useState, useCallback } from 'react';
import { Bell, Loader2, Clock } from 'lucide-react';
import type { NotificationPreferences } from '../../../shared/types';
import HudSelect from '../HudSelect';

/** Map hour (0-23) to a human-readable 12-hour time string */
function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

export default function NotificationSection() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const loadPreferences = useCallback(async () => {
    try {
      const prefs = await window.electronAPI.notificationGetPreferences();
      setPreferences(prefs);
    } catch (err) {
      console.error('Failed to load notification preferences:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const updatePreference = async (update: Partial<NotificationPreferences>) => {
    if (!preferences) return;

    // Optimistic update
    const updated = { ...preferences, ...update };
    setPreferences(updated);

    try {
      await window.electronAPI.notificationUpdatePreferences(update);
    } catch (err) {
      console.error('Failed to update notification preferences:', err);
      // Revert on failure
      setPreferences(preferences);
    }
  };

  const handleTestNotification = async () => {
    setTesting(true);
    try {
      await window.electronAPI.notificationSendTest();
    } catch (err) {
      console.error('Failed to send test notification:', err);
    } finally {
      setTimeout(() => setTesting(false), 1500);
    }
  };

  if (loading || !preferences) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Notifications</h2>
        </div>
        <div className="flex items-center justify-center py-6 text-surface-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-primary-400" />
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Notifications</h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Configure desktop notifications for reminders and daily summaries.
        </p>
      </div>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Master toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={preferences.enabled}
            onChange={(e) => updatePreference({ enabled: e.target.checked })}
            className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
          />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Enable notifications</span>
        </label>

        {preferences.enabled && (
          <div className="space-y-4 pl-6 border-l border-[var(--color-border)] ml-2">
            {/* Due date reminders */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences.dueDateReminders}
                  onChange={(e) => updatePreference({ dueDateReminders: e.target.checked })}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
                />
                <span className="text-sm text-[var(--color-text-secondary)]">Due date reminders</span>
              </label>
              <p className="text-xs text-surface-500 mt-1 ml-6">Notify when cards are due within 24 hours</p>
            </div>

            {/* Daily digest */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences.dailyDigest}
                  onChange={(e) => updatePreference({ dailyDigest: e.target.checked })}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
                />
                <span className="text-sm text-[var(--color-text-secondary)]">Daily digest</span>
              </label>
              <p className="text-xs text-surface-500 mt-1 ml-6">Receive a morning summary of tasks and meetings</p>

              {preferences.dailyDigest && (
                <div className="flex items-center gap-3 mt-2 ml-6">
                  <label className="text-xs text-surface-400">Time</label>
                  <HudSelect
                    value={String(preferences.dailyDigestHour)}
                    onChange={(v) => updatePreference({ dailyDigestHour: parseInt(v, 10) })}
                    icon={Clock}
                    options={Array.from({ length: 24 }, (_, i) => ({
                      value: String(i),
                      label: formatHour(i),
                    }))}
                  />
                </div>
              )}
            </div>

            {/* Recording reminders */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences.recordingReminders}
                  onChange={(e) => updatePreference({ recordingReminders: e.target.checked })}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
                />
                <span className="text-sm text-[var(--color-text-secondary)]">Recording reminders</span>
              </label>
              <p className="text-xs text-surface-500 mt-1 ml-6">Remind to start recording for upcoming meetings</p>
            </div>
          </div>
        )}

        {/* Test button */}
        <div className="pt-2 border-t border-[var(--color-border)]">
          <button
            onClick={handleTestNotification}
            disabled={testing || !preferences.enabled}
            className="flex items-center gap-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-all"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
            {testing ? 'Sent!' : 'Send Test Notification'}
          </button>
        </div>
      </div>
    </section>
  );
}
