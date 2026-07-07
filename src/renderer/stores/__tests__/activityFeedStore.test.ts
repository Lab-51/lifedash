import { describe, it, expect, beforeEach } from 'vitest';
import type { LiveSuggestion } from '../../../shared/types';

const { useRecordingStore } = await import('../recordingStore');
const { useCanvasBadgeStore } = await import('../canvasBadgeStore');
const { useActivityFeedStore } = await import('../activityFeedStore');

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

describe('activityFeedStore', () => {
  beforeEach(() => {
    useActivityFeedStore.setState({ entries: [], viewedTab: 'transcript', pendingToolCalls: [] });
    useCanvasBadgeStore.setState({ counts: { transcript: 0, board: 0, brain: 0 } });
    useRecordingStore.setState({ meetingId: null });
  });

  describe('addToolCall (meeting-agent tool-call source)', () => {
    it('adds a reverse-chron entry with the caller-supplied label and the tool-derived targetTab', () => {
      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "Send report"');

      const [entry] = useActivityFeedStore.getState().entries;
      expect(entry.label).toBe('Created card: "Send report"');
      expect(entry.icon).toBe('tool-ok');
      expect(entry.targetTab).toBe('board');
    });

    it('routes transcript-reading tools to the transcript tab and captureNote to brain', () => {
      useActivityFeedStore.getState().addToolCall('searchTranscript', 'Searched transcript');
      useActivityFeedStore.getState().addToolCall('captureNote', 'Captured a decision');

      const entries = useActivityFeedStore.getState().entries;
      expect(entries[0].targetTab).toBe('brain'); // captureNote, newest first
      expect(entries[1].targetTab).toBe('transcript'); // searchTranscript
    });

    it('bumps the canvas badge when the target tab is NOT the currently-viewed tab', () => {
      useActivityFeedStore.setState({ viewedTab: 'transcript' });

      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');

      expect(useCanvasBadgeStore.getState().counts.board).toBe(1);
    });

    it('does NOT bump the canvas badge when the entry targets the currently-viewed tab', () => {
      useActivityFeedStore.setState({ viewedTab: 'board' });

      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');

      expect(useCanvasBadgeStore.getState().counts.board).toBe(0);
    });

    it('newest entries are prepended (reverse-chron)', () => {
      useActivityFeedStore.getState().addToolCall('getTranscriptWindow', 'Read transcript window');
      useActivityFeedStore.getState().addToolCall('searchTranscript', 'Searched transcript');

      expect(useActivityFeedStore.getState().entries.map((e) => e.label)).toEqual([
        'Searched transcript',
        'Read transcript window',
      ]);
    });
  });

  describe('resolveToolResult', () => {
    it('leaves the optimistic entry as tool-ok when the result succeeds', () => {
      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');

      useActivityFeedStore.getState().resolveToolResult('createCardInInbox', { success: true });

      expect(useActivityFeedStore.getState().entries[0].icon).toBe('tool-ok');
    });

    it('flips the matching pending entry to tool-error when the result reports failure', () => {
      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');

      useActivityFeedStore.getState().resolveToolResult('createCardInInbox', { success: false, error: 'boom' });

      expect(useActivityFeedStore.getState().entries[0].icon).toBe('tool-error');
    });

    it('is a no-op when there is no pending call for that tool name', () => {
      expect(() =>
        useActivityFeedStore.getState().resolveToolResult('createCardInInbox', { success: false }),
      ).not.toThrow();
      expect(useActivityFeedStore.getState().entries).toEqual([]);
    });
  });

  describe('addSuggestionEvent (chip accept/dismiss source)', () => {
    it('accepted action_item -> board tab, "Accepted" verb phrase', () => {
      useActivityFeedStore.getState().addSuggestionEvent(makeSuggestion({ type: 'action_item' }), 'accepted');

      const [entry] = useActivityFeedStore.getState().entries;
      expect(entry.targetTab).toBe('board');
      expect(entry.icon).toBe('accepted');
      expect(entry.label).toBe('Accepted action item: "Follow up with design"');
    });

    it('dismissed decision -> brain tab, "Dismissed" verb phrase', () => {
      useActivityFeedStore
        .getState()
        .addSuggestionEvent(makeSuggestion({ type: 'decision', title: 'Ship v2' }), 'dismissed');

      const [entry] = useActivityFeedStore.getState().entries;
      expect(entry.targetTab).toBe('brain');
      expect(entry.icon).toBe('dismissed');
      expect(entry.label).toBe('Dismissed decision: "Ship v2"');
    });

    it('accepted project -> board tab, project create+link phrasing and icon', () => {
      useActivityFeedStore
        .getState()
        .addSuggestionEvent(makeSuggestion({ type: 'project', title: 'New Initiative' }), 'accepted');

      const [entry] = useActivityFeedStore.getState().entries;
      expect(entry.targetTab).toBe('board');
      expect(entry.icon).toBe('project');
      expect(entry.label).toBe('Created project "New Initiative" — meeting linked');
    });

    it('bumps the badge for an off-canvas suggestion event and not for an on-canvas one', () => {
      useActivityFeedStore.setState({ viewedTab: 'board' });
      useActivityFeedStore.getState().addSuggestionEvent(makeSuggestion({ type: 'decision' }), 'accepted');
      expect(useCanvasBadgeStore.getState().counts.brain).toBe(1);

      useActivityFeedStore.setState({ viewedTab: 'brain' });
      useActivityFeedStore.getState().addSuggestionEvent(makeSuggestion({ type: 'decision' }), 'accepted');
      expect(useCanvasBadgeStore.getState().counts.brain).toBe(1); // unchanged — already on-canvas
    });
  });

  describe('clear()', () => {
    it('resets entries, pending calls, and viewedTab back to transcript', () => {
      useActivityFeedStore.setState({ viewedTab: 'board' });
      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');

      useActivityFeedStore.getState().clear();

      expect(useActivityFeedStore.getState()).toMatchObject({
        entries: [],
        pendingToolCalls: [],
        viewedTab: 'transcript',
      });
    });
  });

  describe('initListener() — clears on recording stop (session-scoped)', () => {
    it('clears when recordingStore.meetingId transitions to null (stop/cancel)', () => {
      useRecordingStore.setState({ meetingId: 'meeting-1' });
      const cleanup = useActivityFeedStore.getState().initListener();
      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');
      expect(useActivityFeedStore.getState().entries).toHaveLength(1);

      useRecordingStore.setState({ meetingId: null });

      expect(useActivityFeedStore.getState().entries).toEqual([]);
      cleanup();
    });

    it('also clears on a transition into a brand-new recording (fresh session)', () => {
      const cleanup = useActivityFeedStore.getState().initListener();
      useRecordingStore.setState({ meetingId: 'meeting-1' });
      useActivityFeedStore.getState().addToolCall('createCardInInbox', 'Created card: "X"');
      expect(useActivityFeedStore.getState().entries).toHaveLength(1);

      useRecordingStore.setState({ meetingId: 'meeting-2' });

      expect(useActivityFeedStore.getState().entries).toEqual([]);
      cleanup();
    });
  });
});
