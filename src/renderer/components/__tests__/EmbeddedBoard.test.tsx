// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
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
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
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
    createLabel: vi.fn().mockResolvedValue(undefined),
    updateLabel: vi.fn().mockResolvedValue(undefined),
    deleteLabel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never);
}

function renderBoard(projectId = 'proj-1') {
  return render(
    <MemoryRouter initialEntries={[`/session/meet-1`]}>
      <Routes>
        <Route path="/session/:id" element={<EmbeddedBoard projectId={projectId} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EmbeddedBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedBoard();
  });

  it('renders the board core (search toolbar + add column) with no columns', () => {
    renderBoard();
    expect(screen.getByTestId('embedded-board')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search cards...')).toBeInTheDocument();
    expect(screen.getByText('Add Column')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    seedBoard({ loading: true });
    renderBoard();
    expect(screen.getByText('Loading board...')).toBeInTheDocument();
  });

  it('shows the error state with a retry button', () => {
    seedBoard({ loading: false, error: 'Failed to load board' });
    renderBoard();
    expect(screen.getByText('Failed to load board')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders a column and its cards', () => {
    seedBoard({
      columns: [{ id: 'col-1', boardId: 'board-1', name: 'Inbox', position: 0, color: null }],
      cards: [makeCard()],
    });
    renderBoard();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Follow up with Sarah')).toBeInTheDocument();
  });

  it('preserves KanbanCardModern Reject/Keep menu for auto-pushed cards (session review surface)', async () => {
    const user = userEvent.setup();
    seedBoard({
      columns: [{ id: 'col-1', boardId: 'board-1', name: 'Inbox', position: 0, color: null }],
      cards: [makeCard({ source: 'auto-from-meeting', sourceMeetingId: 'meet-1', reviewedAt: null })],
    });
    renderBoard();

    await user.click(screen.getByLabelText('Card actions'));
    expect(screen.getByTestId('card-reject-menu-item')).toBeInTheDocument();
    expect(screen.getByText('Keep in Inbox')).toBeInTheDocument();
  });
});
