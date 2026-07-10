// @vitest-environment jsdom
// === FILE PURPOSE ===
// In-brain Inspector (Inspector-card story) — verifies the card CONTENT shell
// dispatches to the right per-type subview and REUSES the existing detail sections
// (mocked to lightweight stubs here, so this stays a focused dispatch/reuse test),
// that decision/question render directly (regression vs the old {kind:'none'}), the
// in-canvas column->card drill re-targets, and that Esc/close dismiss. Positioning
// (the node-anchored card + connector) is BrainMindMap's job, covered in
// BrainMindMap.test.tsx — this suite asserts only the content, not placement.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BrainNode, LiveSuggestion, MeetingWithTranscript } from '../../../shared/types';

// jsdom has no matchMedia — some reused card subviews / their deps may read it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
});

// --- Reused sections mocked to stubs (their real behavior lives in their own
//     suites; here we assert only that the inspector renders them). ------------
vi.mock('../MeetingAnalyticsSection', () => ({
  default: (p: { meetingId: string }) => <div data-testid="mock-analytics">{p.meetingId}</div>,
}));
vi.mock('../BriefSection', () => ({ default: () => <div data-testid="mock-brief" /> }));
vi.mock('../ActionItemList', () => ({ default: () => <div data-testid="mock-actions" /> }));
vi.mock('../ConvertActionModal', () => ({ default: () => null }));
vi.mock('../meeting-detail/TranscriptSection', () => ({ default: () => <div data-testid="mock-transcript" /> }));
vi.mock('../meeting-detail/LiveProposalsSection', () => ({ default: () => <div data-testid="mock-proposals" /> }));
vi.mock('../meeting-detail/LiveAssistantSection', () => ({ default: () => <div data-testid="mock-assistant" /> }));
vi.mock('../ChecklistSection', () => ({
  default: (p: { cardId: string }) => <div data-testid="mock-checklist">{p.cardId}</div>,
}));
vi.mock('../CommentsSection', () => ({ default: () => <div data-testid="mock-comments" /> }));
vi.mock('../RelationshipsSection', () => ({ default: () => <div data-testid="mock-relationships" /> }));
vi.mock('../ActivityLog', () => ({ default: () => <div data-testid="mock-activity" /> }));
vi.mock('../AttachmentsSection', () => ({ default: () => <div data-testid="mock-attachments" /> }));
vi.mock('../TaskBreakdownSection', () => ({ default: () => <div data-testid="mock-taskbreakdown" /> }));

const completedMeeting = {
  id: 'm1',
  projectId: 'p1',
  title: 'Weekly Sync',
  template: 'general',
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: null,
  audioPath: null,
  status: 'completed',
  prepBriefing: null,
  transcriptionLanguage: null,
  unassignedPending: false,
  createdAt: '2026-01-01T00:00:00Z',
  segments: [],
  brief: null,
  actionItems: [],
} as unknown as MeetingWithTranscript;

