// === FILE PURPOSE ===
// Unit tests for speakerNameService (SPEAKER.1 Task 4) — resolving transcript
// speaker LABELS to participant NAMES, and the user's own rename.
//
// Runs against a REAL in-memory PGlite database (same harness as
// whisperPromptService.test.ts / participantRosterService.test.ts) because every
// guarantee here is a read-modify-write guarantee on a jsonb column plus a roster
// query: a hand-rolled db double cannot express "the stored map survived", which
// is exactly the property "never overwrite a user-set name" turns on.
//
// Only ai-provider is faked — the model is the one thing that cannot be real.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { calendarEvents, meetings, transcripts } from '../../db/schema';
import type { CalendarEventAttendee } from '../../../shared/types/calendar';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
vi.mock('../ai-provider', () => ({ generate: vi.fn(), resolveTaskModel: vi.fn() }));

import { renameSpeaker, resolveSpeakerNames } from '../speakerNameService';
import { generate, resolveTaskModel } from '../ai-provider';

const PROVIDER = {
  providerId: 'p1',
  providerName: 'openai',
  apiKeyEncrypted: 'enc',
  baseUrl: null,
  model: 'gpt-4o-mini',
  temperature: 0,
  maxTokens: 500,
};

/** Invented names only — no real meeting content ever enters a fixture. */
const ROSTER = ['Marta Vance', 'Dev Raghunathan', 'Priya Anand'];

async function seedMeeting(
  participants: string[] | null = ROSTER,
  calendarEventId: string | null = null,
): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title: 'Weekly sync', participants, calendarEventId, startedAt: new Date('2026-07-01T09:00:00Z') })
    .returning({ id: meetings.id });
  return row.id;
}

/** A calendar event whose attendees carry NAME AND EMAIL — the roster source that
 *  could actually leak an address into a prompt. */
async function seedEvent(id: string, attendees: CalendarEventAttendee[]): Promise<void> {
  const startsAt = new Date('2026-07-01T09:00:00Z');
  await holder.db.insert(calendarEvents).values({
    id,
    provider: 'google',
    eventId: id.split(':')[1] ?? id,
    title: 'Weekly sync',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    attendees,
    syncedAt: startsAt,
  });
}

async function seedSegments(meetingId: string, lines: [speaker: string | null, content: string][]): Promise<void> {
  await holder.db.insert(transcripts).values(
    lines.map(([speaker, content], i) => ({
      meetingId,
      content,
      speaker,
      startTime: i * 5000,
      endTime: i * 5000 + 4000,
    })),
  );
}

async function storedMap(meetingId: string): Promise<Record<string, string> | null> {
  const [row] = await holder.db
    .select({ speakerNames: meetings.speakerNames })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  return row?.speakerNames ?? null;
}

function modelReplies(answers: unknown): void {
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(generate).mockResolvedValue({ text: JSON.stringify(answers) } as never);
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  // No provider by default: the deterministic stage must stand on its own.
  vi.mocked(resolveTaskModel).mockResolvedValue(null as never);
  await holder.db.delete(transcripts);
  await holder.db.delete(meetings);
  await holder.db.delete(calendarEvents);
});

// === deterministic stage ============================================================

