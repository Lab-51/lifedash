// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { LiveSuggestion } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  acceptLiveSuggestion: vi.fn(),
  dismissLiveSuggestion: vi.fn(),
  listLiveSuggestions: vi.fn().mockResolvedValue([]),
  onLiveTriageSuggestion: vi.fn().mockReturnValue(() => {}),
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useLiveSuggestionsStore } = await import('../../stores/liveSuggestionsStore');
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { default: LiveProposalsFeed } = await import('../LiveProposalsFeed');

function makeSuggestion(overrides: Partial<LiveSuggestion> = {}): LiveSuggestion {
  return {
    id: 's1',
    meetingId: 'meeting-1',
    type: 'action_item',
    title: 'Follow up with design',
    description: null,
    status: 'proposed',
    acceptedCardId: null,
    acceptedProjectId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:05Z',
    ...overrides,
  };
}

describe('LiveProposalsFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLiveSuggestionsStore.setState({
      meetingId: 'meeting-1',
      suggestions: [],
      error: null,
    } as never);
    useRecordingStore.setState({ meetingId: 'meeting-1' } as never);
    useMeetingStore.setState({ meetings: [{ id: 'meeting-1', projectId: 'proj-1' }] } as never);
    useProjectStore.setState({ projects: [{ id: 'proj-1', name: 'Acme' }] } as never);
  });

  it('shows the empty state when there are no pending proposals', () => {
    render(<LiveProposalsFeed />);
    expect(screen.getByText('Listening for action items…')).toBeInTheDocument();
  });

  it('renders a chip per proposed suggestion, newest first', () => {
    useLiveSuggestionsStore.setState({
      suggestions: [
        makeSuggestion({ id: 's1', title: 'Older item' }),
        makeSuggestion({ id: 's2', title: 'Newer item' }),
      ],
    } as never);

    render(<LiveProposalsFeed />);

    const titles = screen.getAllByText(/^(Newer|Older) item$/).map((el) => el.textContent);
    expect(titles).toEqual(['Newer item', 'Older item']);
  });

  it('does not render suggestions that are already accepted or dismissed', () => {
    useLiveSuggestionsStore.setState({
      suggestions: [
        makeSuggestion({ id: 's1', status: 'accepted' }),
        makeSuggestion({ id: 's2', status: 'dismissed' }),
      ],
    } as never);

    render(<LiveProposalsFeed />);

    expect(screen.getByText('Listening for action items…')).toBeInTheDocument();
  });

  it('renders the type label for decision and question suggestions', () => {
    useLiveSuggestionsStore.setState({
      suggestions: [
        makeSuggestion({ id: 's1', type: 'decision', title: 'Go with option B' }),
        makeSuggestion({ id: 's2', type: 'question', title: 'Who owns the rollout?' }),
      ],
    } as never);

    render(<LiveProposalsFeed />);

    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Question')).toBeInTheDocument();
  });

  it('accept: calls the store action and shows "Added to {project} Inbox" for an action_item', async () => {
    const accept = vi.fn().mockResolvedValue(makeSuggestion({ id: 's1', status: 'accepted', acceptedCardId: 'c1' }));
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', title: 'Ship the beta' })],
      accept,
    } as never);

    render(<LiveProposalsFeed />);
    fireEvent.click(screen.getByLabelText('Accept: Ship the beta'));

    expect(accept).toHaveBeenCalledWith('s1');
    await waitFor(() => {
      expect(screen.getByText('Added to Acme Inbox')).toBeInTheDocument();
    });
  });

  it('accept: falls back to "Unassigned" when the meeting has no project', async () => {
    useMeetingStore.setState({ meetings: [{ id: 'meeting-1', projectId: null }] } as never);
    const accept = vi.fn().mockResolvedValue(makeSuggestion({ id: 's1', status: 'accepted', acceptedCardId: 'c1' }));
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', title: 'Ship the beta' })],
      accept,
    } as never);

    render(<LiveProposalsFeed />);
    fireEvent.click(screen.getByLabelText('Accept: Ship the beta'));

    await waitFor(() => {
      expect(screen.getByText('Added to Unassigned Inbox')).toBeInTheDocument();
    });
  });

  it('accept: does not show a confirmation when the store rolls back (IPC failure)', async () => {
    const accept = vi.fn().mockResolvedValue(null);
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', title: 'Ship the beta' })],
      accept,
    } as never);

    render(<LiveProposalsFeed />);
    fireEvent.click(screen.getByLabelText('Accept: Ship the beta'));

    await waitFor(() => expect(accept).toHaveBeenCalled());
    expect(screen.queryByText(/Added to/)).toBeNull();
  });

  it('accept: does not show an Inbox confirmation for decision/question suggestions', async () => {
    const accept = vi.fn().mockResolvedValue(makeSuggestion({ id: 's1', type: 'decision', status: 'accepted' }));
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', type: 'decision', title: 'Go with option B' })],
      accept,
    } as never);

    render(<LiveProposalsFeed />);
    fireEvent.click(screen.getByLabelText('Accept: Go with option B'));

    await waitFor(() => expect(accept).toHaveBeenCalled());
    expect(screen.queryByText(/Added to/)).toBeNull();
  });

  it('accept: "project" chip refreshes the project/meeting stores and shows the linked confirmation', async () => {
    const loadProjects = vi.fn().mockResolvedValue(undefined);
    const loadMeetings = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ loadProjects } as never);
    useMeetingStore.setState({ loadMeetings } as never);
    const accept = vi.fn().mockResolvedValue(
      makeSuggestion({
        id: 's1',
        type: 'project',
        title: 'Mobile App Revamp',
        status: 'accepted',
        acceptedProjectId: 'p9',
      }),
    );
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', type: 'project', title: 'Mobile App Revamp' })],
      accept,
    } as never);

    render(<LiveProposalsFeed />);
    // The Accept button reads "Create" for a project chip.
    fireEvent.click(screen.getByLabelText('Create: Mobile App Revamp'));

    expect(accept).toHaveBeenCalledWith('s1');
    await waitFor(() => {
      expect(screen.getByText('Created project "Mobile App Revamp" — meeting linked')).toBeInTheDocument();
    });
    expect(loadProjects).toHaveBeenCalledTimes(1);
    expect(loadMeetings).toHaveBeenCalledTimes(1);
  });

  it('dismiss: has no side effects (no store refreshes)', () => {
    const loadProjects = vi.fn();
    const loadMeetings = vi.fn();
    useProjectStore.setState({ loadProjects } as never);
    useMeetingStore.setState({ loadMeetings } as never);
    const dismiss = vi.fn().mockResolvedValue(undefined);
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', type: 'project', title: 'Mobile App Revamp' })],
      dismiss,
    } as never);

    render(<LiveProposalsFeed />);
    fireEvent.click(screen.getByLabelText('Dismiss: Mobile App Revamp'));

    expect(dismiss).toHaveBeenCalledWith('s1');
    expect(loadProjects).not.toHaveBeenCalled();
    expect(loadMeetings).not.toHaveBeenCalled();
  });

  it('dismiss: calls the store action with the suggestion id', () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', title: 'Ship the beta' })],
      dismiss,
    } as never);

    render(<LiveProposalsFeed />);
    fireEvent.click(screen.getByLabelText('Dismiss: Ship the beta'));

    expect(dismiss).toHaveBeenCalledWith('s1');
  });

  it('chips and their Accept/Dismiss controls are real, keyboard-operable buttons', () => {
    useLiveSuggestionsStore.setState({
      suggestions: [makeSuggestion({ id: 's1', title: 'Ship the beta' })],
    } as never);

    render(<LiveProposalsFeed />);

    expect(screen.getByRole('button', { name: 'Accept: Ship the beta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss: Ship the beta' })).toBeInTheDocument();
  });
});
