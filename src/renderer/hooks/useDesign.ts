import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export type DesignVariant = 'classic' | 'modern';

export function useDesign() {
  const settings = useSettingsStore(s => s.settings);
  const setSetting = useSettingsStore(s => s.setSetting);

  const designVariant = (settings['app.designVariant'] as DesignVariant) || 'classic';

  useEffect(() => {
    // Remove existing design classes/attributes
    document.documentElement.classList.remove('design-classic', 'design-modern');
    document.documentElement.setAttribute('data-design', designVariant);
    
    // Add specific class for easier CSS targeting
    document.documentElement.classList.add(`design-${designVariant}`);
  }, [designVariant]);

  const setDesign = (variant: DesignVariant) => {
    setSetting('app.designVariant', variant);
  };

  return { designVariant, setDesign };
}
