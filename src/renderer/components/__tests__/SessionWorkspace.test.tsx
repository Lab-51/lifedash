// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  getMeeting: vi.fn().mockResolvedValue(null),
  getProjects: vi.fn().mockResolvedValue([]),
  getMeetingAnalytics: vi.fn().mockResolvedValue(null),
  listLiveSuggestions: vi.fn().mockResolvedValue([]),
  meetingAgentLoad: vi.fn().mockResolvedValue([]),
  getBoards: vi.fn().mockResolvedValue([]),
  getColumns: vi.fn().mockResolvedValue([]),
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { useSettingsStore } = await import('../../stores/settingsStore');
const { useBoardStore } = await import('../../stores/boardStore');
const { default: SessionWorkspace } = await import('../SessionWorkspace');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeMeeting = (overrides: Record<string, unknown> = {}) => ({
  id: 'meet-1',
  title: 'Weekly Standup',
  template: 'none',
  projectId: null,
  status: 'completed',
  startedAt: '2026-03-10T10:00:00Z',
  endedAt: '2026-03-10T10:30:00Z',
  createdAt: '2026-03-10T10:00:00Z',
  audioPath: null,
  prepBriefing: null,
  transcriptionLanguage: null,
  unassignedPending: false,
  segments: [
    {
      id: 'seg-1',
      meetingId: 'meet-1',
      content: 'Hello from the transcript',
      startTime: 0,
      endTime: 1000,
      speaker: null,
      createdAt: '2026-03-10T10:00:00Z',
    },
  ],
  brief: null,
  actionItems: [],
  ...overrides,
});

function renderWorkspace(meetingId = 'meet-1') {
  return render(
    <MemoryRouter initialEntries={[`/session/${meetingId}`]}>
      <Routes>
        <Route path="/session/:id" element={<SessionWorkspace />} />
        <Route path="/" element={<div>Sessions Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Test-only trigger that navigates within the SAME MemoryRouter instance --
 * reproduces the real bug scenario where SessionWorkspace's routed component
 * instance is reused (not remounted) across a /session/:id -> /session/:otherId
 * navigation. */
function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>{`go-to-${to}`}</button>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SessionWorkspace — routed session page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({
      selectedMeeting: makeMeeting() as any,
      loadMeeting: vi.fn().mockResolvedValue(undefined),
      clearSelectedMeeting: vi.fn(),
      clearAnalytics: vi.fn(),
      analytics: null,
      analyticsLoading: false,
    } as any);
    useProjectStore.setState({
      projects: [],
      loadProjects: vi.fn().mockResolvedValue(undefined),
    } as any);
    // Enable an AI provider so the Brief + Action Items sections render (not EmptyAIState)
    useSettingsStore.setState({ providers: [{ id: 'p1', enabled: true }] } as any);
  });

  it('renders header, transcript, and action-items sections from the loaded meeting', () => {
    renderWorkspace();
    // Header title
    expect(screen.getByText('Weekly Standup')).toBeInTheDocument();
    // Transcript tab is active by default — its segment content shows
    expect(screen.getByText('Hello from the transcript')).toBeInTheDocument();
    // Right-rail action-items section
    expect(screen.getByText('Action Items')).toBeInTheDocument();
  });

  it('shows the three canvas tabs (Transcript | Board | Brain)', () => {
    renderWorkspace();
    expect(screen.getByRole('tab', { name: 'Transcript' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Brain' })).toBeInTheDocument();
  });

  it('switches to the Board tab and shows the no-project empty state', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByText('The board arrives with this project')).toBeInTheDocument();
  });

  it('switches to the Brain tab and shows the V3.2 placeholder', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Brain' }));
    expect(screen.getByText('The living graph arrives in V3.2.')).toBeInTheDocument();
  });

  it('mounts the interactive EmbeddedBoard (not the empty state) when the session has a project', async () => {
    const user = userEvent.setup();
    useMeetingStore.setState({ selectedMeeting: makeMeeting({ projectId: 'proj-1' }) as any });
    // Seed the board store so EmbeddedBoard renders deterministically (no async load).
    useBoardStore.setState({
      project: { id: 'proj-1', name: 'Test Project' },
      columns: [],
      cards: [],
      allCards: [],
      labels: [],
      relationships: [],
      loading: false,
      error: null,
      loadBoard: vi.fn().mockResolvedValue(undefined),
    } as any);
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByTestId('embedded-board')).toBeInTheDocument();
    expect(screen.queryByText('The board arrives with this project')).toBeNull();
  });

  it('surfaces the unassigned-reassignment pill when cards are pending assignment', () => {
    useMeetingStore.setState({ selectedMeeting: makeMeeting({ unassignedPending: true }) as any });
    renderWorkspace();
    expect(screen.getByTestId('session-unassigned-pill')).toBeInTheDocument();
  });

  it('shows a loading spinner until the routed meeting matches the id', () => {
    useMeetingStore.setState({ selectedMeeting: null } as any);
    renderWorkspace('missing-id');
    expect(screen.queryByText('Weekly Standup')).toBeNull();
  });

  it('shows a loading spinner (not the not-found state) while loadMeeting is still pending', () => {
    let resolveLoad: (() => void) | undefined;
    useMeetingStore.setState({
      selectedMeeting: null,
      loadMeeting: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    } as any);
    renderWorkspace('pending-id');
    expect(screen.queryByText('Meeting not found')).toBeNull();
    resolveLoad?.();
  });

  it('renders a not-found state with a link back to Sessions when the routed meeting resolves to null (deleted session)', async () => {
    useMeetingStore.setState({
      selectedMeeting: null,
      // Resolves without ever setting selectedMeeting for this id -- mirrors the
      // real store's loadMeeting when getMeeting(id) returns null.
      loadMeeting: vi.fn().mockResolvedValue(undefined),
    } as any);

    renderWorkspace('deleted-id');

    expect(await screen.findByText('Meeting not found')).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: /back to sessions/i });
    expect(backLink).toHaveAttribute('href', '/');
  });

  it('resets the active tab to Transcript when the routed id changes on the same mounted instance', async () => {
    const user = userEvent.setup();
    const meetingOne = makeMeeting({ id: 'meet-1', title: 'Meeting One' });
    const meetingTwo = makeMeeting({
      id: 'meet-2',
      title: 'Meeting Two',
      projectId: 'proj-1',
      segments: [
        {
          id: 'seg-2',
          meetingId: 'meet-2',
          content: 'Second meeting transcript',
          startTime: 0,
          endTime: 1000,
          speaker: null,
          createdAt: '2026-03-11T10:00:00Z',
        },
      ],
    });
    useMeetingStore.setState({
      selectedMeeting: meetingOne as any,
      loadMeeting: vi.fn().mockImplementation(async (id: string) => {
        useMeetingStore.setState({ selectedMeeting: (id === 'meet-2' ? meetingTwo : meetingOne) as any });
      }),
    } as any);

    render(
      <MemoryRouter initialEntries={['/session/meet-1']}>
        <NavigateButton to="/session/meet-2" />
        <Routes>
          <Route path="/session/:id" element={<SessionWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );

    // Leave the transcript tab on session one.
    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');

    // Navigate to a different session -- SAME SessionWorkspace instance, new id.
    await user.click(screen.getByText('go-to-/session/meet-2'));

    expect(await screen.findByText('Meeting Two')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Second meeting transcript')).toBeInTheDocument();
  });
});