describe('resolveSpeakerNames — deterministic (vocatives / introductions)', () => {
  it('names a speaker addressed by a roster name in the NEXT line of another speaker', async () => {
    const meetingId = await seedMeeting();
    await seedSegments(meetingId, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'Thanks, Marta Vance — can you patch the batch limit?'],
    ]);

    expect(await resolveSpeakerNames(meetingId)).toEqual({ 'Speaker 1': 'Marta Vance' });
    expect(await storedMap(meetingId)).toEqual({ 'Speaker 1': 'Marta Vance' });
    // Non-destructive: the raw labels are still on the segments.
    const rows = await holder.db.select().from(transcripts).where(eq(transcripts.meetingId, meetingId));
    expect(rows.map((r) => r.speaker).sort()).toEqual(['Me', 'Speaker 1']);
  });

  it('resolves nothing when the evidence is ambiguous or contradictory', async () => {
    // Two roster names in the addressing line -> not evidence about either.
    const twoNames = await seedMeeting();
    await seedSegments(twoNames, [
      ['Speaker 1', 'Here is the status.'],
      ['Me', 'Thanks Marta Vance, and thanks Dev Raghunathan, can you confirm?'],
    ]);
    expect(await resolveSpeakerNames(twoNames)).toEqual({});

    // The SAME label addressed by two DIFFERENT names -> contradictory.
    const conflicting = await seedMeeting();
    await seedSegments(conflicting, [
      ['Speaker 1', 'Here is the status.'],
      ['Me', 'Thanks, Marta Vance.'],
      ['Speaker 1', 'And one more thing.'],
      ['Me', 'Good point, Priya Anand.'],
    ]);
    expect(await resolveSpeakerNames(conflicting)).toEqual({});

    // The next line is the SAME speaker -> a speaker naming themselves in the
    // next breath is not someone addressing them.
    const selfNamed = await seedMeeting();
    await seedSegments(selfNamed, [
      ['Speaker 1', 'Here is the status.'],
      ['Speaker 1', 'Priya Anand will follow up.'],
    ]);
    expect(await resolveSpeakerNames(selfNamed)).toEqual({});
  });

  it('matches across case, diacritics and punctuation, and needs no model call', async () => {
    // A provider IS armed here: "needs no model call" can only be tested when the
    // call is reachable. Every label resolves deterministically, so `stillUnknown`
    // is empty and the model stage is never entered.
    modelReplies([{ label: 'Speaker 2', name: 'Renée Dubois', confidence: 1 }]);
    const meetingId = await seedMeeting(['Renée Dubois', 'Ivo Kern']);
    await seedSegments(meetingId, [
      ['Speaker 2', 'I will take the migration.'],
      ['Speaker 3', 'thanks RENEE DUBOIS!'],
      ['Speaker 2', 'And the API rollout is yours, Ivo Kern?'],
    ]);

    // The ROSTER's spelling is what gets stored, not the transcript's.
    expect(await resolveSpeakerNames(meetingId)).toEqual({
      'Speaker 2': 'Renée Dubois',
      'Speaker 3': 'Ivo Kern',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('does NOT resolve from a bare mid-sentence mention — only from an ADDRESS', async () => {
    // A MENTION. The name is neither at the start nor the end of the line and no
    // address cue precedes it, so it says nothing about who just spoke. Resolving
    // it would render the previous speaker AS Marta Vance and hand the extraction
    // pass an "explicit owner" built from a guess.
    const mention = await seedMeeting();
    await seedSegments(mention, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'I will ask Marta Vance to look at the batch limit.'],
    ]);
    expect(await resolveSpeakerNames(mention)).toEqual({});
    expect(await storedMap(mention)).toBeNull();

    // The SAME name and speakers, genuinely ADDRESSED at the start of the line.
    const atStart = await seedMeeting();
    await seedSegments(atStart, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'Marta Vance, can you take the batch limit?'],
    ]);
    expect(await resolveSpeakerNames(atStart)).toEqual({ 'Speaker 1': 'Marta Vance' });

    // ...and addressed at the end of it.
    const atEnd = await seedMeeting();
    await seedSegments(atEnd, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'Then it is over to you, Marta Vance'],
    ]);
    expect(await resolveSpeakerNames(atEnd)).toEqual({ 'Speaker 1': 'Marta Vance' });
  });

  it('does NOT resolve from a conjunction/particle opening an ordinary clause', async () => {
    // "So" is a clause opener, not a vocative — "So Marta Vance will handle the
    // rollout" says nothing about who was just addressed. Resolving it would
    // hand Marta Vance to the extraction pass as an EXPLICIT owner on a guess.
    const soOpener = await seedMeeting();
    await seedSegments(soOpener, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'So Marta Vance will handle the rollout.'],
    ]);
    expect(await resolveSpeakerNames(soOpener)).toEqual({});
    expect(await storedMap(soOpener)).toBeNull();

    // Same shape, a second dropped particle ("right" as a clause opener).
    const rightOpener = await seedMeeting();
    await seedSegments(rightOpener, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'Right Marta Vance will handle the rollout.'],
    ]);
    expect(await resolveSpeakerNames(rightOpener)).toEqual({});
    expect(await storedMap(rightOpener)).toBeNull();

    // A genuine cue address still resolves — the fix removes conjunctions and
    // particles, not real greetings/thanks/apologies.
    const genuineCue = await seedMeeting();
    await seedSegments(genuineCue, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'Thanks, Marta Vance — can you patch this?'],
    ]);
    expect(await resolveSpeakerNames(genuineCue)).toEqual({ 'Speaker 1': 'Marta Vance' });
  });
});

