// === FILE PURPOSE ===
// Unit tests for calendarAssociationService.suggestProject — series→project
// association learning (Phase G Task 5). Covers the SERIES_ASSOCIATION_MIN
// threshold, the deterministic tiebreak, and disconnect-independence (the
// service must work from `meetings` columns alone, never touching
// `calendar_events`).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/schema', () => ({
  meetings: { calendarSeriesId: 'calendarSeriesId', projectId: 'projectId', createdAt: 'createdAt' },
  projects: { id: 'id', name: 'name' },
}));

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { suggestProject, SERIES_ASSOCIATION_MIN } from '../calendarAssociationService';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MeetingRow {
  projectId: string | null;
  createdAt: Date;
}

/** Build a mock db whose `select().from().where()` resolves to `meetingRows`
 * on the first call and `projectRows` on the second (the project-name lookup). */
function buildDb(meetingRows: MeetingRow[], projectRows: Array<{ name: string }>) {
  let call = 0;
  const selectFn = vi.fn(() => {
    const idx = call++;
    const rows = idx === 0 ? meetingRows : projectRows;
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    };
  });
  const db = { select: selectFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('suggestProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SERIES_ASSOCIATION_MIN is 2', () => {
    expect(SERIES_ASSOCIATION_MIN).toBe(2);
  });

  it('returns null when no seriesId is provided', async () => {
    const result = await suggestProject({});
    expect(result).toBeNull();
    // Must not even touch the DB
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns null when eventId is provided without seriesId (accepted, unused)', async () => {
    const result = await suggestProject({ eventId: 'google:evt-1' });
    expect(result).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns null when 0 meetings are linked to the series', async () => {
    buildDb([], []);
    const result = await suggestProject({ seriesId: 'series-1' });
    expect(result).toBeNull();
  });

  it('returns null when only 1 meeting is linked (below SERIES_ASSOCIATION_MIN)', async () => {
    buildDb([{ projectId: 'proj-a', createdAt: new Date('2026-01-01') }], []);
    const result = await suggestProject({ seriesId: 'series-1' });
    expect(result).toBeNull();
  });

  it('returns a suggestion when 2 meetings share the same project (threshold met)', async () => {
    buildDb(
      [
        { projectId: 'proj-a', createdAt: new Date('2026-01-01') },
        { projectId: 'proj-a', createdAt: new Date('2026-01-08') },
      ],
      [{ name: 'Website Redesign' }],
    );

    const result = await suggestProject({ seriesId: 'series-1' });

    expect(result).toEqual({ projectId: 'proj-a', projectName: 'Website Redesign', basis: 'series-history' });
  });

  it('picks the higher-count project on a cross-project split', async () => {
    buildDb(
      [
        { projectId: 'proj-a', createdAt: new Date('2026-01-01') },
        { projectId: 'proj-a', createdAt: new Date('2026-01-08') },
        { projectId: 'proj-a', createdAt: new Date('2026-01-15') },
        { projectId: 'proj-b', createdAt: new Date('2026-01-02') },
        { projectId: 'proj-b', createdAt: new Date('2026-01-09') },
      ],
      [{ name: 'Project A' }],
    );

    const result = await suggestProject({ seriesId: 'series-1' });

    expect(result?.projectId).toBe('proj-a');
  });

  it('breaks an exact-count tie deterministically by most-recent linked meeting', async () => {
    // Both projects have 2 linked meetings; proj-b's most recent link is newer.
    buildDb(
      [
        { projectId: 'proj-a', createdAt: new Date('2026-01-01') },
        { projectId: 'proj-a', createdAt: new Date('2026-01-05') },
        { projectId: 'proj-b', createdAt: new Date('2026-01-02') },
        { projectId: 'proj-b', createdAt: new Date('2026-01-20') },
      ],
      [{ name: 'Project B' }],
    );

    const result = await suggestProject({ seriesId: 'series-1' });

    expect(result?.projectId).toBe('proj-b');
  });

  it('breaks a fully-equal tie (same count, same most-recent timestamp) by lower projectId', async () => {
    const sameTime = new Date('2026-01-10');
    buildDb(
      [
        { projectId: 'proj-z', createdAt: sameTime },
        { projectId: 'proj-z', createdAt: sameTime },
        { projectId: 'proj-a', createdAt: sameTime },
        { projectId: 'proj-a', createdAt: sameTime },
      ],
      [{ name: 'Project A' }],
    );

    const result = await suggestProject({ seriesId: 'series-1' });

    // 'proj-a' < 'proj-z' lexicographically
    expect(result?.projectId).toBe('proj-a');
  });

  it('returns null when the top project row has since been deleted (name lookup misses)', async () => {
    buildDb(
      [
        { projectId: 'proj-gone', createdAt: new Date('2026-01-01') },
        { projectId: 'proj-gone', createdAt: new Date('2026-01-08') },
      ],
      [], // project row no longer exists
    );

    const result = await suggestProject({ seriesId: 'series-1' });
    expect(result).toBeNull();
  });

  it('works from meetings columns alone — disconnect-independence (never queries calendar_events)', async () => {
    // The service only ever imports `meetings` and `projects` from db/schema
    // (see the vi.mock above) — if it tried to touch calendar_events this
    // suite would fail at import time. This test just proves the happy path
    // still resolves correctly with no calendar_events state involved at all.
    buildDb(
      [
        { projectId: 'proj-a', createdAt: new Date('2026-01-01') },
        { projectId: 'proj-a', createdAt: new Date('2026-01-08') },
      ],
      [{ name: 'Website Redesign' }],
    );

    const result = await suggestProject({ seriesId: 'series-1' });
    expect(result).not.toBeNull();
    expect(result?.basis).toBe('series-history');
  });
});
