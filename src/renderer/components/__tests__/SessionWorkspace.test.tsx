// @vitest-environment jsdom
import { forwardRef, useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
  buildBrainTree: vi.fn().mockResolvedValue({
    root: {
      id: 'session:meet-1',
      type: 'session',
      label: 'Weekly Standup',
      entityId: 'meet-1',
      childCount: 1,
      children: [
        {
          id: 'group:cards:meet-1',
          type: 'group',
          label: 'Cards created',
          entityId: null,
          childCount: 0,
          children: [],
        },
      ],
    },
    crossLinks: [],
  }),
});

// BrainMindMap's own d3/layout behavior is covered by BrainMindMap.test.tsx —
// here it's mocked to a minimal forwardRef stub so tests can trigger
// onOpenEntity directly and assert SessionWorkspace's routing (Task 3).
vi.mock('../BrainMindMap', () => ({
  default: forwardRef(function MockBrainMindMap(
    props: { scopeKey: string; onOpenEntity: (arg: { type: string; entityId: string }) => void },
    ref: React.Ref<{ fit: () => void }>,
  ) {
    useImperativeHandle(ref, () => ({ fit: () => {} }));
    return (
      <div data-testid="mock-mindmap" data-scope-key={props.scopeKey}>
        <button onClick={() => props.onOpenEntity({ type: 'session', entityId: 'other-meet' })}>open-session</button>
        <button onClick={() => props.onOpenEntity({ type: 'card', entityId: 'card-1' })}>open-card</button>
      </div>
    );
  }),
}));

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

/**
 * The transcript section is collapsed by default (BRAIN-UX.1 Task 5) — click its
 * header toggle to reveal the segment list.
 */
function expandTranscript() {
  const toggle = screen.getAllByRole('button', { expanded: false }).find((b) => /Transcript/.test(b.textContent ?? ''));
  fireEvent.click(toggle!);
}

/**
 * A COMPLETED session now opens on its Summary tab (POST-FLOW.1 follow-up), so
 * anything asserting the transcript/assistant surface has to switch to Meeting
 * first. Live sessions have no Summary tab and need no switch.
 */
function openMeetingTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Meeting' }));
}

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

