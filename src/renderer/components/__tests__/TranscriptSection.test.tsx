// @vitest-environment jsdom
// BRAIN-UX.1 Task 5 — the transcript is reference material, so the section is
// collapsed by default and its controls/segments only exist while open. A
// deep link that passes `initialSearch` must open it (search results can never
// land on a closed panel), and the prose reads in the app's body font with
// font-data left on the timestamp column only.
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import TranscriptSection from '../meeting-detail/TranscriptSection';
import type { MeetingWithTranscript, TranscriptSegment } from '../../../shared/types';

function makeSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'seg-1',
    meetingId: 'meet-1',
    content: 'We agreed to ship the beta on Friday',
    startTime: 0,
    endTime: 4000,
    speaker: null,
    createdAt: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

function makeMeeting(segments: TranscriptSegment[], speakerNames?: Record<string, string>): MeetingWithTranscript {
  return {
    id: 'meet-1',
    projectId: null,
    title: 'Weekly Standup',
    template: 'none',
    startedAt: '2026-03-10T10:00:00Z',
    endedAt: '2026-03-10T10:30:00Z',
    audioPath: null,
    status: 'completed',
    prepBriefing: null,
    transcriptionLanguage: null,
    unassignedPending: false,
    participants: null,
    speakerNames: speakerNames ?? null,
    createdAt: '2026-03-10T10:00:00Z',
    segments,
    brief: null,
    actionItems: [],
  };
}

const SEGMENTS = [
  makeSegment({ id: 'seg-1', content: 'We agreed to ship the beta on Friday' }),
  makeSegment({ id: 'seg-2', content: 'Pricing is still open', startTime: 65000, endTime: 68000 }),
];

function renderSection(
  props: {
    initialSearch?: string;
    segments?: TranscriptSegment[];
    speakerNames?: Record<string, string>;
    onRenameSpeaker?: (label: string, name: string | null) => void;
  } = {},
) {
  return render(
    <TranscriptSection
      meeting={makeMeeting(props.segments ?? SEGMENTS, props.speakerNames)}
      transcriptEndRef={createRef<HTMLDivElement>()}
      initialSearch={props.initialSearch}
      onCopySummary={vi.fn()}
      onCopyActions={vi.fn()}
      copiedField={null}
      onCopy={vi.fn()}
      onRenameSpeaker={props.onRenameSpeaker}
    />,
  );
}

/** The header toggle — the only button carrying aria-expanded (the copy button
 * for the transcript is also named "Transcript"). */
const toggle = () => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded'))!;

describe('TranscriptSection', () => {
  it('is collapsed by default — no segments, search, or copy controls', () => {
    renderSection();

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/2 segments/)).toBeInTheDocument();
    expect(screen.queryByText('We agreed to ship the beta on Friday')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Transcript')).not.toBeInTheDocument();
  });

  it('opens and closes again when the header toggle is clicked', () => {
    renderSection();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('We agreed to ship the beta on Friday')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    expect(screen.getByTitle('Transcript')).toBeInTheDocument();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('We agreed to ship the beta on Friday')).not.toBeInTheDocument();
  });

  it('auto-expands and applies the query when a search deep-link passes initialSearch', () => {
    renderSection({ initialSearch: 'pricing' });

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('Search...')).toHaveValue('pricing');
    // Filtered to the matching segment, with the count reflecting the filter.
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    expect(screen.queryByText('We agreed to ship the beta on Friday')).not.toBeInTheDocument();
  });

  it('renders prose in the body font, leaving font-data on the timestamp column only', () => {
    const { container } = renderSection();
    fireEvent.click(toggle());

    const segmentList = container.querySelector('.max-h-80');
    expect(segmentList).not.toBeNull();
    expect(segmentList!.className).toContain('font-sans');
    expect(segmentList!.className).not.toContain('font-data');

    const timestamp = screen.getByText('00:00');
    expect(timestamp.className).toContain('font-data');
    // The prose paragraph itself carries no mono font.
    expect(screen.getByText('We agreed to ship the beta on Friday').className).not.toContain('font-data');
  });

  it('shows the empty-transcript state (only) once opened', () => {
    renderSection({ segments: [] });

    expect(screen.queryByText('No transcript available')).not.toBeInTheDocument();

    fireEvent.click(toggle());

    expect(screen.getByText('No transcript available')).toBeInTheDocument();
  });
});

// === SPEAKER.1 - the speaker chip ===================================================

describe('TranscriptSection - speaker names', () => {
  const LABELLED = [makeSegment({ id: 'seg-1', speaker: 'Speaker 2' })];

  it('shows the mapped NAME, falling back to the raw label', () => {
    renderSection({ segments: LABELLED, speakerNames: { 'Speaker 2': 'Marta Vance' } });
    fireEvent.click(toggle());
    expect(screen.getByText('[Marta Vance]')).toBeInTheDocument();
    expect(screen.queryByText('[Speaker 2]')).not.toBeInTheDocument();

    cleanup();
    renderSection({ segments: LABELLED, speakerNames: { 'Speaker 9': 'Nobody' } });
    fireEvent.click(toggle());
    expect(screen.getByText('[Speaker 2]')).toBeInTheDocument();
  });

  it('renames in place: Enter commits with the RAW label, Escape cancels', () => {
    const onRenameSpeaker = vi.fn();
    renderSection({ segments: LABELLED, speakerNames: { 'Speaker 2': 'Marta Vance' }, onRenameSpeaker });
    fireEvent.click(toggle());

    // Keyboard-reachable: the chip is a real button with an accessible name.
    const chip = screen.getByRole('button', { name: 'Rename speaker Marta Vance' });
    fireEvent.click(chip);

    const input = screen.getByLabelText('Name for speaker Speaker 2');
    fireEvent.change(input, { target: { value: 'Priya Anand' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameSpeaker).not.toHaveBeenCalled();
    expect(screen.getByText('[Marta Vance]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename speaker Marta Vance' }));
    const reopened = screen.getByLabelText('Name for speaker Speaker 2');
    fireEvent.change(reopened, { target: { value: 'Priya Anand' } });
    fireEvent.keyDown(reopened, { key: 'Enter' });
    // The RAW label is what is written, never the display name.
    expect(onRenameSpeaker).toHaveBeenCalledWith('Speaker 2', 'Priya Anand');

    // An emptied field CLEARS the name rather than storing a blank one.
    fireEvent.click(screen.getByRole('button', { name: 'Rename speaker Marta Vance' }));
    const third = screen.getByLabelText('Name for speaker Speaker 2');
    fireEvent.change(third, { target: { value: '  ' } });
    fireEvent.keyDown(third, { key: 'Enter' });
    expect(onRenameSpeaker).toHaveBeenLastCalledWith('Speaker 2', null);
  });

  it('is read-only when the host passes no rename handler', () => {
    renderSection({ segments: LABELLED, speakerNames: { 'Speaker 2': 'Marta Vance' } });
    fireEvent.click(toggle());
    expect(screen.queryByRole('button', { name: /Rename speaker/ })).not.toBeInTheDocument();
    expect(screen.getByText('[Marta Vance]')).toBeInTheDocument();
  });
});
