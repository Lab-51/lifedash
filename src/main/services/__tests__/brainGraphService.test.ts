// === FILE PURPOSE ===
// Unit tests for brainGraphService.buildBrainGraph (TWIN-GRAPH.1 Task 1).
//
// Runs against a REAL in-memory PGlite database (same harness as
// calendarContextService.test.ts / calendarPollScheduler.test.ts) because
// every guarantee here is a query guarantee: the forgotten-fact exclusion
// happens at the query, the session-scope entity/session filtering is a query
// + in-memory join, and the 1500-node cap is a ranking over real rows. No AI
// seam exists in this service, so nothing needs mocking beyond getDb.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { entities, entityLinks, entityFacts, twinFacts, meetings } from '../../db/schema';

// --- Mocks (before importing the module under test) -------------------------
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import { buildBrainGraph } from '../brainGraphService';
import type { BrainGraph, BrainGraphNode } from '../../../shared/types/brain';

// --- Seed helpers -------------------------------------------------------------

async function seedMeeting(opts: { title: string; startedAt: Date; endedAt?: Date | null }): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title: opts.title, status: 'completed', startedAt: opts.startedAt, endedAt: opts.endedAt ?? null })
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

async function seedLink(entityId: string, meetingId: string): Promise<void> {
  await holder.db.insert(entityLinks).values({ entityId, meetingId });
}

async function seedEntityFact(entityId: string, meetingId: string, content: string, createdAt?: Date): Promise<string> {
  const [row] = await holder.db
    .insert(entityFacts)
    .values({ entityId, content, sourceMeetingId: meetingId, ...(createdAt ? { createdAt } : {}) })
    .returning({ id: entityFacts.id });
  return row.id;
}

async function seedTwinFact(
  fact: string,
  opts: { sourceMeetingId?: string | null; status?: 'active' | 'forgotten'; createdAt?: Date } = {},
): Promise<string> {
  const [row] = await holder.db
    .insert(twinFacts)
    .values({
      fact,
      category: 'domain',
      sourceMeetingId: opts.sourceMeetingId ?? null,
      status: opts.status ?? 'active',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: twinFacts.id });
  return row.id;
}

async function clearTables(): Promise<void> {
  await holder.db.delete(entityFacts);
  await holder.db.delete(entityLinks);
  await holder.db.delete(twinFacts);
  await holder.db.delete(entities);
  await holder.db.delete(meetings);
}

function findNode(graph: BrainGraph, id: string): BrainGraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  await clearTables();
});

// ---------------------------------------------------------------------------
// End-to-end node/edge shape
// ---------------------------------------------------------------------------

