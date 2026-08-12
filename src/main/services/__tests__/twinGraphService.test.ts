// === FILE PURPOSE ===
// Unit tests for twinGraphService.buildTwinMemoryGraph (TWIN-GRAPH.2 Task 1).
//
// Runs against a REAL in-memory PGlite database (same harness as
// brainGraphService.test.ts) because every guarantee here is a query
// guarantee: the forgotten-fact exclusion happens at the query, the
// meeting-title join for provenance is a query, and the node cap is a
// ranking over real rows. No AI seam exists in this service, so nothing
// needs mocking beyond getDb.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { twinFacts, meetings } from '../../db/schema';

// --- Mocks (before importing the module under test) -------------------------
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import { buildTwinMemoryGraph } from '../twinGraphService';
import type { TwinMemoryGraph, TwinGraphNode, TwinFactCategory } from '../../../shared/types/twin';

// --- Seed helpers -------------------------------------------------------------

async function seedMeeting(opts: { title: string; startedAt: Date }): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title: opts.title, status: 'completed', startedAt: opts.startedAt })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedTwinFact(
  fact: string,
  opts: {
    category?: TwinFactCategory;
    label?: string | null;
    sourceMeetingId?: string | null;
    sourceMeetingLabel?: string | null;
    status?: 'active' | 'forgotten';
    createdAt?: Date;
  } = {},
): Promise<string> {
  const [row] = await holder.db
    .insert(twinFacts)
    .values({
      fact,
      category: opts.category ?? 'domain',
      label: opts.label ?? null,
      sourceMeetingId: opts.sourceMeetingId ?? null,
      sourceMeetingLabel: opts.sourceMeetingLabel ?? null,
      status: opts.status ?? 'active',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: twinFacts.id });
  return row.id;
}

async function clearTables(): Promise<void> {
  await holder.db.delete(twinFacts);
  await holder.db.delete(meetings);
}

