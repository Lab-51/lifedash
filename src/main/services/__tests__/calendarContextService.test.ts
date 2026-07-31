// === FILE PURPOSE ===
// Unit tests for calendarContextService (CAL-UX.2 Task 1) — the deterministic
// cross-meeting context behind the event-details modal, plus the opt-in prep note.
// Runs against a REAL in-memory PGlite database (same harness as
// calendarPollScheduler.test.ts) because every guarantee here is a query
// guarantee: series resolution + self-exclusion, "open" action-item state, the
// honest total behind the cap, and conservative attendee↔person name matching.
// Only the AI seam (resolveTaskModel + generateValidated) is mocked — mirroring
// how entityFactService.test.ts mocks the same two modules.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { actionItems, calendarEvents, entities, entityFacts, meetingBriefs, meetings } from '../../db/schema';
import type { CalendarEventAttendee } from '../../../shared/types/calendar';

// --- Mocks (before importing the module under test) ---------------------------------
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import {
  getEventContext,
  generatePrepNote,
  clearPrepNoteCache,
  NO_MODEL_ERROR_MESSAGE,
  PREP_NOTE_FAILED_MESSAGE,
} from '../calendarContextService';
import { resolveTaskModel } from '../ai-provider';
import { generateValidated } from '../twinResearchService';

// --- Helpers -----------------------------------------------------------------------

const PROVIDER = {
  providerId: 'p1',
  providerName: 'lmstudio' as const,
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'local',
};