describe('buildBrainGraph — everything scope: nodes + edges', () => {
  it('produces entity, session, entityFact and twinFact nodes with the right edges and degrees', async () => {
    const meetingId = await seedMeeting({
      title: 'Kickoff',
      startedAt: new Date('2026-08-01T09:00:00Z'),
      endedAt: new Date('2026-08-01T10:00:00Z'),
    });
    const entityId = await seedEntity('Dana Lee', 'person');
    await seedLink(entityId, meetingId);
    const factId = await seedEntityFact(
      entityId,
      meetingId,
      'Dana leads the billing team',
      new Date('2026-08-01T09:30:00Z'),
    );
    const twinFactId = await seedTwinFact('User prefers async standups', {
      sourceMeetingId: meetingId,
      createdAt: new Date('2026-08-01T09:45:00Z'),
    });

    const graph = await buildBrainGraph({ scope: 'everything' });

    expect(graph.droppedCount).toBe(0);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      [`entity:${entityId}`, `session:${meetingId}`, `entity-fact:${factId}`, `twin-fact:${twinFactId}`].sort(),
    );

    // Edges: participation (entity->session), attribution (fact->entity),
    // provenance (entityFact->session), provenance (twinFact->session).
    expect(graph.edges).toHaveLength(4);
    expect(graph.edges).toContainEqual({
      fromId: `entity:${entityId}`,
      toId: `session:${meetingId}`,
      kind: 'participation',
    });
    expect(graph.edges).toContainEqual({
      fromId: `entity-fact:${factId}`,
      toId: `entity:${entityId}`,
      kind: 'attribution',
    });
    expect(graph.edges).toContainEqual({
      fromId: `entity-fact:${factId}`,
      toId: `session:${meetingId}`,
      kind: 'provenance',
    });
    expect(graph.edges).toContainEqual({
      fromId: `twin-fact:${twinFactId}`,
      toId: `session:${meetingId}`,
      kind: 'provenance',
    });

    const entityNode = findNode(graph, `entity:${entityId}`);
    expect(entityNode).toMatchObject({ type: 'person', label: 'Dana Lee', recordId: entityId, degree: 2 });

    const sessionNode = findNode(graph, `session:${meetingId}`);
    expect(sessionNode).toMatchObject({ type: 'session', label: 'Kickoff', recordId: meetingId, degree: 3 });
    // endedAt wins over startedAt for recency.
    expect(sessionNode?.newestTimestamp).toBe(new Date('2026-08-01T10:00:00Z').toISOString());

    const factNode = findNode(graph, `entity-fact:${factId}`);
    expect(factNode).toMatchObject({
      type: 'entityFact',
      label: 'Dana leads the billing team',
      recordId: factId,
      degree: 2,
      newestTimestamp: new Date('2026-08-01T09:30:00Z').toISOString(),
    });

    const twinFactNode = findNode(graph, `twin-fact:${twinFactId}`);
    expect(twinFactNode).toMatchObject({
      type: 'twinFact',
      label: 'User prefers async standups',
      recordId: twinFactId,
      degree: 1,
      newestTimestamp: new Date('2026-08-01T09:45:00Z').toISOString(),
    });
  });

  it('produces identical node ids across two consecutive calls on the same data', async () => {
    const meetingId = await seedMeeting({ title: 'Kickoff', startedAt: new Date('2026-08-01T09:00:00Z') });
    const entityId = await seedEntity('Dana Lee');
    await seedLink(entityId, meetingId);

    const first = await buildBrainGraph({ scope: 'everything' });
    const second = await buildBrainGraph({ scope: 'everything' });
    expect(second.nodes.map((n) => n.id).sort()).toEqual(first.nodes.map((n) => n.id).sort());
  });
});

// ---------------------------------------------------------------------------
// Forgotten twin facts excluded AT THE QUERY
// ---------------------------------------------------------------------------

