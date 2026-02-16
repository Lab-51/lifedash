// === FILE PURPOSE ===
// Settings Page
// Dynamically renders either the Classic or Modern settings view based on user preference.

import { useDesign } from '../hooks/useDesign';
import SettingsPageClassic from '../components/SettingsPageClassic';
import SettingsPageModern from '../components/SettingsPageModern';

function SettingsPage() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <SettingsPageModern />;
  }

  return <SettingsPageClassic />;
}

export default SettingsPage;
