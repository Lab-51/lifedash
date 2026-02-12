// === FILE PURPOSE ===
// Placeholder page for the Settings view.
// Will be replaced with configuration panels (AI providers, audio, etc.) in a later phase.

// === DEPENDENCIES ===
// lucide-react (Settings icon)

import { Settings } from 'lucide-react';

function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-surface-100">Settings</h1>
      <p className="mt-1 text-surface-400">
        Configure your dashboard preferences.
      </p>

      <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
        <Settings size={48} className="mb-4 text-surface-600" />
        <p className="text-lg">App configuration will appear here</p>
      </div>
    </div>
  );
}

export default SettingsPage;
