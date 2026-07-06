import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LiveSuggestion } from '../../../shared/types';

vi.stubGlobal('electronAPI', {
  acceptLiveSuggestion: vi.fn(),
  dismissLiveSuggestion: vi.fn(),
  listLiveSuggestions: vi.fn().mockResolvedValue([]),
  onLiveTriageSuggestion: vi.fn().mockReturnValue(() => {}),
});
vi.stubGlobal('window', globalThis);

const { useRecordingStore } = await import('../recordingStore');
const { useLiveSuggestionsStore, selectPendingProposals, selectPendingCount } = await import('../liveSuggestionsStore');

/** Flush the microtask queue so fire-and-forget async reactions (e.g. the
 * recordingStore subscribe callback's `void loadForMeeting(...)`) resolve. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('liveSuggestionsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.listLiveSuggestions).mockResolvedValue([]);
    vi.mocked(window.electronAPI.onLiveTriageSuggestion).mockReturnValue(() => {});
    useLiveSuggestionsStore.setState({ meetingId: null, suggestions: [], error: null });
    useRecordingStore.setState({ meetingId: null });
  });

  it('loads existing suggestions when recordingStore.meetingId transitions to a value (recording start)', async () => {
    const existing = [makeSuggestion({ id: 's1' }), makeSuggestion({ id: 's2', status: 'accepted' })];
    vi.mocked(window.electronAPI.listLiveSuggestions).mockResolvedValueOnce(existing);

    const cleanup = useLiveSuggestionsStore.getState().initListener();
    useRecordingStore.setState({ meetingId: 'meeting-1' });
    await flush();

    expect(window.electronAPI.listLiveSuggestions).toHaveBeenCalledWith('meeting-1');
    expect(useLiveSuggestionsStore.getState().meetingId).toBe('meeting-1');
    expect(useLiveSuggestionsStore.getState().suggestions).toHaveLength(2);
    cleanup();
  });

  it('clears all state when recordingStore.meetingId transitions to null (stop/cancel)', async () => {
    vi.mocked(window.electronAPI.listLiveSuggestions).mockResolvedValueOnce([makeSuggestion()]);
    const cleanup = useLiveSuggestionsStore.getState().initListener();
    useRecordingStore.setState({ meetingId: 'meeting-1' });
    await flush();
    expect(useLiveSuggestionsStore.getState().suggestions).toHaveLength(1);

    useRecordingStore.setState({ meetingId: null });

    expect(useLiveSuggestionsStore.getState().suggestions).toEqual([]);
    expect(useLiveSuggestionsStore.getState().meetingId).toBeNull();
    cleanup();
  });

  it('appends a new suggestion from the live-triage:suggestion event for the active meeting', () => {
    let handler: ((suggestion: LiveSuggestion) => void) | undefined;
    vi.mocked(window.electronAPI.onLiveTriageSuggestion).mockImplementation((cb) => {
      handler = cb;
      return () => {};
    });

    const cleanup = useLiveSuggestionsStore.getState().initListener();
    useLiveSuggestionsStore.setState({ meetingId: 'meeting-1' });

    handler?.(makeSuggestion({ id: 'new-1' }));

    expect(useLiveSuggestionsStore.getState().suggestions.map((s) => s.id)).toEqual(['new-1']);
    cleanup();
  });

  it('ignores a live-triage:suggestion event for a different (stale) meeting', () => {
    let handler: ((suggestion: LiveSuggestion) => void) | undefined;
    vi.mocked(window.electronAPI.onLiveTriageSuggestion).mockImplementation((cb) => {
      handler = cb;
      return () => {};
    });

    const cleanup = useLiveSuggestionsStore.getState().initListener();
    useLiveSuggestionsStore.setState({ meetingId: 'meeting-1' });

    handler?.(makeSuggestion({ id: 'stray-1', meetingId: 'meeting-OTHER' }));

    expect(useLiveSuggestionsStore.getState().suggestions).toEqual([]);
    cleanup();
  });

  it('accept: optimistically marks accepted, then reconciles with the IPC result', async () => {
    useLiveSuggestionsStore.setState({ meetingId: 'meeting-1', suggestions: [makeSuggestion({ id: 's1' })] });
    let resolveAccept: (value: LiveSuggestion) => void = () => {};
    vi.mocked(window.electronAPI.acceptLiveSuggestion).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAccept = resolve;
      }),
    );

    const pending = useLiveSuggestionsStore.getState().accept('s1');
    // Optimistic update happens synchronously before the IPC call resolves.
    expect(useLiveSuggestionsStore.getState().suggestions[0].status).toBe('accepted');

    const serverResult = makeSuggestion({ id: 's1', status: 'accepted', acceptedCardId: 'card-1' });
    resolveAccept(serverResult);
    const result = await pending;

    expect(result).toEqual(serverResult);
    expect(useLiveSuggestionsStore.getState().suggestions[0].acceptedCardId).toBe('card-1');
  });

  it('accept: rolls back on IPC failure and surfaces an error', async () => {
    const original = makeSuggestion({ id: 's1' });
    useLiveSuggestionsStore.setState({ meetingId: 'meeting-1', suggestions: [original] });
    vi.mocked(window.electronAPI.acceptLiveSuggestion).mockRejectedValueOnce(new Error('Failed to create card'));

    const result = await useLiveSuggestionsStore.getState().accept('s1');

    expect(result).toBeNull();
    expect(useLiveSuggestionsStore.getState().suggestions).toEqual([original]);
    expect(useLiveSuggestionsStore.getState().error).toBe('Failed to create card');
  });

  it('dismiss: optimistically marks dismissed, then reconciles with the IPC result', async () => {
    useLiveSuggestionsStore.setState({ meetingId: 'meeting-1', suggestions: [makeSuggestion({ id: 's1' })] });
    vi.mocked(window.electronAPI.dismissLiveSuggestion).mockResolvedValueOnce(
      makeSuggestion({ id: 's1', status: 'dismissed' }),
    );

    const pending = useLiveSuggestionsStore.getState().dismiss('s1');
    expect(useLiveSuggestionsStore.getState().suggestions[0].status).toBe('dismissed');
    await pending;

    expect(useLiveSuggestionsStore.getState().suggestions[0].status).toBe('dismissed');
  });

  it('dismiss: rolls back on IPC failure and surfaces an error', async () => {
    const original = makeSuggestion({ id: 's1' });
    useLiveSuggestionsStore.setState({ meetingId: 'meeting-1', suggestions: [original] });
    vi.mocked(window.electronAPI.dismissLiveSuggestion).mockRejectedValueOnce(new Error('Network error'));

    await useLiveSuggestionsStore.getState().dismiss('s1');

    expect(useLiveSuggestionsStore.getState().suggestions).toEqual([original]);
    expect(useLiveSuggestionsStore.getState().error).toBe('Network error');
  });

  it('selectPendingProposals / selectPendingCount only count "proposed" items', () => {
    useLiveSuggestionsStore.setState({
      suggestions: [
        makeSuggestion({ id: 's1', status: 'proposed' }),
        makeSuggestion({ id: 's2', status: 'accepted' }),
        makeSuggestion({ id: 's3', status: 'dismissed' }),
        makeSuggestion({ id: 's4', status: 'proposed' }),
      ],
    });

    const state = useLiveSuggestionsStore.getState();
    expect(selectPendingProposals(state).map((s) => s.id)).toEqual(['s1', 's4']);
    expect(selectPendingCount(state)).toBe(2);
  });

  it('clear() resets meetingId, suggestions, and error', () => {
    useLiveSuggestionsStore.setState({
      meetingId: 'meeting-1',
      suggestions: [makeSuggestion()],
      error: 'some error',
    });

    useLiveSuggestionsStore.getState().clear();

    expect(useLiveSuggestionsStore.getState()).toMatchObject({ meetingId: null, suggestions: [], error: null });
  });
});
