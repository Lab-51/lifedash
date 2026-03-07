import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export type FontScale = '14' | '16' | '18' | '20';

export function useFontScale() {
  const settings = useSettingsStore(s => s.settings);
  const setSetting = useSettingsStore(s => s.setSetting);

  const fontScale = (settings['app.fontScale'] as FontScale) || '16';

  useEffect(() => {
    if (fontScale === '16') {
      document.documentElement.style.removeProperty('font-size');
    } else {
      document.documentElement.style.fontSize = `${fontScale}px`;
    }
  }, [fontScale]);

  const setFontScale = (scale: FontScale) => {
    setSetting('app.fontScale', scale);
  };

  return { fontScale, setFontScale };
}
