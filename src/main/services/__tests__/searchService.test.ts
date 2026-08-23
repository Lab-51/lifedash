// === FILE PURPOSE ===
// Unit tests for searchService (V3.1 Task 6): verifies the empty-query short
// circuit, the Sessions-bucket merge/dedup (highest rank wins across
// meetings/transcripts/briefs), per-group result capping/ordering, card
// project-id passthrough, and -- most importantly -- that the user's query is
// ALWAYS a bound parameter to websearch_to_tsquery, never string-concatenated
// into the SQL text (checked against drizzle-orm's actual sql`` queryChunks
// shape, not a guess).
//
// Also covers collapseByEntity (BRIEF-QUAL.2 Task 4) as a plain, DB-free unit:
// the `brief` vector channel's per-entity collapse (best chunk per entity_id,
// cut to k AFTER collapsing) that stops one chatty meeting's notes chunks from
// crowding every other meeting's brief out of the top-k fetch. The REAL cosine
// wiring (real PGlite) is proved in searchService.hybrid.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { search, collapseByEntity } from '../searchService';
import { getDb } from '../../db/connection';
import { SNIPPET_HIGHLIGHT_START, SNIPPET_HIGHLIGHT_END } from '../../../shared/types/search';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The five FTS queries run (in this fixed order) via Promise.all: meetings,
 * transcripts, briefs, cards, projects. Queues one `db.execute` resolution per
 * entity so each query function's row shape can be controlled independently.
 */
function mockExecuteSequence(rowsPerCall: unknown[][]) {
  const execute = vi.fn();
  for (const rows of rowsPerCall) {
    execute.mockResolvedValueOnce({ rows });
  }
  vi.mocked(getDb).mockReturnValue({ execute } as never);
  return execute;
}

/**
 * Verifies a drizzle sql`` object binds `userQuery` as a real parameter
 * (a standalone entry in queryChunks) rather than splicing it into one of the
 * literal text chunks -- i.e. no string concatenation into the SQL text.
 */
function isParameterized(sqlObj: unknown, userQuery: string): boolean {
  const chunks = (sqlObj as { queryChunks: unknown[] }).queryChunks;
  const boundAsParam = chunks.includes(userQuery);
  const leakedIntoText = chunks.some((chunk) => {
    if (chunk && typeof chunk === 'object' && 'value' in (chunk as { value?: unknown[] })) {
      const value = (chunk as { value: unknown[] }).value;
      return value.some((part) => typeof part === 'string' && part.includes(userQuery));
    }
    return false;
  });
  return boundAsParam && !leakedIntoText;
}

