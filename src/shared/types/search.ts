// === Full-text search types (V3.1 Task 6) ===
// Shared between the main-process searchService (produces snippets via
// ts_headline) and the renderer's SessionSearch (renders them) so both agree on
// the highlight marker format without shipping raw HTML across the IPC boundary
// -- the renderer never needs dangerouslySetInnerHTML.

/** ts_headline StartSel/StopSel markers -- control characters that can never
 * appear in real transcript/card/project text, so the renderer can split on
 * them and highlight matches as plain React nodes instead of parsing HTML. */
export const SNIPPET_HIGHLIGHT_START = '';
export const SNIPPET_HIGHLIGHT_END = '';

export type SearchResultType = 'session' | 'card' | 'project';

export interface SearchResultItem {
  type: SearchResultType;
  /** Primary id for navigation: meetingId for 'session', cardId for 'card', projectId for 'project'. */
  id: string;
  title: string;
  /** ts_headline snippet with highlight markers, or null for a title/name-only match. */
  snippet: string | null;
  /** Present for 'card' results only -- needed to build the board route (/projects/:projectId). */
  projectId?: string;
  rank: number;
  /**
   * V3.4 (Task 5): true when this result came from the semantic (vector) layer
   * rather than FTS — lets the UI badge/blend it. Optional + additive: today's
   * FTS results simply omit it (undefined ⇒ keyword match).
   */
  semantic?: boolean;
}

/**
 * V3.4 (Task 5): an optional synthesized answer over the search results
 * (knowledge Q&A). Additive — absent for a plain keyword search. Citations point
 * back at the sessions the answer drew from so the UI can link them.
 */
export interface SearchAnswer {
  text: string;
  citations: Array<{ meetingId: string; title: string; snippet?: string }>;
}

export interface SearchResults {
  sessions: SearchResultItem[];
  cards: SearchResultItem[];
  projects: SearchResultItem[];
  /** Optional synthesized answer (V3.4). Absent for a plain keyword search. */
  answer?: SearchAnswer;
}
