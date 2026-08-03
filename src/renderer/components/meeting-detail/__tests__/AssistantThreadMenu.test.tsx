// @vitest-environment jsdom
// Thread controls for the meeting assistant. The distinction these tests defend:
// "New chat" is NON-destructive (the old conversation is archived and still
// readable) while "Clear" destroys messages permanently — so only Clear may
// confirm, and only Clear may delete.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MeetingAgentThreadSummary } from '../../../../shared/types';

const meetingAgentNewThread = vi.fn().mockResolvedValue({});
const meetingAgentClear = vi.fn().mockResolvedValue([]);
const meetingAgentListThreads = vi.fn();

vi.stubGlobal('electronAPI', { meetingAgentNewThread, meetingAgentClear, meetingAgentListThreads });

const { default: AssistantThreadMenu } = await import('../AssistantThreadMenu');

function thread(overrides: Partial<MeetingAgentThreadSummary> = {}): MeetingAgentThreadSummary {
  return {
    id: 't-old',
    meetingId: 'm1',
    archivedAt: '2026-08-01T10:00:00.000Z',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    messageCount: 4,
    preview: 'What did we decide about pricing?',
    ...overrides,
  };
}

function renderMenu(props: Partial<React.ComponentProps<typeof AssistantThreadMenu>> = {}) {
  const onReset = vi.fn();
  const onOpenArchived = vi.fn();
  render(
    <AssistantThreadMenu
      meetingId="m1"
      busy={false}
      hasMessages
      onReset={onReset}
      onOpenArchived={onOpenArchived}
      viewingArchivedId={null}
      {...props}
    />,
  );
  return { onReset, onOpenArchived };
}

beforeEach(() => {
  vi.clearAllMocks();
  meetingAgentListThreads.mockResolvedValue([]);
});

describe('AssistantThreadMenu — new chat keeps history', () => {
  it('archives and reloads without asking, because nothing is lost', async () => {
    const { onReset } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /New chat/ }));

    await waitFor(() => expect(meetingAgentNewThread).toHaveBeenCalledWith('m1'));
    expect(onReset).toHaveBeenCalled();
    // No confirmation: archiving is not destructive.
    expect(screen.queryByText('Clear this conversation?')).not.toBeInTheDocument();
    expect(meetingAgentClear).not.toHaveBeenCalled();
  });
});

describe('AssistantThreadMenu — clear is destructive', () => {
  it('confirms before deleting anything', async () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));

    expect(await screen.findByText('Clear this conversation?')).toBeInTheDocument();
    expect(meetingAgentClear).not.toHaveBeenCalled();
  });

  it('states plainly that nothing the app learned is affected', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));

    // The chat is not a source for briefs/cards/embeddings/twin facts — the copy
    // must not imply the user is erasing meeting knowledge.
    expect(
      await screen.findByText(/transcript, brief, cards and anything the Twin has learned are untouched/i),
    ).toBeInTheDocument();
  });

  it('deletes only after the user confirms', async () => {
    const { onReset } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    await screen.findByText('Clear this conversation?');

    // Both the toolbar trigger and the dialog's confirm are named "Clear" — the
    // LAST one in the DOM is the dialog's, which is the one under test.
    const confirms = screen.getAllByRole('button', { name: 'Clear' });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() => expect(meetingAgentClear).toHaveBeenCalledWith('m1'));
    expect(onReset).toHaveBeenCalled();
  });

  it('is unavailable with an empty chat or while viewing history', () => {
    const { unmount } = render(
      <AssistantThreadMenu
        meetingId="m1"
        busy={false}
        hasMessages={false}
        onReset={vi.fn()}
        onOpenArchived={vi.fn()}
        viewingArchivedId={null}
      />,
    );
    expect(screen.getByRole('button', { name: /Clear/ })).toBeDisabled();
    unmount();

    renderMenu({ viewingArchivedId: 't-old' });
    expect(screen.getByRole('button', { name: /Clear/ })).toBeDisabled();
  });
});

describe('AssistantThreadMenu — archive', () => {
  it('lists archived conversations by what they were about', async () => {
    meetingAgentListThreads.mockResolvedValue([
      thread({ id: 't-current', archivedAt: null, messageCount: 0, preview: null }),
      thread(),
    ]);
    const { onOpenArchived } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));

    const entry = await screen.findByText('What did we decide about pricing?');
    // The CURRENT thread is not offered as history.
    expect(screen.queryByText('Empty conversation')).not.toBeInTheDocument();

    fireEvent.click(entry);
    expect(onOpenArchived).toHaveBeenCalledWith(expect.objectContaining({ id: 't-old' }));
  });

  it('explains the empty archive instead of showing a blank popover', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));

    expect(await screen.findByText(/No earlier conversations yet/)).toBeInTheDocument();
  });

  it('never blocks the chat when listing fails', async () => {
    meetingAgentListThreads.mockRejectedValue(new Error('db busy'));
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));

    expect(await screen.findByText(/No earlier conversations yet/)).toBeInTheDocument();
  });

  it('disables thread switching mid-stream so a reply cannot be stranded', () => {
    renderMenu({ busy: true });

    expect(screen.getByRole('button', { name: /New chat/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Archive/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Clear/ })).toBeDisabled();
  });
});
