import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../gamificationStore', () => ({
  useGamificationStore: {
    getState: () => ({ awardXP: vi.fn().mockResolvedValue(undefined) }),
  },
}));

vi.stubGlobal('electronAPI', {
  generateBrief: vi.fn(),
  getMeetings: vi.fn().mockResolvedValue([]),
  getMeeting: vi.fn().mockResolvedValue(null),
  getActionItemCounts: vi.fn().mockResolvedValue({}),
  meetingsGetPendingActionCount: vi.fn().mockResolvedValue(0),
  updateMeetingParticipants: vi.fn(),
  onBriefReady: vi.fn(),
});
vi.stubGlobal('window', globalThis);

const { useMeetingStore } = await import('../meetingStore');

const resetState = () =>
  useMeetingStore.setState({
    meetings: [],
    selectedMeeting: null,
    loading: false,
    error: null,
    actionItemCounts: {},
    pendingActionCount: 0,
    generatingBrief: false,
    generatingActions: false,
    briefErrors: {},
    participantsEditedAfterBrief: {},
    diarizing: false,
    diarizationError: null,
    analytics: null,
    analyticsLoading: false,
  });

describe('meetingStore — briefErrors', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('sets briefErrors[meetingId] when generateBrief fails', async () => {
    vi.mocked(window.electronAPI.generateBrief).mockRejectedValueOnce(new Error('Rate limit exceeded'));

    await useMeetingStore.getState().generateBrief('meeting-A');

    expect(useMeetingStore.getState().briefErrors['meeting-A']).toBe('Rate limit exceeded');
  });

  it('clears briefErrors[meetingId] on subsequent successful generateBrief', async () => {
    vi.mocked(window.electronAPI.generateBrief).mockRejectedValueOnce(new Error('Rate limit exceeded'));
    await useMeetingStore.getState().generateBrief('meeting-A');
    expect(useMeetingStore.getState().briefErrors['meeting-A']).toBe('Rate limit exceeded');

    const mockBrief = { id: 'b1', meetingId: 'meeting-A', summary: 'Summary', createdAt: new Date().toISOString() };
    vi.mocked(window.electronAPI.generateBrief).mockResolvedValueOnce(mockBrief as any);
    useMeetingStore.setState({
      selectedMeeting: { id: 'meeting-A', segments: [], actionItems: [], brief: null } as any,
    });
    await useMeetingStore.getState().generateBrief('meeting-A');

    expect(useMeetingStore.getState().briefErrors['meeting-A']).toBeUndefined();
  });

  it('isolates errors per meeting — error for A does not appear for B', async () => {
    vi.mocked(window.electronAPI.generateBrief).mockRejectedValueOnce(new Error('Error for A'));
    await useMeetingStore.getState().generateBrief('meeting-A');

    expect(useMeetingStore.getState().briefErrors['meeting-A']).toBe('Error for A');
    expect(useMeetingStore.getState().briefErrors['meeting-B']).toBeUndefined();
  });
});

describe('meetingStore — diarizeMeeting selectedMeeting guard', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    (window.electronAPI as any).diarizeMeeting = vi.fn().mockResolvedValue({ success: true });
    (window.electronAPI as any).getMeetingAnalytics = vi.fn().mockResolvedValue(null);
  });

  it('does NOT overwrite selectedMeeting when diarizing a DIFFERENT meeting', async () => {
    // The in-brain inspector can diarize a meeting the host page does NOT own;
    // stomping selectedMeeting would collapse the host page to a spinner.
    const host = { id: 'meeting-HOST', segments: [], actionItems: [], brief: null } as any;
    useMeetingStore.setState({ selectedMeeting: host });
    vi.mocked(window.electronAPI.getMeeting).mockResolvedValueOnce({ id: 'meeting-OTHER', segments: [] } as any);

    await useMeetingStore.getState().diarizeMeeting('meeting-OTHER');

    expect(useMeetingStore.getState().selectedMeeting).toBe(host); // untouched
    expect(useMeetingStore.getState().diarizing).toBe(false);
  });

  it('DOES update selectedMeeting when diarizing the meeting the page owns', async () => {
    useMeetingStore.setState({ selectedMeeting: { id: 'meeting-OWN', segments: [] } as any });
    const updated = { id: 'meeting-OWN', segments: [{ speaker: 'A' }] } as any;
    vi.mocked(window.electronAPI.getMeeting).mockResolvedValueOnce(updated);

    await useMeetingStore.getState().diarizeMeeting('meeting-OWN');

    expect(useMeetingStore.getState().selectedMeeting).toBe(updated);
  });
});

