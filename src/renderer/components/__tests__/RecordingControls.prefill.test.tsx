// @vitest-environment jsdom
// Phase G Task 4: RecordingControls calendar prefill. Seeds the title from the event,
// preselects the suggested project (only if the user hasn't chosen), and threads the
// calendar ids through startRecording. The absent-prop path must be unchanged.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { CalendarEvent } from '../../../shared/types/calendar';

vi.mock('../AudioLevelMeter', () => ({ default: () => <div data-testid="audio-level-meter" /> }));

const suggestCalendarProject = vi.fn().mockResolvedValue(null);
vi.stubGlobal('electronAPI', {
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  whisperGetActiveModel: vi.fn().mockResolvedValue(null),
  transcriptionGetConfig: vi.fn().mockResolvedValue({ type: 'local' }),
  getProjectsWithRecency: vi.fn().mockResolvedValue([]),
  suggestCalendarProject,
});

const { useRecordingStore } = await import('../../stores/recordingStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { default: RecordingControls } = await import('../RecordingControls');

const event: CalendarEvent = {
  id: 'google:evt-1',
  provider: 'google',
  eventId: 'evt-1',
  title: 'Quarterly Review',
  startsAt: '2026-07-31T10:00:00Z',
  endsAt: '2026-07-31T10:30:00Z',
  attendees: [],
  seriesId: 'series-9',
};

describe('RecordingControls — calendar prefill (Phase G Task 4)', () => {
  let startRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    startRecording = vi.fn().mockResolvedValue(undefined);
    useMeetingStore.setState({ meetings: [] } as never);
    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      starting: false,
      error: null,
      includeMic: true,
      startRecording,
    } as never);
  });

  it('seeds the title input from the event title', async () => {
    render(<RecordingControls initialCalendarEvent={event} />);
    await waitFor(() => expect(screen.getByPlaceholderText('Meeting title...')).toHaveValue('Quarterly Review'));
  });

  it('threads calendarEventId + calendarSeriesId through startRecording', async () => {
    const user = userEvent.setup();
    render(<RecordingControls initialCalendarEvent={event} />);
    await waitFor(() => expect(screen.getByPlaceholderText('Meeting title...')).toHaveValue('Quarterly Review'));

    await user.click(screen.getByRole('button', { name: /Start Recording/i }));

    expect(startRecording).toHaveBeenCalledWith(
      'Quarterly Review',
      undefined,
      'none',
      'en',
      'google:evt-1',
      'series-9',
    );
  });

  it('asks for a project suggestion using the series + event ids', async () => {
    render(<RecordingControls initialCalendarEvent={event} />);
    await waitFor(() =>
      expect(suggestCalendarProject).toHaveBeenCalledWith({ seriesId: 'series-9', eventId: 'evt-1' }),
    );
  });

  it('absent prop: does not seed calendar ids into startRecording (regression)', async () => {
    const user = userEvent.setup();
    render(<RecordingControls />);
    const input = screen.getByPlaceholderText('Meeting title...');
    await user.clear(input);
    await user.type(input, 'Ad-hoc chat');

    await user.click(screen.getByRole('button', { name: /Start Recording/i }));

    expect(startRecording).toHaveBeenCalledWith('Ad-hoc chat', undefined, 'none', 'en', undefined, undefined);
    expect(suggestCalendarProject).not.toHaveBeenCalled();
  });
});
