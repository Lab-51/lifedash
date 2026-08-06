// @vitest-environment jsdom
// MEET-DEL.1 Task 2: SessionsHome's impact-aware delete confirm.
// Covers: the dialog opens immediately with a skeleton (never blocked on the
// meetings:get-delete-impact query), non-zero impact lines render from the
// resolved IPC data, a zero-impact meeting falls back to today's plain
// message unchanged, the keep-facts checkbox defaults unchecked and its state
// actually reaches the deleteMeeting call (not just the checkbox's DOM
// state), and the fact-label preview caps at 8 with an honest "and N more".
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { MeetingDeleteImpact } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
const deleteMeeting = vi.fn().mockResolvedValue(undefined);
const getMeetingDeleteImpact = vi.fn();

vi.stubGlobal('electronAPI', {
  hasWhisperModel: vi.fn().mockResolvedValue(true),
  onTranscriptSegment: vi.fn().mockReturnValue(() => {}),
  onWhisperDownloadProgress: vi.fn().mockReturnValue(() => {}),
  downloadWhisperModel: vi.fn().mockResolvedValue(undefined),
  getMeetings: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  getMeeting: vi.fn().mockResolvedValue(null),
  deleteMeeting,
  getMeetingDeleteImpact,
  getActionItemCounts: vi.fn().mockResolvedValue({}),
  transcriptionGetConfig: vi.fn().mockResolvedValue({ type: 'local' }),
  getSetting: vi.fn().mockResolvedValue(null),
  getWhisperModels: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue({ sessions: [], cards: [], projects: [] }),
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { default: SessionsHome } = await import('../SessionsHome');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <SessionsHome />
    </MemoryRouter>,
  );
}

const makeMeeting = (overrides: Record<string, unknown> = {}) => ({
  id: 'meet-1',
  title: 'Weekly Standup',
  template: 'standup',
  startedAt: '2026-03-10T10:00:00Z',
  endedAt: '2026-03-10T10:30:00Z',
  createdAt: '2026-03-10T10:00:00Z',
  updatedAt: '2026-03-10T10:30:00Z',
  projectId: null,
  ...overrides,
});

const ZERO_IMPACT: MeetingDeleteImpact = {
  factCount: 0,
  factLabels: [],
  audioBytes: 0,
  hasBrief: false,
  transcriptSegmentCount: 0,
};

/** Clicks the meeting card's delete action and waits for the dialog to open. */
async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle('Delete meeting'));
  expect(await screen.findByText('Delete Meeting')).toBeInTheDocument();
}

