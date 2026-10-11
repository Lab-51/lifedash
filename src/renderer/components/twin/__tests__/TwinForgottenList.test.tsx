// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinForgottenList (TWIN-LOOP.2 Task 3): the Forgotten list's Restore and Delete
// permanently. Pinned here: nothing is erased without the confirm dialog, the
// confirm copy says backups made before now still contain the text, Cancel returns
// focus to the button that opened the dialog, a completed delete moves focus to the
// list heading, and a refused restore/purge says so. Fixture text is synthetic.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinFact } from '../../../../shared/types';

const twinMemoryPurge = vi.fn();
const twinMemoryPurgeAllForgotten = vi.fn();
const twinMemoryRestore = vi.fn();
vi.stubGlobal('electronAPI', { twinMemoryPurge, twinMemoryPurgeAllForgotten, twinMemoryRestore });

const { default: TwinForgottenList } = await import('../TwinForgottenList');

const LONG_FACT = `Prefers ${'very '.repeat(60)}long written agendas sent the day before`;

function forgottenFact(id: string, fact: string): TwinFact {
  return {
    id,
    fact,
    label: null,
    category: 'preference',
    sourceMeetingId: null,
    status: 'forgotten',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

const FACTS = [forgottenFact('11111111-1111-4111-8111-111111111111', LONG_FACT), forgottenFact('f2', 'Drinks tea')];

const onChanged = vi.fn();

function renderList(facts: TwinFact[] | null = FACTS) {
  return render(<TwinForgottenList facts={facts} loadError={false} onChanged={onChanged} />);
}

const list = () => screen.getByRole('list', { name: 'Forgotten facts' });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  onChanged.mockResolvedValue(undefined);
});

describe('TwinForgottenList', () => {
  it('lists each forgotten fact with Restore and Delete permanently, wrapping long text', () => {
    renderList();

    const rows = within(list()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(LONG_FACT)).toHaveClass('break-words');
    expect(within(rows[0]).getByRole('button', { name: `Restore: ${LONG_FACT}` })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: `Delete permanently: ${LONG_FACT}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete all forgotten permanently' })).toBeInTheDocument();
  });

  it('says so when nothing is forgotten, and offers no delete-all', () => {
    renderList([]);
    expect(screen.getByText('Nothing is forgotten.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete all/i })).not.toBeInTheDocument();
  });

  it('Delete permanently asks first; Cancel erases nothing and returns focus to the button', () => {
    renderList();
    const deleteButton = within(list()).getByRole('button', { name: /^Delete permanently: Drinks tea/ });
    deleteButton.focus();
    fireEvent.click(deleteButton);

    expect(screen.getByText('Delete this fact permanently?')).toBeInTheDocument();
    expect(screen.getByText(/backups made before now still contain the text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(twinMemoryPurge).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this fact permanently?')).not.toBeInTheDocument();
    expect(deleteButton).toHaveFocus();
  });

  it('confirming purges that one fact, reloads the list and moves focus to the heading', async () => {
    twinMemoryPurge.mockResolvedValue(true);
    renderList();
    fireEvent.click(within(list()).getByRole('button', { name: /^Delete permanently: Prefers very/ }));
    // The whole fact is shown in the dialog, in an overflow-safe block.
    expect(screen.getAllByText(LONG_FACT).at(-1)).toHaveClass('break-words', 'overflow-y-auto');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    });
    expect(twinMemoryPurge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(onChanged).toHaveBeenCalledWith(false);
    expect(screen.getByRole('heading', { name: 'Forgotten facts' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Delete all asks with the count and the backup note, then purges every forgotten fact', async () => {
    twinMemoryPurgeAllForgotten.mockResolvedValue(2);
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all forgotten permanently' }));

    expect(screen.getByText('Delete all forgotten facts permanently?')).toBeInTheDocument();
    expect(
      screen.getByText(/All 2 forgotten facts .* Backups made before now still contain the text\./),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    });
    expect(twinMemoryPurgeAllForgotten).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(false);
  });

  it('Restore brings the fact back (no confirm) and tells the host to refresh the graph', async () => {
    twinMemoryRestore.mockResolvedValue({ ...FACTS[1], status: 'active' });
    renderList();
    await act(async () => {
      fireEvent.click(within(list()).getByRole('button', { name: /^Restore: Drinks tea/ }));
    });
    expect(twinMemoryRestore).toHaveBeenCalledWith('f2');
    expect(onChanged).toHaveBeenCalledWith(true);
  });

  it('a refused purge or restore says so', async () => {
    twinMemoryPurge.mockResolvedValue(false);
    twinMemoryRestore.mockResolvedValue(null);
    renderList();

    fireEvent.click(within(list()).getByRole('button', { name: /^Delete permanently: Drinks tea/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not delete that fact permanently/i);

    await act(async () => {
      fireEvent.click(within(list()).getByRole('button', { name: /^Restore: Drinks tea/ }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not restore that fact/i);
    expect(onChanged).not.toHaveBeenCalledWith(true);
  });
});
