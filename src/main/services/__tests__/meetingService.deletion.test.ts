// === FILE PURPOSE ===
// Tests for meetingService's deletion contract (MEET-DEL.1 Task 1): the
// delete-impact preview query, and the transactional deleteMeeting (default
// hard-delete vs. keep-with-snapshot-label paths), including the post-commit
// WAV unlink and the active-recording guard.
//
// Runs against a REAL PGlite instance migrated through the actual `drizzle/`
// migrations (same harness as entity-facts-migration.test.ts and
// calendarContextService.test.ts) rather than a mocked DB — db.transaction()'s
// real commit behavior and the real read-path -> transaction -> unlink call
// order are exactly what's under test (see LEARNINGS.md 2026-08-06: isolated
// mocked-call sequences can pass while the app's real order fails). This also
// proves migration 0048 applies cleanly on a fresh DB: beforeAll's migrate()
// call fails the whole file if it doesn't.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { meetings, twinFacts, meetingBriefs, transcripts } from '../../db/schema';
import { labelFor } from '../../../shared/twin/factLabel';

// --- Mocks (before importing the module under test) -------------------------------

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import { deleteMeeting, getMeetingDeleteImpact, ActiveRecordingDeleteError } from '../meetingService';
import { setActiveMeetingId } from '../recordingState';

type Db = typeof holder.db;

// --- Fixtures ------------------------------------------------------------------

let pg: PGlite;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-meeting-delete-'));

