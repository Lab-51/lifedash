// === FILE PURPOSE ===
// Unit tests for whisperPromptService (SPEAKER.1 Task 2) — the whisper glossary
// composed from the roster, the project's name/topics, and the preset glossary
// setting. Runs against a REAL in-memory PGlite database (same harness as
// participantRosterService.test.ts) because every guarantee here is a
// query/merge/budget guarantee: ordering, the char-budget item drop, per-preset
// key isolation, and email exclusion.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { calendarEvents, entities, entityLinks, meetings, projects, settings } from '../../db/schema';
import { DEFAULT_MIXED_PROMPTS } from '../../../shared/types/transcription';
import type { CalendarEventAttendee } from '../../../shared/types/calendar';

// --- Mocks (before importing the module under test) ---------------------------------
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import { buildInitialPrompt, GLOSSARY_BUDGET_CHARS } from '../whisperPromptService';

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

async function seedTopic(name: string): Promise<string> {
  const [row] = await holder.db
    .insert(entities)
    .values({ name, normalizedName: name.toLowerCase().replace(/\s+/g, ' ').trim(), kind: 'topic' })
    .returning({ id: entities.id });
  return row.id;
}

async function linkEntity(entityId: string, meetingId: string): Promise<void> {
  await holder.db.insert(entityLinks).values({ entityId, meetingId });
}

async function setGlossary(presetCode: string, value: string): Promise<void> {
  await holder.db.insert(settings).values({ key: `transcription:initial-prompt:${presetCode}`, value });
}

