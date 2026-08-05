// @vitest-environment jsdom
// === FILE PURPOSE ===
// FactInspector (TWIN-GRAPH.1 Task 4) — the memory-graph fact card that closed
// Task 3's "clicking a fact does nothing" gap. Covers what the component itself
// owns: the full fact content, the twin-fact category chip resolved over the
// EXISTING twin:memory-list channel (and honestly omitted when it can't be), the
// graph-derived provenance link, the in-canvas drill to the entity a fact is
// about, and the Forget request + the failure message the host feeds back.
//
// The optimistic removal and its ROLLBACK are deliberately NOT re-tested here:
// they live in memoryGraphStore.forgetNode and are covered by
// memoryGraphStore.test.ts. This component only ASKS — testing the ask here and
// the store's round trip there keeps one behaviour in one place.
//
// FactInspector has no mounted host right now (see BrainMemoryGraph's header):
// it is exercised directly, which is why this suite stands on its own.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BrainNode, TwinFact } from '../../../shared/types';

const twinMemoryList = vi.fn().mockResolvedValue([]);
vi.stubGlobal('electronAPI', { twinMemoryList });

const { default: FactInspector, isFactNode } = await import('../brain-inspector/FactInspector');
type FactNode = Parameters<typeof FactInspector>[0]['node'];

const ENTITY_FACT: FactNode = {
  id: 'entity-fact:f1',
  type: 'entityFact',
  label: 'Prefers async written updates over stand-ups',
  recordId: 'f1',
};
const TWIN_FACT: FactNode = { id: 'twin-fact:t1', type: 'twinFact', label: 'Ships on Fridays', recordId: 't1' };

const ADA: BrainNode = {
  id: 'entity:e1',
  type: 'person',
  label: 'Ada Lovelace',
  entityId: 'e1',
  childCount: 0,
  children: [],
};

const twinFact = (over: Partial<TwinFact> = {}): TwinFact => ({
  id: 't1',
  fact: 'Ships on Fridays',
  label: null,
  category: 'commitment',
  sourceMeetingId: 'm1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

function renderInspector(node: FactNode, over: Partial<Parameters<typeof FactInspector>[0]> = {}) {
  const props = {
    node,
    relations: { entity: ADA, session: { meetingId: 'm1', title: 'Kickoff' } },
    onOpenEntity: vi.fn(),
    onInspectNode: vi.fn(),
    onForget: vi.fn(),
    ...over,
  };
  render(<FactInspector {...props} />);
  return props;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  twinMemoryList.mockResolvedValue([]);
});

describe('isFactNode', () => {
  it('recognises exactly the two fact ledgers and nothing else', () => {
    expect(isFactNode(ENTITY_FACT)).toBe(true);
    expect(isFactNode(TWIN_FACT)).toBe(true);
    expect(isFactNode(ADA)).toBe(false);
  });
});

describe('FactInspector — content', () => {
  it('renders the FULL fact content, not the truncated canvas label', () => {
    renderInspector(ENTITY_FACT);

    expect(screen.getByTestId('brain-inspector-fact')).toBeInTheDocument();
    expect(screen.getByText('Prefers async written updates over stand-ups')).toBeInTheDocument();
  });

  it('never fetches the twin ledger for an entity fact (it has no category)', async () => {
    renderInspector(ENTITY_FACT);

    await waitFor(() => expect(screen.getByTestId('brain-inspector-fact')).toBeInTheDocument());
    expect(twinMemoryList).not.toHaveBeenCalled();
  });

  it('shows a twin fact’s category chip, resolved over the existing ledger channel', async () => {
    twinMemoryList.mockResolvedValue([twinFact()]);
    renderInspector(TWIN_FACT);

    expect(await screen.findByLabelText('Category: Commitment')).toHaveTextContent('Commitment');
  });

  it('omits the chip rather than guessing when the fact is not in the ledger', async () => {
    twinMemoryList.mockResolvedValue([twinFact({ id: 'someone-else' })]);
    renderInspector(TWIN_FACT);

    await waitFor(() => expect(twinMemoryList).toHaveBeenCalled());
    expect(screen.queryByText('Commitment')).toBeNull();
  });

  it('omits the chip when the ledger lookup rejects (no chip beats a wrong one)', async () => {
    twinMemoryList.mockRejectedValue(new Error('db down'));
    renderInspector(TWIN_FACT);

    await waitFor(() => expect(twinMemoryList).toHaveBeenCalled());
    expect(screen.getByText('Ships on Fridays')).toBeInTheDocument();
    expect(screen.queryByText('Commitment')).toBeNull();
  });
});

describe('FactInspector — provenance and drill-through', () => {
  it('links to the session the fact was learned in, by title', () => {
    const { onOpenEntity } = renderInspector(ENTITY_FACT);

    fireEvent.click(screen.getByRole('button', { name: 'learned in Kickoff' }));

    expect(onOpenEntity).toHaveBeenCalledWith({ type: 'session', entityId: 'm1' });
  });

  it('says so plainly when the source session is not in the current view', () => {
    renderInspector(ENTITY_FACT, { relations: { entity: ADA, session: null } });

    expect(screen.getByText('Source session not in this view.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /learned in/ })).toBeNull();
  });

  it('re-targets the inspector to the entity the fact is about (in-canvas drill)', () => {
    const { onInspectNode } = renderInspector(ENTITY_FACT);

    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));

    expect(onInspectNode).toHaveBeenCalledWith(ADA);
  });

  it('shows no "About" section for a twin fact (it is attributed to no entity)', async () => {
    renderInspector(TWIN_FACT, { relations: { entity: null, session: { meetingId: 'm1', title: 'Kickoff' } } });

    await waitFor(() => expect(twinMemoryList).toHaveBeenCalled());
    expect(screen.queryByText('About')).toBeNull();
  });
});

describe('FactInspector — forget', () => {
  it('asks the host to forget THIS fact, with an accessible name naming it', () => {
    const { onForget } = renderInspector(ENTITY_FACT);

    fireEvent.click(screen.getByLabelText('Forget: Prefers async written updates over stand-ups'));

    expect(onForget).toHaveBeenCalledWith(ENTITY_FACT);
  });

  it('surfaces a failed forget as an alert — never a silent no-op that looks like data loss', () => {
    renderInspector(TWIN_FACT, { forgetError: 'Could not forget this memory — it is still here.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not forget this memory — it is still here.');
  });

  it('shows no error text on the happy path', () => {
    renderInspector(ENTITY_FACT);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
