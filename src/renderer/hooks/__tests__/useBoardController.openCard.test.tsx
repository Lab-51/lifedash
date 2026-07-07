// @vitest-environment jsdom
// Regression coverage for the ?openCard= consumption path in useBoardController
// (exercised through EmbeddedBoard, the only public mount), covering migration
// fixes B and C:
//   • B — the openCard effect is now `active`-gated (like the load effect + drag
//     monitors): an INERT board (covered by the full-screen LiveModeOverlay) must
//     NOT consume openCard — no invisible modal, no rewrite of the shared URL.
//   • C — a stale/absent openCard is cleared from the URL once the ACTIVE board has
//     SETTLED on its own project (project.id === projectId), so it can't linger and
//     mis-fire — WITHOUT clearing during the foreign-board grace window (the store
//     still holding a different project's board means "not yet settled here").
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';

// The document-scoped drag monitor is irrelevant here — stub it so nothing registers.
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, monitorForElements: vi.fn(() => () => {}) };
});
// Stub the lazy card-detail modal so opening a card is observable without its own
// electronAPI side effects.
vi.mock('../../components/CardDetailModal', () => ({
  default: () => <div data-testid="card-detail-modal" />,
}));

vi.stubGlobal('electronAPI', {
  getProjects: vi.fn().mockResolvedValue([]),
  getBoards: vi.fn().mockResolvedValue([{ id: 'board-1', projectId: 'proj-1', name: 'Board' }]),
  createBoard: vi.fn().mockResolvedValue({ id: 'board-1' }),
  getColumns: vi.fn().mockResolvedValue([]),
  getCardsByBoard: vi.fn().mockResolvedValue([]),
  getLabels: vi.fn().mockResolvedValue([]),
  getRelationshipsByBoard: vi.fn().mockResolvedValue([]),
  getCardTemplates: vi.fn().mockResolvedValue([]),
  updateCard: vi.fn().mockResolvedValue({ card: {}, spawnedCard: null }),
  markCardReviewed: vi.fn().mockResolvedValue({}),
  moveCard: vi.fn().mockResolvedValue({}),
});

const { useBoardStore } = await import('../../stores/boardStore');
const { default: EmbeddedBoard } = await import('../../components/EmbeddedBoard');

const makeCard = (overrides: Record<string, unknown> = {}) => ({
  id: 'card-1',
  columnId: 'col-1',
  title: 'Follow up with Sarah',
  description: null,
  position: 0,
  priority: 'medium',
  dueDate: null,
  completed: false,
  archived: false,
  labels: [],
  source: null,
  sourceMeetingId: null,
  reviewedAt: null,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  ...overrides,
});

function seedBoard(overrides: Record<string, unknown> = {}) {
  useBoardStore.setState({
    project: { id: 'proj-1', name: 'Test Project', archived: false, createdAt: '2026-03-01' },
    board: { id: 'board-1', projectId: 'proj-1', name: 'Board' },
    columns: [{ id: 'col-1', boardId: 'board-1', name: 'Inbox', position: 0, color: null }],
    cards: [],
    allCards: [],
    labels: [],
    relationships: [],
    loading: false,
    error: null,
    loadBoard: vi.fn().mockResolvedValue(undefined),
    addColumn: vi.fn().mockResolvedValue(undefined),
    deleteColumn: vi.fn().mockResolvedValue(undefined),
    updateColumn: vi.fn().mockResolvedValue(undefined),
    addCard: vi.fn().mockResolvedValue(undefined),
    updateCard: vi.fn().mockResolvedValue(undefined),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    moveCard: vi.fn().mockResolvedValue(undefined),
    markCardReviewed: vi.fn().mockResolvedValue(undefined),
    reorderColumns: vi.fn().mockResolvedValue(undefined),
    createLabel: vi.fn().mockResolvedValue(undefined),
    updateLabel: vi.fn().mockResolvedValue(undefined),
    deleteLabel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="test-location">{`${location.pathname}${location.search}`}</div>;
}

function renderBoard(entry: string, opts: { active?: boolean; projectId?: string } = {}) {
  const { active = true, projectId = 'proj-1' } = opts;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/session/:id" element={<EmbeddedBoard projectId={projectId} active={active} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useBoardController ?openCard= consumption (fixes B + C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedBoard();
  });

  it('baseline: an ACTIVE board opens + consumes openCard when the target card is present', async () => {
    seedBoard({ cards: [makeCard({ id: 'card-1' })], allCards: [makeCard({ id: 'card-1' })] });
    renderBoard('/session/meet-1?openCard=card-1', { active: true });

    expect(await screen.findByTestId('card-detail-modal')).toBeInTheDocument();
    // Param consumed off the URL.
    expect(screen.getByTestId('test-location')).toHaveTextContent('/session/meet-1');
    expect(screen.getByTestId('test-location')).not.toHaveTextContent('openCard');
  });

  it('fix B: an INACTIVE (overlay-covered) board does NOT consume openCard', () => {
    seedBoard({ cards: [makeCard({ id: 'card-1' })], allCards: [makeCard({ id: 'card-1' })] });
    renderBoard('/session/meet-1?openCard=card-1', { active: false });

    // Only the foreground board consumes the param: no modal, and the shared URL param
    // is left untouched (no invisible modal / shared-param rewrite from the covered board).
    expect(screen.queryByTestId('card-detail-modal')).toBeNull();
    expect(screen.getByTestId('test-location')).toHaveTextContent('openCard=card-1');
  });

  it('fix C: a stale openCard (target absent) is CLEARED once the active board settles on its project', () => {
    // Settled on proj-1 (project.id === projectId), not loading, but the target card is
    // absent → a stale/deleted/wrong-project openCard. It must be cleared, not linger.
    seedBoard({ cards: [], allCards: [] });
    renderBoard('/session/meet-1?openCard=ghost-card', { active: true });

    expect(screen.queryByTestId('card-detail-modal')).toBeNull();
    expect(screen.getByTestId('test-location')).toHaveTextContent('/session/meet-1');
    expect(screen.getByTestId('test-location')).not.toHaveTextContent('openCard');
  });

  it('fix C grace window: openCard SURVIVES while the board has not yet settled on this project', () => {
    // The store still holds a DIFFERENT project's board (a foreign-board switch in
    // flight), so project.id !== projectId → not settled here. The deep-linked openCard
    // must survive until this project's board loads, or the link would be dropped early.
    seedBoard({ project: { id: 'proj-other' }, cards: [], allCards: [] });
    renderBoard('/session/meet-1?openCard=card-1', { active: true, projectId: 'proj-1' });

    expect(screen.getByTestId('test-location')).toHaveTextContent('openCard=card-1');
  });
});
