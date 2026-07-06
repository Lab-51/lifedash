// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock @atlaskit/pragmatic-drag-and-drop — no real drag in jsdom
// ---------------------------------------------------------------------------
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));
vi.mock('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge', () => ({
  attachClosestEdge: (data: Record<string, unknown>) => data,
  extractClosestEdge: () => null,
}));

// ---------------------------------------------------------------------------
// Mock window.electronAPI
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  markCardReviewed: vi.fn().mockResolvedValue({}),
  rejectCard: vi.fn().mockResolvedValue({ card: {}, actionItem: null }),
  restoreRejectedCard: vi.fn().mockResolvedValue(undefined),
  countUnreviewedCards: vi.fn().mockResolvedValue(0),
});

// ---------------------------------------------------------------------------
// Imports must come AFTER mocks
// ---------------------------------------------------------------------------
const { default: KanbanCardModern } = await import('../KanbanCardModern');
import type { Card } from '../../../shared/types';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    columnId: 'col-1',
    title: 'Test card',
    description: null,
    position: 0,
    priority: 'medium',
    dueDate: null,
    completed: false,
    archived: false,
    source: 'manual',
    sourceMeetingId: null,
    reviewedAt: null,
    createdAt: new Date('2026-05-01').toISOString(),
    updatedAt: new Date('2026-05-01').toISOString(),
    ...overrides,
  };
}

const baseProps = {
  onUpdate: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
};

function renderCard(card: Card) {
  return render(
    <MemoryRouter>
      <KanbanCardModern card={card} {...baseProps} />
    </MemoryRouter>,
  );
}

describe('KanbanCardModern — auto-pushed source badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "From meeting" source badge when source=auto-from-meeting', () => {
    renderCard(makeCard({ source: 'auto-from-meeting', sourceMeetingId: 'm-1' }));
    expect(screen.getByTestId('card-source-badge')).toBeInTheDocument();
    expect(screen.getByTestId('card-source-badge')).toHaveTextContent(/from meeting/i);
  });

  it('does NOT render the source badge when source=manual', () => {
    renderCard(makeCard({ source: 'manual' }));
    expect(screen.queryByTestId('card-source-badge')).toBeNull();
  });
});

describe('KanbanCardModern — live-assistant source badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Live Assistant" source badge when source=live-assistant', () => {
    renderCard(makeCard({ source: 'live-assistant', sourceMeetingId: 'm-1' }));
    expect(screen.getByTestId('card-source-badge')).toBeInTheDocument();
    expect(screen.getByTestId('card-source-badge')).toHaveTextContent(/live assistant/i);
  });

  it('does NOT render the source badge when source=manual (live-assistant variant)', () => {
    renderCard(makeCard({ source: 'manual' }));
    expect(screen.queryByTestId('card-source-badge')).toBeNull();
  });
});

describe('KanbanCardModern — Reject menu visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the overflow menu trigger only on auto-pushed cards', () => {
    renderCard(makeCard({ source: 'auto-from-meeting', sourceMeetingId: 'm-1' }));
    // Overflow menu trigger has aria-label "Card actions"
    expect(screen.getByLabelText(/card actions/i)).toBeInTheDocument();
  });

  it('does NOT show the overflow menu trigger on manual cards', () => {
    renderCard(makeCard({ source: 'manual' }));
    expect(screen.queryByLabelText(/card actions/i)).toBeNull();
  });
});
