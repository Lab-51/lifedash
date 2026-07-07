// @vitest-environment jsdom
// Regression coverage for the board/broadcast concurrency cluster (findings #3/#4):
// the `active` guard on useBoardController (threaded through EmbeddedBoard). An
// inert board (covered by the full-screen LiveModeOverlay) must NOT load/stomp the
// shared store and must register NO document-scoped drag monitor, so a single drop
// is handled exactly once. Re-activating self-heals (reloads its own project).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock the drag adapter so we can assert exactly how many document-scoped
// monitors each board instance registers (and drive a synthetic drop).
// ---------------------------------------------------------------------------
type MonitorConfig = { canMonitor: (a: unknown) => boolean; onDrop: (a: unknown) => void };
const { monitorMock } = vi.hoisted(() => ({
  // Typed via the generic so mock.calls carry the MonitorConfig arg, without
  // declaring an (unused) parameter on the implementation.
  monitorMock: vi.fn<(config: MonitorConfig) => () => void>(() => () => {}),
}));
// Override ONLY monitorForElements; keep the real draggable/dropTargetForElements
// so BoardColumnModern/KanbanCardModern still render (they share this module).
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, monitorForElements: monitorMock };
});

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking.
// ---------------------------------------------------------------------------
const { useBoardStore } = await import('../../stores/boardStore');
const { default: EmbeddedBoard } = await import('../EmbeddedBoard');

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
    columns: [],
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

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter initialEntries={['/session/meet-1']}>
      <Routes>
        <Route path="/session/:id" element={node} />
      </Routes>
    </MemoryRouter>
  );
}

// The card monitor is the registration whose canMonitor accepts a card source
// (the other registration is the column-reorder monitor).
function cardMonitors(): MonitorConfig[] {
  return monitorMock.mock.calls
    .map((c) => c[0])
    .filter((cfg) => cfg.canMonitor({ source: { data: { type: 'card' } } }));
}

describe('EmbeddedBoard active guard (findings #3/#4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedBoard();
  });

  it('active (default true): loads the board and registers one card monitor', () => {
    const loadBoard = vi.fn().mockResolvedValue(undefined);
    seedBoard({ loadBoard });

    render(wrap(<EmbeddedBoard projectId="proj-1" />));

    expect(loadBoard).toHaveBeenCalledWith('proj-1');
    expect(monitorMock).toHaveBeenCalled();
    expect(cardMonitors()).toHaveLength(1);
  });

  it('active=false: registers NO drag monitors and never calls loadBoard (no stomp)', () => {
    const loadBoard = vi.fn().mockResolvedValue(undefined);
    seedBoard({ loadBoard });

    render(wrap(<EmbeddedBoard projectId="proj-1" active={false} />));

    expect(monitorMock).not.toHaveBeenCalled();
    expect(loadBoard).not.toHaveBeenCalled();
  });

  it('self-heals: flipping active false -> true reloads the project and registers a monitor', () => {
    const loadBoard = vi.fn().mockResolvedValue(undefined);
    seedBoard({ loadBoard });

    const { rerender } = render(wrap(<EmbeddedBoard projectId="proj-1" active={false} />));
    expect(loadBoard).not.toHaveBeenCalled();
    expect(monitorMock).not.toHaveBeenCalled();

    rerender(wrap(<EmbeddedBoard projectId="proj-1" active={true} />));

    expect(loadBoard).toHaveBeenCalledWith('proj-1');
    expect(cardMonitors()).toHaveLength(1);
  });

  it('regression (#4): a single drop fires exactly one card monitor when a second board is inactive', () => {
    const moveCard = vi.fn().mockResolvedValue(undefined);
    seedBoard({
      columns: [
        { id: 'col-1', boardId: 'board-1', name: 'Inbox', position: 0, color: null },
        { id: 'col-2', boardId: 'board-1', name: 'Doing', position: 1, color: null },
      ],
      cards: [makeCard({ id: 'card-1', columnId: 'col-1', position: 0 })],
      moveCard,
    });

    // Two coexisting boards (the overlay/route concurrency): only one is active.
    render(
      wrap(
        <>
          <EmbeddedBoard projectId="proj-1" active={true} />
          <EmbeddedBoard projectId="proj-1" active={false} />
        </>,
      ),
    );

    const monitors = cardMonitors();
    // The inactive board registered no monitor — only ONE card monitor exists.
    expect(monitors).toHaveLength(1);

    // A single user drop makes pragmatic-dnd invoke EVERY registered card monitor's
    // onDrop. With one registration, moveCard fires exactly once (no double IPC /
    // duplicate 'moved' history rows).
    const dropEvent = {
      source: { data: { type: 'card', cardId: 'card-1', sourceColumnId: 'col-1', sourcePosition: 0 } },
      location: { current: { dropTargets: [{ data: { type: 'column', columnId: 'col-2' } }] } },
    };
    monitors.forEach((m) => m.onDrop(dropEvent));

    expect(moveCard).toHaveBeenCalledTimes(1);
    expect(moveCard).toHaveBeenCalledWith('card-1', 'col-2', 0);
  });
});
