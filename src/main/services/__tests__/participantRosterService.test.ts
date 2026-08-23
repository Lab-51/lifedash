// === FILE PURPOSE ===
// Unit tests for participantRosterService (BRIEF-QUAL.1 Task 1) — the merged
// participant roster (typed participants + calendar attendees + known project
// people) injected into the brief prompt. Runs against a REAL in-memory PGlite
// database (same harness as calendarContextService.test.ts) because every
// guarantee here is a query/merge guarantee: dedupe, source-priority ordering,
// caps, and email exclusion.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { calendarEvents, entities, entityLinks, meetings, projects } from '../../db/schema';
import type { CalendarEventAttendee } from '../../../shared/types/calendar';

// --- Mocks (before importing the module under test) ---------------------------------
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import { buildRoster, formatRosterBlock } from '../participantRosterService';

// --- Helpers -----------------------------------------------------------------------

async function seedProject(name = 'Project A'): Promise<string> {
  const [row] = await holder.db.insert(projects).values({ name }).returning({ id: projects.id });
  return row.id;
}

async function seedMeeting(opts: {
  title?: string;
  participants?: string[] | null;
  calendarEventId?: string | null;
  projectId?: string | null;
  startedAt?: Date;
}): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({
      title: opts.title ?? 'Meeting',
      participants: opts.participants ?? null,
      calendarEventId: opts.calendarEventId ?? null,
      projectId: opts.projectId ?? null,
      startedAt: opts.startedAt ?? new Date('2026-07-01T09:00:00Z'),
    })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedEvent(id: string, attendees: CalendarEventAttendee[]): Promise<void> {
  const startsAt = new Date('2026-08-03T09:00:00Z');
  await holder.db.insert(calendarEvents).values({
    id,
    provider: 'google',
    eventId: id.split(':')[1] ?? id,
    title: `Title ${id}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    attendees,
    syncedAt: new Date(),
  });
}

async function seedPerson(name: string): Promise<string> {
  const [row] = await holder.db
    .insert(entities)
    .values({ name, normalizedName: name.toLowerCase().replace(/\s+/g, ' ').trim(), kind: 'person' })
    .returning({ id: entities.id });
  return row.id;
}

async function linkEntity(entityId: string, meetingId: string): Promise<void> {
  await holder.db.insert(entityLinks).values({ entityId, meetingId });
}

async function clearTables(): Promise<void> {
  await holder.db.delete(entityLinks);
  await holder.db.delete(entities);
  await holder.db.delete(meetings);
  await holder.db.delete(calendarEvents);
  await holder.db.delete(projects);
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await clearTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// === buildRoster — basic sources ====================================================

describe('buildRoster — unknown meeting', () => {
  it('returns an empty roster (never throws) for a meeting that does not exist', async () => {
    expect(await buildRoster('00000000-0000-0000-0000-000000000000')).toEqual([]);
  });
});

describe('buildRoster — participants source', () => {
  it('returns typed participants in entry order, trimmed', async () => {
    const meetingId = await seedMeeting({ participants: ['Alice', 'Bob'] });
    expect(await buildRoster(meetingId)).toEqual([
      { name: 'Alice', source: 'participants' },
      { name: 'Bob', source: 'participants' },
    ]);
  });

  it('is empty when participants is null', async () => {
    const meetingId = await seedMeeting({ participants: null });
    expect(await buildRoster(meetingId)).toEqual([]);
  });
});

describe('buildRoster — calendar source', () => {
  it('adds attendee NAMES only — emails never appear, even for a name-less attendee', async () => {
    await seedEvent('google:evt-1', [{ name: 'Carol', email: 'carol@example.com' }, { email: 'nameless@example.com' }]);
    const meetingId = await seedMeeting({ calendarEventId: 'google:evt-1' });

    const roster = await buildRoster(meetingId);

    expect(roster).toEqual([{ name: 'Carol', source: 'calendar' }]);
    expect(JSON.stringify(roster)).not.toContain('@');
  });

  it('is empty when there is no calendarEventId or the cached row is missing', async () => {
    expect(await buildRoster(await seedMeeting({ calendarEventId: null }))).toEqual([]);
    expect(await buildRoster(await seedMeeting({ calendarEventId: 'google:missing' }))).toEqual([]);
  });

  it('never throws when the calendar lookup fails — roster falls back to the other sources', async () => {
    await seedEvent('google:evt-err', [{ name: 'Carol' }]);
    const meetingId = await seedMeeting({ participants: ['Alice'], calendarEventId: 'google:evt-err' });

    const realSelect = holder.db.select.bind(holder.db);
    const spy = vi.spyOn(holder.db, 'select');
    spy.mockImplementationOnce(realSelect as never); // the meeting row lookup
    spy.mockImplementationOnce(() => {
      throw new Error('calendar_events query failed');
    }); // the calendar attendee lookup

    const roster = await buildRoster(meetingId);

    expect(roster).toEqual([{ name: 'Alice', source: 'participants' }]);
    spy.mockRestore();
  });
});

describe('buildRoster — known project people', () => {
  it('is empty when the meeting has no projectId (no query for that source)', async () => {
    const projectId = await seedProject();
    const other = await seedMeeting({ projectId, startedAt: new Date('2026-01-01T00:00:00Z') });
    await linkEntity(await seedPerson('Dana'), other);

    const meetingId = await seedMeeting({ projectId: null });

    expect(await buildRoster(meetingId)).toEqual([]);
  });

  it('lists persons linked to OTHER meetings of the same project, most recent first, capped at 12', async () => {
    const projectId = await seedProject();
    const names = Array.from({ length: 14 }, (_, i) => `Person ${String(i).padStart(2, '0')}`);
    for (let i = 0; i < names.length; i++) {
      const otherMeeting = await seedMeeting({
        projectId,
        startedAt: new Date(2026, 0, i + 1), // ascending — Person 13 is newest
      });
      await linkEntity(await seedPerson(names[i]), otherMeeting);
    }
    // A different project's person must never leak in.
    const otherProjectId = await seedProject('Project B');
    const otherProjectMeeting = await seedMeeting({ projectId: otherProjectId });
    await linkEntity(await seedPerson('Outsider'), otherProjectMeeting);

    const meetingId = await seedMeeting({ projectId });

    const roster = await buildRoster(meetingId);

    expect(roster).toHaveLength(12);
    expect(roster.every((r) => r.source === 'known')).toBe(true);
    expect(roster.map((r) => r.name)).toEqual([...names].reverse().slice(0, 12));
    expect(roster.some((r) => r.name === 'Outsider')).toBe(false);
  });

  it('excludes the current meeting itself from the "other meetings" set', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting({ projectId });
    // Link a person to THIS meeting only — must not surface as "known" (it isn't from an OTHER meeting).
    await linkEntity(await seedPerson('SelfOnly'), meetingId);

    expect(await buildRoster(meetingId)).toEqual([]);
  });
});

// === buildRoster — merge across sources =============================================

describe('buildRoster — merge across sources', () => {
  it('orders participants -> calendar -> known', async () => {
    const projectId = await seedProject();
    const olderMeeting = await seedMeeting({ projectId, startedAt: new Date('2026-01-01T00:00:00Z') });
    await linkEntity(await seedPerson('Carol'), olderMeeting);
    await seedEvent('google:evt-1', [{ name: 'Bob' }]);

    const meetingId = await seedMeeting({
      participants: ['Alice'],
      calendarEventId: 'google:evt-1',
      projectId,
    });

    expect(await buildRoster(meetingId)).toEqual([
      { name: 'Alice', source: 'participants' },
      { name: 'Bob', source: 'calendar' },
      { name: 'Carol', source: 'known' },
    ]);
  });

  it('dedupes the SAME person across all three sources — the highest-priority source (and its spelling) wins', async () => {
    const projectId = await seedProject();
    const olderMeeting = await seedMeeting({ projectId, startedAt: new Date('2026-01-01T00:00:00Z') });
    await linkEntity(await seedPerson('ANNA KOWALSKI'), olderMeeting);
    await seedEvent('google:evt-1', [{ name: 'anna   kowalski ' }]);

    const meetingId = await seedMeeting({
      participants: ['Anna Kowalski'],
      calendarEventId: 'google:evt-1',
      projectId,
    });

    expect(await buildRoster(meetingId)).toEqual([{ name: 'Anna Kowalski', source: 'participants' }]);
  });

  it('caps the combined roster at 24 total entries', async () => {
    const participants = Array.from({ length: 20 }, (_, i) => `P${i}`);
    await seedEvent(
      'google:evt-1',
      Array.from({ length: 10 }, (_, i) => ({ name: `C${i}` })),
    );
    const meetingId = await seedMeeting({ participants, calendarEventId: 'google:evt-1' });

    const roster = await buildRoster(meetingId);

    expect(roster).toHaveLength(24);
    expect(roster.slice(0, 20).every((r) => r.source === 'participants')).toBe(true);
    expect(roster.slice(20).every((r) => r.source === 'calendar')).toBe(true);
  });
});

// === formatRosterBlock ===============================================================

describe('formatRosterBlock', () => {
  it('returns an empty string for no roster and no language (byte-identical default path)', () => {
    expect(formatRosterBlock([], null)).toBe('');
  });

  it('renders the exact participants instruction', () => {
    const block = formatRosterBlock(
      [
        { name: 'Alice', source: 'participants' },
        { name: 'Bob', source: 'calendar' },
      ],
      null,
    );
    expect(block).toBe(
      'Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): Alice, Bob.',
    );
  });

  it('renders only the language instruction when the roster is empty', () => {
    expect(formatRosterBlock([], 'Czech')).toBe('Write the entire brief in Czech.');
  });

  it('renders both fragments, joined by a blank line, when both are present', () => {
    const block = formatRosterBlock([{ name: 'Alice', source: 'participants' }], 'Czech');
    expect(block).toBe(
      'Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): Alice.\n\nWrite the entire brief in Czech.',
    );
  });
});