async function clearTables(): Promise<void> {
  await holder.db.delete(entityLinks);
  await holder.db.delete(entities);
  await holder.db.delete(meetings);
  await holder.db.delete(calendarEvents);
  await holder.db.delete(projects);
  await holder.db.delete(settings);
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

// === ordering ========================================================================

describe('buildInitialPrompt — ordering', () => {
  it('orders roster names -> project name -> topic entities -> preset glossary', async () => {
    const projectId = await seedProject('Acme');
    const otherMeeting = await seedMeeting({ projectId, startedAt: new Date('2026-01-01T00:00:00Z') });
    await linkEntity(await seedTopic('Widget'), otherMeeting);
    await setGlossary('en', 'GlossaryText');

    const meetingId = await seedMeeting({ participants: ['Alice'], projectId });

    expect(await buildInitialPrompt(meetingId, 'en')).toBe('Alice, Acme, Widget, GlossaryText');
  });

  it('is empty when the meeting has no roster, no project, and no stored/default glossary', async () => {
    const meetingId = await seedMeeting({});
    expect(await buildInitialPrompt(meetingId, 'en')).toBe('');
  });
});

// === per-preset glossary key isolation ==============================================

describe('buildInitialPrompt — per-preset glossary key', () => {
  it('reads a PLAIN preset’s own settings key, not another preset’s', async () => {
    await setGlossary('cs', 'Ahoj svete');
    await setGlossary('sk', 'Ahoj svet');
    const meetingId = await seedMeeting({});

    expect(await buildInitialPrompt(meetingId, 'cs')).toBe('Ahoj svete');
  });

  it('a plain preset with no stored glossary has no built-in default (stays empty)', async () => {
    const meetingId = await seedMeeting({});
    expect(await buildInitialPrompt(meetingId, 'cs')).toBe('');
  });

  it('a mixed preset falls back to its trilingual default when unset', async () => {
    const meetingId = await seedMeeting({});
    expect(await buildInitialPrompt(meetingId, 'sk-mix')).toBe(DEFAULT_MIXED_PROMPTS['sk-mix']);
  });

  it('a mixed preset with a stored glossary uses the stored value, not the default', async () => {
    await setGlossary('en-mix', 'Custom trilingual glossary');
    const meetingId = await seedMeeting({});

    expect(await buildInitialPrompt(meetingId, 'en-mix')).toBe('Custom trilingual glossary');
  });
});

// === empty roster -> byte-identical mixed-preset default ============================

describe('buildInitialPrompt — empty roster, mixed presets', () => {
  it('is byte-identical to today’s DEFAULT_MIXED_PROMPTS for every mixed code when nothing else is seeded', async () => {
    for (const code of ['cs-mix', 'sk-mix', 'en-mix'] as const) {
      const meetingId = await seedMeeting({});
      expect(await buildInitialPrompt(meetingId, code)).toBe(DEFAULT_MIXED_PROMPTS[code]);
    }
  });
});

// === topic entities: dedup + cap ====================================================

describe('buildInitialPrompt — project topic entities', () => {
  it('dedupes the SAME topic entity linked to multiple meetings of the project', async () => {
    const projectId = await seedProject('Acme'); // distinct from the topic name, isolates the assertion
    const topicId = await seedTopic('Roadmap');
    const m1 = await seedMeeting({ projectId, startedAt: new Date('2026-01-01T00:00:00Z') });
    const m2 = await seedMeeting({ projectId, startedAt: new Date('2026-02-01T00:00:00Z') });
    await linkEntity(topicId, m1);
    await linkEntity(topicId, m2);

    const meetingId = await seedMeeting({ projectId });

    // 'Roadmap' appears exactly once, not twice, despite two links to it.
    expect(await buildInitialPrompt(meetingId, 'en')).toBe('Acme, Roadmap');
  });

  it('caps topic entities at 12, most recent first', async () => {
    const projectId = await seedProject();
    const names = Array.from({ length: 14 }, (_, i) => `Topic${String(i).padStart(2, '0')}`);
    for (let i = 0; i < names.length; i++) {
      const otherMeeting = await seedMeeting({ projectId, startedAt: new Date(2026, 0, i + 1) });
      await linkEntity(await seedTopic(names[i]), otherMeeting);
    }
    // A different project's topic must never leak in.
    const otherProjectId = await seedProject('Project B');
    const otherProjectMeeting = await seedMeeting({ projectId: otherProjectId });
    await linkEntity(await seedTopic('Outsider'), otherProjectMeeting);

    const meetingId = await seedMeeting({ projectId, title: 'Project A meeting' });

    const result = await buildInitialPrompt(meetingId, 'en');
    const items = result.split(', ');
    // Project name ('Project A') + 12 of the 14 topics.
    expect(items).toHaveLength(13);
    expect(items[0]).toBe('Project A');
    expect(items.slice(1)).toEqual([...names].reverse().slice(0, 12));
    expect(result).not.toContain('Outsider');
  });
});

// === no email ever appears ===========================================================

describe('buildInitialPrompt — privacy', () => {
  it('never includes an attendee email, even when the roster is built from a calendar attendee', async () => {
    await seedEvent('google:evt-1', [{ name: 'Carol', email: 'carol@example.com' }]);
    const meetingId = await seedMeeting({ calendarEventId: 'google:evt-1' });

    const result = await buildInitialPrompt(meetingId, 'en');

    expect(result).toBe('Carol');
    expect(result).not.toContain('@');
  });
});

// === the char-budget cap drops whole items, never slices one ========================

describe('buildInitialPrompt — GLOSSARY_BUDGET_CHARS cap', () => {
  it('drops the lowest-priority item WHOLE when the total exceeds the budget, never truncating a kept item', async () => {
    const projectId = await seedProject('ProjectName');
    await setGlossary('en', 'X'.repeat(400)); // far larger than the whole budget alone

    const meetingId = await seedMeeting({ participants: ['Alice', 'Bob'], projectId });

    const result = await buildInitialPrompt(meetingId, 'en');

    // The oversized glossary item is dropped ENTIRELY — not one 'X' survives —
    // while the small, higher-priority items are kept intact and unmodified.
    expect(result).toBe('Alice, Bob, ProjectName');
    expect(result).not.toContain('X');
    expect(result.length).toBeLessThanOrEqual(GLOSSARY_BUDGET_CHARS);
  });

  it('keeps the full glossary untouched when it already fits the budget', async () => {
    await setGlossary('en', 'A short glossary');
    const meetingId = await seedMeeting({});

    expect(await buildInitialPrompt(meetingId, 'en')).toBe('A short glossary');
  });
});
