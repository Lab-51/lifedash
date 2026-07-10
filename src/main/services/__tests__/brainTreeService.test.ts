// === FILE PURPOSE ===
// Unit tests for brainTreeService.buildBrainTree (V3.2 Task 1).
//
// Seeding approach: this project's services run raw drizzle sql`` via
// db.execute(); every service test mocks getDb rather than spinning up a real
// PGlite (no sibling test instantiates one). We therefore mirror
// searchService.test.ts exactly — a seeded fixture DB double whose execute()
// yields one queued { rows } payload per query, in the fixed order the service
// issues them. This exercises the part that actually carries the logic and the
// risk: the in-memory hierarchy assembly, pruning, childCount, crossLinks, and
// id stability.
//
// It also verifies the security guarantee the plan calls out: the session-scope
// meetingId is ALWAYS a bound sql`` parameter, never concatenated into query
// text (checked against drizzle-orm's real queryChunks shape).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { buildBrainTree } from '../brainTreeService';
import { getDb } from '../../db/connection';
import type { BrainNode } from '../../../shared/types/brain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Queue one db.execute({ rows }) resolution per query, in issue order. */
function mockExecuteSequence(rowsPerCall: unknown[][]) {
  const execute = vi.fn();
  for (const rows of rowsPerCall) execute.mockResolvedValueOnce({ rows });
  vi.mocked(getDb).mockReturnValue({ execute } as never);
  return execute;
}

/** Collect every node id in a tree (DFS) — used for id-stability comparison. */
function collectIds(root: BrainNode): string[] {
  const ids: string[] = [];
  const stack: BrainNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as BrainNode;
    ids.push(n.id);
    for (const c of n.children) stack.push(c);
  }
  return ids.sort();
}

/** Find a direct child by node id. */
function child(node: BrainNode, id: string): BrainNode | undefined {
  return node.children.find((c) => c.id === id);
}

/**
 * True iff `userValue` is bound as a standalone sql`` parameter rather than
 * spliced into one of the literal text chunks (ported from searchService.test).
 */
function isParameterized(sqlObj: unknown, userValue: string): boolean {
  const chunks = (sqlObj as { queryChunks: unknown[] }).queryChunks;
  const boundAsParam = chunks.includes(userValue);
  const leakedIntoText = chunks.some((chunk) => {
    if (chunk && typeof chunk === 'object' && 'value' in (chunk as { value?: unknown[] })) {
      const value = (chunk as { value: unknown[] }).value;
      return value.some((part) => typeof part === 'string' && part.includes(userValue));
    }
    return false;
  });
  return boundAsParam && !leakedIntoText;
}

