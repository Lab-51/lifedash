// @vitest-environment jsdom
// AUDIO-DEVICE.1: the "Voice processing" toggle persists audio:micProcessing as
// 'off' / 'on' (unset reads as on), which the next recording's mic open uses.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../../../services/audioCaptureService', () => ({
  enumerateAudioDevices: vi.fn().mockResolvedValue([]),
}));

const getSetting = vi.fn();
const setSetting = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('electronAPI', { getSetting, setSetting, deleteSetting: vi.fn() });
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
});

const { default: AudioDeviceSection } = await import('../AudioDeviceSection');

describe('AudioDeviceSection — voice processing toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSetting.mockResolvedValue(undefined);
  });

  it('shows processing on when unset, and writes "off" then "on" as it is toggled', async () => {
    getSetting.mockResolvedValue(null);
    render(<AudioDeviceSection />);

    const toggle = await screen.findByLabelText('Voice processing');
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/Bluetooth headset drops during recordings/);

    fireEvent.click(toggle);
    await waitFor(() => expect(setSetting).toHaveBeenLastCalledWith('audio:micProcessing', 'off'));
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() => expect(setSetting).toHaveBeenLastCalledWith('audio:micProcessing', 'on'));
    expect(toggle).toBeChecked();
  });
});
