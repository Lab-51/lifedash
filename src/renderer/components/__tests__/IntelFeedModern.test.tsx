// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI
// ---------------------------------------------------------------------------
vi.stubGlobal('window', {
  ...window,
  electronAPI: {
    getIntelItems: vi.fn().mockResolvedValue([]),
    getIntelSources: vi.fn().mockResolvedValue([]),
    fetchIntelAll: vi.fn().mockResolvedValue({ newItems: 0 }),
    seedIntelDefaults: vi.fn().mockResolvedValue(undefined),
    markIntelRead: vi.fn().mockResolvedValue(undefined),
    toggleIntelBookmark: vi.fn().mockResolvedValue(undefined),
    getIntelBrief: vi.fn().mockResolvedValue(null),
    generateIntelBrief: vi.fn().mockResolvedValue(null),
    summarizeIntelItem: vi.fn().mockResolvedValue(''),
    getProjects: vi.fn().mockResolvedValue([]),
    getIdeas: vi.fn().mockResolvedValue([]),
    createIdea: vi.fn().mockResolvedValue({ id: 'idea-1' }),
    createProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    appVersion: '2.2.15',
    platform: 'win32',
  },
});

// ---------------------------------------------------------------------------
// Import stores and component after mocking
// ---------------------------------------------------------------------------
const { useIntelFeedStore } = await import('../../stores/intelFeedStore');
const { default: IntelFeedModern } = await import('../IntelFeedModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <IntelFeedModern />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('IntelFeedModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Override store actions to no-ops so mount effects don't trigger loading state
    useIntelFeedStore.setState({
      items: [],
      sources: [],
      dateFilter: 'today',
      loading: false,
      fetching: false,
      error: null,
      brief: null,
      briefLoading: false,
      briefType: 'executive',
      categoryFilter: null,
      readerItem: null,
      readerContent: null,
      readerLoading: false,
      briefChatMessages: [],
      briefChatSending: false,
      loadItems: vi.fn().mockResolvedValue(undefined),
      loadSources: vi.fn().mockResolvedValue(undefined),
      seedDefaults: vi.fn().mockResolvedValue(undefined),
      fetchAll: vi.fn().mockResolvedValue({ newItems: 0 }),
      loadBrief: vi.fn().mockResolvedValue(undefined),
      generateBrief: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('renders without crashing with empty feed', () => {
    renderComponent();
    expect(screen.getByText('Intelligence Feed')).toBeInTheDocument();
  });

  it('date filter tabs render', () => {
    renderComponent();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('shows empty state message when no articles', () => {
    renderComponent();
    expect(screen.getByText('No articles yet')).toBeInTheDocument();
  });

  it('feed header renders with subtitle', () => {
    renderComponent();
    expect(screen.getByText('Stay informed with curated news from your sources.')).toBeInTheDocument();
  });

  it('shows the system label and Refresh button', () => {
    renderComponent();
    expect(screen.getByText('SYS.INTEL')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('shows Sources button with count', () => {
    useIntelFeedStore.setState({ sources: [{ id: 's1' }, { id: 's2' }] } as any);
    renderComponent();
    expect(screen.getByText('Sources (2)')).toBeInTheDocument();
  });

  it('shows Add Article button', () => {
    renderComponent();
    expect(screen.getByText('Add Article')).toBeInTheDocument();
  });

  it('shows article count', () => {
    renderComponent();
    expect(screen.getByText('0 articles')).toBeInTheDocument();
  });
});
