// === FILE PURPOSE ===
// Structural data backbone for the "living brain" mind map (V3.2 Task 1).
//
// buildBrainTree({ scope }) reads the knowledge structure straight from the DB
// (ZERO AI calls) and assembles a HIERARCHICAL tree for two scopes:
//   - 'workspace'          -> workspace > projects > (Sessions group + board
//                             columns) > sessions/cards, plus a root-level
//                             "Unlinked sessions" group for project-less meetings.
//   - { meetingId }        -> one session > Project / Cards created / Decisions /
//                             Open questions branches.
// Cross-hierarchy relations (a card's meeting provenance, an accepted
// suggestion's card/project) ride in a flat crossLinks array — rendered later as
// dashed overlays, never as tree edges.
//
// === INVARIANTS ===
// - One bulk query per entity type — NO N+1. All projects/columns/cards/sessions
//   /suggestions are fetched in a handful of queries, then assembled in memory.
// - Node ids are STABLE/deterministic (entity type + entity id, or a fixed
//   synthetic key). Task 4's live-growth diff depends on identical ids across
//   refetches — never use index/timestamp/random.
// - Empty-branch pruning: a column with 0 cards and a group with 0 children are
//   dropped. Projects are NEVER pruned (an empty project is still meaningful).
// - childCount reflects direct children AFTER pruning.
// - The whole tree is returned — no caps / lazy-loading (that is the renderer's
//   job). Personal-tool scale serializes fine over one IPC call.
// - Archived cards are excluded (they are off the board, matching every board
//   view); all project rows are included (system + archived) so no session/card
//   ever vanishes from the map.
//
// === SECURITY ===
// The session-scope meetingId is ALWAYS bound as a drizzle sql`` parameter,
// never concatenated into query text.

import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import type { BrainNode, BrainNodeType, BrainScope, BrainTree, CrossLink } from '../../shared/types/brain';

type DB = ReturnType<typeof getDb>;

// --- Stable id helpers ------------------------------------------------------
// Entity nodes: `${type}:${entityId}`. Synthetic (group/root) nodes: a fixed
// key that only ever depends on stable parent identity.
const WORKSPACE_ROOT_ID = 'workspace';
const UNLINKED_GROUP_ID = 'group:unlinked';
const projectNodeId = (id: string) => `project:${id}`;
const columnNodeId = (id: string) => `column:${id}`;
const cardNodeId = (id: string) => `card:${id}`;
const sessionNodeId = (id: string) => `session:${id}`;
const decisionNodeId = (id: string) => `decision:${id}`;
const questionNodeId = (id: string) => `question:${id}`;
const sessionsGroupId = (projectId: string) => `group:sessions:${projectId}`;
const projectGroupId = (meetingId: string) => `group:project:${meetingId}`;
const cardsGroupId = (meetingId: string) => `group:cards:${meetingId}`;
const decisionsGroupId = (meetingId: string) => `group:decisions:${meetingId}`;
const questionsGroupId = (meetingId: string) => `group:questions:${meetingId}`;

// --- Raw row shapes (snake_case, as PGlite returns them) --------------------
// The index signature satisfies db.execute<T>'s Record<string, unknown> bound.
interface RawRow {
  [key: string]: unknown;
}
interface ProjectRow extends RawRow {
  id: string;
  name: string;
}
interface ColumnRow extends RawRow {
  id: string;
  name: string;
  project_id: string;
}
interface CardRow extends RawRow {
  id: string;
  column_id: string;
  title: string;
  source_meeting_id: string | null;
}
interface MeetingRow extends RawRow {
  id: string;
  title: string;
  project_id: string | null;
}
interface SuggestionRow extends RawRow {
  id: string;
  type: string;
  title: string;
  accepted_card_id: string | null;
  accepted_project_id: string | null;
}

interface RelCandidate {
  fromId: string;
  toId: string;
}

// --- Small in-memory helpers ------------------------------------------------
function node(
  id: string,
  type: BrainNodeType,
  label: string,
  entityId: string | null,
  children: BrainNode[],
): BrainNode {
  return { id, type, label, entityId, childCount: children.length, children };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) existing.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function makeCardNode(row: CardRow): BrainNode {
  return node(cardNodeId(row.id), 'card', row.title, row.id, []);
}

/** Build a column node, or null if it has no (non-archived) cards — empty
 *  columns are pruned per the plan. */
function makeColumnNode(col: ColumnRow, cardsByColumn: Map<string, CardRow[]>): BrainNode | null {
  const cards = cardsByColumn.get(col.id) ?? [];
  if (cards.length === 0) return null;
  return node(columnNodeId(col.id), 'column', col.name, col.id, cards.map(makeCardNode));
}

/** Push a card->originating-session provenance candidate for every card that
 *  carries a source meeting. buildCrossLinks drops any whose session is absent. */
function collectProvenance(cards: CardRow[], out: RelCandidate[]): void {
  for (const c of cards) {
    if (c.source_meeting_id != null) out.push({ fromId: cardNodeId(c.id), toId: sessionNodeId(c.source_meeting_id) });
  }
}

