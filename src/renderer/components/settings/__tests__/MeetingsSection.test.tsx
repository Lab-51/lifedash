// @vitest-environment jsdom
// GUARD.1 Task 2: MeetingsSection persists the inactivity auto-stop toggle
// (recording:autoStopEnabled) and threshold (recording:autoStopMinutes), on top
// of the pre-existing meetings:autoPushEnabled toggle.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const getSetting = vi.fn();
const setSetting = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('electronAPI', { getSetting, setSetting });

const { default: MeetingsSection } = await import('../MeetingsSection');

describe('MeetingsSection — inactivity auto-stop settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSetting.mockResolvedValue(undefined);
  });

  it('defaults to enabled + 10 minutes when the keys were never written', async () => {
    getSetting.mockResolvedValue(null);
    render(<MeetingsSection />);

    const checkbox = await screen.findByLabelText('Auto-stop recording when no audio is detected');
    expect(checkbox).toBeChecked();
    expect(screen.getByLabelText('Minutes of silence before auto-stop')).toHaveValue(10);
  });

  it('loads a previously saved disabled state and custom threshold', async () => {
    getSetting.mockImplementation((key: string) => {
      if (key === 'recording:autoStopEnabled') return Promise.resolve('false');
      if (key === 'recording:autoStopMinutes') return Promise.resolve('25');
      return Promise.resolve(null);
    });
    render(<MeetingsSection />);

    const checkbox = await screen.findByLabelText('Auto-stop recording when no audio is detected');
    expect(checkbox).not.toBeChecked();
    expect(screen.getByLabelText('Minutes of silence before auto-stop')).toBeDisabled();
    expect(screen.getByLabelText('Minutes of silence before auto-stop')).toHaveValue(25);
  });

  it('persists the checkbox key on toggle', async () => {
    getSetting.mockResolvedValue(null);
    render(<MeetingsSection />);

    const checkbox = await screen.findByLabelText('Auto-stop recording when no audio is detected');
    fireEvent.click(checkbox);

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('recording:autoStopEnabled', 'false'));
  });

  it('persists the minutes key on a valid in-range change', async () => {
    getSetting.mockResolvedValue(null);
    render(<MeetingsSection />);

    const minutesInput = await screen.findByLabelText('Minutes of silence before auto-stop');
    fireEvent.change(minutesInput, { target: { value: '30' } });

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('recording:autoStopMinutes', '30'));
  });

  it('ignores an out-of-range minutes value (no persist, no state change)', async () => {
    getSetting.mockResolvedValue(null);
    render(<MeetingsSection />);

    const minutesInput = await screen.findByLabelText('Minutes of silence before auto-stop');
    fireEvent.change(minutesInput, { target: { value: '1' } }); // below AUTO_STOP_MINUTES_MIN (2)

    expect(setSetting).not.toHaveBeenCalledWith('recording:autoStopMinutes', expect.anything());
    expect(minutesInput).toHaveValue(10);
  });
});
