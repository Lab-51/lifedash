// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActivityFeed from '../ActivityFeed';
import type { ActivityFeedEntry } from '../../stores/activityFeedStore';

function makeEntry(overrides: Partial<ActivityFeedEntry> = {}): ActivityFeedEntry {
  return {
    id: 'e1',
    icon: 'tool-ok',
    label: 'Created card: "Send report"',
    timestamp: new Date().toISOString(),
    targetTab: 'board',
    ...overrides,
  };
}

describe('ActivityFeed', () => {
  it('shows the empty-state text when there are no entries', () => {
    render(<ActivityFeed entries={[]} onSelectTab={vi.fn()} />);
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
  });

  it('renders each entry label, newest-first order preserved from props', () => {
    render(
      <ActivityFeed
        entries={[
          makeEntry({ id: 'e1', label: 'Created card: "Send report"' }),
          makeEntry({ id: 'e2', label: 'Searched transcript' }),
        ]}
        onSelectTab={vi.fn()}
      />,
    );

    const items = screen.getAllByRole('button', { name: /go to/i });
    expect(items[0]).toHaveTextContent('Created card: "Send report"');
    expect(items[1]).toHaveTextContent('Searched transcript');
  });

  it("clicking an entry calls onSelectTab with that entry's targetTab (explicit user action)", () => {
    const onSelectTab = vi.fn();
    render(<ActivityFeed entries={[makeEntry({ targetTab: 'board' })]} onSelectTab={onSelectTab} />);

    fireEvent.click(screen.getByRole('button', { name: /go to board/i }));

    expect(onSelectTab).toHaveBeenCalledWith('board');
  });

  it('uses the provided title', () => {
    render(<ActivityFeed entries={[]} onSelectTab={vi.fn()} title="Session activity" />);
    expect(screen.getByText('Session activity')).toBeInTheDocument();
  });

  it('is collapsible: toggling the header hides and re-shows the list', () => {
    render(<ActivityFeed entries={[makeEntry()]} onSelectTab={vi.fn()} collapsible />);

    const toggle = screen.getByRole('button', { name: /collapse activity/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Created card: "Send report"')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: /expand activity/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Created card: "Send report"')).toBeNull();
  });

  it('is not collapsible by default — no toggle button rendered', () => {
    render(<ActivityFeed entries={[makeEntry()]} onSelectTab={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /collapse/i })).toBeNull();
  });
});