async function seedEvent(
  id: string,
  opts: {
    seriesId?: string | null;
    attendees?: CalendarEventAttendee[];
    title?: string;
    description?: string | null;
  } = {},
): Promise<void> {
  const startsAt = new Date('2026-08-03T09:00:00Z');
  await holder.db.insert(calendarEvents).values({
    id,
    provider: 'google',
    eventId: id.split(':')[1] ?? id,
    title: opts.title ?? `Title ${id}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    attendees: opts.attendees ?? [],
    seriesId: opts.seriesId ?? null,
    description: opts.description ?? null,
    syncedAt: new Date(),
  });
}

async function seedMeeting(opts: {
  title: string;
  status?: 'recording' | 'processing' | 'completed';
  startedAt?: Date;
  endedAt?: Date | null;
  calendarEventId?: string | null;
  calendarSeriesId?: string | null;
}): Promise<string> {
  const startedAt = opts.startedAt ?? new Date('2026-07-01T09:00:00Z');
  const [row] = await holder.db
    .insert(meetings)
    .values({
      title: opts.title,
      status: opts.status ?? 'completed',
      startedAt,
      endedAt: opts.endedAt === undefined ? new Date(startedAt.getTime() + 45 * 60_000) : opts.endedAt,
      calendarEventId: opts.calendarEventId ?? null,
      calendarSeriesId: opts.calendarSeriesId ?? null,
    })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedEntity(name: string, kind: 'person' | 'topic' = 'person'): Promise<string> {
  const [row] = await holder.db
    .insert(entities)
    .values({ name, normalizedName: name.toLowerCase().replace(/\s+/g, ' ').trim(), kind })
    .returning({ id: entities.id });
  return row.id;
}

async function seedFacts(entityId: string, meetingId: string, contents: string[]): Promise<void> {
  await holder.db
    .insert(entityFacts)
    .values(contents.map((content) => ({ entityId, content, sourceMeetingId: meetingId })));
}

async function clearTables(): Promise<void> {
  await holder.db.delete(entityFacts);
  await holder.db.delete(schema.entityLinks);
  await holder.db.delete(entities);
  await holder.db.delete(actionItems);
  await holder.db.delete(meetingBriefs);
  await holder.db.delete(meetings);
  await holder.db.delete(calendarEvents);
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  clearPrepNoteCache();
  await clearTables();
});

// === getEventContext — unknown / recorded ==========================================

describe('getEventContext — event lookup', () => {
  it('returns an EMPTY context (never throws) for an event that is not cached', async () => {
    const context = await getEventContext('google:does-not-exist');
    expect(context).toEqual({ recordedSession: null, lastSeriesSession: null, attendeeMatches: [] });
  });

  it('finds the recorded session by EXACT calendarEventId only', async () => {
    await seedEvent('google:evt-1');
    const meetingId = await seedMeeting({ title: 'Recorded one', calendarEventId: 'google:evt-1' });
    await seedMeeting({ title: 'Other event', calendarEventId: 'google:evt-2' });

    const context = await getEventContext('google:evt-1');

    expect(context.recordedSession).toEqual({ meetingId, title: 'Recorded one' });
  });

  it('reports no recorded session when nothing links the event', async () => {
    await seedEvent('google:evt-1');
    await seedMeeting({ title: 'Unlinked', calendarEventId: null });

    const context = await getEventContext('google:evt-1');

    expect(context.recordedSession).toBeNull();
  });
});

// === getEventContext — series resolution ===========================================

describe('getEventContext — lastSeriesSession', () => {
  it('is null when the event has no seriesId (a one-off meeting)', async () => {
    await seedEvent('google:evt-1', { seriesId: null });
    await seedMeeting({ title: 'Some series session', calendarSeriesId: 'series-A' });

    const context = await getEventContext('google:evt-1');

    expect(context.lastSeriesSession).toBeNull();
  });

  it('picks the most recent COMPLETED session of the series and EXCLUDES this event own session', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A' });
    // This event's own session — the newest of the series, but must be excluded.
    await seedMeeting({
      title: 'This very event',
      calendarEventId: 'google:evt-now',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-29T09:00:00Z'),
    });
    await seedMeeting({
      title: 'Older occurrence',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-08T09:00:00Z'),
    });
    const expected = await seedMeeting({
      title: 'Previous occurrence',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-22T09:00:00Z'),
    });
    // Same time window but a different series — must never be picked.
    await seedMeeting({
      title: 'Different series',
      calendarSeriesId: 'series-B',
      startedAt: new Date('2026-07-28T09:00:00Z'),
    });

    const context = await getEventContext('google:evt-now');

    expect(context.lastSeriesSession?.meetingId).toBe(expected);
    expect(context.lastSeriesSession?.title).toBe('Previous occurrence');
    expect(context.lastSeriesSession?.endedAt).toBe(new Date('2026-07-22T09:45:00Z').toISOString());
  });

  it('ignores sessions of the series that are not completed', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A' });
    await seedMeeting({
      title: 'Still recording',
      status: 'recording',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-30T09:00:00Z'),
      endedAt: null,
    });
    await seedMeeting({
      title: 'Processing',
      status: 'processing',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-29T09:00:00Z'),
    });
    const expected = await seedMeeting({
      title: 'Completed one',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-01T09:00:00Z'),
    });

    const context = await getEventContext('google:evt-now');

    expect(context.lastSeriesSession?.meetingId).toBe(expected);
  });

  it('is null when the series has no other completed session', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A' });
    await seedMeeting({
      title: 'This very event',
      calendarEventId: 'google:evt-now',
      calendarSeriesId: 'series-A',
    });

    const context = await getEventContext('google:evt-now');

    expect(context.lastSeriesSession).toBeNull();
  });
});

// === getEventContext — brief snippet ===============================================

describe('getEventContext — brief snippet', () => {
  it('plain-texts the brief and truncates it at 240 chars', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A' });
    const meetingId = await seedMeeting({ title: 'Previous', calendarSeriesId: 'series-A' });
    await holder.db.insert(meetingBriefs).values({
      meetingId,
      summary: `# Summary\n\n**Pricing** was agreed. ${'word '.repeat(120)}`,
    });

    const snippet = (await getEventContext('google:evt-now')).lastSeriesSession?.briefSnippet;

    expect(snippet).toHaveLength(240);
    expect(snippet?.startsWith('Summary Pricing was agreed.')).toBe(true);
    expect(snippet).not.toContain('#');
    expect(snippet).not.toContain('**');
  });

  it('keeps a short brief intact and returns null when there is no brief', async () => {
    await seedEvent('google:evt-1', { seriesId: 'series-A' });
    const withBrief = await seedMeeting({
      title: 'With brief',
      calendarSeriesId: 'series-A',
      startedAt: new Date('2026-07-20T09:00:00Z'),
    });
    await holder.db.insert(meetingBriefs).values({ meetingId: withBrief, summary: 'Short and sweet.' });
    expect((await getEventContext('google:evt-1')).lastSeriesSession?.briefSnippet).toBe('Short and sweet.');

    await seedEvent('google:evt-2', { seriesId: 'series-B' });
    await seedMeeting({ title: 'No brief', calendarSeriesId: 'series-B' });
    expect((await getEventContext('google:evt-2')).lastSeriesSession?.briefSnippet).toBeNull();
  });
});

// === getEventContext — open action items ===========================================