/** Surfaces the router location so tests can assert the in-session viewProject/openCard
 *  override was applied (instead of a real navigation away to a retired /projects page). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="test-location">{`${location.pathname}${location.search}`}</div>;
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

  it('renders header, the Summary tab by default, and the transcript on the Meeting tab', () => {
    renderWorkspace();
    // Header title
    expect(screen.getByText('Weekly Standup')).toBeInTheDocument();
    // A completed session opens on Summary — Brief + Action Items live there.
    expect(screen.getByText('Action Items')).toBeInTheDocument();
    // The transcript is one click away: its segment content shows once the
    // Meeting tab is open and the (collapsed-by-default) section is expanded.
    openMeetingTab();
    expandTranscript();
    expect(screen.getByText('Hello from the transcript')).toBeInTheDocument();
  });

  // POST-FLOW.1 follow-up — the brief is a first-class TAB, selected by default.
  // It first shipped as a hero stacked above the strip, which pushed Meeting /
  // Board / Brain down the page; the whole point of this shape is that the brief
  // leads WITHOUT costing the other surfaces their place.
  it('gives a COMPLETED session a Summary tab that comes first and is selected by default', () => {
    renderWorkspace();

    const summaryTab = screen.getByRole('tab', { name: 'Summary' });
    const meetingTab = screen.getByRole('tab', { name: 'Meeting' });

    // DOCUMENT_POSITION_FOLLOWING (4) — Summary is FIRST in the strip.
    expect(summaryTab.compareDocumentPosition(meetingTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...and active on arrival, with no click.
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    expect(meetingTab).toHaveAttribute('aria-selected', 'false');

    // The other tabs are PEERS, not pushed below a hero: same tablist parent.
    expect(summaryTab.parentElement).toBe(meetingTab.parentElement);
    expect(document.getElementById('panel-transcript')).toBeNull();

    // The brief lives in that panel — it is not also left in the rail.
    const panel = screen.getByTestId('session-summary-tab');
    expect(within(panel).getByText('Brief')).toBeInTheDocument();
    expect(screen.getAllByText('Brief')).toHaveLength(1);
    expect(within(panel).getByText('Action Items')).toBeInTheDocument();
    expect(screen.getAllByText('Action Items')).toHaveLength(1);
  });

  it('leaves a LIVE session composed exactly as before — no Summary tab, intelligence still in the rail', () => {
    useMeetingStore.setState({ selectedMeeting: makeMeeting({ status: 'recording', endedAt: null }) as any });
    renderWorkspace();

    expect(screen.queryByTestId('session-summary-tab')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Summary' })).toBeNull();
    // The live strip still leads with Transcript, and it is the active tab.
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
    // Still present, and still OUTSIDE the center canvas (the rail).
    const brief = screen.getByText('Brief');
    expect(brief).toBeInTheDocument();
    expect(brief.closest('section')).toBeNull();
    expect(screen.getByText('Action Items').closest('section')).toBeNull();
  });

  it('shows four canvas tabs for a completed meeting (Summary | Meeting | Board | Brain)', () => {
    renderWorkspace();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Summary', 'Meeting', 'Board', 'Brain']);
  });

  it('hosts the Meeting Assistant chat in the center canvas (not the rail) for completed meetings', () => {
    renderWorkspace();
    openMeetingTab();
    // The chat lives inside the transcript/meeting tabpanel — the primary surface.
    const panel = document.getElementById('panel-transcript')!;
    expect(within(panel as HTMLElement).getByText('Meeting Assistant')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByLabelText('Ask about this meeting')).toBeInTheDocument();
  });

  it('switches to the Board tab and shows the no-project empty state', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByText('The board arrives with this project')).toBeInTheDocument();
  });

  it('switches to the Brain tab and loads the session-scoped mind map via IPC', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('tab', { name: 'Brain' }));
    expect(await screen.findByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', 'session:meet-1');
    expect(window.electronAPI.buildBrainTree).toHaveBeenCalledWith({ meetingId: 'meet-1' });
  });

  it('routes a Brain session-node click to /session/:id (real navigation)', async () => {
    const user = userEvent.setup();
    renderWorkspace(); // starts at /session/meet-1
    await user.click(screen.getByRole('tab', { name: 'Brain' }));
    await screen.findByTestId('mock-mindmap');

    await user.click(screen.getByText('open-session'));

    // A real route change to /session/other-meet: SessionWorkspace re-renders for
    // the new id, which doesn't match the mocked selectedMeeting (still meet-1),
    // landing on the not-found gate — confirming navigation actually happened.
    expect(await screen.findByText('Meeting not found')).toBeInTheDocument();
  });

  it("shows a Brain FOREIGN-project card IN this session's Board tab via the viewProject override (no /projects navigation)", async () => {
    const user = userEvent.setup();
    // Session has no own project; the clicked card belongs to proj-9 (a foreign project).
    // The board store is NOT yet settled on proj-9 (project null, loading) — this is the
    // real post-click / pre-load instant, when ?openCard= must survive until the foreign
    // board loads. (A settled proj-9 board that still lacked the card would be a genuinely
    // stale openCard, which fix C now clears — covered by its own test below.)
    useBoardStore.setState({
      allCards: [{ id: 'card-1', columnId: 'col-1', projectId: 'proj-9' } as any],
      project: null,
      columns: [],
      cards: [],
      labels: [],
      relationships: [],
      loading: true,
      error: null,
      loadBoard: vi.fn().mockResolvedValue(undefined),
    } as any);
    useProjectStore.setState({
      projects: [{ id: 'proj-9', name: 'Proj Nine' }] as any,
      loadProjects: vi.fn().mockResolvedValue(undefined),
    } as any);
    render(
      <MemoryRouter initialEntries={['/session/meet-1']}>
        <Routes>
          <Route path="/session/:id" element={<SessionWorkspace />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: 'Brain' }));
    await screen.findByTestId('mock-mindmap');

    await user.click(screen.getByText('open-card'));

    // In-canvas: Board tab active, the foreign board embedded, the back-banner shown,
    // and the URL carries the override (viewProject + openCard) — NOT a /projects nav.
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('embedded-board')).toBeInTheDocument();
    expect(screen.getByText('Proj Nine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to this session's board/i })).toBeInTheDocument();
    expect(screen.getByTestId('test-location')).toHaveTextContent('/session/meet-1?viewProject=proj-9&openCard=card-1');
  });

  it("the viewProject back-banner returns the Board tab to the session's own project", async () => {
    const user = userEvent.setup();
    useMeetingStore.setState({ selectedMeeting: makeMeeting({ projectId: 'proj-own' }) as any });
    useBoardStore.setState({
      allCards: [{ id: 'card-1', columnId: 'col-1', projectId: 'proj-9' } as any],
      project: { id: 'proj-own', name: 'Own Project' },
      columns: [],
      cards: [],
      labels: [],
      relationships: [],
      loading: false,
      error: null,
      loadBoard: vi.fn().mockResolvedValue(undefined),
    } as any);
    useProjectStore.setState({
      projects: [
        { id: 'proj-own', name: 'Own Project' },
        { id: 'proj-9', name: 'Proj Nine' },
      ] as any,
      loadProjects: vi.fn().mockResolvedValue(undefined),
    } as any);
    render(
      <MemoryRouter initialEntries={['/session/meet-1']}>
        <Routes>
          <Route path="/session/:id" element={<SessionWorkspace />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: 'Brain' }));
    await screen.findByTestId('mock-mindmap');
    await user.click(screen.getByText('open-card'));
    expect(screen.getByText('Proj Nine')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to this session's board/i }));

    // Banner gone, override cleared — the board is back on the session's own project.
    expect(screen.queryByText('Proj Nine')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('test-location')).toHaveTextContent('/session/meet-1');
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

  it('resets the active tab to the new default when the routed id changes on the same mounted instance', async () => {
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
    // The Board tab does NOT carry over: a newly-routed COMPLETED session lands
    // on its own Summary tab (POST-FLOW.1 follow-up), not on the previous tab.
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'false');
    openMeetingTab();
    expandTranscript();
    expect(screen.getByText('Second meeting transcript')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BRIEF-QUAL.1 Task 4: copyActionItems includes "Owner — task (due)" when
// owner/dueText are known, and stays plain otherwise.
// ---------------------------------------------------------------------------
describe('SessionWorkspace — copy action items (BRIEF-QUAL.1 Task 4)', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom's real Clipboard object resists a plain Object.defineProperty
    // override (its own accessor keeps winning for callers outside this file's
    // module scope) — a Proxy over the real `navigator` that intercepts only
    // `clipboard` sidesteps that reliably, matching the app's real one-liner
    // `navigator.clipboard.writeText(text)` call site exactly.
    const realNavigator = navigator;
    vi.stubGlobal(
      'navigator',
      new Proxy(realNavigator, {
        get(target, prop, receiver) {
          if (prop === 'clipboard') return { writeText };
          return Reflect.get(target, prop, receiver);
        },
      }),
    );
    useMeetingStore.setState({
      selectedMeeting: makeMeeting({
        actionItems: [
          {
            id: 'a1',
            meetingId: 'meet-1',
            cardId: null,
            description: 'Send the doc',
            owner: 'Alex Chen',
            dueText: 'Friday',
            status: 'approved',
            createdAt: '2026-03-10T10:00:00Z',
          },
          {
            id: 'a2',
            meetingId: 'meet-1',
            cardId: null,
            description: 'Book the room',
            owner: null,
            dueText: null,
            status: 'pending',
            createdAt: '2026-03-10T10:00:00Z',
          },
        ],
      }) as any,
      loadMeeting: vi.fn().mockResolvedValue(undefined),
      clearSelectedMeeting: vi.fn(),
      clearAnalytics: vi.fn(),
      analytics: null,
      analyticsLoading: false,
    } as any);
    useProjectStore.setState({ projects: [], loadProjects: vi.fn().mockResolvedValue(undefined) } as any);
    useSettingsStore.setState({ providers: [{ id: 'p1', enabled: true }] } as any);
  });

  it('copies "Owner — task (due)" when owner/dueText are known, plain when not', () => {
    renderWorkspace();
    openMeetingTab();
    expandTranscript();

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(writeText).toHaveBeenCalledWith('- [x] Alex Chen — Send the doc (Friday)\n- [ ] Book the room');
  });
});
