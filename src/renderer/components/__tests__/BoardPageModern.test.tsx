// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
vi.stubGlobal('window', {
  ...window,
  electronAPI: {
    getProjects: vi.fn().mockResolvedValue([]),
    getBoards: vi.fn().mockResolvedValue([{ id: 'board-1', projectId: 'proj-1', name: 'Board' }]),
    createBoard: vi.fn().mockResolvedValue({ id: 'board-1' }),
    getColumns: vi.fn().mockResolvedValue([]),
    getCardsByBoard: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
    getRelationshipsByBoard: vi.fn().mockResolvedValue([]),
    getAllCards: vi.fn().mockResolvedValue([]),
    createColumn: vi.fn().mockResolvedValue({ id: 'col-1' }),
    updateColumn: vi.fn().mockResolvedValue(undefined),
    deleteColumn: vi.fn().mockResolvedValue(undefined),
    reorderColumns: vi.fn().mockResolvedValue(undefined),
    createCard: vi.fn().mockResolvedValue({ id: 'card-1' }),
    updateCard: vi.fn().mockResolvedValue({ card: {}, spawnedCard: null }),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    moveCard: vi.fn().mockResolvedValue(undefined),
    createLabel: vi.fn().mockResolvedValue({ id: 'lbl-1' }),
    updateLabel: vi.fn().mockResolvedValue(undefined),
    deleteLabel: vi.fn().mockResolvedValue(undefined),
    attachLabel: vi.fn().mockResolvedValue(undefined),
    detachLabel: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue(undefined),
    projectAgentGetThreads: vi.fn().mockResolvedValue([]),
    projectAgentGetMessages: vi.fn().mockResolvedValue([]),
    onProjectAgentChunk: vi.fn().mockReturnValue(() => {}),
    onProjectAgentToolEvent: vi.fn().mockReturnValue(() => {}),
    appVersion: '2.2.15',
    platform: 'win32',
  },
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useBoardStore } = await import('../../stores/boardStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { useProjectAgentStore } = await import('../../stores/projectAgentStore');
const { default: BoardPageModern } = await import('../BoardPageModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent(projectId = 'proj-1') {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/board`]}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<BoardPageModern />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BoardPageModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useBoardStore.setState({
      project: { id: 'proj-1', name: 'Test Project', archived: false, createdAt: '2026-03-01' } as any,
      board: { id: 'board-1', projectId: 'proj-1', name: 'Board' } as any,
      columns: [],
      cards: [],
      allCards: [],
      labels: [],
      relationships: [],
      loading: false,
      error: null,
      loadBoard: vi.fn().mockResolvedValue(undefined),
      loadAllCards: vi.fn().mockResolvedValue(undefined),
      addColumn: vi.fn().mockResolvedValue(undefined),
      deleteColumn: vi.fn().mockResolvedValue(undefined),
      updateColumn: vi.fn().mockResolvedValue(undefined),
      reorderColumns: vi.fn().mockResolvedValue(undefined),
      addCard: vi.fn().mockResolvedValue(undefined),
      updateCard: vi.fn().mockResolvedValue(undefined),
      deleteCard: vi.fn().mockResolvedValue(undefined),
      moveCard: vi.fn().mockResolvedValue(undefined),
      createLabel: vi.fn().mockResolvedValue(undefined),
      updateLabel: vi.fn().mockResolvedValue(undefined),
      deleteLabel: vi.fn().mockResolvedValue(undefined),
      attachLabel: vi.fn().mockResolvedValue(undefined),
      detachLabel: vi.fn().mockResolvedValue(undefined),
    } as any);

    useProjectStore.setState({
      projects: [{ id: 'proj-1', name: 'Test Project', archived: false, createdAt: '2026-03-01' }] as any,
      loading: false,
      error: null,
      loadProjects: vi.fn().mockResolvedValue(undefined),
      updateProject: vi.fn().mockResolvedValue(undefined),
    } as any);

    useProjectAgentStore.setState({
      messageCount: 0,
      messages: [],
      streaming: false,
      streamingText: '',
      activeThreadId: null,
      threads: [],
      loading: false,
      error: null,
      loadMessageCount: vi.fn().mockResolvedValue(undefined),
      loadThreads: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    } as any);
  });

  it('renders without crashing', () => {
    renderComponent();
    expect(screen.getByText('SYS.BOARD')).toBeInTheDocument();
  });

  it('shows project name as heading', () => {
    renderComponent();
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('shows Kanban View subtitle', () => {
    renderComponent();
    expect(screen.getByText('Kanban View')).toBeInTheDocument();
  });

  it('shows Add Column button when no columns exist', () => {
    renderComponent();
    expect(screen.getByText('Add Column')).toBeInTheDocument();
  });

  it('shows search input for cards', () => {
    renderComponent();
    const searchInput = screen.getByPlaceholderText('Search cards...');
    expect(searchInput).toBeInTheDocument();
  });

  it('shows AI Agent FAB button', () => {
    renderComponent();
    expect(screen.getByText('AI Agent')).toBeInTheDocument();
  });

  it('shows loading state when loading is true', () => {
    useBoardStore.setState({ loading: true } as any);
    renderComponent();
    expect(screen.getByText('Loading board...')).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    useBoardStore.setState({ loading: false, error: 'Failed to load board' } as any);
    renderComponent();
    expect(screen.getByText('Failed to load board')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