function findNode(graph: TwinMemoryGraph, id: string): TwinGraphNode | undefined {
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
// Tiers and edges: core -> hubs -> facts
// ---------------------------------------------------------------------------

describe('buildTwinMemoryGraph — tiers and edges', () => {
  it('produces the twin core (tier 0), one hub per populated category (tier 1), and every active fact (tier 2)', async () => {
    const meetingId = await seedMeeting({ title: 'Kickoff', startedAt: new Date('2026-08-01T09:00:00Z') });
    const personFactId = await seedTwinFact('Dana leads billing', {
      category: 'person',
      sourceMeetingId: meetingId,
      createdAt: new Date('2026-08-01T09:15:00Z'),
    });
    const domainFactId = await seedTwinFact('Works in fintech', {
      category: 'domain',
      sourceMeetingId: meetingId,
      createdAt: new Date('2026-08-01T09:30:00Z'),
    });

    const graph = await buildTwinMemoryGraph();

    expect(graph.droppedCount).toBe(0);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      ['twin', 'category:person', 'category:domain', `fact:${personFactId}`, `fact:${domainFactId}`].sort(),
    );

    // Core node.
    const core = findNode(graph, 'twin');
    expect(core).toMatchObject({
      type: 'twin',
      tier: 0,
      label: 'Twin',
      recordId: 'singleton',
      category: null,
      degree: 2,
    });

    // Hub nodes.
    const personHub = findNode(graph, 'category:person');
    expect(personHub).toMatchObject({
      type: 'category',
      tier: 1,
      label: 'Person',
      recordId: 'person',
      category: 'person',
      degree: 2, // twin->hub, hub->fact
    });
    const domainHub = findNode(graph, 'category:domain');
    expect(domainHub).toMatchObject({ type: 'category', tier: 1, label: 'Domain', category: 'domain', degree: 2 });

    // Fact nodes, with provenance embedded directly (no second round-trip needed).
    const personFact = findNode(graph, `fact:${personFactId}`);
    expect(personFact).toMatchObject({
      type: 'fact',
      tier: 2,
      label: 'Dana leads billing',
      recordId: personFactId,
      category: 'person',
      degree: 1,
      sourceMeetingId: meetingId,
      sourceMeetingTitle: 'Kickoff',
      newestTimestamp: new Date('2026-08-01T09:15:00Z').toISOString(),
    });

    // Edges: twin->hub (x2), hub->fact (x2). No fact<->fact edges anywhere.
    expect(graph.edges).toHaveLength(4);
    expect(graph.edges).toContainEqual({ fromId: 'twin', toId: 'category:person', kind: 'twin-hub' });
    expect(graph.edges).toContainEqual({ fromId: 'twin', toId: 'category:domain', kind: 'twin-hub' });
    expect(graph.edges).toContainEqual({ fromId: 'category:person', toId: `fact:${personFactId}`, kind: 'hub-fact' });
    expect(graph.edges).toContainEqual({ fromId: 'category:domain', toId: `fact:${domainFactId}`, kind: 'hub-fact' });
  });

  it('still emits the twin core when there are zero facts, with no hubs and no edges', async () => {
    const graph = await buildTwinMemoryGraph();
    expect(graph.nodes).toEqual([
      {
        id: 'twin',
        type: 'twin',
        tier: 0,
        label: 'Twin',
        recordId: 'singleton',
        category: null,
        degree: 0,
        newestTimestamp: null,
      },
    ]);
    expect(graph.edges).toEqual([]);
    expect(graph.droppedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Forgotten facts excluded AT THE QUERY
// ---------------------------------------------------------------------------

describe('buildTwinMemoryGraph — forgotten facts', () => {
  it('excludes status=forgotten facts entirely (query-level, not post-filtered)', async () => {
    const activeId = await seedTwinFact('Active fact', { status: 'active' });
    const forgottenId = await seedTwinFact('Forgotten fact', { status: 'forgotten' });

    const graph = await buildTwinMemoryGraph();

    expect(findNode(graph, `fact:${activeId}`)).toBeDefined();
    expect(findNode(graph, `fact:${forgottenId}`)).toBeUndefined();
  });

  it('emits no hub for a category whose only facts are forgotten', async () => {
    await seedTwinFact('Forgotten preference', { category: 'preference', status: 'forgotten' });

    const graph = await buildTwinMemoryGraph();

    expect(findNode(graph, 'category:preference')).toBeUndefined();
    expect(graph.nodes).toHaveLength(1); // only the twin core
  });
});

// ---------------------------------------------------------------------------
// Empty categories never get a hub
// ---------------------------------------------------------------------------

describe('buildTwinMemoryGraph — empty categories', () => {
  it('emits hubs only for categories that actually have an active fact, never all five', async () => {
    await seedTwinFact('Only a person fact', { category: 'person' });

    const graph = await buildTwinMemoryGraph();

    const hubIds = graph.nodes.filter((n) => n.type === 'category').map((n) => n.id);
    expect(hubIds).toEqual(['category:person']);
    expect(findNode(graph, 'category:project')).toBeUndefined();
    expect(findNode(graph, 'category:preference')).toBeUndefined();
    expect(findNode(graph, 'category:domain')).toBeUndefined();
    expect(findNode(graph, 'category:commitment')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provenance: null sourceMeetingId, and a deleted source meeting
// ---------------------------------------------------------------------------

describe('buildTwinMemoryGraph — provenance', () => {
  it('yields a fact node with sourceMeetingId=null and sourceMeetingTitle=null for a never-sourced fact — never a fabricated id', async () => {
    const factId = await seedTwinFact('Standalone preference', { category: 'preference', sourceMeetingId: null });

    const graph = await buildTwinMemoryGraph();

    const node = findNode(graph, `fact:${factId}`);
    expect(node).toMatchObject({ sourceMeetingId: null, sourceMeetingTitle: null });
  });

  it('keeps the fact but loses its provenance link when the source meeting is deleted (schema SET NULL)', async () => {
    const meetingId = await seedMeeting({ title: 'Deleted session', startedAt: new Date('2026-08-01T09:00:00Z') });
    const factId = await seedTwinFact('Fact from a deleted session', {
      category: 'commitment',
      sourceMeetingId: meetingId,
    });

    // Delete the source meeting — the FK's onDelete: 'set null' fires at the DB level,
    // so twin_facts.source_meeting_id is set null by Postgres itself, not by the service.
    await holder.db.delete(meetings).where(eq(meetings.id, meetingId));

    const graph = await buildTwinMemoryGraph();

    const node = findNode(graph, `fact:${factId}`);
    expect(node).toBeDefined(); // the fact itself survives the deletion
    expect(node).toMatchObject({ sourceMeetingId: null, sourceMeetingTitle: null }); // never a raw stale id
  });

  it('carries the MEET-DEL.1 snapshot label onto the fact node when the source meeting is gone but was kept', async () => {
    const factId = await seedTwinFact('Kept after its session was deleted', {
      category: 'commitment',
      sourceMeetingId: null,
      sourceMeetingLabel: 'Roadmap review — deleted 2026-08-06',
    });

    const graph = await buildTwinMemoryGraph();

    const node = findNode(graph, `fact:${factId}`);
    expect(node).toMatchObject({
      sourceMeetingId: null,
      sourceMeetingTitle: null,
      sourceMeetingLabel: 'Roadmap review — deleted 2026-08-06',
    });
  });

  it('yields sourceMeetingLabel=null for an ordinary fact that never went through the keep-path', async () => {
    const factId = await seedTwinFact('Ordinary fact, never deleted', { category: 'domain' });

    const graph = await buildTwinMemoryGraph();

    expect(findNode(graph, `fact:${factId}`)).toMatchObject({ sourceMeetingLabel: null });
  });
});

// ---------------------------------------------------------------------------
// Label vs text: the caption and the document are DIFFERENT fields
// (TWIN-READ.1 Tasks 1 and 3). The renderer captions a node with `label` and
// reveals `text` on focus, so conflating them would either put a sentence back
// on the node or hide the memory behind a 2-4 word caption.
// ---------------------------------------------------------------------------

describe('buildTwinMemoryGraph — fact label and full text', () => {
  it('emits the STORED label as the caption and the full sentence as `text`', async () => {
    const factId = await seedTwinFact('Prefers async written updates over status meetings', {
      category: 'preference',
      label: 'Async updates',
    });

    const graph = await buildTwinMemoryGraph();

    expect(findNode(graph, `fact:${factId}`)).toMatchObject({
      label: 'Async updates',
      text: 'Prefers async written updates over status meetings',
    });
  });

  it('falls back to the DERIVED short label when no label was stored — but `text` is still verbatim', async () => {
    const factId = await seedTwinFact('The Q3 pricing decision was deferred to the board meeting', {
      category: 'project',
      label: null,
    });

    const graph = await buildTwinMemoryGraph();

    const node = findNode(graph, `fact:${factId}`);
    // Exactly what shared labelFor() derives — never a second derivation here.
    expect(node?.label).toBe('The Q3 pricing decision…');
    expect(node?.text).toBe('The Q3 pricing decision was deferred to the board meeting');
  });

  it('never puts `text` on structure — the core and hubs have nothing longer than their label', async () => {
    await seedTwinFact('Works in fintech', { category: 'domain' });

    const graph = await buildTwinMemoryGraph();

    expect(findNode(graph, 'twin')).not.toHaveProperty('text');
    expect(findNode(graph, 'category:domain')).not.toHaveProperty('text');
  });
});

// ---------------------------------------------------------------------------
// Node cap
// ---------------------------------------------------------------------------

describe('buildTwinMemoryGraph — node cap', () => {
  it('drops the least-prominent FACT nodes first, never the core or a hub, and reports droppedCount honestly', async () => {
    const FACT_COUNT = 1600;
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    await holder.db.insert(twinFacts).values(
      Array.from({ length: FACT_COUNT }, (_, i) => ({
        fact: `Fact ${i}`,
        category: 'domain' as const,
        sourceMeetingId: null,
        createdAt: new Date(base + i * 60_000), // strictly increasing, i=0 oldest
      })),
    );

    const graph = await buildTwinMemoryGraph();

    // Total nodes: twin(1) + hub(1) + kept facts = 1500 exactly.
    expect(graph.nodes).toHaveLength(1500);
    expect(graph.droppedCount).toBe(FACT_COUNT + 2 - 1500);

    // Core and hub always survive the cap.
    expect(findNode(graph, 'twin')).toBeDefined();
    expect(findNode(graph, 'category:domain')).toBeDefined();

    // The oldest facts (equal degree, lowest newestTimestamp) are dropped first.
    const factNodes = graph.nodes.filter((n) => n.type === 'fact');
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