// === model stage ====================================================================

describe('resolveSpeakerNames — the one roster-constrained model call', () => {
  const SEGMENTS: [string | null, string][] = [
    ['Speaker 1', 'Numbers look healthy this quarter.'],
    ['Speaker 2', 'I will send the updated timeline.'],
  ];

  it('keeps only answers at confidence >= 0.8 whose name is on the roster', async () => {
    const meetingId = await seedMeeting();
    await seedSegments(meetingId, SEGMENTS);
    modelReplies([
      { label: 'Speaker 1', name: 'Marta Vance', confidence: 0.91 },
      { label: 'Speaker 2', name: 'Dev Raghunathan', confidence: 0.62 }, // under the bar
    ]);

    expect(await resolveSpeakerNames(meetingId)).toEqual({ 'Speaker 1': 'Marta Vance' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generate).mock.calls[0][0].taskType).toBe('summarization');
  });

  it('drops a name that is not on the roster, and stores the ROSTER spelling', async () => {
    const meetingId = await seedMeeting();
    await seedSegments(meetingId, SEGMENTS);
    modelReplies([
      { label: 'Speaker 1', name: 'Someone Unlisted', confidence: 1 }, // invented
      { label: 'Speaker 2', name: 'dev raghunathan', confidence: 0.95 }, // roster, wrong case
    ]);

    expect(await resolveSpeakerNames(meetingId)).toEqual({ 'Speaker 2': 'Dev Raghunathan' });
  });

  it('degrades to no names when the provider is missing, throws, or replies with junk', async () => {
    const noProvider = await seedMeeting();
    await seedSegments(noProvider, SEGMENTS);
    expect(await resolveSpeakerNames(noProvider)).toEqual({});
    expect(generate).not.toHaveBeenCalled();

    const throwing = await seedMeeting();
    await seedSegments(throwing, SEGMENTS);
    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
    vi.mocked(generate).mockRejectedValueOnce(new Error('provider exploded'));
    expect(await resolveSpeakerNames(throwing)).toEqual({});

    const junk = await seedMeeting();
    await seedSegments(junk, SEGMENTS);
    vi.mocked(generate).mockResolvedValue({ text: 'sorry, I cannot tell' } as never);
    expect(await resolveSpeakerNames(junk)).toEqual({});
    expect(await storedMap(junk)).toBeNull();
  });

  it('never asks about a label that is already named, and never overwrites one', async () => {
    const meetingId = await seedMeeting();
    await seedSegments(meetingId, SEGMENTS);
    await renameSpeaker(meetingId, 'Speaker 1', 'Priya Anand'); // the user's own call
    modelReplies([
      { label: 'Speaker 1', name: 'Marta Vance', confidence: 1 }, // would clobber
      { label: 'Speaker 2', name: 'Dev Raghunathan', confidence: 0.99 },
    ]);

    expect(await resolveSpeakerNames(meetingId)).toEqual({
      'Speaker 1': 'Priya Anand',
      'Speaker 2': 'Dev Raghunathan',
    });
    // The already-named label is not even in the question.
    const { prompt } = vi.mocked(generate).mock.calls[0][0];
    expect(prompt).toContain('Speaker labels to identify: Speaker 2');
    expect(prompt).not.toContain('Speaker labels to identify: Speaker 1');
  });

  it('does not write a STALE map over a rename made DURING the model call', async () => {
    // The model call takes minutes on a local tier and the transcript's rename chip
    // stays live throughout, so the map read before the call is stale by the time
    // the result is written. Renaming from inside the `generate` mock reproduces
    // that interleaving deterministically.
    const meetingId = await seedMeeting();
    await seedSegments(meetingId, SEGMENTS);
    await renameSpeaker(meetingId, 'Speaker 1', 'Priya Anand');

    vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
    vi.mocked(generate).mockImplementation(async () => {
      // The user, while waiting: names a label the model is still working on...
      await renameSpeaker(meetingId, 'Speaker 2', 'Marta Vance');
      // ...and clears one it was told about at the start.
      await renameSpeaker(meetingId, 'Speaker 1', null);
      return { text: JSON.stringify([{ label: 'Speaker 2', name: 'Dev Raghunathan', confidence: 1 }]) } as never;
    });

    // The user's rename survives the model's answer, and the cleared name is NOT
    // resurrected from the pre-call copy of the map.
    const expected = { 'Speaker 2': 'Marta Vance' };
    expect(await resolveSpeakerNames(meetingId)).toEqual(expected);
    expect(await storedMap(meetingId)).toEqual(expected);
  });

  it('sends roster NAMES only and skips the call entirely with no roster', async () => {
    // The roster's calendar source is the one that CARRIES emails, so the meeting
    // is linked to an event whose attendee has both — otherwise "no @ in the
    // prompt" would be true of a fixture that never had an email to leak.
    await seedEvent('google:evt-1', [{ name: 'Nils Ahlberg', email: 'nils.ahlberg@example.test' }]);
    const withRoster = await seedMeeting(ROSTER, 'google:evt-1');
    await seedSegments(withRoster, SEGMENTS);
    modelReplies([]);
    await resolveSpeakerNames(withRoster);
    const { prompt } = vi.mocked(generate).mock.calls[0][0];
    expect(prompt).toContain('Marta Vance, Dev Raghunathan, Priya Anand');
    expect(prompt).toContain('Nils Ahlberg');
    expect(prompt).not.toContain('@');
    expect(prompt).not.toContain('example.test');

    vi.mocked(generate).mockClear();
    const noRoster = await seedMeeting(null);
    await seedSegments(noRoster, SEGMENTS);
    expect(await resolveSpeakerNames(noRoster)).toEqual({});
    expect(generate).not.toHaveBeenCalled();
  });
});

