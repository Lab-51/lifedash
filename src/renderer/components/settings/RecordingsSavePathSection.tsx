// === FILE PURPOSE ===
// Recordings save path section for the Settings page.
// Lets the user choose a custom folder for saving audio recordings.
// Selection is persisted to the settings key-value store.
//
// === DEPENDENCIES ===
// React, lucide-react icons

import { useEffect, useState } from 'react';
import { FolderOpen, Loader2, RotateCcw } from 'lucide-react';

/** Settings key for the recordings save path */
const SETTINGS_KEY = 'recordings:savePath';

export default function RecordingsSavePathSection() {
  const [currentPath, setCurrentPath] = useState('');
  const [defaultPath, setDefaultPath] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [savedPath, defPath] = await Promise.all([
          window.electronAPI.getSetting(SETTINGS_KEY),
          window.electronAPI.getDefaultRecordingsPath(),
        ]);

        setDefaultPath(defPath);

        if (savedPath) {
          setCurrentPath(savedPath);
          setIsCustom(true);
        } else {
          setCurrentPath(defPath);
          setIsCustom(false);
        }
      } catch (err) {
        console.error('Failed to load recordings save path:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const handleBrowse = async () => {
    try {
      const folder = await window.electronAPI.pickRecordingsFolder();
      if (folder) {
        await window.electronAPI.setSetting(SETTINGS_KEY, folder);
        setCurrentPath(folder);
        setIsCustom(true);
      }
    } catch (err) {
      console.error('Failed to set recordings folder:', err);
    }
  };

  const handleReset = async () => {
    try {
      await window.electronAPI.deleteSetting(SETTINGS_KEY);
      setCurrentPath(defaultPath);
      setIsCustom(false);
    } catch (err) {
      console.error('Failed to reset recordings folder:', err);
    }
  };

  if (loading) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-surface-100">Recordings Folder</h2>
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
          <FolderOpen size={18} className="text-primary-400" />
          <h2 className="text-lg font-semibold text-surface-100">Recordings Folder</h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Choose where audio recordings are saved on disk.
        </p>
      </div>

      <div className="p-4 bg-surface-800 border border-surface-700 rounded-lg space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-surface-200">
              Save Location
              {isCustom && (
                <span className="ml-2 text-xs font-normal text-primary-400">(custom)</span>
              )}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm text-surface-300 bg-surface-900 px-3 py-2 rounded border border-surface-700 truncate">
              {currentPath}
            </code>
            <button
              onClick={handleBrowse}
              className="px-3 py-2 text-sm bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors whitespace-nowrap"
            >
              Browse...
            </button>
            {isCustom && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1 px-3 py-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
                title="Reset to default location"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            )}
          </div>

          <p className="text-xs text-surface-500 mt-2">
            Changing this folder only affects new recordings. Existing recordings remain accessible at their original paths.
          </p>
        </div>
      </div>
    </section>
  );
}
