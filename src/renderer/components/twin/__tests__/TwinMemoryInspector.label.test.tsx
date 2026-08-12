// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinMemoryInspector's provenance label priority (TWIN-LEARN.1 Task 2). A kept
// fact whose source meeting was deleted via "keep what the twin learned" carries
// MEET-DEL.1's `sourceMeetingLabel` snapshot as its ONLY surviving provenance —
// this proves the inspector actually shows it instead of the generic "a past
// session" fallback. Renders TwinMemoryInspector directly (not through the whole
// graph/store), which is why this is its own small file rather than an addition
// to TwinMemoryGraph.test.tsx: that file already owns the graph-level provenance
// coverage (title present, both absent) and is off limits this phase (TWIN-LIGHT.1).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TwinMemoryInspector from '../TwinMemoryInspector';
import type { TwinGraphNode } from '../../../../shared/types';

function factNode(overrides: Partial<TwinGraphNode> = {}): TwinGraphNode {
  return {
    id: 'fact:f1',
    type: 'fact',
    tier: 2,
    label: 'Ships Friday',
    text: 'The team ships the release on Friday.',
    recordId: 'f1',
    category: 'commitment',
    degree: 1,
    newestTimestamp: '2026-08-01T00:00:00.000Z',
    sourceMeetingId: null,
    sourceMeetingTitle: null,
    ...overrides,
  };
}

function renderInspector(node: TwinGraphNode) {
  return render(
    <TwinMemoryInspector
      node={node}
      scopeFactCount={0}
      autoFocus={false}
      onForget={vi.fn()}
      onOpenSession={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('TwinMemoryInspector — sourceMeetingLabel provenance (TWIN-LEARN.1 Task 2)', () => {
  it('shows the MEET-DEL.1 snapshot label — and offers no dead link — when the source meeting was deleted but kept', () => {
    renderInspector(
      factNode({
        sourceMeetingId: null,
        sourceMeetingTitle: null,
        sourceMeetingLabel: 'Roadmap review — deleted 2026-08-06',
      }),
    );

    expect(screen.getByText('learned in Roadmap review — deleted 2026-08-06')).toBeInTheDocument();
    // No dead link: the source meeting row is gone, there is nothing to open.
    expect(screen.queryByRole('button', { name: /learned in/i })).not.toBeInTheDocument();
  });

  it('keeps the generic "a past session" fallback for a payload with no sourceMeetingLabel field at all (pre-existing shape)', () => {
    // No sourceMeetingLabel key whatsoever — the shape every fixture had before
    // this field existed (and still has, e.g. TwinMemoryGraph.test.tsx's frozen
    // fixtures). Must degrade exactly like an explicit null, never throw or blank.
    renderInspector(factNode({ sourceMeetingId: null, sourceMeetingTitle: null }));

    expect(screen.getByText('learned in a past session')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /learned in/i })).not.toBeInTheDocument();
  });

  it('still prefers a LIVE session title over a stamped label when both happen to be present', () => {
    renderInspector(
      factNode({
        sourceMeetingId: 'meeting-1',
        sourceMeetingTitle: 'Weekly Sync',
        sourceMeetingLabel: 'Roadmap review — deleted 2026-08-06',
      }),
    );

    expect(screen.getByRole('button', { name: 'learned in Weekly Sync' })).toBeInTheDocument();
    expect(screen.queryByText(/Roadmap review/)).not.toBeInTheDocument();
  });
});