describe('getEventContext — open action items', () => {
  it('caps the list at 5 while reporting the honest total, counting only open items', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A' });
    const meetingId = await seedMeeting({ title: 'Previous', calendarSeriesId: 'series-A' });

    // 7 OPEN items (pending + approved are both outstanding) and 2 that are not.
    const open = Array.from({ length: 7 }, (_, i) => ({
      meetingId,
      description: `Open item ${i}`,
      status: (i % 2 === 0 ? 'pending' : 'approved') as 'pending' | 'approved',
    }));
    await holder.db.insert(actionItems).values(open);
    await holder.db.insert(actionItems).values([
      { meetingId, description: 'Dismissed item', status: 'dismissed' },
      { meetingId, description: 'Converted item', status: 'converted' },
    ]);

    const last = (await getEventContext('google:evt-now')).lastSeriesSession;

    expect(last?.totalOpenActionItems).toBe(7);
    expect(last?.openActionItems).toHaveLength(5);
    expect(last?.openActionItems.every((i) => i.text.startsWith('Open item'))).toBe(true);
    expect(last?.openActionItems[0].id).toBeTruthy();
  });

  it('returns an empty list and a zero total when nothing is open', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A' });
    const meetingId = await seedMeeting({ title: 'Previous', calendarSeriesId: 'series-A' });
    await holder.db.insert(actionItems).values([{ meetingId, description: 'Done', status: 'converted' }]);

    const last = (await getEventContext('google:evt-now')).lastSeriesSession;

    expect(last?.openActionItems).toEqual([]);
    expect(last?.totalOpenActionItems).toBe(0);
  });
});

// === getEventContext — attendee matching ===========================================

describe('getEventContext — attendee matching', () => {
  it('matches case/whitespace-insensitively but NEVER fuzzily, and joins fact counts', async () => {
    const meetingId = await seedMeeting({ title: 'Source' });
    const anna = await seedEntity('Anna Kowalski');
    await seedEntity('Ben Ortiz');
    await seedFacts(anna, meetingId, ['owns pricing', 'raised the Q3 timeline']);

    await seedEvent('google:evt-1', {
      attendees: [
        { name: '  anna   kowalski ', email: 'anna@example.com' }, // normalized exact ⇒ match
        { name: 'Ann', email: 'ann@example.com' }, // prefix only ⇒ NO match
        { email: 'nameless@example.com' }, // no name at all ⇒ ignored
      ],
    });

    const matches = (await getEventContext('google:evt-1')).attendeeMatches;

    expect(matches).toEqual([{ entityId: anna, name: 'Anna Kowalski', factCount: 2 }]);
  });

  it('matches PERSON entities only (a topic with the same name is ignored)', async () => {
    await seedEntity('Pricing', 'topic');
    await seedEvent('google:evt-1', { attendees: [{ name: 'Pricing' }] });

    expect((await getEventContext('google:evt-1')).attendeeMatches).toEqual([]);
  });

  it('reports factCount 0 for a known person with no facts yet', async () => {
    const ben = await seedEntity('Ben Ortiz');
    await seedEvent('google:evt-1', { attendees: [{ name: 'Ben Ortiz' }] });

    expect((await getEventContext('google:evt-1')).attendeeMatches).toEqual([
      { entityId: ben, name: 'Ben Ortiz', factCount: 0 },
    ]);
  });

  it('caps matches at 6 and dedupes repeated attendees', async () => {
    const names = ['P One', 'P Two', 'P Three', 'P Four', 'P Five', 'P Six', 'P Seven'];
    for (const name of names) await seedEntity(name);
    await seedEvent('google:evt-1', {
      attendees: [...names, 'p one'].map((name) => ({ name })),
    });

    const matches = (await getEventContext('google:evt-1')).attendeeMatches;

    expect(matches).toHaveLength(6);
    expect(matches.map((m) => m.name)).toEqual(names.slice(0, 6));
  });
});

// === generatePrepNote ==============================================================

