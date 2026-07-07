// === FILE PURPOSE ===
// Query-time full-text search across sessions (meetings/transcripts/briefs),
// cards, and projects (V3.1 Task 6). Uses Postgres FTS -- to_tsvector +
// websearch_to_tsquery -- with the 'simple' config (NOT 'english') because
// transcripts are multilingual (TRANSCRIBE-MULTILANG): no stemming beats
// wrong-language stemming. Query-time only, NO new indexes/migrations --
// personal-tool scale (add a GIN index later only if measured slow).
//
// The user's query is ALWAYS passed as a bound parameter to
// websearch_to_tsquery via drizzle's sql`` tagged template -- never
// string-concatenated into the query text.
//
// ts_headline was verified to work in PGlite (including custom StartSel/StopSel
// markers) -- see SNIPPET_HIGHLIGHT_START/END. No manual-snippet fallback is
// needed.
//
// Results are grouped for the UI into three buckets: sessions (meetings union
// transcripts union briefs, deduped by meeting -- the highest-ranked match per
// meeting wins), cards, and projects.

import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { SNIPPET_HIGHLIGHT_START, SNIPPET_HIGHLIGHT_END } from '../../shared/types/search';
import type { SearchResultItem, SearchResultType, SearchResults } from '../../shared/types/search';

type DB = ReturnType<typeof getDb>;

const FETCH_LIMIT = 20; // rows fetched per entity before ranking/grouping
const RESULT_LIMIT = 8; // rows surfaced per group in the UI

/** ts_headline options -- bound as a parameter like the query itself. StartSel/
 * StopSel are control characters (never appear in real text) so the renderer
 * can highlight matches without parsing HTML. */
const HEADLINE_OPTIONS = `StartSel=${SNIPPET_HIGHLIGHT_START}, StopSel=${SNIPPET_HIGHLIGHT_END}, MaxFragments=1, MaxWords=15, MinWords=5, HighlightAll=false`;

interface RawRow {
  [key: string]: unknown;
  id: string;
  title: string;
  snippet: string | null;
  project_id?: string | null;
  rank: number | string;
}

function toItem(type: SearchResultType, row: RawRow): SearchResultItem {
  return {
    type,
    id: row.id,
    title: row.title,
    snippet: row.snippet ?? null,
    projectId: row.project_id ?? undefined,
    rank: Number(row.rank),
  };
}

async function searchMeetings(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT id, title, NULL AS snippet,
      ts_rank(to_tsvector('simple', title), websearch_to_tsquery('simple', ${query})) AS rank
    FROM meetings
    WHERE to_tsvector('simple', title) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('session', row));
}

async function searchTranscriptContent(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT t.meeting_id AS id, m.title AS title,
      ts_headline('simple', t.content, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS}) AS snippet,
      ts_rank(to_tsvector('simple', t.content), websearch_to_tsquery('simple', ${query})) AS rank
    FROM transcripts t
    JOIN meetings m ON m.id = t.meeting_id
    WHERE to_tsvector('simple', t.content) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('session', row));
}

async function searchBriefs(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT b.meeting_id AS id, m.title AS title,
      ts_headline('simple', b.summary, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS}) AS snippet,
      ts_rank(to_tsvector('simple', b.summary), websearch_to_tsquery('simple', ${query})) AS rank
    FROM meeting_briefs b
    JOIN meetings m ON m.id = b.meeting_id
    WHERE to_tsvector('simple', b.summary) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('session', row));
}

async function searchCards(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT c.id AS id, c.title AS title, b.project_id AS project_id,
      CASE WHEN c.description IS NOT NULL
             AND to_tsvector('simple', c.description) @@ websearch_to_tsquery('simple', ${query})
           THEN ts_headline('simple', c.description, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS})
           ELSE NULL END AS snippet,
      ts_rank(to_tsvector('simple', c.title || ' ' || coalesce(c.description, '')), websearch_to_tsquery('simple', ${query})) AS rank
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN boards b ON b.id = col.board_id
    WHERE c.archived = false
      AND to_tsvector('simple', c.title || ' ' || coalesce(c.description, '')) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('card', row));
}

async function searchProjects(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT id, name AS title, NULL AS snippet,
      ts_rank(to_tsvector('simple', name), websearch_to_tsquery('simple', ${query})) AS rank
    FROM projects
    WHERE archived = false AND system = false
      AND to_tsvector('simple', name) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('project', row));
}

function topRanked(items: SearchResultItem[]): SearchResultItem[] {
  return [...items].sort((a, b) => b.rank - a.rank).slice(0, RESULT_LIMIT);
}

/**
 * Merge meeting/transcript/brief matches into one Sessions bucket, deduped by
 * meeting id -- the highest-ranked source per meeting wins, so a transcript or
 * brief hit (which carries a snippet) is preferred over a bare title match when
 * a meeting matches on more than one field. On a tied rank, the snippet-carrying
 * entry wins the tie-break (meeting rows are inserted before transcript/brief
 * rows above, so a strict `>` would otherwise let a snippet-less title match
 * shadow an equally-ranked transcript hit).
 */
function mergeSessionResults(...groups: SearchResultItem[][]): SearchResultItem[] {
  const byId = new Map<string, SearchResultItem>();
  for (const item of groups.flat()) {
    const existing = byId.get(item.id);
    const tiedButHasSnippet = !!existing && item.rank === existing.rank && !!item.snippet && !existing.snippet;
    if (!existing || item.rank > existing.rank || tiedButHasSnippet) byId.set(item.id, item);
  }
  return topRanked([...byId.values()]);
}

/**
 * Full-text search across sessions, cards, and projects. See file header for
 * the FTS approach and parameterization guarantee.
 */
export async function search(rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (!query) return { sessions: [], cards: [], projects: [] };

  const db = getDb();
  const [meetingRows, transcriptRows, briefRows, cardRows, projectRows] = await Promise.all([
    searchMeetings(db, query),
    searchTranscriptContent(db, query),
    searchBriefs(db, query),
    searchCards(db, query),
    searchProjects(db, query),
  ]);

  return {
    sessions: mergeSessionResults(meetingRows, transcriptRows, briefRows),
    cards: topRanked(cardRows),
    projects: topRanked(projectRows),
  };
}
