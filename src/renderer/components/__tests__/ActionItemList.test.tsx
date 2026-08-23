// @vitest-environment jsdom
// ActionItemList owner/due rendering (BRIEF-QUAL.1 Task 4): owner renders as a
// leading chip and dueText as a muted suffix when known; an item with neither
// shows no chip and — critically — never the word "Unassigned".
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionItemList from '../ActionItemList';
import type { ActionItem } from '../../../shared/types';

function makeItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'a1',
    meetingId: 'meet-1',
    cardId: null,
    description: 'Send the doc',
    owner: null,
    dueText: null,
    status: 'pending',
    createdAt: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

const noop = () => {};

describe('ActionItemList — owner/due rendering (BRIEF-QUAL.1 Task 4)', () => {
  it('renders the owner as a leading chip when known', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ owner: 'Alex Chen' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.getByText('Alex Chen')).toBeInTheDocument();
  });

  it('renders dueText as a muted suffix when present', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ dueText: 'Friday' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.getByText('Due Friday')).toBeInTheDocument();
  });

  it('shows no chip and never the word "Unassigned" when owner is unknown', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ owner: null, dueText: null })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.queryByText(/unassigned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Due /)).not.toBeInTheDocument();
  });

  it('renders both owner and due together on the same item', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ owner: 'Sam Rivera', dueText: 'end of Q3' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Due end of Q3')).toBeInTheDocument();
  });
});
