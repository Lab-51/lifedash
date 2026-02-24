// === FILE PURPOSE ===
// Audio device selection section for the Settings page.
// Enumerates available audio input devices (microphones) and lets the user
// choose which one to use for recording. Selection is persisted to the
// settings key-value store.
//
// === DEPENDENCIES ===
// React, lucide-react icons, audioCaptureService (enumerateAudioDevices)

import { useEffect, useState, useCallback } from 'react';
import { Headphones, Loader2, RefreshCw } from 'lucide-react';
import { enumerateAudioDevices, type AudioDeviceInfo } from '../../services/audioCaptureService';

/** Settings keys used for audio device configuration */
const SETTINGS_KEY_MIC = 'audio:inputDeviceId';

export default function AudioDeviceSection() {
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const allDevices = await enumerateAudioDevices();
      setDevices(allDevices);
    } catch (err) {
      console.error('Failed to enumerate audio devices:', err);
    }
  }, []);

  const loadSavedDevice = useCallback(async () => {
    try {
      const savedMic = await window.electronAPI.getSetting(SETTINGS_KEY_MIC);
      if (savedMic) setSelectedMicId(savedMic);
    } catch (err) {
      console.error('Failed to load saved audio device:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadDevices(), loadSavedDevice()]).finally(() => setLoading(false));
  }, [loadDevices, loadSavedDevice]);

  // Listen for device changes (plugging in/out headsets)
  useEffect(() => {
    const handler = () => { loadDevices(); };
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [loadDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDevices();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleMicChange = async (deviceId: string) => {
    setSelectedMicId(deviceId);
    try {
      if (deviceId) {
        await window.electronAPI.setSetting(SETTINGS_KEY_MIC, deviceId);
      } else {
        await window.electronAPI.deleteSetting(SETTINGS_KEY_MIC);
      }
    } catch (err) {
      console.error('Failed to save audio device setting:', err);
    }
  };

  const inputDevices = devices.filter((d) => d.kind === 'audioinput');

  if (loading) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Audio Devices</h2>
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
          <Headphones size={18} className="text-primary-400" />
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Audio Devices</h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Select which microphone to use for meeting recordings.
        </p>
      </div>

      <div className="p-4 hud-panel clip-corner-cut-sm space-y-4">
        {/* Microphone selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              Microphone Input
            </label>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
              title="Refresh device list"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <select
            value={selectedMicId}
            onChange={(e) => handleMicChange(e.target.value)}
            className="w-full"
          >
            <option value="">System Default</option>
            {inputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>

          <p className="text-xs text-surface-500 mt-2">
            {inputDevices.length === 0
              ? 'No microphones detected. Check your audio connections.'
              : `${inputDevices.length} microphone${inputDevices.length !== 1 ? 's' : ''} available. Choose "System Default" to use the OS default device.`}
          </p>
        </div>

        {/* System audio info */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-surface-500">
            System audio (what you hear) is captured automatically via the operating system.
            No configuration needed.
          </p>
        </div>
      </div>
    </section>
  );
}
