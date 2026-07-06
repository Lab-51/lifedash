// @vitest-environment jsdom
// LIVE.2 Task 6 — the post-meeting "Live proposals" section. Loads independently
// via listLiveSuggestions (own local state, not liveSuggestionsStore, which
// clears on recording stop) so un-actioned proposals survive meeting end.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { LiveSuggestion } from '../../../shared/types';

const listLiveSuggestions = vi.fn();
const acceptLiveSuggestion = vi.fn();
const dismissLiveSuggestion = vi.fn();

vi.stubGlobal('electronAPI', {
  listLiveSuggestions,
  acceptLiveSuggestion,
  dismissLiveSuggestion,
});

const { default: LiveProposalsSection } = await import('../meeting-detail/LiveProposalsSection');

function makeSuggestion(overrides: Partial<LiveSuggestion> = {}): LiveSuggestion {
  return {
    id: 's1',
    meetingId: 'meeting-1',
    type: 'action_item',
    title: 'Ship the beta',
    description: null,
    status: 'proposed',
    acceptedCardId: null,
    acceptedProjectId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:05Z',
    ...overrides,
  };
}

describe('LiveProposalsSection (post-meeting)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when there are no un-actioned proposals for the meeting', async () => {
    listLiveSuggestions.mockResolvedValue([]);
    const { container } = render(<LiveProposalsSection meetingId="meeting-1" projectName="Acme" />);
    await waitFor(() => expect(listLiveSuggestions).toHaveBeenCalledWith('meeting-1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('loads and renders proposed suggestions for the meeting independently (not via the live store)', async () => {
    listLiveSuggestions.mockResolvedValue([
      makeSuggestion({ id: 's1', title: 'Ship the beta' }),
      makeSuggestion({ id: 's2', title: 'Follow up with design', status: 'accepted' }),
      makeSuggestion({ id: 's3', title: 'Dismissed item', status: 'dismissed' }),
    ]);

    render(<LiveProposalsSection meetingId="meeting-1" projectName="Acme" />);

    await waitFor(() => expect(screen.getByText('Ship the beta')).toBeInTheDocument());
    expect(screen.getByText('Live proposals')).toBeInTheDocument();
    expect(screen.getByText('(1 pending)')).toBeInTheDocument();
    // Already-actioned suggestions are not shown as pending chips.
    expect(screen.queryByText('Follow up with design')).toBeNull();
    expect(screen.queryByText('Dismissed item')).toBeNull();
  });

  it('accept: calls acceptLiveSuggestion and shows "Added to {project} Inbox" for an action_item', async () => {
    listLiveSuggestions.mockResolvedValue([makeSuggestion({ id: 's1', title: 'Ship the beta' })]);
    acceptLiveSuggestion.mockResolvedValue(makeSuggestion({ id: 's1', status: 'accepted', acceptedCardId: 'card-1' }));

    render(<LiveProposalsSection meetingId="meeting-1" projectName="Acme" />);
    await waitFor(() => expect(screen.getByText('Ship the beta')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Accept: Ship the beta'));

    expect(acceptLiveSuggestion).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.getByText('Added to Acme Inbox')).toBeInTheDocument());
    // The accepted chip is no longer shown as pending.
    expect(screen.queryByText('(1 pending)')).toBeNull();
  });

  it('dismiss: calls dismissLiveSuggestion and removes the chip from the pending list', async () => {
    listLiveSuggestions.mockResolvedValue([makeSuggestion({ id: 's1', title: 'Ship the beta' })]);
    dismissLiveSuggestion.mockResolvedValue(makeSuggestion({ id: 's1', status: 'dismissed' }));

    render(<LiveProposalsSection meetingId="meeting-1" projectName="Acme" />);
    await waitFor(() => expect(screen.getByText('Ship the beta')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Dismiss: Ship the beta'));

    expect(dismissLiveSuggestion).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.queryByText('Ship the beta')).toBeNull());
  });
});
