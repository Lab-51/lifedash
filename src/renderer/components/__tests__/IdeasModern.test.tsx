// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  getIdeas: vi.fn().mockResolvedValue([]),
  getIdea: vi.fn().mockResolvedValue(null),
  createIdea: vi.fn().mockResolvedValue({ id: 'idea-1' }),
  updateIdea: vi.fn().mockResolvedValue(undefined),
  deleteIdea: vi.fn().mockResolvedValue(undefined),
  analyzeIdea: vi.fn().mockResolvedValue(null),
  convertIdeaToProject: vi.fn().mockResolvedValue('proj-1'),
  convertIdeaToCard: vi.fn().mockResolvedValue('card-1'),
  appVersion: '2.2.15',
  platform: 'win32',
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useIdeaStore } = await import('../../stores/ideaStore');
const { default: IdeasModern } = await import('../IdeasModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <IdeasModern />
    </MemoryRouter>,
  );
}

const makeIdea = (overrides: Record<string, unknown> = {}) => ({
  id: 'idea-1',
  title: 'Build a mobile app',
  description: 'Cross-platform mobile application for the dashboard',
  status: 'new' as const,
  tags: ['mobile', 'react-native'],
  effort: 'high',
  impact: 'high',
  createdAt: '2026-03-10T10:00:00Z',
  updatedAt: '2026-03-10T10:30:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('IdeasModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useIdeaStore.setState({
      ideas: [],
      selectedIdea: null,
      loading: false,
      error: null,
      analysis: null,
      analyzing: false,
      analysisError: null,
      loadIdeas: vi.fn().mockResolvedValue(undefined),
      loadIdea: vi.fn().mockResolvedValue(undefined),
      createIdea: vi.fn().mockResolvedValue({ id: 'idea-new' }),
      updateIdea: vi.fn().mockResolvedValue(undefined),
      deleteIdea: vi.fn().mockResolvedValue(undefined),
      clearSelectedIdea: vi.fn(),
      convertToProject: vi.fn().mockResolvedValue('proj-1'),
      convertToCard: vi.fn().mockResolvedValue('card-1'),
      analyzeIdea: vi.fn().mockResolvedValue(undefined),
      clearAnalysis: vi.fn(),
    } as any);
  });

  it('renders without crashing', () => {
    renderComponent();
    expect(screen.getByText('Ideas')).toBeInTheDocument();
  });

  it('shows the system label', () => {
    renderComponent();
    expect(screen.getByText('SYS.IDEAS')).toBeInTheDocument();
  });

  it('shows the page subtitle', () => {
    renderComponent();
    expect(screen.getByText('Capture, refine, and track your flashes of brilliance.')).toBeInTheDocument();
  });

  it('shows Add Idea button', () => {
    renderComponent();
    expect(screen.getByText('Add Idea')).toBeInTheDocument();
  });

  it('shows empty state when no ideas exist', () => {
    renderComponent();
    expect(screen.getByText('Capture every spark')).toBeInTheDocument();
  });

  it('shows filter tabs (All, New, Exploring, Active, Archived)', () => {
    renderComponent();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Exploring')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('search input exists and is interactive', async () => {
    const user = userEvent.setup();

    useIdeaStore.setState({
      ideas: [makeIdea()] as any,
    });

    renderComponent();
    const searchInput = screen.getByPlaceholderText('Search ideas...');
    expect(searchInput).toBeInTheDocument();

    await user.type(searchInput, 'mobile');
    expect(searchInput).toHaveValue('mobile');
  });

  it('displays idea cards when ideas exist in store', () => {
    useIdeaStore.setState({
      ideas: [
        makeIdea({ id: 'idea-1', title: 'Build a mobile app' }),
        makeIdea({ id: 'idea-2', title: 'Add dark mode' }),
      ] as any,
    });

    renderComponent();
    expect(screen.getByText('Build a mobile app')).toBeInTheDocument();
    expect(screen.getByText('Add dark mode')).toBeInTheDocument();
  });

  it('shows sort control with Newest as default', () => {
    renderComponent();
    expect(screen.getByText('Newest')).toBeInTheDocument();
  });

  it('displays tags on idea cards', () => {
    useIdeaStore.setState({
      ideas: [makeIdea({ tags: ['mobile', 'react-native'] })] as any,
    });

    renderComponent();
    expect(screen.getByText('mobile')).toBeInTheDocument();
    expect(screen.getByText('react-native')).toBeInTheDocument();
  });
});