beforeAll(async () => {
  pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

afterAll(async () => {
  await pg.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  setActiveMeetingId(null);
});

async function insertMeeting(overrides: Partial<typeof meetings.$inferInsert> = {}) {
  const db: Db = holder.db;
  const [row] = await db
    .insert(meetings)
    .values({
      title: 'Weekly Sync',
      startedAt: new Date('2026-08-01T10:00:00Z'),
      status: 'completed',
      ...overrides,
    })
    .returning();
  return row;
}

async function insertFact(meetingId: string, overrides: Partial<typeof twinFacts.$inferInsert> = {}) {
  const db: Db = holder.db;
  const [row] = await db
    .insert(twinFacts)
    .values({
      fact: 'The team prefers async standups over live calls.',
      category: 'preference',
      sourceMeetingId: meetingId,
      status: 'active',
      ...overrides,
    })
    .returning();
  return row;
}

async function writeWavFixture(bytes: string | Buffer = 'fake wav bytes'): Promise<string> {
  const filePath = path.join(tmpRoot, `${randomUUID()}.wav`);
  await fsp.writeFile(filePath, bytes);
  return filePath;
}

// ---------------------------------------------------------------------------
// deleteMeeting — default (forget) path
// ---------------------------------------------------------------------------

describe('deleteMeeting — default path', () => {
  it('hard-deletes facts (active + forgotten) and the meeting row, and unlinks the WAV', async () => {
    const db: Db = holder.db;
    const meeting = await insertMeeting({ title: 'Sprint planning' });
    const wavPath = await writeWavFixture();
    await db.update(meetings).set({ audioPath: wavPath }).where(eq(meetings.id, meeting.id));

    const activeFact = await insertFact(meeting.id, { status: 'active', fact: 'Ships Friday.' });
    const forgottenFact = await insertFact(meeting.id, { status: 'forgotten', fact: 'Old note.' });
    const [brief] = await db
      .insert(meetingBriefs)
      .values({ meetingId: meeting.id, summary: 'Pre-existing brief' })
      .returning();
    const [segment] = await db
      .insert(transcripts)
      .values({ meetingId: meeting.id, content: 'Pre-existing segment', startTime: 0, endTime: 500 })
      .returning();

    await deleteMeeting(meeting.id);

    const remainingMeetings = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(remainingMeetings).toHaveLength(0);

    const remainingFacts = await db
      .select()
      .from(twinFacts)
      .where(inArray(twinFacts.id, [activeFact.id, forgottenFact.id]));
    expect(remainingFacts).toHaveLength(0);

    // The pre-existing brief/transcript cascade (onDelete: 'cascade') still
    // fires correctly from WITHIN the new explicit transaction — not just
    // trusted blindly.
    const remainingBriefs = await db.select().from(meetingBriefs).where(eq(meetingBriefs.id, brief.id));
    expect(remainingBriefs).toHaveLength(0);
    const remainingSegments = await db.select().from(transcripts).where(eq(transcripts.id, segment.id));
    expect(remainingSegments).toHaveLength(0);

    expect(fs.existsSync(wavPath)).toBe(false);
  });

  it('resolves without throwing when the WAV file is already missing (ENOENT)', async () => {
    const db: Db = holder.db;
    const meeting = await insertMeeting({ title: 'No file on disk' });
    const missingPath = path.join(tmpRoot, 'does-not-exist.wav');
    await db.update(meetings).set({ audioPath: missingPath }).where(eq(meetings.id, meeting.id));

    await expect(deleteMeeting(meeting.id)).resolves.toBeUndefined();

    const remaining = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(remaining).toHaveLength(0);
  });

  it('resolves cleanly when the meeting has no audioPath at all (nothing to unlink)', async () => {
    const meeting = await insertMeeting({ title: 'Never recorded audio' });
    await expect(deleteMeeting(meeting.id)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteMeeting — keep path
// ---------------------------------------------------------------------------

describe('deleteMeeting — keep path (keepLearnedFacts: true)', () => {
  it('stamps sourceMeetingLabel on every fact and preserves the rows with a nulled FK', async () => {
    const db: Db = holder.db;
    const meeting = await insertMeeting({ title: 'Roadmap review' });
    const factA = await insertFact(meeting.id, { status: 'active' });
    const factB = await insertFact(meeting.id, { status: 'forgotten' });

    await deleteMeeting(meeting.id, { keepLearnedFacts: true });

    const kept = await db
      .select()
      .from(twinFacts)
      .where(inArray(twinFacts.id, [factA.id, factB.id]));
    expect(kept).toHaveLength(2);
    for (const row of kept) {
      expect(row.sourceMeetingId).toBeNull();
      expect(row.sourceMeetingLabel).toMatch(/^Roadmap review — deleted \d{4}-\d{2}-\d{2}$/);
    }

    const remainingMeetings = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(remainingMeetings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deleteMeeting — active-recording guard
// ---------------------------------------------------------------------------

describe('deleteMeeting — active-recording guard', () => {
  it('rejects with ActiveRecordingDeleteError before any mutation when the meeting is the active recording', async () => {
    const db: Db = holder.db;
    const meeting = await insertMeeting({ title: 'Live now' });
    const fact = await insertFact(meeting.id);
    setActiveMeetingId(meeting.id);

    await expect(deleteMeeting(meeting.id)).rejects.toBeInstanceOf(ActiveRecordingDeleteError);

    // Nothing was mutated — the row and its fact both survive.
    const remainingMeetings = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(remainingMeetings).toHaveLength(1);
    const remainingFacts = await db.select().from(twinFacts).where(eq(twinFacts.id, fact.id));
    expect(remainingFacts).toHaveLength(1);
  });

  it('does NOT reject deleting a DIFFERENT meeting while another one is actively recording', async () => {
    const recordingMeeting = await insertMeeting({ title: 'Recording elsewhere' });
    const targetMeeting = await insertMeeting({ title: 'Safe to delete' });
    setActiveMeetingId(recordingMeeting.id);

    await expect(deleteMeeting(targetMeeting.id)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getMeetingDeleteImpact
// ---------------------------------------------------------------------------

describe('getMeetingDeleteImpact', () => {
  it('returns accurate counts, labels, bytes, and hasBrief for a populated meeting', async () => {
    const db: Db = holder.db;
    const meeting = await insertMeeting({ title: 'Populated meeting' });
    const bytes = Buffer.from('x'.repeat(1234));
    const wavPath = await writeWavFixture(bytes);
    await db.update(meetings).set({ audioPath: wavPath }).where(eq(meetings.id, meeting.id));

    const labelledFactText = 'The team prefers async standups over live calls.';
    const unlabelledFactText = 'Ships the analytics dashboard Friday.';
    await insertFact(meeting.id, {
      label: 'Async standups',
      fact: labelledFactText,
      createdAt: new Date('2026-08-01T10:01:00Z'),
    });
    await insertFact(meeting.id, {
      label: null,
      fact: unlabelledFactText,
      createdAt: new Date('2026-08-01T10:02:00Z'),
    });

    await db.insert(meetingBriefs).values({ meetingId: meeting.id, summary: 'Summary text' });
    await db.insert(transcripts).values([
      { meetingId: meeting.id, content: 'Segment one', startTime: 0, endTime: 1000 },
      { meetingId: meeting.id, content: 'Segment two', startTime: 1000, endTime: 2000 },
    ]);

    const impact = await getMeetingDeleteImpact(meeting.id);

    expect(impact.factCount).toBe(2);
    // The second fact has no stored label — labelFor() must still resolve a
    // non-null derived fallback; never the raw null.
    expect(impact.factLabels).toEqual(['Async standups', labelFor({ fact: unlabelledFactText, label: null })]);
    expect(impact.factLabels).not.toContain(null);
    expect(impact.audioBytes).toBe(bytes.byteLength);
    expect(impact.hasBrief).toBe(true);
    expect(impact.transcriptSegmentCount).toBe(2);
  });

  it('returns zeros/empty for a bare meeting with no facts, brief, transcripts, or audio', async () => {
    const meeting = await insertMeeting({ title: 'Bare meeting' });

    const impact = await getMeetingDeleteImpact(meeting.id);

    expect(impact).toEqual({
      factCount: 0,
      factLabels: [],
      audioBytes: 0,
      hasBrief: false,
      transcriptSegmentCount: 0,
    });
  });

  it('reports audioBytes: 0 when audioPath points at a file missing on disk', async () => {
    const db: Db = holder.db;
    const meeting = await insertMeeting({ title: 'Dangling audio path' });
    await db
      .update(meetings)
      .set({ audioPath: path.join(tmpRoot, 'never-written.wav') })
      .where(eq(meetings.id, meeting.id));

    const impact = await getMeetingDeleteImpact(meeting.id);

    expect(impact.audioBytes).toBe(0);
  });
});