describe('generatePrepNote', () => {
  it('runs the model pipeline ONCE per event, then serves the cached note', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A', title: 'Weekly sync' });
    const previous = await seedMeeting({ title: 'Previous', calendarSeriesId: 'series-A' });
    await holder.db.insert(meetingBriefs).values({ meetingId: previous, summary: 'Pricing was agreed.' });
    await holder.db
      .insert(actionItems)
      .values([{ meetingId: previous, description: 'Send the deck', status: 'pending' }]);
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue({ note: 'Follow up on the deck.' });

    const first = await generatePrepNote('google:evt-now');
    const second = await generatePrepNote('google:evt-now');

    expect(first).toBe('Follow up on the deck.');
    expect(second).toBe(first);
    expect(generateValidated).toHaveBeenCalledTimes(1);
    // The cache short-circuits BEFORE model resolution — no provider lookup either.
    expect(resolveTaskModel).toHaveBeenCalledTimes(1);
    expect(resolveTaskModel).toHaveBeenCalledWith('meeting_prep');
  });

  it('feeds the deterministic context (brief + open items) and NO transcript into the prompt', async () => {
    await seedEvent('google:evt-now', {
      seriesId: 'series-A',
      title: 'Weekly sync',
      attendees: [{ name: 'Anna Kowalski' }],
    });
    const previous = await seedMeeting({ title: 'Previous', calendarSeriesId: 'series-A' });
    await holder.db.insert(meetingBriefs).values({ meetingId: previous, summary: 'Pricing was agreed.' });
    await holder.db
      .insert(actionItems)
      .values([{ meetingId: previous, description: 'Send the deck', status: 'pending' }]);
    const anna = await seedEntity('Anna Kowalski');
    await seedFacts(anna, previous, ['owns pricing']);
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue({ note: 'Note.' });

    await generatePrepNote('google:evt-now');

    const opts = vi.mocked(generateValidated).mock.calls[0][0];
    expect(opts.taskType).toBe('meeting_prep');
    expect(opts.context).toContain('Weekly sync');
    expect(opts.context).toContain('Pricing was agreed.');
    expect(opts.context).toContain('Send the deck');
    expect(opts.context).toContain('Anna Kowalski: owns pricing');
  });

  it('includes the event description as its own labeled section (CAL-UX.2b)', async () => {
    await seedEvent('google:evt-now', {
      title: 'Weekly sync',
      description: 'Agenda: pricing, then the roadmap.',
    });
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue({ note: 'Note.' });

    await generatePrepNote('google:evt-now');

    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context).toContain('Event description (written by the organizer):');
    expect(context).toContain('Agenda: pricing, then the roadmap.');
  });

  it('omits the description section entirely when the event has none', async () => {
    await seedEvent('google:evt-now', { description: null });
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue({ note: 'Note.' });

    await generatePrepNote('google:evt-now');

    expect(vi.mocked(generateValidated).mock.calls[0][0].context).not.toContain('Event description');
  });

  it('slices the description at 1000 chars and still caps the whole context at 4000', async () => {
    await seedEvent('google:evt-now', { seriesId: 'series-A', description: 'D'.repeat(4000) });
    const previous = await seedMeeting({ title: 'Previous', calendarSeriesId: 'series-A' });
    await holder.db.insert(meetingBriefs).values({ meetingId: previous, summary: 'Pricing was agreed.' });
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue({ note: 'Note.' });

    await generatePrepNote('google:evt-now');

    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context.match(/D+/)?.[0]).toHaveLength(1000);
    expect(context.length).toBeLessThanOrEqual(4000);
    // The 1000-char slice leaves room for the rest — the description never crowds it out.
    expect(context).toContain('Pricing was agreed.');
  });

  it('rejects with the typed no-model message and never calls the pipeline', async () => {
    await seedEvent('google:evt-now');
    vi.mocked(resolveTaskModel).mockResolvedValue(null);

    await expect(generatePrepNote('google:evt-now')).rejects.toThrow(NO_MODEL_ERROR_MESSAGE);
    expect(generateValidated).not.toHaveBeenCalled();
    // The renderer keys off /model|provider/i — keep that wording contract.
    expect(NO_MODEL_ERROR_MESSAGE).toMatch(/model|provider/i);
  });

  it('rejects honestly (and caches nothing) when the model returns nothing usable', async () => {
    await seedEvent('google:evt-now');
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue(null);

    await expect(generatePrepNote('google:evt-now')).rejects.toThrow(PREP_NOTE_FAILED_MESSAGE);

    vi.mocked(generateValidated).mockResolvedValue({ note: 'Second try works.' });
    await expect(generatePrepNote('google:evt-now')).resolves.toBe('Second try works.');
  });

  it('rejects for an event that is not cached', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);

    await expect(generatePrepNote('google:missing')).rejects.toThrow(/no longer cached/i);
    expect(generateValidated).not.toHaveBeenCalled();
  });

  it('hard-caps the note at 1200 chars', async () => {
    await seedEvent('google:evt-now');
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER);
    vi.mocked(generateValidated).mockResolvedValue({ note: 'x'.repeat(5000) });

    expect(await generatePrepNote('google:evt-now')).toHaveLength(1200);
  });
});