describe('meetingStore — updateParticipants (BRIEF-QUAL.1 Task 4)', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('calls the preload method and updates both meetings and selectedMeeting', async () => {
    const updated = { id: 'meeting-A', participants: ['Alex Chen'] } as any;
    vi.mocked(window.electronAPI.updateMeetingParticipants).mockResolvedValueOnce(updated);
    useMeetingStore.setState({
      meetings: [{ id: 'meeting-A', participants: null } as any],
      selectedMeeting: { id: 'meeting-A', segments: [], actionItems: [], brief: null, participants: null } as any,
    });

    await useMeetingStore.getState().updateParticipants('meeting-A', ['Alex Chen']);

    expect(window.electronAPI.updateMeetingParticipants).toHaveBeenCalledWith('meeting-A', ['Alex Chen']);
    expect(useMeetingStore.getState().meetings[0]).toBe(updated);
    expect(useMeetingStore.getState().selectedMeeting?.participants).toEqual(['Alex Chen']);
  });

  it('marks the meeting as edited-since-brief', async () => {
    const updated = { id: 'meeting-A', participants: ['Alex Chen'] } as any;
    vi.mocked(window.electronAPI.updateMeetingParticipants).mockResolvedValueOnce(updated);

    await useMeetingStore.getState().updateParticipants('meeting-A', ['Alex Chen']);

    expect(useMeetingStore.getState().participantsEditedAfterBrief['meeting-A']).toBe(true);
  });

  it('generateBrief clears the edited-since-brief flag on success', async () => {
    useMeetingStore.setState({ participantsEditedAfterBrief: { 'meeting-A': true } });
    const mockBrief = { id: 'b1', meetingId: 'meeting-A', summary: 'Summary', createdAt: new Date().toISOString() };
    vi.mocked(window.electronAPI.generateBrief).mockResolvedValueOnce(mockBrief as any);

    await useMeetingStore.getState().generateBrief('meeting-A');

    expect(useMeetingStore.getState().participantsEditedAfterBrief['meeting-A']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST-FLOW.1 Task 2: fill-in-place. Main pushes `meeting:brief-ready` after
// EVERY brief persist (success and AI-RESIL.1 failure card alike); the store
// refetches the SELECTED meeting so the wrap-up hero swaps its "Writing your
// brief…" banner for the real thing with no user action.
// ---------------------------------------------------------------------------
describe('meetingStore — initBriefReadyListener', () => {
  /** Hands back the callback the store registered, plus the unsubscribe spy. */
  function armListener() {
    const unsubscribe = vi.fn();
    let captured: ((data: { meetingId: string; failed: boolean }) => void) | undefined;
    vi.mocked(window.electronAPI.onBriefReady).mockImplementation((cb) => {
      captured = cb;
      return unsubscribe;
    });
    const returned = useMeetingStore.getState().initBriefReadyListener();
    return { fire: (meetingId: string, failed = false) => captured!({ meetingId, failed }), unsubscribe, returned };
  }

  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('refetches the SELECTED meeting and swaps it into the store', async () => {
    useMeetingStore.setState({
      selectedMeeting: { id: 'meeting-A', segments: [], actionItems: [], brief: null } as any,
    });
    const withBrief = { id: 'meeting-A', segments: [], actionItems: [], brief: { summary: 'Landed' } } as any;
    vi.mocked(window.electronAPI.getMeeting).mockResolvedValueOnce(withBrief);

    const { fire } = armListener();
    fire('meeting-A');
    await vi.waitFor(() => expect(useMeetingStore.getState().selectedMeeting).toBe(withBrief));

    expect(window.electronAPI.getMeeting).toHaveBeenCalledWith('meeting-A');
  });

  it('refetches for a FAILURE card too — the card renders through BriefSection', async () => {
    useMeetingStore.setState({
      selectedMeeting: { id: 'meeting-A', segments: [], actionItems: [], brief: null } as any,
    });
    const failed = { id: 'meeting-A', segments: [], actionItems: [], brief: { summary: 'failed' } } as any;
    vi.mocked(window.electronAPI.getMeeting).mockResolvedValueOnce(failed);

    const { fire } = armListener();
    fire('meeting-A', true);
    await vi.waitFor(() => expect(useMeetingStore.getState().selectedMeeting).toBe(failed));
  });

  it('does NOTHING for ANOTHER meeting — the desktop notification covers that one', () => {
    const host = { id: 'meeting-HOST', segments: [], actionItems: [], brief: null } as any;
    useMeetingStore.setState({ selectedMeeting: host });

    const { fire } = armListener();
    fire('meeting-OTHER');

    expect(window.electronAPI.getMeeting).not.toHaveBeenCalled();
    expect(useMeetingStore.getState().selectedMeeting).toBe(host);
  });

  it('does not stomp selectedMeeting when the user switches sessions mid-fetch', async () => {
    useMeetingStore.setState({
      selectedMeeting: { id: 'meeting-A', segments: [], actionItems: [], brief: null } as any,
    });
    let resolveFetch: ((m: unknown) => void) | undefined;
    vi.mocked(window.electronAPI.getMeeting).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as any,
    );

    const { fire } = armListener();
    fire('meeting-A');

    const other = { id: 'meeting-B', segments: [], actionItems: [], brief: null } as any;
    useMeetingStore.setState({ selectedMeeting: other });
    resolveFetch!({ id: 'meeting-A', segments: [], actionItems: [], brief: { summary: 'stale' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(useMeetingStore.getState().selectedMeeting).toBe(other);
  });

  it('returns the preload unsubscribe function so AppShell can tear it down', () => {
    const { unsubscribe, returned } = armListener();
    expect(returned).toBe(unsubscribe);
  });
});