// === the user's rename ==============================================================

describe('renameSpeaker', () => {
  it('sets, replaces and clears one label without disturbing the others', async () => {
    const meetingId = await seedMeeting();

    expect(await renameSpeaker(meetingId, 'Speaker 1', 'Marta Vance')).toEqual({ 'Speaker 1': 'Marta Vance' });
    await renameSpeaker(meetingId, 'Me', 'Priya Anand');
    expect(await renameSpeaker(meetingId, 'Speaker 1', 'Dev Raghunathan')).toEqual({
      'Speaker 1': 'Dev Raghunathan',
      Me: 'Priya Anand',
    });

    // null CLEARS — which is what makes the label eligible for resolution again.
    expect(await renameSpeaker(meetingId, 'Speaker 1', null)).toEqual({ Me: 'Priya Anand' });
    expect(await storedMap(meetingId)).toEqual({ Me: 'Priya Anand' });
  });

  it('a cleared label can be resolved again', async () => {
    const meetingId = await seedMeeting();
    await seedSegments(meetingId, [
      ['Speaker 1', 'The export worker fails for large accounts.'],
      ['Me', 'Thanks, Marta Vance.'],
    ]);
    await renameSpeaker(meetingId, 'Speaker 1', 'Priya Anand');
    expect(await resolveSpeakerNames(meetingId)).toEqual({ 'Speaker 1': 'Priya Anand' });

    await renameSpeaker(meetingId, 'Speaker 1', null);
    expect(await resolveSpeakerNames(meetingId)).toEqual({ 'Speaker 1': 'Marta Vance' });
  });
});
