// @vitest-environment jsdom
// MeetingAnalyticsSection (SPEAKER.1 Task 4): the "Identify Speakers" trigger no
// longer disappears once labels exist — a bad diarization pass has to be
// re-runnable — and a re-run is confirmed, because it overwrites transcript
// labels (including two-channel `Me` labels) while leaving the user's name map
// alone. The breakdown shows the mapped NAME but stays coloured and keyed by the
// raw LABEL, so renaming can never recolour or re-bucket a speaker.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import MeetingAnalyticsSection, { getSpeakerColor } from '../MeetingAnalyticsSection';
import { useMeetingStore } from '../../stores/meetingStore';
import type { MeetingAnalytics, MeetingWithTranscript } from '../../../shared/types';

const MEETING_ID = 'meeting-1';

// The "Resolve Names" trigger goes through the REAL store action on purpose —
// the point of these tests is that the meeting:resolve-speaker-names IPC has a
// production caller at all, so only the preload boundary is stubbed.
const resolveSpeakerNamesIpc = vi.fn();
vi.stubGlobal('electronAPI', { resolveSpeakerNames: resolveSpeakerNamesIpc });

function makeAnalytics(overrides: Partial<MeetingAnalytics> = {}): MeetingAnalytics {
  return {
    durationMs: 600_000,
    totalSegments: 12,
    totalWords: 900,
    wordsPerMinute: 90,
    hasDiarization: true,
    speakers: [
      { speaker: 'Speaker 2', talkTimeMs: 300_000, talkTimePercent: 50, wordCount: 450 },
      { speaker: 'Me', talkTimeMs: 300_000, talkTimePercent: 50, wordCount: 450 },
    ],
    actionItemCounts: { total: 0, pending: 0, approved: 0, dismissed: 0, converted: 0 },
    ...overrides,
  } as MeetingAnalytics;
}

const diarizeMeeting = vi.fn();

function setup(analytics: MeetingAnalytics, speakerNames?: Record<string, string>) {
  useMeetingStore.setState({
    analytics,
    analyticsLoading: false,
    diarizing: false,
    diarizationError: null,
    loadAnalytics: vi.fn(),
    diarizeMeeting,
  });
  return render(<MeetingAnalyticsSection meetingId={MEETING_ID} isCompleted speakerNames={speakerNames} />);
}

beforeEach(() => {
  diarizeMeeting.mockReset();
  resolveSpeakerNamesIpc.mockReset();
  useMeetingStore.setState({ selectedMeeting: null });
});

describe('MeetingAnalyticsSection — the Identify Speakers trigger', () => {
  it('runs straight away when there are no labels yet', () => {
    setup(makeAnalytics({ hasDiarization: false, speakers: [] }));

    fireEvent.click(screen.getByRole('button', { name: 'Identify Speakers' }));

    expect(diarizeMeeting).toHaveBeenCalledWith(MEETING_ID);
    expect(screen.queryByText('Re-run speaker identification?')).not.toBeInTheDocument();
  });

  it('stays available once labels exist, and confirms before overwriting them', () => {
    setup(makeAnalytics());

    // The regression this fixes: the button used to vanish the moment any label existed.
    fireEvent.click(screen.getByRole('button', { name: 'Identify Speakers' }));
    expect(diarizeMeeting).not.toHaveBeenCalled();

    // The confirm has to be honest about BOTH halves of what a re-run does.
    expect(screen.getByText('Re-run speaker identification?')).toBeInTheDocument();
    expect(screen.getByText(/existing speaker labels are overwritten/)).toBeInTheDocument();
    expect(screen.getByText(/including the "Me" labels from two-channel recording/)).toBeInTheDocument();
    expect(screen.getByText(/names you gave speakers are NOT overwritten/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(diarizeMeeting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Identify Speakers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Re-identify' }));
    expect(diarizeMeeting).toHaveBeenCalledWith(MEETING_ID);
  });
});

describe('MeetingAnalyticsSection — the Resolve Names trigger', () => {
  const clickResolve = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve Names' }));
    });
  };

  it('calls the resolve IPC and refreshes the meeting with the names it got back', async () => {
    resolveSpeakerNamesIpc.mockResolvedValue({ 'Speaker 2': 'Marta Vance' });
    useMeetingStore.setState({ selectedMeeting: { id: MEETING_ID } as MeetingWithTranscript });
    setup(makeAnalytics());

    await clickResolve();

    expect(resolveSpeakerNamesIpc).toHaveBeenCalledWith(MEETING_ID);
    // The refresh is what makes a resolved name actually render: the host reads
    // speakerNames off selectedMeeting.
    expect(useMeetingStore.getState().selectedMeeting?.speakerNames).toEqual({ 'Speaker 2': 'Marta Vance' });
    expect(screen.queryByText('No names resolved')).not.toBeInTheDocument();
  });

  it('degrades to "no names resolved" when nothing resolves AND when the call fails', async () => {
    resolveSpeakerNamesIpc.mockResolvedValue({});
    setup(makeAnalytics());
    await clickResolve();
    expect(screen.getByText('No names resolved')).toBeInTheDocument();

    // A failed resolution is the same outcome as an empty one, and must never
    // throw into the meeting view (AI-RESIL.1).
    resolveSpeakerNamesIpc.mockRejectedValue(new Error('provider unreachable'));
    await clickResolve();
    expect(screen.getByText('No names resolved')).toBeInTheDocument();
    expect(screen.getByText('Speaker Breakdown')).toBeInTheDocument();
  });

  it('is not offered when the transcript has no speaker labels to resolve', () => {
    setup(makeAnalytics({ hasDiarization: false, speakers: [] }));

    expect(screen.queryByRole('button', { name: 'Resolve Names' })).not.toBeInTheDocument();
    // ...while its sibling, which CREATES the labels, still is.
    expect(screen.getByRole('button', { name: 'Identify Speakers' })).toBeInTheDocument();
  });
});

describe('MeetingAnalyticsSection — the speaker breakdown', () => {
  it('shows the mapped name while keeping the LABEL-keyed colour', () => {
    setup(makeAnalytics(), { 'Speaker 2': 'Marta Vance' });

    const named = screen.getByText('Marta Vance');
    expect(screen.queryByText('Speaker 2')).not.toBeInTheDocument();
    // Renaming must not recolour: the chip still carries the colour the LABEL hashes to.
    expect(named.className).toContain(getSpeakerColor('Speaker 2').text);
    expect(named.className).not.toContain(getSpeakerColor('Marta Vance').text);
    // An unmapped label falls back to itself.
    expect(screen.getByText('Me')).toBeInTheDocument();
  });
});