const acceptedDecision: LiveSuggestion = {
  id: 's1',
  meetingId: 'm1',
  type: 'decision',
  title: 'Ship v2 on Friday',
  description: 'Team agreed to cut the release Friday.',
  status: 'accepted',
  acceptedCardId: null,
  acceptedProjectId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

vi.stubGlobal('electronAPI', {
  getMeeting: vi.fn().mockResolvedValue(completedMeeting),
  listLiveSuggestions: vi.fn().mockResolvedValue([acceptedDecision]),
  getCardComments: vi.fn().mockResolvedValue([]),
  getCardRelationships: vi.fn().mockResolvedValue([]),
  getCardActivities: vi.fn().mockResolvedValue([]),
  getCardAttachments: vi.fn().mockResolvedValue([]),
  getChecklistItems: vi.fn().mockResolvedValue([]),
});

const { default: BrainInspector } = await import('../BrainInspector');
const { useBoardStore } = await import('../../stores/boardStore');
const { useProjectStore } = await import('../../stores/projectStore');

function node(partial: Partial<BrainNode> & Pick<BrainNode, 'id' | 'type' | 'label' | 'entityId'>): BrainNode {
  return { childCount: partial.children?.length ?? 0, children: [], ...partial };
}

function renderInspector(n: BrainNode, over: Partial<Parameters<typeof BrainInspector>[0]> = {}) {
  return render(
    <BrainInspector
      node={n}
      meetingId="m1"
      onOpenEntity={over.onOpenEntity ?? vi.fn()}
      onInspectNode={over.onInspectNode ?? vi.fn()}
      onClose={over.onClose ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useBoardStore.setState({ allCards: [] });
  useProjectStore.setState({ projects: [] });
});

describe('BrainInspector — per-type reuse', () => {
  it('session node renders the reused meeting-detail stack', async () => {
    renderInspector(node({ id: 'session:m1', type: 'session', label: 'Weekly Sync', entityId: 'm1' }));

    expect(await screen.findByTestId('brain-inspector-session')).toBeInTheDocument();
    // Analytics is deliberately NOT reused here — it drives a single non-keyed
    // global meetingStore slot (+ a diarize action) that would cross-contaminate
    // the host page's analytics/selectedMeeting when inspecting a foreign meeting.
    expect(screen.queryByTestId('mock-analytics')).toBeNull();
    expect(screen.getByTestId('mock-brief')).toBeInTheDocument();
    expect(screen.getByTestId('mock-actions')).toBeInTheDocument();
    expect(screen.getByTestId('mock-transcript')).toBeInTheDocument();
    // Completed meeting -> proposals + assistant render too.
    expect(screen.getByTestId('mock-proposals')).toBeInTheDocument();
    expect(screen.getByTestId('mock-assistant')).toBeInTheDocument();
  });

  it('card node renders the reused card-detail sub-sections and a header from the lean allCards item', async () => {
    useBoardStore.setState({
      allCards: [
        {
          id: 'card9',
          columnId: 'col1',
          title: 'Refactor auth',
          description: '<p>rich text</p>',
          priority: 'high',
          archived: false,
          completed: false,
          updatedAt: '2026-01-01T00:00:00Z',
          projectId: 'p1',
        },
      ],
    });
    renderInspector(node({ id: 'card:card9', type: 'card', label: 'Refactor auth', entityId: 'card9' }));

    const cardPanel = screen.getByTestId('brain-inspector-card');
    expect(cardPanel).toBeInTheDocument();
    expect(within(cardPanel).getByRole('heading', { name: 'Refactor auth' })).toBeInTheDocument();
    // Sub-sections mount once details finish loading (loadingCardDetails flips false).
    expect(await screen.findByTestId('mock-checklist')).toHaveTextContent('card9');
    expect(screen.getByTestId('mock-comments')).toBeInTheDocument();
    expect(screen.getByTestId('mock-relationships')).toBeInTheDocument();
    expect(screen.getByTestId('mock-activity')).toBeInTheDocument();
    expect(screen.getByTestId('mock-taskbreakdown')).toBeInTheDocument();
  });

  it('card node falls back to the payload label when the card is not in allCards (no fabrication)', async () => {
    renderInspector(node({ id: 'card:gone', type: 'card', label: 'Archived card', entityId: 'gone' }));
    expect(
      within(screen.getByTestId('brain-inspector-card')).getByRole('heading', { name: 'Archived card' }),
    ).toBeInTheDocument();
    // No columnId available -> TaskBreakdown (which needs it) is omitted, others still mount.
    expect(await screen.findByTestId('mock-checklist')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-taskbreakdown')).toBeNull();
  });

  it('project node renders a header + child-branch counts from the payload', () => {
    useProjectStore.setState({
      projects: [
        {
          id: 'p1',
          name: 'Project Alpha',
          description: 'The alpha project',
          color: '#abc',
          archived: false,
          pinned: false,
          system: false,
          autoPushEnabled: null,
          hourlyRate: null,
          sortOrder: 0,
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    });
    renderInspector(
      node({
        id: 'project:p1',
        type: 'project',
        label: 'Project Alpha',
        entityId: 'p1',
        children: [node({ id: 'group:sessions:p1', type: 'group', label: 'Sessions', entityId: null, children: [] })],
      }),
    );

    const projectPanel = screen.getByTestId('brain-inspector-project');
    expect(projectPanel).toBeInTheDocument();
    expect(within(projectPanel).getByRole('heading', { name: 'Project Alpha' })).toBeInTheDocument();
    expect(screen.getByText('The alpha project')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('column node lists its card rows and drills into a card in-canvas (re-targets, not navigate)', () => {
    const onInspectNode = vi.fn();
    const onOpenEntity = vi.fn();
    const cardRow = node({ id: 'card:c1', type: 'card', label: 'First card', entityId: 'c1' });
    renderInspector(
      node({
        id: 'column:col1',
        type: 'column',
        label: 'Backlog',
        entityId: 'col1',
        children: [cardRow, node({ id: 'card:c2', type: 'card', label: 'Second card', entityId: 'c2' })],
      }),
      { onInspectNode, onOpenEntity },
    );

    expect(screen.getByTestId('brain-inspector-column')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /First card/ }));

    expect(onInspectNode).toHaveBeenCalledWith(cardRow);
    expect(onOpenEntity).not.toHaveBeenCalled(); // in-canvas drill, never navigation
  });

  it('decision node renders its real detail directly (regression vs the old {kind:none})', async () => {
    renderInspector(node({ id: 'decision:s1', type: 'decision', label: 'Ship v2', entityId: 's1' }));

    expect(screen.getByTestId('brain-inspector-suggestion')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Ship v2 on Friday' })).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(window.electronAPI.listLiveSuggestions).toHaveBeenCalledWith('m1');
  });

  it('person entity node lists its linked sessions and navigates to one via onOpenEntity', () => {
    const onOpenEntity = vi.fn();
    const s1 = node({ id: 'entity-session:e1:m1', type: 'session', label: 'Kickoff', entityId: 'm1' });
    const s2 = node({ id: 'entity-session:e1:m2', type: 'session', label: 'Retro', entityId: 'm2' });
    renderInspector(node({ id: 'entity:e1', type: 'person', label: 'Dana Lee', entityId: 'e1', children: [s1, s2] }), {
      onOpenEntity,
    });

    const panel = screen.getByTestId('brain-inspector-entity');
    expect(within(panel).getByRole('heading', { name: 'Dana Lee' })).toBeInTheDocument();
    expect(within(panel).getByText('Person')).toBeInTheDocument();
    expect(within(panel).getByText(/Linked to 2 sessions/)).toBeInTheDocument();

    // Clicking a linked session NAVIGATES (host onOpenEntity), threading the person
    // across sessions — never a fabricated destination.
    fireEvent.click(screen.getByRole('button', { name: /Kickoff/ }));
    expect(onOpenEntity).toHaveBeenCalledWith({ type: 'session', entityId: 'm1' });
  });

  it('topic entity node shows the Topic kind and a zero-session count without fetching', () => {
    renderInspector(node({ id: 'entity:e2', type: 'topic', label: 'Billing', entityId: 'e2', children: [] }));
    const panel = screen.getByTestId('brain-inspector-entity');
    expect(within(panel).getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(within(panel).getByText('Topic')).toBeInTheDocument();
    expect(within(panel).getByText(/Linked to 0 sessions/)).toBeInTheDocument();
    // An entity has no standalone page → no "Open full page" affordance.
    expect(screen.queryByRole('button', { name: /Open .*→/ })).toBeNull();
  });

  it('question node with no resolvable meeting still shows the real payload label (no fetch, no fake)', () => {
    // No meetingId -> zero-fetch fallback path; the payload label is still shown.
    render(
      <BrainInspector
        node={node({ id: 'question:q1', type: 'question', label: 'How do we scale?', entityId: 'q1' })}
        onOpenEntity={vi.fn()}
        onInspectNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      within(screen.getByTestId('brain-inspector-suggestion')).getByRole('heading', { name: 'How do we scale?' }),
    ).toBeInTheDocument();
    expect(window.electronAPI.listLiveSuggestions).not.toHaveBeenCalled();
  });
});

describe('BrainInspector — shell affordances', () => {
  it('"Open full page →" fires the host onOpenEntity for the node', () => {
    const onOpenEntity = vi.fn();
    useBoardStore.setState({ allCards: [] });
    renderInspector(node({ id: 'card:c1', type: 'card', label: 'A card', entityId: 'c1' }), { onOpenEntity });

    fireEvent.click(screen.getByRole('button', { name: /Open card/ }));
    expect(onOpenEntity).toHaveBeenCalledWith({ type: 'card', entityId: 'c1' });
  });

  it('decision/question offer "Open session →" (their parent meeting), not a fabricated destination', () => {
    const onOpenEntity = vi.fn();
    renderInspector(node({ id: 'decision:s1', type: 'decision', label: 'Ship v2', entityId: 's1' }), { onOpenEntity });

    fireEvent.click(screen.getByRole('button', { name: /Open session/ }));
    expect(onOpenEntity).toHaveBeenCalledWith({ type: 'session', entityId: 'm1' });
  });

  it('the close button and Esc both dismiss the inspector', () => {
    const onClose = vi.fn();
    renderInspector(node({ id: 'project:p1', type: 'project', label: 'Project Alpha', entityId: 'p1' }), { onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is a labelled region for screen readers', () => {
    renderInspector(node({ id: 'project:p1', type: 'project', label: 'Project Alpha', entityId: 'p1' }));
    expect(screen.getByRole('region', { name: 'Project details' })).toBeInTheDocument();
  });
});
