import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electronAPI on globalThis, then alias window = globalThis so store code
// that reads window.electronAPI works without replacing the entire window object.
vi.stubGlobal('electronAPI', {
  getCardComments: vi.fn().mockResolvedValue([]),
  getCardRelationships: vi.fn().mockResolvedValue([]),
  getCardActivities: vi.fn().mockResolvedValue([]),
  getCardAttachments: vi.fn().mockResolvedValue([]),
  getChecklistItems: vi.fn().mockResolvedValue([]),
  addCardComment: vi.fn().mockResolvedValue({ id: 'c1', content: 'test', createdAt: '2026-01-01T00:00:00Z' }),
  updateCardComment: vi
    .fn()
    .mockImplementation((_id: string, content: string) =>
      Promise.resolve({ id: _id, content, createdAt: '2026-01-01T00:00:00Z' }),
    ),
  deleteCardComment: vi.fn().mockResolvedValue(undefined),
  addCardRelationship: vi.fn().mockResolvedValue({ id: 'r1', type: 'blocks' }),
  deleteCardRelationship: vi.fn().mockResolvedValue(undefined),
  addCardAttachment: vi.fn().mockResolvedValue({ id: 'a1', fileName: 'file.txt' }),
  deleteCardAttachment: vi.fn().mockResolvedValue(undefined),
  openCardAttachment: vi.fn().mockResolvedValue(undefined),
  addChecklistItem: vi
    .fn()
    .mockImplementation((_cardId: string, title: string) =>
      Promise.resolve({ id: 'cl1', title, completed: false, position: 0 }),
    ),
  updateChecklistItem: vi.fn().mockResolvedValue(undefined),
  deleteChecklistItem: vi.fn().mockResolvedValue(undefined),
  reorderChecklistItems: vi.fn().mockResolvedValue(undefined),
});
vi.stubGlobal('window', globalThis);

// Must import after stubGlobal
const { useCardDetailStore } = await import('../cardDetailStore');

const initialState = {
  selectedCardComments: [],
  selectedCardRelationships: [],
  selectedCardActivities: [],
  selectedCardAttachments: [],
  selectedCardChecklistItems: [],
  loadingCardDetails: false,
};

