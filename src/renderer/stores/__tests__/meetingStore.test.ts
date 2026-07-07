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