// Sanity check on the helper itself, against both a parameterized and a
// (hypothetical) concatenated query, so a bug in the helper can't silently
// pass the real test below.
describe('isParameterized helper sanity check', () => {
  it('reports true for a properly parameterized sql`` query', () => {
    const evil = "'; DROP TABLE meetings; --";
    const parameterized = sql`SELECT * FROM meetings WHERE title = ${evil}`;
    expect(isParameterized(parameterized, evil)).toBe(true);
  });

  it('reports false for a naively concatenated query', () => {
    const evil = "'; DROP TABLE meetings; --";
    const concatenated = sql.raw(`SELECT * FROM meetings WHERE title = '${evil}'`);
    expect(isParameterized(concatenated, evil)).toBe(false);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('search', () => {
  it('returns empty grouped results for an empty/whitespace query without touching the db', async () => {
    const result = await search('   ');
    expect(result).toEqual({ sessions: [], cards: [], projects: [] });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('runs exactly one parameterized FTS query per entity (5 total)', async () => {
    const execute = mockExecuteSequence([[], [], [], [], []]);
    const evilQuery = "'; DROP TABLE meetings; --";

    await search(evilQuery);

    expect(execute).toHaveBeenCalledTimes(5);
    for (const call of execute.mock.calls) {
      expect(isParameterized(call[0], evilQuery)).toBe(true);
    }
  });

  it('merges meetings/transcripts/briefs into one Sessions bucket, deduped by meeting id (highest rank wins)', async () => {
    mockExecuteSequence([
      // meetings: title match, low rank
      [{ id: 'm1', title: 'Q3 Roadmap', snippet: null, rank: 0.2 }],
      // transcripts: same meeting, higher rank + a snippet -> should win
      [
        {
          id: 'm1',
          title: 'Q3 Roadmap',
          snippet: `We discussed the ${SNIPPET_HIGHLIGHT_START}roadmap${SNIPPET_HIGHLIGHT_END} in depth`,
          rank: 0.9,
        },
      ],
      // briefs: none
      [],
      // cards: none
      [],
      // projects: none
      [],
    ]);

    const result = await search('roadmap');

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ type: 'session', id: 'm1', rank: 0.9 });
    expect(result.sessions[0].snippet).toContain('roadmap');
  });

  it('prefers the snippet-carrying hit on a TIED rank instead of the bare title match (#6)', async () => {
    mockExecuteSequence([
      // meetings: title match, snippet=NULL -- inserted into the merge first
      [{ id: 'm3', title: 'Design Review', snippet: null, rank: 0.5 }],
      // transcripts: same meeting, SAME rank, but carries a snippet
      [
        {
          id: 'm3',
          title: 'Design Review',
          snippet: `Talked through the ${SNIPPET_HIGHLIGHT_START}design${SNIPPET_HIGHLIGHT_END} review`,
          rank: 0.5,
        },
      ],
      [],
      [],
      [],
    ]);

    const result = await search('design');

    expect(result.sessions).toHaveLength(1);
    // A strict `>` would have kept the title row (inserted first); the tie-break
    // must prefer the snippet-carrying transcript row instead.
    expect(result.sessions[0].snippet).toContain('design');
  });

  it('picks the meeting-title match over a lower-ranked brief match for the same meeting', async () => {
    mockExecuteSequence([
      [{ id: 'm2', title: 'Search Feature Kickoff', snippet: null, rank: 0.8 }],
      [],
      [{ id: 'm2', title: 'Search Feature Kickoff', snippet: 'ship full text search', rank: 0.1 }],
      [],
      [],
    ]);

    const result = await search('search');

    expect(result.sessions).toHaveLength(1);
    // Title match (rank 0.8) beats the brief match (rank 0.1) -- highest rank wins regardless of source.
    expect(result.sessions[0].rank).toBe(0.8);
    expect(result.sessions[0].snippet).toBeNull();
  });

  it('maps card rows with their projectId for board-route navigation', async () => {
    mockExecuteSequence([
      [],
      [],
      [],
      [{ id: 'c1', title: 'Build search feature', project_id: 'proj-9', snippet: null, rank: 0.4 }],
      [],
    ]);

    const result = await search('search feature');

    expect(result.cards).toEqual([
      { type: 'card', id: 'c1', title: 'Build search feature', snippet: null, projectId: 'proj-9', rank: 0.4 },
    ]);
  });

  it('maps project rows', async () => {
    mockExecuteSequence([[], [], [], [], [{ id: 'p1', title: 'Acme Launch', snippet: null, rank: 0.6 }]]);

    const result = await search('acme');

    expect(result.projects).toEqual([
      { type: 'project', id: 'p1', title: 'Acme Launch', snippet: null, projectId: undefined, rank: 0.6 },
    ]);
  });

  it('caps and sorts each group to the top-ranked results', async () => {
    const manyCards = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: `Card ${i}`,
      project_id: 'p1',
      snippet: null,
      rank: i, // 0..9, ascending -- output must be capped + sorted descending
    }));
    mockExecuteSequence([[], [], [], manyCards, []]);

    const result = await search('card');

    expect(result.cards).toHaveLength(8);
    expect(result.cards.map((c) => c.rank)).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it('coerces string-typed rank values (as some pg drivers return numeric types) to numbers', async () => {
    mockExecuteSequence([[{ id: 'm1', title: 'Standup', snippet: null, rank: '0.42' }], [], [], [], []]);

    const result = await search('standup');

    expect(result.sessions[0].rank).toBe(0.42);
    expect(typeof result.sessions[0].rank).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// collapseByEntity (BRIEF-QUAL.2 Task 4) — brief-channel per-entity collapse
// ---------------------------------------------------------------------------

describe('collapseByEntity — brief-channel per-entity collapse before the top-k cut', () => {
  /** A minimal distance-ascending vector row, shaped like the `brief` channel's
   *  over-fetched SQL rows (entity_id present — only that channel selects it). */
  function row(entityId: string, distance: number, meetingId = 'm1') {
    return {
      id: meetingId,
      title: 'T',
      project_id: null,
      meeting_id: meetingId,
      entity_id: entityId,
      content: 'c',
      distance,
    };
  }

  it('collapses three rows sharing one entityId to ONE hit carrying the smallest distance', () => {
    // Same entity three times — e.g. chunk 0's summary plus two notes chunks of
    // one chatty meeting's brief. Rows arrive distance-ascending (the real SQL's
    // ORDER BY distance), so the kept (first-seen) row is also the closest.
    const rows = [row('brief-1', 0.1), row('brief-1', 0.2), row('brief-1', 0.3)];

    const result = collapseByEntity(rows, 8);

    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe('brief-1');
    expect(result[0].distance).toBe(0.1); // the smallest — first-seen under ascending input
  });

  it('a second entityId is still present alongside the first', () => {
    const rows = [row('brief-1', 0.1), row('brief-1', 0.15), row('brief-2', 0.2)];

    const result = collapseByEntity(rows, 8);

    expect(result.map((r) => r.entity_id).sort()).toEqual(['brief-1', 'brief-2']);
  });

  it('honours k AFTER the collapse — an over-represented entity cannot crowd a second entity out before the cut', () => {
    // Three rows for brief-1 occupy the closest three distances; a naive
    // "cut to k first, collapse after" implementation would return ONLY
    // brief-1 for k=2 (all three of its rows fall inside the top 2) — exactly
    // the crowd-out bug this collapse exists to prevent.
    const rows = [row('brief-1', 0.1), row('brief-1', 0.11), row('brief-1', 0.12), row('brief-2', 0.13)];

    const result = collapseByEntity(rows, 2);

    expect(result.map((r) => r.entity_id)).toEqual(['brief-1', 'brief-2']);
  });

  it('k still caps the collapsed result when more than k distinct entities remain', () => {
    const rows = [row('brief-1', 0.1), row('brief-2', 0.2), row('brief-3', 0.3), row('brief-4', 0.4)];

    const result = collapseByEntity(rows, 2);

    expect(result.map((r) => r.entity_id)).toEqual(['brief-1', 'brief-2']);
  });

  it('an empty input yields an empty result', () => {
    expect(collapseByEntity([], 8)).toEqual([]);
  });
});
