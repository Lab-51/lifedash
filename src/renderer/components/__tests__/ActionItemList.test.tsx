// @vitest-environment jsdom
// ActionItemList owner/due rendering (BRIEF-QUAL.1 Task 4): owner renders as a
// leading chip and dueText as a muted suffix when known; an item with neither
// shows no chip and — critically — never the word "Unassigned".
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionItemList from '../ActionItemList';
import type { ActionItem } from '../../../shared/types';

function makeItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'a1',
    meetingId: 'meet-1',
    cardId: null,
    description: 'Send the doc',
    owner: null,
    dueText: null,
    status: 'pending',
    createdAt: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

const noop = () => {};

describe('ActionItemList — owner/due rendering (BRIEF-QUAL.1 Task 4)', () => {
  it('renders the owner as a leading chip when known', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ owner: 'Alex Chen' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.getByText('Alex Chen')).toBeInTheDocument();
  });

  it('renders dueText as a muted suffix when present', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ dueText: 'Friday' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.getByText('Due Friday')).toBeInTheDocument();
  });

  it('shows no chip and never the word "Unassigned" when owner is unknown', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ owner: null, dueText: null })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.queryByText(/unassigned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Due /)).not.toBeInTheDocument();
  });

  it('renders both owner and due together on the same item', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ owner: 'Sam Rivera', dueText: 'end of Q3' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
      />,
    );
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Due end of Q3')).toBeInTheDocument();
  });
});

/** Escapes regex metacharacters — an IANA zone can contain `+` (e.g.
 *  "Etc/GMT+2") which would otherwise be parsed as a quantifier. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// "said <date> (<zone>)" suffix (BRIEF-EVID.1 Task 3) — meeting.startedAt/
// timezone threaded in as props (never read from the global meetingStore, see
// TranscriptSection's header for why).
// ---------------------------------------------------------------------------
describe('ActionItemList — "said <date> (<zone>)" suffix (BRIEF-EVID.1 Task 3)', () => {
  it('shows the suffix only when dueText is present, never when it is absent', () => {
    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ dueText: null }), makeItem({ id: 'a2', dueText: 'Friday' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
        meetingStartedAt="2026-03-10T12:00:00Z"
        meetingTimezone="Europe/Prague"
      />,
    );
    // Exactly one "said" suffix — for the item WITH dueText, none for the other.
    expect(screen.getAllByText(/said/)).toHaveLength(1);
  });

  it("formats the date in the meeting's own timezone, not UTC — fails if the zone is ignored", () => {
    // Fixed startedAt near midnight UTC + a zone 14h ahead: the local calendar
    // date genuinely differs from the UTC date, so this is a real control, not
    // a coincidence of formatting.
    const startedAt = '2026-03-10T23:30:00Z';
    const zone = 'Pacific/Kiritimati';
    const zoneDate = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(startedAt));
    const utcDate = new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(startedAt));
    expect(zoneDate).not.toBe(utcDate); // sanity: the fixture actually crosses a date line

    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ dueText: 'Friday' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
        meetingStartedAt={startedAt}
        meetingTimezone={zone}
      />,
    );

    expect(
      screen.getByText(new RegExp(`said ${escapeRegExp(zoneDate)} \\(${escapeRegExp(zone)}\\)`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`said ${escapeRegExp(utcDate)} `))).not.toBeInTheDocument();
  });

  it("falls back to the viewer's own zone when the meeting has none", () => {
    const startedAt = '2026-03-10T12:00:00Z';
    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    render(
      <ActionItemList
        meetingId="meet-1"
        actionItems={[makeItem({ dueText: 'Friday' })]}
        isCompleted
        generatingActions={false}
        onGenerate={noop}
        onUpdateStatus={vi.fn()}
        onConvert={vi.fn()}
        meetingStartedAt={startedAt}
        meetingTimezone={null}
      />,
    );

    expect(screen.getByText(new RegExp(`\\(${escapeRegExp(viewerZone)}\\)$`))).toBeInTheDocument();
  });
});