// Sanity-check the helper against a known-good and known-bad query.
describe('isParameterized helper sanity check', () => {
  it('reports true for a bound param and false for a concatenated one', () => {
    const evil = "'; DROP TABLE meetings; --";
    expect(isParameterized(sql`SELECT * FROM meetings WHERE id = ${evil}`, evil)).toBe(true);
    expect(isParameterized(sql.raw(`SELECT * FROM meetings WHERE id = '${evil}'`), evil)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Workspace query order: projects, columns, cards, meetings (Promise.all), then
// the two V3.4 entity queries (entities, entity_links) issued by loadEntities. The
// base fixture has NO entities, so the "People & topics" group is pruned and every
// pre-entity assertion holds unchanged; entity behavior gets its own fixture below.
function workspaceFixture() {
  return [
    // projects — p1 has sessions+cards, p2 has cards but NO sessions, p3 empty
    [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Gamma' },
      { id: 'p3', name: 'Empty' },
    ],
    // columns (already board.position/col.position ordered) — col2 is empty
    [
      { id: 'col1', name: 'To Do', project_id: 'p1' },
      { id: 'col2', name: 'Done', project_id: 'p1' },
      { id: 'col3', name: 'Backlog', project_id: 'p2' },
    ],
    // cards (archived=false) — col2 has none, so it must be pruned
    [
      { id: 'cardA', column_id: 'col1', title: 'Task A', source_meeting_id: 'm1' },
      { id: 'cardB', column_id: 'col1', title: 'Task B', source_meeting_id: null },
      { id: 'cardC', column_id: 'col3', title: 'Task C', source_meeting_id: null },
    ],
    // meetings — m1 linked to p1, m2 unlinked
    [
      { id: 'm1', title: 'Kickoff', project_id: 'p1' },
      { id: 'm2', title: 'Solo', project_id: null },
    ],
    [], // entities (none)
    [], // entity_links (none)
  ];
}

// ---------------------------------------------------------------------------
// Workspace scope
// ---------------------------------------------------------------------------

describe('buildBrainTree — workspace scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues exactly one query per entity type (6 total: 4 structural + 2 entity, no N+1)', async () => {
    const execute = mockExecuteSequence(workspaceFixture());
    await buildBrainTree({ scope: 'workspace' });
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it('builds workspace > projects > (Sessions group + columns) with an Unlinked sessions root group', async () => {
    mockExecuteSequence(workspaceFixture());
    const { root } = await buildBrainTree({ scope: 'workspace' });

    expect(root).toMatchObject({ id: 'workspace', type: 'workspace', label: 'Workspace', entityId: null });
    // 3 projects + 1 unlinked group
    expect(root.childCount).toBe(4);
    expect(root.children).toHaveLength(4);

    // --- Project Alpha: Sessions group first, then non-empty column ---
    const alpha = child(root, 'project:p1');
    expect(alpha).toMatchObject({ type: 'project', label: 'Alpha', entityId: 'p1', childCount: 2 });

    const sessions = child(alpha as BrainNode, 'group:sessions:p1');
    expect(sessions).toMatchObject({ type: 'group', label: 'Sessions', entityId: null, childCount: 1 });
    expect(sessions?.children[0]).toMatchObject({
      id: 'session:m1',
      type: 'session',
      label: 'Kickoff',
      entityId: 'm1',
    });

    const toDo = child(alpha as BrainNode, 'column:col1');
    expect(toDo).toMatchObject({ type: 'column', label: 'To Do', entityId: 'col1', childCount: 2 });
    expect(toDo?.children.map((c) => c.id)).toEqual(['card:cardA', 'card:cardB']);

    // col2 has no cards -> pruned
    expect(child(alpha as BrainNode, 'column:col2')).toBeUndefined();
  });

  it('emits a column but NO Sessions group for a project with cards and no sessions', async () => {
    mockExecuteSequence(workspaceFixture());
    const { root } = await buildBrainTree({ scope: 'workspace' });

    const gamma = child(root, 'project:p2');
    expect(gamma?.childCount).toBe(1);
    expect(child(gamma as BrainNode, 'group:sessions:p2')).toBeUndefined();
    expect(child(gamma as BrainNode, 'column:col3')).toMatchObject({ label: 'Backlog', childCount: 1 });
  });

  it('keeps an entirely empty project (never prunes projects)', async () => {
    mockExecuteSequence(workspaceFixture());
    const { root } = await buildBrainTree({ scope: 'workspace' });

    const empty = child(root, 'project:p3');
    expect(empty).toMatchObject({ type: 'project', label: 'Empty', childCount: 0 });
    expect(empty?.children).toEqual([]);
  });

  it('groups project-less meetings under the Unlinked sessions root group', async () => {
    mockExecuteSequence(workspaceFixture());
    const { root } = await buildBrainTree({ scope: 'workspace' });

    const unlinked = child(root, 'group:unlinked');
    expect(unlinked).toMatchObject({ type: 'group', label: 'Unlinked sessions', entityId: null, childCount: 1 });
    expect(unlinked?.children[0]).toMatchObject({ id: 'session:m2', label: 'Solo' });
  });

  it('omits the Unlinked sessions group when every meeting is linked', async () => {
    const fx = workspaceFixture();
    fx[3] = [{ id: 'm1', title: 'Kickoff', project_id: 'p1' }]; // no unlinked meeting
    mockExecuteSequence(fx);
    const { root } = await buildBrainTree({ scope: 'workspace' });
    expect(child(root, 'group:unlinked')).toBeUndefined();
    expect(root.childCount).toBe(3);
  });

  it('emits provenance crossLinks from card to originating session (only when both exist)', async () => {
    mockExecuteSequence(workspaceFixture());
    const { crossLinks } = await buildBrainTree({ scope: 'workspace' });
    // cardA -> m1 (both present); cardB/cardC have no source meeting
    expect(crossLinks).toEqual([{ fromId: 'card:cardA', toId: 'session:m1', kind: 'provenance' }]);
  });

  it('produces identical node ids across two consecutive calls on the same data', async () => {
    mockExecuteSequence(workspaceFixture());
    const first = await buildBrainTree({ scope: 'workspace' });
    mockExecuteSequence(workspaceFixture());
    const second = await buildBrainTree({ scope: 'workspace' });
    expect(collectIds(second.root)).toEqual(collectIds(first.root));
  });
});

// ---------------------------------------------------------------------------
// Session scope
// ---------------------------------------------------------------------------

describe('buildBrainTree — session scope', () => {
  beforeEach(() => vi.clearAllMocks());

  // Linked-session query order: meeting, project, projectColumns, projectCards,
  // cardsCreated, suggestions, then the two V3.4 entity queries (entities,
  // entity_links). The base fixture has NO entities so the entity group is pruned.
  function linkedSessionFixture() {
    return [
      [{ id: 'm1', title: 'Kickoff', project_id: 'p1' }], // meeting
      [{ id: 'p1', name: 'Alpha' }], // project
      [
        { id: 'col1', name: 'To Do', project_id: 'p1' },
        { id: 'col2', name: 'Done', project_id: 'p1' }, // empty -> pruned
      ],
      [
        { id: 'cardA', column_id: 'col1', title: 'Task A', source_meeting_id: 'm1' },
        { id: 'cardB', column_id: 'col1', title: 'Task B', source_meeting_id: null },
      ],
      // cardsCreated (source_meeting_id = m1): cardA (also on board) + cardX (not on board)
      [
        { id: 'cardA', column_id: 'col1', title: 'Task A', source_meeting_id: 'm1' },
        { id: 'cardX', column_id: 'col1', title: 'New idea', source_meeting_id: 'm1' },
      ],
      // accepted suggestions: a decision linked to a card, a question linked to the project
      [
        { id: 'd1', type: 'decision', title: 'Ship v1', accepted_card_id: 'cardA', accepted_project_id: null },
        { id: 'q1', type: 'question', title: 'Budget?', accepted_card_id: null, accepted_project_id: 'p1' },
      ],
      [], // entities (none)
      [], // entity_links (none)
    ];
  }

  it('issues one query per entity for a linked session (8 total: 6 structural + 2 entity)', async () => {
    const execute = mockExecuteSequence(linkedSessionFixture());
    await buildBrainTree({ scope: { meetingId: 'm1' } });
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it('builds the session root with Project / Cards created / Decisions / Open questions branches', async () => {
    mockExecuteSequence(linkedSessionFixture());
    const { root } = await buildBrainTree({ scope: { meetingId: 'm1' } });

    expect(root).toMatchObject({ id: 'session:m1', type: 'session', label: 'Kickoff', entityId: 'm1', childCount: 4 });
    expect(root.children.map((c) => c.id)).toEqual([
      'group:project:m1',
      'group:cards:m1',
      'group:decisions:m1',
      'group:questions:m1',
    ]);

    // Project branch: group -> project -> non-empty column -> cards (col2 pruned)
    const projectGroup = child(root, 'group:project:m1');
    expect(projectGroup).toMatchObject({ type: 'group', label: 'Project', childCount: 1 });
    const project = projectGroup?.children[0] as BrainNode;
    expect(project).toMatchObject({ id: 'project:p1', type: 'project', label: 'Alpha', childCount: 1 });
    const col = child(project, 'column:col1');
    expect(col?.children.map((c) => c.id)).toEqual(['card:cardA', 'card:cardB']);
    expect(child(project, 'column:col2')).toBeUndefined();

    // Cards created branch
    const created = child(root, 'group:cards:m1');
    expect(created).toMatchObject({ type: 'group', label: 'Cards created', childCount: 2 });
    expect(created?.children.map((c) => c.id)).toEqual(['card:cardA', 'card:cardX']);

    // Decisions + Open questions branches
    const decisions = child(root, 'group:decisions:m1');
    expect(decisions).toMatchObject({ type: 'group', label: 'Decisions', childCount: 1 });
    expect(decisions?.children[0]).toMatchObject({
      id: 'decision:d1',
      type: 'decision',
      label: 'Ship v1',
      entityId: 'd1',
    });

    const questions = child(root, 'group:questions:m1');
    expect(questions).toMatchObject({ type: 'group', label: 'Open questions', childCount: 1 });
    expect(questions?.children[0]).toMatchObject({
      id: 'question:q1',
      type: 'question',
      label: 'Budget?',
      entityId: 'q1',
    });
  });

  it('emits deduped provenance and accepted crossLinks (only when both endpoints exist)', async () => {
    mockExecuteSequence(linkedSessionFixture());
    const { crossLinks } = await buildBrainTree({ scope: { meetingId: 'm1' } });

    // provenance: cardA appears in both board + created (deduped to one), plus cardX
    expect(crossLinks).toContainEqual({ fromId: 'card:cardA', toId: 'session:m1', kind: 'provenance' });
    expect(crossLinks).toContainEqual({ fromId: 'card:cardX', toId: 'session:m1', kind: 'provenance' });
    // accepted: decision -> its card, question -> the linked project
    expect(crossLinks).toContainEqual({ fromId: 'decision:d1', toId: 'card:cardA', kind: 'accepted' });
    expect(crossLinks).toContainEqual({ fromId: 'question:q1', toId: 'project:p1', kind: 'accepted' });
    // exactly 4 (cardA provenance deduped)
    expect(crossLinks).toHaveLength(4);
  });

  it('handles an unlinked session (no Project branch, 5 queries) with empty branches pruned', async () => {
    const execute = mockExecuteSequence([
      [{ id: 'm2', title: 'Solo', project_id: null }], // meeting (unlinked)
      [], // cardsCreated
      [], // suggestions
      [], // entities
      [], // entity_links
    ]);
    const { root, crossLinks } = await buildBrainTree({ scope: { meetingId: 'm2' } });

    expect(execute).toHaveBeenCalledTimes(5);
    expect(root).toMatchObject({ id: 'session:m2', type: 'session', label: 'Solo', childCount: 0 });
    expect(root.children).toEqual([]);
    expect(crossLinks).toEqual([]);
  });

  it('falls back to a bare Session root when the meeting is not found', async () => {
    mockExecuteSequence([[], [], [], [], []]);
    const { root } = await buildBrainTree({ scope: { meetingId: 'ghost' } });
    expect(root).toMatchObject({ id: 'session:ghost', type: 'session', label: 'Session', childCount: 0 });
  });

  it('binds meetingId as a sql parameter — never concatenated into query text', async () => {
    const evil = "'; DROP TABLE meetings; --";
    const execute = mockExecuteSequence([[], [], [], [], []]); // meeting not found -> 5 calls
    await buildBrainTree({ scope: { meetingId: evil } });

    // The meeting lookup binds it as a real parameter...
    expect(isParameterized(execute.mock.calls[0][0], evil)).toBe(true);
    // ...and NO query leaks it into literal SQL text.
    for (const call of execute.mock.calls) {
      const chunks = (call[0] as { queryChunks: unknown[] }).queryChunks;
      const leaked = chunks.some(
        (c) =>
          c &&
          typeof c === 'object' &&
          'value' in (c as { value?: unknown[] }) &&
          (c as { value: unknown[] }).value.some((p) => typeof p === 'string' && p.includes(evil)),
      );
      expect(leaked).toBe(false);
    }
  });

  it('produces identical node ids across two consecutive calls on the same data', async () => {
    mockExecuteSequence(linkedSessionFixture());
    const first = await buildBrainTree({ scope: { meetingId: 'm1' } });
    mockExecuteSequence(linkedSessionFixture());
    const second = await buildBrainTree({ scope: { meetingId: 'm1' } });
    expect(collectIds(second.root)).toEqual(collectIds(first.root));
  });
});

// ---------------------------------------------------------------------------
// Entity nodes (V3.4 semantic layer)
// ---------------------------------------------------------------------------

describe('buildBrainTree — entity nodes (People & topics)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a workspace "People & topics" group; each entity node is typed by kind and branches to its sessions', async () => {
    mockExecuteSequence([
      [{ id: 'p1', name: 'Alpha' }], // projects
      [], // columns
      [], // cards
      [
        { id: 'm1', title: 'Kickoff', project_id: 'p1' },
        { id: 'm2', title: 'Retro', project_id: 'p1' },
      ], // meetings
      // entities — e3 has NO links and must be pruned
      [
        { id: 'e1', name: 'Dana Lee', kind: 'person' },
        { id: 'e2', name: 'Billing', kind: 'topic' },
        { id: 'e3', name: 'Orphan', kind: 'topic' },
      ],
      // entity_links (joined to meetings for the title)
      [
        { entity_id: 'e1', meeting_id: 'm1', title: 'Kickoff' },
        { entity_id: 'e1', meeting_id: 'm2', title: 'Retro' },
        { entity_id: 'e2', meeting_id: 'm1', title: 'Kickoff' },
      ],
    ]);
    const { root } = await buildBrainTree({ scope: 'workspace' });

    const group = child(root, 'group:entities:workspace');
    expect(group).toMatchObject({ type: 'group', label: 'People & topics', entityId: null, childCount: 2 });

    // Dana Lee (person) → both sessions she appeared in, as session children.
    const dana = child(group as BrainNode, 'entity:e1');
    expect(dana).toMatchObject({ type: 'person', label: 'Dana Lee', entityId: 'e1', childCount: 2 });
    expect(dana?.children.map((c) => c.id)).toEqual(['entity-session:e1:m1', 'entity-session:e1:m2']);
    expect(dana?.children[0]).toMatchObject({ type: 'session', label: 'Kickoff', entityId: 'm1' });

    // Billing (topic) → the one session it appeared in.
    const billing = child(group as BrainNode, 'entity:e2');
    expect(billing).toMatchObject({ type: 'topic', label: 'Billing', entityId: 'e2', childCount: 1 });

    // An entity with no links is pruned (never shown).
    expect(child(group as BrainNode, 'entity:e3')).toBeUndefined();
  });

  it('omits the People & topics group entirely when there are no entities', async () => {
    mockExecuteSequence(workspaceFixture()); // base fixture: no entities
    const { root } = await buildBrainTree({ scope: 'workspace' });
    expect(child(root, 'group:entities:workspace')).toBeUndefined();
  });

  it('in session scope, shows only entities linked to THIS session — but each still shows ALL its sessions', async () => {
    mockExecuteSequence([
      [{ id: 'm1', title: 'Kickoff', project_id: null }], // meeting (unlinked → no project branch)
      [], // cardsCreated
      [], // suggestions
      // entities — e3 is linked only to m2, so it must NOT appear in m1's scope
      [
        { id: 'e1', name: 'Dana Lee', kind: 'person' },
        { id: 'e2', name: 'Billing', kind: 'topic' },
        { id: 'e3', name: 'Elsewhere', kind: 'topic' },
      ],
      // entity_links: e1 appears in m1 AND m2, e2 in m1, e3 only in m2
      [
        { entity_id: 'e1', meeting_id: 'm1', title: 'Kickoff' },
        { entity_id: 'e1', meeting_id: 'm2', title: 'Retro' },
        { entity_id: 'e2', meeting_id: 'm1', title: 'Kickoff' },
        { entity_id: 'e3', meeting_id: 'm2', title: 'Retro' },
      ],
    ]);
    const { root } = await buildBrainTree({ scope: { meetingId: 'm1' } });

    const group = child(root, 'group:entities:m1');
    expect(group).toMatchObject({ type: 'group', label: 'People & topics', childCount: 2 });

    // e1 is in m1's scope AND still surfaces its OTHER session (m2) as a child.
    const dana = child(group as BrainNode, 'entity:e1');
    expect(dana).toMatchObject({ type: 'person', childCount: 2 });
    expect(dana?.children.map((c) => c.entityId)).toEqual(['m1', 'm2']);

    // e3 (linked only to m2) is excluded from m1's scope.
    expect(child(group as BrainNode, 'entity:e3')).toBeUndefined();
  });
});
