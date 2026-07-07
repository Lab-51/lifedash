// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LiveCanvasTabs, { type CanvasTabDef } from '../LiveCanvasTabs';

const TABS: CanvasTabDef[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'board', label: 'Board' },
  { id: 'brain', label: 'Brain' },
];

describe('LiveCanvasTabs', () => {
  it('renders all tabs with correct aria-selected state', () => {
    render(<LiveCanvasTabs tabs={TABS} active="transcript" onSelect={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Brain' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelect with the clicked tab id', () => {
    const onSelect = vi.fn();
    render(<LiveCanvasTabs tabs={TABS} active="transcript" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));

    expect(onSelect).toHaveBeenCalledWith('board');
  });

  it('navigates to the next/previous tab with arrow keys (roving tabindex)', () => {
    const onSelect = vi.fn();
    render(<LiveCanvasTabs tabs={TABS} active="transcript" onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Transcript' }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('board');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Transcript' }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('brain');
  });

  it('only the active tab is keyboard-focusable (roving tabindex)', () => {
    render(<LiveCanvasTabs tabs={TABS} active="board" onSelect={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('tab', { name: 'Brain' })).toHaveAttribute('tabIndex', '-1');
  });

  it('shows a badge when a tab has a nonzero count and hides it at zero', () => {
    const withBadge: CanvasTabDef[] = [
      { id: 'transcript', label: 'Transcript', badge: 0 },
      { id: 'board', label: 'Board', badge: 3 },
      { id: 'brain', label: 'Brain' },
    ];
    render(<LiveCanvasTabs tabs={withBadge} active="transcript" onSelect={vi.fn()} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('caps the badge display at "9+"', () => {
    const withBadge: CanvasTabDef[] = [
      { id: 'transcript', label: 'Transcript' },
      { id: 'board', label: 'Board', badge: 12 },
      { id: 'brain', label: 'Brain' },
    ];
    render(<LiveCanvasTabs tabs={withBadge} active="transcript" onSelect={vi.fn()} />);

    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});
