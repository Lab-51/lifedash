// === FILE PURPOSE ===
// Main-side data layer for the TWIN's own memory graph (TWIN-GRAPH.2 Task 1) —
// `twin:build-memory-graph`. One IPC round trip returns the twin's full,
// tiered memory graph: one twin core, one hub per POPULATED
// `twinFactCategoryEnum` value, and every ACTIVE `twinFact` as a leaf, with
// provenance (source meeting id + title) attached directly to each fact node.
//
// === SIBLING, NOT AN EXTENSION OF brainGraphService — DECISION ===
// brainGraphService (TWIN-GRAPH.1) is entity-centric: entities are the hubs,
// entityFacts/twinFacts attach to them, and sessions are their own nodes tied
// in via provenance/participation edges. This graph is different IN KIND, not
// just in degree: it has exactly one root, exactly the five
// twinFactCategoryEnum values as its only possible hubs (never emitted empty),
// and NO entity concept, NO session nodes, and NO fact<->fact edges — the
// fixed tier (core -> hub -> fact) is the entire structure, and provenance is
// carried as fields on the fact node rather than a graph edge. Forcing one
// service to emit both shapes would make the cap rule ("drop least-prominent
// FACT nodes") ambiguous across three different fact-shaped node types, and
// would tangle two unrelated scope literals (brainGraphService's
// 'everything' | { meetingId } vs this graph, which has no scope at all — it
// is always the twin's whole ledger). A sibling keeps each service's
// invariants legible and independently testable. brainGraphService is
// untouched by this file.
//
// === INVARIANTS ===
// - status='active' is filtered AT THE QUERY (drizzle `.where(eq(...))`),
//   never post-filtered — a forgotten fact must never reach the renderer.
// - A hub is emitted ONLY for a category with >=1 active fact — never an
//   empty lane. (Structural: hubs are built FROM the grouped fact rows, so an
//   unpopulated category can never produce one.)
// - No fact<->fact edges — twin->hub ('twin-hub') and hub->fact ('hub-fact')
//   only. The tiers are the structure.
// - `sourceMeetingId` is nullable by deliberate schema design (SET NULL on
//   meeting delete — "a learned fact outlives the deletion of its source
//   session, it just loses its provenance link"). A null is carried through
//   AS null, never guessed. `sourceMeetingTitle` is joined in (LEFT JOIN
//   meetings) so "learned in <session>" renders without a second round-trip;
//   it is null whenever `sourceMeetingId` is null — including when the join
//   can't resolve a still-set id (should not happen given the FK, but the
//   LEFT JOIN degrades safely either way). NEVER a fabricated id or title.
// - Prominence INPUTS only (degree, newestTimestamp) — scoring stays in the
//   renderer (an established TWIN-GRAPH.1 decision, carried here), so tuning
//   never touches this IPC contract.
// - Node cap: only FACT nodes are ever dropped, ranked least-prominent-first
//   (lowest pre-cap degree, then oldest newestTimestamp, then id for
//   determinism) — mirrors brainGraphService's cap exactly. The twin core and
//   category hubs are NEVER dropped. `droppedCount` is always honest — no
//   silent truncation. Returned `degree` is recomputed AFTER dropping, so it
//   always matches the returned `edges`.
//
// === SECURITY ===
// No user input reaches this service (no scope/filter parameters) — every
// value queried is bound through drizzle's query builder.

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { twinFacts, meetings } from '../db/schema';
import { labelFor } from '../../shared/twin/factLabel';
import type { TwinFactCategory, TwinGraphNodeType, TwinGraphEdge, TwinMemoryGraph } from '../../shared/types/twin';

type DB = ReturnType<typeof getDb>;

/** Backstop, not a common path — mirrors brainGraphService's cap value.
 *  Realistic totals are low hundreds of facts (twinMemoryService caps
 *  extraction at ~5 new facts/session). */
const MAX_NODES = 1500;

const TWIN_CORE_ID = 'twin';
/** Matches db/schema/twin.ts's TWIN_PROFILE_ID — the twin_profile table's one
 *  valid row id — so the core node's recordId is a real value, not invented. */
const TWIN_CORE_RECORD_ID = 'singleton';

const categoryNodeId = (category: TwinFactCategory): string => `category:${category}`;
const factNodeId = (id: string): string => `fact:${id}`;

/** Row shape after the fact/meeting-title join (already camelCase/typed). */
interface FactRow {
  id: string;
  fact: string;
  /** Stored short label (TWIN-READ.1 Task 1), or null — read ONLY through
   *  labelFor() below, never directly; a null here still yields a readable node
   *  label via the derived fallback. */
  label: string | null;
  category: TwinFactCategory;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  createdAt: Date;
}

/** A node before the cap/degree pass — degree is computed last, once the
 *  final edge set (post-cap) is known. */
interface BuiltNode {
  id: string;
  type: TwinGraphNodeType;
  tier: 0 | 1 | 2;
  label: string;
  /** Fact nodes only — the full sentence behind the short label. */
  text?: string;
  recordId: string;
  category: TwinFactCategory | null;
  newestTimestamp: string | null;
  sourceMeetingId?: string | null;
  sourceMeetingTitle?: string | null;
}

/** Every ACTIVE fact, with its source meeting's title joined in (LEFT JOIN —
 *  a null sourceMeetingId or a since-deleted meeting both yield
 *  sourceMeetingTitle=null, never a crash, never a guess). Filtered AT THE
 *  QUERY, not post-filtered. */