function collectIds(root: BrainNode): Set<string> {
  const ids = new Set<string>();
  const stack: BrainNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as BrainNode;
    ids.add(current.id);
    for (const child of current.children) stack.push(child);
  }
  return ids;
}

/** Keep only relations whose BOTH endpoints exist as nodes in the tree, deduped. */
function buildCrossLinks(idSet: Set<string>, provenance: RelCandidate[], accepted: RelCandidate[]): CrossLink[] {
  const links: CrossLink[] = [];
  const seen = new Set<string>();
  const add = (fromId: string, toId: string, kind: CrossLink['kind']) => {
    if (!idSet.has(fromId) || !idSet.has(toId)) return;
    const key = `${kind}:${fromId}->${toId}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ fromId, toId, kind });
  };
  for (const rel of provenance) add(rel.fromId, rel.toId, 'provenance');
  for (const rel of accepted) add(rel.fromId, rel.toId, 'accepted');
  return links;
}

// --- Workspace scope --------------------------------------------------------
async function buildWorkspaceTree(db: DB): Promise<BrainTree> {
  const [projectsRes, columnsRes, cardsRes, meetingsRes] = await Promise.all([
    db.execute<ProjectRow>(sql`
      SELECT id, name FROM projects
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `),
    // Columns carry their project + board ordering via a join with boards
    // (different tables — the PGlite "same table twice" limit does not apply).
    db.execute<ColumnRow>(sql`
      SELECT col.id AS id, col.name AS name, b.project_id AS project_id
      FROM columns col
      JOIN boards b ON b.id = col.board_id
      ORDER BY b.position ASC, col.position ASC, col.id ASC
    `),
    db.execute<CardRow>(sql`
      SELECT id, column_id, title, source_meeting_id
      FROM cards
      WHERE archived = false
      ORDER BY position ASC, id ASC
    `),
    db.execute<MeetingRow>(sql`
      SELECT id, title, project_id FROM meetings
      ORDER BY started_at DESC, created_at DESC, id ASC
    `),
  ]);

  const cardsByColumn = groupBy(cardsRes.rows, (c) => c.column_id);
  const columnsByProject = groupBy(columnsRes.rows, (c) => c.project_id);

  const sessionsByProject = new Map<string, MeetingRow[]>();
  const unlinkedSessions: MeetingRow[] = [];
  for (const meeting of meetingsRes.rows) {
    if (meeting.project_id == null) {
      unlinkedSessions.push(meeting);
    } else {
      const existing = sessionsByProject.get(meeting.project_id);
      if (existing) existing.push(meeting);
      else sessionsByProject.set(meeting.project_id, [meeting]);
    }
  }

  const projectNodes = projectsRes.rows.map((project) => {
    const children: BrainNode[] = [];

    // "Sessions" group first (pruned when the project has no sessions).
    const sessions = sessionsByProject.get(project.id) ?? [];
    if (sessions.length > 0) {
      const sessionNodes = sessions.map((m) => node(sessionNodeId(m.id), 'session', m.title, m.id, []));
      children.push(node(sessionsGroupId(project.id), 'group', 'Sessions', null, sessionNodes));
    }

    // Then one node per non-empty board column (flattened across all boards).
    for (const col of columnsByProject.get(project.id) ?? []) {
      const columnNode = makeColumnNode(col, cardsByColumn);
      if (columnNode) children.push(columnNode);
    }

    return node(projectNodeId(project.id), 'project', project.name, project.id, children);
  });

  const rootChildren = [...projectNodes];
  if (unlinkedSessions.length > 0) {
    const sessionNodes = unlinkedSessions.map((m) => node(sessionNodeId(m.id), 'session', m.title, m.id, []));
    rootChildren.push(node(UNLINKED_GROUP_ID, 'group', 'Unlinked sessions', null, sessionNodes));
  }

  const root = node(WORKSPACE_ROOT_ID, 'workspace', 'Workspace', null, rootChildren);

  // Provenance: card -> the session it was created from (accepted links have no
  // suggestion nodes in workspace scope, so none are emitted here).
  const provenance: RelCandidate[] = [];
  collectProvenance(cardsRes.rows, provenance);

  return { root, crossLinks: buildCrossLinks(collectIds(root), provenance, []) };
}

// --- Session scope ----------------------------------------------------------

/**
 * Build the "Project" branch (group > project > non-empty columns > cards) for
 * the session's linked project, collecting card->session provenance. Returns
 * null when the linked project row no longer exists.
 */
async function buildProjectBranch(
  db: DB,
  meetingId: string,
  linkedProjectId: string,
  provenance: RelCandidate[],
): Promise<BrainNode | null> {
  const [projectRes, columnsRes, cardsRes] = await Promise.all([
    db.execute<ProjectRow>(sql`SELECT id, name FROM projects WHERE id = ${linkedProjectId}`),
    db.execute<ColumnRow>(sql`
      SELECT col.id AS id, col.name AS name, b.project_id AS project_id
      FROM columns col
      JOIN boards b ON b.id = col.board_id
      WHERE b.project_id = ${linkedProjectId}
      ORDER BY b.position ASC, col.position ASC, col.id ASC
    `),
    db.execute<CardRow>(sql`
      SELECT c.id AS id, c.column_id AS column_id, c.title AS title, c.source_meeting_id AS source_meeting_id
      FROM cards c
      JOIN columns col ON col.id = c.column_id
      JOIN boards b ON b.id = col.board_id
      WHERE b.project_id = ${linkedProjectId} AND c.archived = false
      ORDER BY c.position ASC, c.id ASC
    `),
  ]);

  const project = projectRes.rows[0];
  if (!project) return null;

  const cardsByColumn = groupBy(cardsRes.rows, (c) => c.column_id);
  const columnNodes: BrainNode[] = [];
  for (const col of columnsRes.rows) {
    const columnNode = makeColumnNode(col, cardsByColumn);
    if (columnNode) columnNodes.push(columnNode);
  }
  collectProvenance(cardsRes.rows, provenance);

  const projectNode = node(projectNodeId(project.id), 'project', project.name, project.id, columnNodes);
  return node(projectGroupId(meetingId), 'group', 'Project', null, [projectNode]);
}

/**
 * Append the "Decisions" and "Open questions" branches for the meeting's
 * accepted live suggestions (fetched in one query, bucketed by type here) and
 * collect each suggestion's accepted-card / accepted-project relation.
 */
function appendSuggestionBranches(
  rows: SuggestionRow[],
  meetingId: string,
  rootChildren: BrainNode[],
  accepted: RelCandidate[],
): void {
  const decisions = rows.filter((s) => s.type === 'decision');
  const questions = rows.filter((s) => s.type === 'question');
  if (decisions.length > 0) {
    const dNodes = decisions.map((s) => node(decisionNodeId(s.id), 'decision', s.title, s.id, []));
    rootChildren.push(node(decisionsGroupId(meetingId), 'group', 'Decisions', null, dNodes));
  }
  if (questions.length > 0) {
    const qNodes = questions.map((s) => node(questionNodeId(s.id), 'question', s.title, s.id, []));
    rootChildren.push(node(questionsGroupId(meetingId), 'group', 'Open questions', null, qNodes));
  }
  for (const s of rows) {
    const fromId = s.type === 'decision' ? decisionNodeId(s.id) : questionNodeId(s.id);
    if (s.accepted_card_id != null) accepted.push({ fromId, toId: cardNodeId(s.accepted_card_id) });
    if (s.accepted_project_id != null) accepted.push({ fromId, toId: projectNodeId(s.accepted_project_id) });
  }
}

async function buildSessionTree(db: DB, meetingId: string): Promise<BrainTree> {
  const meetingRes = await db.execute<MeetingRow>(sql`
    SELECT id, title, project_id FROM meetings WHERE id = ${meetingId}
  `);
  const meeting = meetingRes.rows[0];
  const linkedProjectId = meeting?.project_id ?? null;

  const rootChildren: BrainNode[] = [];
  const provenance: RelCandidate[] = [];
  const accepted: RelCandidate[] = [];

  // Branch: "Project" — the linked project with its columns/cards.
  if (linkedProjectId) {
    const projectBranch = await buildProjectBranch(db, meetingId, linkedProjectId, provenance);
    if (projectBranch) rootChildren.push(projectBranch);
  }

  // Branch: "Cards created" — cards whose provenance is this meeting.
  const createdRes = await db.execute<CardRow>(sql`
    SELECT id, column_id, title, source_meeting_id
    FROM cards
    WHERE source_meeting_id = ${meetingId} AND archived = false
    ORDER BY created_at ASC, id ASC
  `);
  if (createdRes.rows.length > 0) {
    rootChildren.push(node(cardsGroupId(meetingId), 'group', 'Cards created', null, createdRes.rows.map(makeCardNode)));
    collectProvenance(createdRes.rows, provenance);
  }

  // Branches: "Decisions" + "Open questions" — accepted live suggestions.
  const suggestionsRes = await db.execute<SuggestionRow>(sql`
    SELECT id, type, title, accepted_card_id, accepted_project_id
    FROM live_suggestions
    WHERE meeting_id = ${meetingId} AND status = 'accepted' AND type IN ('decision', 'question')
    ORDER BY created_at ASC, id ASC
  `);
  appendSuggestionBranches(suggestionsRes.rows, meetingId, rootChildren, accepted);

  const root = node(sessionNodeId(meetingId), 'session', meeting?.title ?? 'Session', meetingId, rootChildren);
  return { root, crossLinks: buildCrossLinks(collectIds(root), provenance, accepted) };
}

/**
 * Build the hierarchical brain-tree payload for the given scope. Structural DB
 * reads only — no AI. See the file header for invariants and the id-stability
 * contract that Task 4's live-growth diff relies on.
 */
export async function buildBrainTree(params: { scope: BrainScope }): Promise<BrainTree> {
  const db = getDb();
  if (params.scope === 'workspace') return buildWorkspaceTree(db);
  return buildSessionTree(db, params.scope.meetingId);
}