describe('SessionsHome — delete impact dialog (MEET-DEL.1 Task 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMeeting.mockResolvedValue(undefined);
    getMeetingDeleteImpact.mockReset();

    useMeetingStore.setState({
      meetings: [makeMeeting()] as any,
      loading: false,
      error: null,
      actionItemCounts: {},
      selectedMeeting: null,
      generatingBrief: false,
      generatingActions: false,
      pendingActionCount: 0,
      loadMeetings: vi.fn().mockResolvedValue(undefined),
      loadMeeting: vi.fn().mockResolvedValue(undefined),
      loadActionItemCounts: vi.fn().mockResolvedValue(undefined),
    } as any);

    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      meetingId: null,
      completedMeetingId: null,
      elapsed: 0,
      lastTranscript: '',
      error: null,
      starting: false,
    });

    useProjectStore.setState({
      projects: [],
      loading: false,
      error: null,
      loadProjects: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('opens immediately with a skeleton and does not block on the impact query', async () => {
    const user = userEvent.setup();
    let resolveImpact!: (value: MeetingDeleteImpact) => void;
    getMeetingDeleteImpact.mockReturnValue(
      new Promise<MeetingDeleteImpact>((resolve) => {
        resolveImpact = resolve;
      }),
    );

    renderComponent();
    await openDeleteConfirm(user);

    // The base message and the skeleton are already visible — nothing waited
    // on the still-pending query.
    expect(screen.getByText('Delete "Weekly Standup"? This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByTestId('delete-impact-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(getMeetingDeleteImpact).toHaveBeenCalledWith('meet-1');

    resolveImpact(ZERO_IMPACT);
    await waitFor(() => expect(screen.queryByTestId('delete-impact-skeleton')).toBeNull());
  });

  it('renders non-zero impact lines from the mocked IPC data, checkbox unchecked by default', async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue({
      factCount: 3,
      factLabels: ['Prefers async standups', 'Owns the Q3 roadmap', 'Based in Prague'],
      audioBytes: 2.5 * 1024 * 1024,
      hasBrief: true,
      transcriptSegmentCount: 42,
    } satisfies MeetingDeleteImpact);

    renderComponent();
    await openDeleteConfirm(user);

    expect(await screen.findByText('3 learned facts')).toBeInTheDocument();
    expect(screen.getByText('recording file (2.5 MB)')).toBeInTheDocument();
    expect(screen.getByText('brief and transcript (42 segments)')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', { name: /Keep what the twin learned/i });
    expect(checkbox).not.toBeChecked();
  });

  it('a meeting with only a brief (no transcript segments) is worded honestly', async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue({
      factCount: 0,
      factLabels: [],
      audioBytes: 0,
      hasBrief: true,
      transcriptSegmentCount: 0,
    } satisfies MeetingDeleteImpact);

    renderComponent();
    await openDeleteConfirm(user);

    expect(await screen.findByText('brief')).toBeInTheDocument();
    expect(screen.queryByText(/transcript/)).toBeNull();
    expect(screen.queryByText(/learned facts/)).toBeNull();
  });

  it('zero-impact meeting renders unchanged: no impact lines, no checkbox — just the plain confirm', async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue(ZERO_IMPACT);

    renderComponent();
    await openDeleteConfirm(user);
    await waitFor(() => expect(screen.queryByTestId('delete-impact-skeleton')).toBeNull());

    // Positively assert the plain message rendered — an absence-only check
    // would pass trivially if the dialog never rendered at all.
    expect(screen.getByText('Delete "Weekly Standup"? This cannot be undone.')).toBeInTheDocument();
    expect(screen.queryByText(/learned facts/)).toBeNull();
    expect(screen.queryByText(/recording file/)).toBeNull();
    expect(screen.queryByText('This also deletes')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('default unchecked state reaches the store/IPC call as keepLearnedFacts: false', async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue({
      factCount: 2,
      factLabels: ['Fact one', 'Fact two'],
      audioBytes: 0,
      hasBrief: false,
      transcriptSegmentCount: 0,
    } satisfies MeetingDeleteImpact);

    renderComponent();
    await openDeleteConfirm(user);
    await screen.findByText('2 learned facts');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteMeeting).toHaveBeenCalledWith('meet-1', { keepLearnedFacts: false });
  });

  it('checking "Keep what the twin learned" passes keepLearnedFacts: true through to the store/IPC call', async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue({
      factCount: 2,
      factLabels: ['Fact one', 'Fact two'],
      audioBytes: 0,
      hasBrief: false,
      transcriptSegmentCount: 0,
    } satisfies MeetingDeleteImpact);

    renderComponent();
    await openDeleteConfirm(user);
    await screen.findByText('2 learned facts');

    const checkbox = screen.getByRole('checkbox', { name: /Keep what the twin learned/i });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteMeeting).toHaveBeenCalledWith('meet-1', { keepLearnedFacts: true });
  });

  it("a zero-impact meeting deletes with no opts at all (today's unchanged behavior)", async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue(ZERO_IMPACT);

    renderComponent();
    await openDeleteConfirm(user);
    await waitFor(() => expect(screen.queryByTestId('delete-impact-skeleton')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteMeeting).toHaveBeenCalledWith('meet-1', undefined);
  });

  it('expandable fact list caps the preview at 8 with an honest "and N more"', async () => {
    const user = userEvent.setup();
    const labels = Array.from({ length: 8 }, (_, i) => `Fact number ${i + 1}`);
    getMeetingDeleteImpact.mockResolvedValue({
      factCount: 11,
      factLabels: labels,
      audioBytes: 0,
      hasBrief: false,
      transcriptSegmentCount: 0,
    } satisfies MeetingDeleteImpact);

    renderComponent();
    await openDeleteConfirm(user);

    const toggle = await screen.findByText('11 learned facts');
    // Labels are collapsed until the row is expanded.
    expect(screen.queryByText(labels[0])).toBeNull();

    await user.click(toggle);

    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });

  it('cancel closes the dialog without calling deleteMeeting', async () => {
    const user = userEvent.setup();
    getMeetingDeleteImpact.mockResolvedValue(ZERO_IMPACT);

    renderComponent();
    await openDeleteConfirm(user);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete Meeting')).toBeNull();
    expect(deleteMeeting).not.toHaveBeenCalled();
  });
});
