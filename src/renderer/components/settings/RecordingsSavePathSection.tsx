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
const SAVE_RECORDINGS_KEY = 'audio:saveRecordings';

export default function RecordingsSavePathSection() {
  const [currentPath, setCurrentPath] = useState('');
  const [defaultPath, setDefaultPath] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [saveEnabled, setSaveEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [savedPath, defPath, saveRecordings] = await Promise.all([
          window.electronAPI.getSetting(SETTINGS_KEY),
          window.electronAPI.getDefaultRecordingsPath(),
          window.electronAPI.getSetting(SAVE_RECORDINGS_KEY),
        ]);

        setDefaultPath(defPath);
        setSaveEnabled(saveRecordings !== 'false');

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

  const handleToggleSave = async (enabled: boolean) => {
    try {
      await window.electronAPI.setSetting(SAVE_RECORDINGS_KEY, String(enabled));
      setSaveEnabled(enabled);
    } catch (err) {
      console.error('Failed to update save recordings setting:', err);
    }
  };

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
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">
            Recordings Folder
          </h2>
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
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Recordings</h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Configure audio recording storage. Transcripts are always saved regardless of this setting.
        </p>
      </div>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Save audio toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={saveEnabled}
            onChange={(e) => handleToggleSave(e.target.checked)}
            className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
          />
          <div>
            <span className="text-sm font-medium text-[var(--color-text-primary)]">Save audio recordings to disk</span>
            <p className="text-xs text-surface-500 mt-0.5">
              When disabled, only transcripts are kept. Audio files won't be saved, so you won't be able to replay or
              re-transcribe.
            </p>
          </div>
        </label>

        {/* Folder picker — only shown when saving is enabled */}
        {saveEnabled && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                Save Location
                {isCustom && <span className="ml-2 text-xs font-normal text-primary-400">(custom)</span>}
              </label>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-[var(--color-text-secondary)] bg-surface-50 dark:bg-surface-950 px-3 py-2 rounded border border-[var(--color-border)] truncate font-data">
                {currentPath}
              </code>
              <button
                onClick={handleBrowse}
                className="px-3 py-2 text-sm border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all whitespace-nowrap"
              >
                Browse...
              </button>
              {isCustom && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
                  title="Reset to default location"
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
              )}
            </div>

            <p className="text-xs text-surface-500 mt-2">
              Changing this folder only affects new recordings. Existing recordings remain accessible at their original
              paths.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
