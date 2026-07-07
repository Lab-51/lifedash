// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// jsdom doesn't implement matchMedia — useTheme reads it on mount
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// Mock window.electronAPI BEFORE store/component imports
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  countUnreviewedCards: vi.fn().mockResolvedValue(0),
  backgroundAgentGetNewCount: vi.fn().mockResolvedValue(0),
  // Sidebar reads/calls audio-recording bits via RecordingIndicator child
  onRecordingState: vi.fn().mockReturnValue(() => {}),
});

// ---------------------------------------------------------------------------
const { useMeetingStore } = await import('../../stores/meetingStore');
const { default: SidebarModern } = await import('../SidebarModern');

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarModern />
    </MemoryRouter>,
  );
}

describe('SidebarModern — V3.1 IA collapse (3-entry nav)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({ unreviewedAutoPushedCount: 0 });
  });

  it('renders exactly 3 nav entries', () => {
    renderSidebar();
    expect(screen.getAllByTestId('nav-item')).toHaveLength(3);
  });

  it('legacy surfaces (Projects, Brainstorm, Ideas, Focus, Intel) are absent from the nav', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /projects/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /brainstorm/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /ideas/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /focus/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /intel/i })).toBeNull();
  });

  it('renders a Sessions link pointing at the home route', () => {
    renderSidebar();
    const sessions = screen.getByRole('link', { name: /sessions/i });
    expect(sessions).toHaveAttribute('href', '/');
  });

  it('renders a Settings link pointing at /settings', () => {
    renderSidebar();
    const settings = screen.getByRole('link', { name: /settings/i });
    expect(settings).toHaveAttribute('href', '/settings');
  });

  it('renders the Twin entry as disabled with an "arrives in V3.3" tooltip', () => {
    renderSidebar();
    const twin = screen.getByRole('button', { name: /twin/i });
    expect(twin).toHaveAttribute('aria-disabled', 'true');
    expect(twin).toHaveAttribute('title', 'Twin — arrives in V3.3');
  });
});

describe('SidebarModern — unreviewed auto-pushed cards badge (now on Sessions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({ unreviewedAutoPushedCount: 0 });
  });

  it('does not render the badge when count is 0', () => {
    useMeetingStore.setState({ unreviewedAutoPushedCount: 0 });
    renderSidebar();
    expect(screen.queryByTestId('sessions-unreviewed-badge')).toBeNull();
  });

  it('renders a numeric badge on the Sessions nav when count > 0', () => {
    useMeetingStore.setState({ unreviewedAutoPushedCount: 3 });
    renderSidebar();
    const badge = screen.getByTestId('sessions-unreviewed-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
  });

  it('caps the badge display at "9+" when count > 9', () => {
    useMeetingStore.setState({ unreviewedAutoPushedCount: 42 });
    renderSidebar();
    const badge = screen.getByTestId('sessions-unreviewed-badge');
    expect(badge).toHaveTextContent('9+');
  });
});