describe('buildBrainGraph — forgotten twin facts', () => {
  it('excludes status=forgotten twin facts entirely (query-level, not post-filtered)', async () => {
    const meetingId = await seedMeeting({ title: 'Kickoff', startedAt: new Date('2026-08-01T09:00:00Z') });
    const activeId = await seedTwinFact('Active fact', { sourceMeetingId: meetingId, status: 'active' });
    const forgottenId = await seedTwinFact('Forgotten fact', { sourceMeetingId: meetingId, status: 'forgotten' });

    const graph = await buildBrainGraph({ scope: 'everything' });

    expect(findNode(graph, `twin-fact:${activeId}`)).toBeDefined();
    expect(findNode(graph, `twin-fact:${forgottenId}`)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Null-sourceMeetingId twin fact -> node without a provenance edge
// ---------------------------------------------------------------------------

describe('buildBrainGraph — twin fact with no source meeting', () => {
  it('yields a node with degree 0 and no provenance edge', async () => {
    const twinFactId = await seedTwinFact('Standalone preference', { sourceMeetingId: null });

    const graph = await buildBrainGraph({ scope: 'everything' });

    const node = findNode(graph, `twin-fact:${twinFactId}`);
    expect(node).toMatchObject({ type: 'twinFact', degree: 0 });
    expect(graph.edges.some((e) => e.fromId === `twin-fact:${twinFactId}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session scope filtering
// ---------------------------------------------------------------------------

describe('buildBrainGraph — session scope', () => {
  it('includes only entities linked to the scoped meeting, but shows ALL of their sessions', async () => {
    const m1 = await seedMeeting({ title: 'Session 1', startedAt: new Date('2026-08-01T09:00:00Z') });
    const m2 = await seedMeeting({ title: 'Session 2', startedAt: new Date('2026-08-02T09:00:00Z') });
    const m3 = await seedMeeting({ title: 'Session 3', startedAt: new Date('2026-08-03T09:00:00Z') });

    const e1 = await seedEntity('Dana Lee', 'person'); // linked to m1 AND m2
    await seedLink(e1, m1);
    await seedLink(e1, m2);
    const e2 = await seedEntity('Billing', 'topic'); // linked to m3 only
    await seedLink(e2, m3);

    const graph = await buildBrainGraph({ scope: { meetingId: m1 } });

    expect(findNode(graph, `entity:${e1}`)).toBeDefined();
    expect(findNode(graph, `entity:${e2}`)).toBeUndefined();

    // e1 still surfaces BOTH of its sessions, not just the scoped one.
    expect(findNode(graph, `session:${m1}`)).toBeDefined();
    expect(findNode(graph, `session:${m2}`)).toBeDefined();
    expect(findNode(graph, `session:${m3}`)).toBeUndefined();
  });

  it('includes only twin facts sourced FROM the scoped meeting', async () => {
    const m1 = await seedMeeting({ title: 'Session 1', startedAt: new Date('2026-08-01T09:00:00Z') });
    const m2 = await seedMeeting({ title: 'Session 2', startedAt: new Date('2026-08-02T09:00:00Z') });
    const fromM1 = await seedTwinFact('Learned in session 1', { sourceMeetingId: m1 });
    const fromM2 = await seedTwinFact('Learned in session 2', { sourceMeetingId: m2 });

    const graph = await buildBrainGraph({ scope: { meetingId: m1 } });

    expect(findNode(graph, `twin-fact:${fromM1}`)).toBeDefined();
    expect(findNode(graph, `twin-fact:${fromM2}`)).toBeUndefined();
  });

  it('returns an empty-ish graph for a session with no linked entities and no sourced twin facts', async () => {
    const m1 = await seedMeeting({ title: 'Lonely session', startedAt: new Date('2026-08-01T09:00:00Z') });

    const graph = await buildBrainGraph({ scope: { meetingId: m1 } });

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.droppedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 1500-node cap
// ---------------------------------------------------------------------------

describe('buildBrainGraph — 1500-node cap', () => {
  it('drops the least-prominent FACT nodes first, never entities/sessions, and reports droppedCount honestly', async () => {
    const meetingId = await seedMeeting({ title: 'Big session', startedAt: new Date('2026-08-01T09:00:00Z') });
    const entityId = await seedEntity('Prolific Person');
    await seedLink(entityId, meetingId);

    const FACT_COUNT = 1600;
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    await holder.db.insert(entityFacts).values(
      Array.from({ length: FACT_COUNT }, (_, i) => ({
        entityId,
        content: `Fact ${i}`,
        sourceMeetingId: meetingId,
        createdAt: new Date(base + i * 60_000), // strictly increasing, i=0 oldest
      })),
    );

    const graph = await buildBrainGraph({ scope: 'everything' });

    // Total nodes: entity(1) + session(1) + kept facts = 1500 exactly.
    expect(graph.nodes).toHaveLength(1500);
    expect(graph.droppedCount).toBe(FACT_COUNT + 2 - 1500);

    // Entity and session nodes always survive the cap.
    expect(findNode(graph, `entity:${entityId}`)).toBeDefined();
    expect(findNode(graph, `session:${meetingId}`)).toBeDefined();

    // The oldest facts (lowest newestTimestamp, equal degree) are dropped first;
    // the newest facts survive.
    const factNodes = graph.nodes.filter((n) => n.type === 'entityFact');
    expect(factNodes).toHaveLength(1498);
    const oldestSurvivor = factNodes.reduce(
      (min, n) => (n.newestTimestamp! < min ? n.newestTimestamp! : min),
      factNodes[0].newestTimestamp!,
    );
    expect(Date.parse(oldestSurvivor)).toBeGreaterThan(base + (FACT_COUNT - 1498 - 1) * 60_000);

    // No dangling edges: every edge endpoint must reference a surviving node.
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.fromId)).toBe(true);
      expect(nodeIds.has(edge.toId)).toBe(true);
    }
  });
});
