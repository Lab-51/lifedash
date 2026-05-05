// === FILE PURPOSE ===
// Meetings settings section for the Settings page (General tab).
// Exposes the global auto-push toggle so users can disable automatic
// card creation after recordings finish.
//
// === DEPENDENCIES ===
// React, lucide-react icons, electronAPI (preload bridge), SETTINGS_KEY_AUTO_PUSH constant

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

const SETTINGS_KEY_AUTO_PUSH = 'meetings:autoPushEnabled';

export default function MeetingsSection() {
  const [autoPushEnabled, setAutoPushEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSetting = useCallback(async () => {
    try {
      const raw = await window.electronAPI.getSetting(SETTINGS_KEY_AUTO_PUSH);
      // null or undefined means the key was never written — default is true
      setAutoPushEnabled(raw !== 'false');
    } catch (err) {
      console.error('Failed to load meetings:autoPushEnabled setting:', err);
      setAutoPushEnabled(true);
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

  if (loading || autoPushEnabled === null) {
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
    </div>
  );
}