async function loadActiveFacts(db: DB): Promise<FactRow[]> {
  const rows = await db
    .select({
      id: twinFacts.id,
      fact: twinFacts.fact,
      label: twinFacts.label,
      category: twinFacts.category,
      sourceMeetingId: twinFacts.sourceMeetingId,
      sourceMeetingTitle: meetings.title,
      createdAt: twinFacts.createdAt,
    })
    .from(twinFacts)
    .leftJoin(meetings, eq(twinFacts.sourceMeetingId, meetings.id))
    .where(eq(twinFacts.status, 'active'));
  return rows.map((r) => ({ ...r, sourceMeetingTitle: r.sourceMeetingTitle ?? null }));
}

/** Count edges touching each node id. */
function degreeMap(edges: TwinGraphEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const e of edges) {
    bump(e.fromId);
    bump(e.toId);
  }
  return counts;
}

/** Apply the node cap (fact nodes only, least-prominent-first) and recompute
 *  `degree` from the final edge set so it is always honest. Mirrors
 *  brainGraphService.capAndFinalize exactly, restricted to type==='fact'. */
function capAndFinalize(nodes: BuiltNode[], edges: TwinGraphEdge[]): TwinMemoryGraph {
  let keptNodes = nodes;
  let keptEdges = edges;
  let droppedCount = 0;

  if (nodes.length > MAX_NODES) {
    const preDropDegree = degreeMap(edges);
    const factNodes = nodes.filter((n) => n.type === 'fact');
    const ranked = [...factNodes].sort((a, b) => {
      const degA = preDropDegree.get(a.id) ?? 0;
      const degB = preDropDegree.get(b.id) ?? 0;
      if (degA !== degB) return degA - degB;
      const tsA = a.newestTimestamp ? Date.parse(a.newestTimestamp) : 0;
      const tsB = b.newestTimestamp ? Date.parse(b.newestTimestamp) : 0;
      if (tsA !== tsB) return tsA - tsB;
      return a.id.localeCompare(b.id);
    });
    const overBy = nodes.length - MAX_NODES;
    const toDrop = new Set(ranked.slice(0, Math.min(overBy, ranked.length)).map((n) => n.id));
    droppedCount = toDrop.size;
    keptNodes = nodes.filter((n) => !toDrop.has(n.id));
    keptEdges = edges.filter((e) => !toDrop.has(e.fromId) && !toDrop.has(e.toId));
  }

  const finalDegree = degreeMap(keptEdges);
  const outputNodes = keptNodes.map((n) => ({
    id: n.id,
    type: n.type,
    tier: n.tier,
    label: n.label,
    recordId: n.recordId,
    category: n.category,
    degree: finalDegree.get(n.id) ?? 0,
    newestTimestamp: n.newestTimestamp,
    ...(n.type === 'fact'
      ? {
          text: n.text ?? n.label,
          sourceMeetingId: n.sourceMeetingId ?? null,
          sourceMeetingTitle: n.sourceMeetingTitle ?? null,
        }
      : {}),
  }));

  return { nodes: outputNodes, edges: keptEdges, droppedCount };
}

/** Group facts by category, preserving only categories that actually occur —
 *  this IS the "never emit an empty hub" guarantee (a hub is built only from
 *  a Map entry that exists, and an entry only exists if a fact produced it). */
function groupByCategory(facts: FactRow[]): Map<TwinFactCategory, FactRow[]> {
  const map = new Map<TwinFactCategory, FactRow[]>();
  for (const f of facts) {
    const existing = map.get(f.category);
    if (existing) existing.push(f);
    else map.set(f.category, [f]);
  }
  return map;
}

/** Latest `createdAt` among a set of facts, as an ISO string, or null if empty. */
function newestOf(facts: FactRow[]): string | null {
  let newest: number | null = null;
  for (const f of facts) {
    const t = f.createdAt.getTime();
    if (newest === null || t > newest) newest = t;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * Build the twin's full memory graph: one core, one hub per populated
 * category, every active fact as a leaf. Structural DB reads only — no AI.
 * See the file header for the sibling decision and invariants.
 */
export async function buildTwinMemoryGraph(): Promise<TwinMemoryGraph> {
  const db = getDb();
  const facts = await loadActiveFacts(db);
  const byCategory = groupByCategory(facts);

  const edges: TwinGraphEdge[] = [];
  const nodes: BuiltNode[] = [
    {
      id: TWIN_CORE_ID,
      type: 'twin',
      tier: 0,
      label: 'Twin',
      recordId: TWIN_CORE_RECORD_ID,
      category: null,
      newestTimestamp: newestOf(facts),
    },
  ];

  for (const [category, categoryFacts] of byCategory) {
    edges.push({ fromId: TWIN_CORE_ID, toId: categoryNodeId(category), kind: 'twin-hub' });
    nodes.push({
      id: categoryNodeId(category),
      type: 'category',
      tier: 1,
      label: category.charAt(0).toUpperCase() + category.slice(1),
      recordId: category,
      category,
      newestTimestamp: newestOf(categoryFacts),
    });

    for (const f of categoryFacts) {
      edges.push({ fromId: categoryNodeId(category), toId: factNodeId(f.id), kind: 'hub-fact' });
      nodes.push({
        id: factNodeId(f.id),
        type: 'fact',
        tier: 2,
        // Short stored label (with a derived never-blank fallback) — computed
        // HERE so the renderer never re-derives it (TWIN-READ.1 Task 1).
        label: labelFor(f),
        // ...and the full sentence alongside it, because the label is a caption
        // and the fact is the document: the renderer reveals THIS on focus
        // (TWIN-READ.1 Task 3) rather than a truncated fragment of prose.
        text: f.fact,
        recordId: f.id,
        category,
        newestTimestamp: f.createdAt.toISOString(),
        sourceMeetingId: f.sourceMeetingId,
        sourceMeetingTitle: f.sourceMeetingTitle,
      });
    }
  }

  return capAndFinalize(nodes, edges);
}
