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

describe('SidebarModern — Projects unreviewed badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({ unreviewedAutoPushedCount: 0 });
  });

  it('does not render the badge when count is 0', () => {
    useMeetingStore.setState({ unreviewedAutoPushedCount: 0 });
    render(
      <MemoryRouter>
        <SidebarModern />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('projects-unreviewed-badge')).toBeNull();
  });

  it('renders a numeric badge on the Projects nav when count > 0', () => {
    useMeetingStore.setState({ unreviewedAutoPushedCount: 3 });
    render(
      <MemoryRouter>
        <SidebarModern />
      </MemoryRouter>,
    );
    const badge = screen.getByTestId('projects-unreviewed-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
  });

  it('caps the badge display at "9+" when count > 9', () => {
    useMeetingStore.setState({ unreviewedAutoPushedCount: 42 });
    render(
      <MemoryRouter>
        <SidebarModern />
      </MemoryRouter>,
    );
    const badge = screen.getByTestId('projects-unreviewed-badge');
    expect(badge).toHaveTextContent('9+');
  });
});