describe('cardDetailStore', () => {
  beforeEach(() => {
    useCardDetailStore.setState(initialState);
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useCardDetailStore.getState();
    expect(state.selectedCardComments).toEqual([]);
    expect(state.selectedCardRelationships).toEqual([]);
    expect(state.selectedCardActivities).toEqual([]);
    expect(state.selectedCardAttachments).toEqual([]);
    expect(state.selectedCardChecklistItems).toEqual([]);
    expect(state.loadingCardDetails).toBe(false);
  });

  it('clearCardDetails resets all state fields back to initial', () => {
    // Set some non-initial state
    useCardDetailStore.setState({
      selectedCardComments: [{ id: 'c1' }] as any,
      selectedCardRelationships: [{ id: 'r1' }] as any,
      selectedCardActivities: [{ id: 'a1' }] as any,
      selectedCardAttachments: [{ id: 'att1' }] as any,
      selectedCardChecklistItems: [{ id: 'cl1' }] as any,
      loadingCardDetails: true,
    });

    useCardDetailStore.getState().clearCardDetails();

    const state = useCardDetailStore.getState();
    expect(state.selectedCardComments).toEqual([]);
    expect(state.selectedCardRelationships).toEqual([]);
    expect(state.selectedCardActivities).toEqual([]);
    expect(state.selectedCardAttachments).toEqual([]);
    expect(state.selectedCardChecklistItems).toEqual([]);
    // Note: clearCardDetails does NOT reset loadingCardDetails per the store impl
  });

  it('loadCardDetails sets loading then populates all sub-entity arrays', async () => {
    const mockComments = [{ id: 'c1', content: 'hello' }];
    const mockRelationships = [{ id: 'r1', type: 'blocks' }];
    const mockActivities = [{ id: 'a1', action: 'created' }];
    const mockAttachments = [{ id: 'att1', fileName: 'file.pdf' }];
    const mockChecklist = [{ id: 'cl1', title: 'task', completed: false }];

    vi.mocked(window.electronAPI.getCardComments).mockResolvedValueOnce(mockComments as any);
    vi.mocked(window.electronAPI.getCardRelationships).mockResolvedValueOnce(mockRelationships as any);
    vi.mocked(window.electronAPI.getCardActivities).mockResolvedValueOnce(mockActivities as any);
    vi.mocked(window.electronAPI.getCardAttachments).mockResolvedValueOnce(mockAttachments as any);
    vi.mocked(window.electronAPI.getChecklistItems).mockResolvedValueOnce(mockChecklist as any);

    await useCardDetailStore.getState().loadCardDetails('card-1');

    const state = useCardDetailStore.getState();
    expect(state.selectedCardComments).toEqual(mockComments);
    expect(state.selectedCardRelationships).toEqual(mockRelationships);
    expect(state.selectedCardActivities).toEqual(mockActivities);
    expect(state.selectedCardAttachments).toEqual(mockAttachments);
    expect(state.selectedCardChecklistItems).toEqual(mockChecklist);
    expect(state.loadingCardDetails).toBe(false);
  });

  it('loadCardDetails handles errors and resets loading', async () => {
    vi.mocked(window.electronAPI.getCardComments).mockRejectedValueOnce(new Error('fail'));

    await useCardDetailStore.getState().loadCardDetails('card-1');

    const state = useCardDetailStore.getState();
    expect(state.loadingCardDetails).toBe(false);
    // Other arrays remain at initial since the whole Promise.all fails
    expect(state.selectedCardComments).toEqual([]);
  });

  it('addComment prepends the new comment to selectedCardComments', async () => {
    const existing = { id: 'c0', content: 'old', createdAt: '2025-01-01T00:00:00Z' };
    useCardDetailStore.setState({ selectedCardComments: [existing] as any });

    const newComment = { id: 'c1', content: 'new', createdAt: '2026-01-01T00:00:00Z' };
    vi.mocked(window.electronAPI.addCardComment).mockResolvedValueOnce(newComment as any);

    await useCardDetailStore.getState().addComment({ cardId: 'card-1', content: 'new' } as any);

    const comments = useCardDetailStore.getState().selectedCardComments;
    expect(comments).toHaveLength(2);
    expect(comments[0].id).toBe('c1'); // new comment is first
    expect(comments[1].id).toBe('c0');
  });

  it('deleteComment removes the comment from state', async () => {
    useCardDetailStore.setState({
      selectedCardComments: [
        { id: 'c1', content: 'a' },
        { id: 'c2', content: 'b' },
      ] as any,
    });

    await useCardDetailStore.getState().deleteComment('c1');

    const comments = useCardDetailStore.getState().selectedCardComments;
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe('c2');
  });

  it('state updates are isolated — setting comments does not affect relationships', () => {
    const relationships = [{ id: 'r1', type: 'blocks' }] as any;
    useCardDetailStore.setState({
      selectedCardRelationships: relationships,
    });

    useCardDetailStore.setState({
      selectedCardComments: [{ id: 'c1' }] as any,
    });

    const state = useCardDetailStore.getState();
    expect(state.selectedCardRelationships).toEqual(relationships);
    expect(state.selectedCardComments).toHaveLength(1);
  });

  it('addChecklistItem appends the item to the list', async () => {
    const existing = { id: 'cl0', title: 'first', completed: false, position: 0 };
    useCardDetailStore.setState({ selectedCardChecklistItems: [existing] as any });

    await useCardDetailStore.getState().addChecklistItem('card-1', 'second');

    const items = useCardDetailStore.getState().selectedCardChecklistItems;
    expect(items).toHaveLength(2);
    expect(items[1].title).toBe('second');
  });

  it('deleteChecklistItem removes optimistically from state', async () => {
    useCardDetailStore.setState({
      selectedCardChecklistItems: [
        { id: 'cl1', title: 'a', completed: false, position: 0 },
        { id: 'cl2', title: 'b', completed: false, position: 1 },
      ] as any,
    });

    // Don't await — the optimistic update happens synchronously
    const promise = useCardDetailStore.getState().deleteChecklistItem('cl1');
    const items = useCardDetailStore.getState().selectedCardChecklistItems;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('cl2');
    await promise;
  });
});
