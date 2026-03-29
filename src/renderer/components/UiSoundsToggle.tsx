// === FILE PURPOSE ===
// Compact toggle for enabling/disabling UI sounds.
// Reads and writes 'app.uiSounds' via settingsStore. Default: enabled (true).

import { Volume2, VolumeX } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';

export default function UiSoundsToggle() {
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const enabled = (settings['app.uiSounds'] ?? 'true') === 'true';

  const toggle = () => {
    setSetting('app.uiSounds', enabled ? 'false' : 'true');
  };

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all ${
        enabled
          ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)]'
      }`}
    >
      {enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
      {enabled ? 'On' : 'Off'}
    </button>
  );
}
