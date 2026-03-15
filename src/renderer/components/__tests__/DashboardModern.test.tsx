// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfill ResizeObserver for jsdom (used by ProductivityPulse)
// ---------------------------------------------------------------------------
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// ---------------------------------------------------------------------------
// Mock window.electronAPI — comprehensive to cover all child components
// ---------------------------------------------------------------------------
vi.stubGlobal('window', {
  ...window,
  electronAPI: {
    // Projects / Meetings / Ideas
    getProjects: vi.fn().mockResolvedValue([]),
    getMeetings: vi.fn().mockResolvedValue([]),
    getIdeas: vi.fn().mockResolvedValue([]),
    getMeetingActionItems: vi.fn().mockResolvedValue([]),
    generateStandup: vi.fn().mockResolvedValue({ standup: '' }),
    getActivityData: vi.fn().mockResolvedValue({ dayCounts: {} }),
    // Background agent
    onBackgroundAgentNewInsights: vi.fn().mockReturnValue(() => {}),
    backgroundAgentGetPreferences: vi.fn().mockResolvedValue(null),
    backgroundAgentGetInsights: vi.fn().mockResolvedValue([]),
    backgroundAgentGetAllInsights: vi.fn().mockResolvedValue([]),
    backgroundAgentGetNewCount: vi.fn().mockResolvedValue(0),
    backgroundAgentGetDailyUsage: vi.fn().mockResolvedValue(null),
    // Gamification
    gamificationGetStats: vi.fn().mockResolvedValue({
      totalXp: 0,
      todayXp: 0,
      level: 1,
      levelName: 'Novice',
      xpProgress: 0,
      xpNextLevel: 100,
      currentStreak: 0,
      longestStreak: 0,
      xpByCategory: {},
      focusTodaySessions: 0,
      focusTodayMinutes: 0,
      focusTotalSessions: 0,
      focusTotalMinutes: 0,
    }),
    gamificationGetAchievements: vi.fn().mockResolvedValue([]),
    gamificationGetDaily: vi.fn().mockResolvedValue([]),
    gamificationAwardXp: vi.fn().mockResolvedValue({ xpGained: 0 }),
    // Focus
    getFocusStats: vi.fn().mockResolvedValue({
      totalSessions: 0,
      totalMinutes: 0,
      todaySessions: 0,
      todayMinutes: 0,
      streak: 0,
    }),
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    notificationShow: vi.fn(),
    // Misc
    appVersion: '2.2.15',
    platform: 'win32',
  },
});

// ---------------------------------------------------------------------------
// Import stores and component after mocking
// ---------------------------------------------------------------------------
const { useProjectStore } = await import('../../stores/projectStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useIdeaStore } = await import('../../stores/ideaStore');
const { useBoardStore } = await import('../../stores/boardStore');
const { useFocusStore } = await import('../../stores/focusStore');
const { useBackgroundAgentStore } = await import('../../stores/backgroundAgentStore');
const { default: DashboardModern } = await import('../DashboardModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <DashboardModern />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('DashboardModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useProjectStore.setState({ projects: [], loading: false, error: null });
    useMeetingStore.setState({
      meetings: [],
      loading: false,
      error: null,
      actionItemCounts: {},
      selectedMeeting: null,
      generatingBrief: false,
      generatingActions: false,
      pendingActionCount: 0,
    });
    useIdeaStore.setState({ ideas: [], loading: false, error: null });
    useBoardStore.setState({ allCards: [] } as any);
    useFocusStore.setState({ mode: 'idle' } as any);
    useBackgroundAgentStore.setState({
      insights: [],
      newInsightsCount: 0,
      preferences: null,
      dailyUsage: null,
      loading: false,
    });
  });

  it('renders without crashing', () => {
    renderComponent();
    expect(screen.getByText('Your meetings, organized and private')).toBeInTheDocument();
  });

  it('shows the projects section heading', () => {
    renderComponent();
    // Stat card + section heading both contain SYS.PROJECTS
    const els = screen.getAllByText('SYS.PROJECTS');
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the meetings section heading', () => {
    renderComponent();
    // Stat card + section heading both contain SYS.MEETINGS
    const els = screen.getAllByText('SYS.MEETINGS');
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state for no projects', () => {
    renderComponent();
    expect(screen.getByText('Organize your work visually')).toBeInTheDocument();
  });

  it('quick action buttons render', () => {
    renderComponent();
    expect(screen.getByText('Record')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Brain')).toBeInTheDocument();
    expect(screen.getByText('Idea')).toBeInTheDocument();
    // "Focus" appears in both the quick action button and FocusStatsWidget
    expect(screen.getAllByText('Focus').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Standup')).toBeInTheDocument();
  });

  it('displays stat counts for meetings, projects, ideas', () => {
    useMeetingStore.setState({
      meetings: [
        {
          id: 'm1',
          title: 'Meeting A',
          template: 'standup',
          startedAt: '2026-03-10T10:00:00Z',
          endedAt: '2026-03-10T10:30:00Z',
          createdAt: '2026-03-10T10:00:00Z',
        },
        {
          id: 'm2',
          title: 'Meeting B',
          template: 'standup',
          startedAt: '2026-03-10T11:00:00Z',
          endedAt: '2026-03-10T11:30:00Z',
          createdAt: '2026-03-10T11:00:00Z',
        },
      ] as any,
    });
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'Proj', archived: false, createdAt: '2026-03-01' }] as any,
    });
    useIdeaStore.setState({ ideas: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] as any });

    renderComponent();

    expect(screen.getByText('2')).toBeInTheDocument(); // meetings
    expect(screen.getByText('1')).toBeInTheDocument(); // projects
    expect(screen.getByText('3')).toBeInTheDocument(); // ideas
  });

  it('shows the action items section heading', () => {
    renderComponent();
    expect(screen.getByText('SYS.ACTION_ITEMS')).toBeInTheDocument();
  });
});
