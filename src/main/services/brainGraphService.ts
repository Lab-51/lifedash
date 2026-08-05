// === FILE PURPOSE ===
// Main-side data layer for the memory graph (TWIN-GRAPH.1 Task 1) — the flat,
// force-directed replacement for the old brainTree hierarchy. brainTreeService
// (structural, no facts) is RETAINED and untouched; this is a NEW, separate
// service + IPC channel because no existing channel exposes entities and
// facts together. buildBrainGraph({ scope }) assembles memory-centric nodes
// (entities, their entityFacts, the twin's own ACTIVE twinFacts, and the
// sessions referenced by any provenance/participation edge) plus edges, in
// ONE round trip.
//
// === INVARIANTS ===
// - Bulk queries only, NO N+1, ZERO AI calls (same discipline as brainTreeService).
// - Forgotten twin facts are excluded AT THE QUERY (`status = 'active'`),
//   never filtered after the fact.
// - Node/edge shapes carry prominence INPUTS (degree, newestTimestamp) only —
//   never a final score. Scoring is the renderer's job (Task 2) so tuning
//   never touches this IPC contract.
// - No entity<->entity edges in v1 — relatedness reads through shared session
//   nodes. Do not add one.
// - 1500-node cap: only entityFact/twinFact nodes are ever dropped, ranked
//   least-prominent-first (lowest pre-cap degree, then oldest newestTimestamp,
//   then id for determinism). Entities and sessions are NEVER dropped.
//   `droppedCount` is always honest — no silent truncation. Returned `degree`
//   is recomputed AFTER dropping, so it always matches the returned `edges`.
//
// === SCOPE ===
// 'everything'    -> every entity + its facts/sessions, every active twin fact.
// { meetingId }   -> entities linked to that meeting (each surviving entity
//                    still surfaces ALL its OWN sessions/facts, mirroring
//                    brainTreeService's session-scope entity behavior), and
//                    only the twin facts sourced FROM that meeting.
//
// === SECURITY ===
// meetingId is passed through drizzle's query builder (`eq`/`inArray`), which
// always binds parameters — never string-concatenated into SQL.

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { entities, entityLinks, entityFacts, twinFacts, meetings } from '../db/schema';
import type {
  BrainGraphScope,
  BrainGraphNode,
  BrainGraphNodeType,
  BrainGraphEdge,
  BrainGraph,
} from '../../shared/types/brain';

type DB = ReturnType<typeof getDb>;

/** Backstop, not a common path — see file header. Realistic totals are tens to
 *  low hundreds of entities, high hundreds of facts (ENTITY_CAP=8/session,
 *  FACTS_PER_ENTITY_CAP=5/entity/session). */
const MAX_NODES = 1500;

// --- Stable id helpers (mirrors brainTreeService's `${type}:${id}` convention) ---
const entityNodeId = (id: string) => `entity:${id}`;
const entityFactNodeId = (id: string) => `entity-fact:${id}`;
const twinFactNodeId = (id: string) => `twin-fact:${id}`;
const sessionNodeId = (id: string) => `session:${id}`;

// --- Row shapes (drizzle query-builder results — already camelCase/typed) ---
interface EntityRow {
  id: string;
  name: string;
  kind: 'person' | 'topic';
}
interface EntityLinkRow {
  entityId: string;
  meetingId: string;
}
interface EntityFactRow {
  id: string;
  entityId: string;
  content: string;
  sourceMeetingId: string;
  createdAt: Date;
}
interface TwinFactRow {
  id: string;
  fact: string;
  sourceMeetingId: string | null;
  createdAt: Date;
}
interface MeetingRow {
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
}

/** A node before the cap/degree pass — degree is computed last, once the
 *  final edge set (post-cap) is known. */
interface BuiltNode {
  id: string;
  type: BrainGraphNodeType;
  label: string;
  recordId: string;
  newestTimestamp: string | null;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const existing = map.get(key(item));
    if (existing) existing.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}

/** Fetch every entity + every entity_link in TWO bulk queries — no meetingId
 *  parameter, so both scopes read the whole small entity set and filter in
 *  memory (same convention as brainTreeService.loadEntities). */
async function loadEntitiesAndLinks(db: DB): Promise<{ entityRows: EntityRow[]; linkRows: EntityLinkRow[] }> {
  const [entityRows, linkRows] = await Promise.all([
    db.select({ id: entities.id, name: entities.name, kind: entities.kind }).from(entities),
    db.select({ entityId: entityLinks.entityId, meetingId: entityLinks.meetingId }).from(entityLinks),
  ]);
  return { entityRows, linkRows };
}

interface GraphInputs {
  entityRows: EntityRow[];
  linkRows: EntityLinkRow[];
  entityFactRows: EntityFactRow[];
  twinFactRows: TwinFactRow[];
}

/** Count edges touching each node id. */
function degreeMap(edges: BrainGraphEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const e of edges) {
    bump(e.fromId);
    bump(e.toId);
  }
  return counts;
}

/** Apply the 1500-node cap (fact nodes only, least-prominent-first) and
 *  recompute `degree` from the final edge set so it is always honest. */
function capAndFinalize(nodes: BuiltNode[], edges: BrainGraphEdge[]): BrainGraph {
  let keptNodes = nodes;
  let keptEdges = edges;
  let droppedCount = 0;

  if (nodes.length > MAX_NODES) {
    const preDropDegree = degreeMap(edges);
    const factNodes = nodes.filter((n) => n.type === 'entityFact' || n.type === 'twinFact');
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
  const outputNodes: BrainGraphNode[] = keptNodes.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    recordId: n.recordId,
    degree: finalDegree.get(n.id) ?? 0,
    newestTimestamp: n.newestTimestamp,
  }));

  return { nodes: outputNodes, edges: keptEdges, droppedCount };
}

/** Referenced meeting ids: every entity_link's session + every fact's
 *  non-null source meeting. */
function collectReferencedMeetingIds(inputs: GraphInputs): Set<string> {
  const meetingIds = new Set<string>();
  for (const l of inputs.linkRows) meetingIds.add(l.meetingId);
  for (const f of inputs.entityFactRows) meetingIds.add(f.sourceMeetingId);
  for (const f of inputs.twinFactRows) if (f.sourceMeetingId) meetingIds.add(f.sourceMeetingId);
  return meetingIds;
}

function buildSessionNodes(meetingRows: MeetingRow[]): BuiltNode[] {
  return meetingRows.map((m) => ({
    id: sessionNodeId(m.id),
    type: 'session' as const,
    label: m.title,
    recordId: m.id,
    newestTimestamp: (m.endedAt ?? m.startedAt).toISOString(),
  }));
}

/** One entity node + its participation edges (entity -> session, via
 *  entity_links). Recency blends the entity's linked-session timestamps with
 *  its own facts' createdAt. */
function buildEntityNode(
  e: EntityRow,
  links: EntityLinkRow[],
  facts: EntityFactRow[],
  meetingById: Map<string, MeetingRow>,
  edges: BrainGraphEdge[],
): BuiltNode {
  let newest: number | null = null;
  for (const l of links) {
    const m = meetingById.get(l.meetingId);
    if (!m) continue; // defensive: never crash on a dangling link
    edges.push({ fromId: entityNodeId(e.id), toId: sessionNodeId(l.meetingId), kind: 'participation' });
    const t = (m.endedAt ?? m.startedAt).getTime();
    if (newest === null || t > newest) newest = t;
  }
  for (const f of facts) {
    const t = f.createdAt.getTime();
    if (newest === null || t > newest) newest = t;
  }
  return {
    id: entityNodeId(e.id),
    type: e.kind,
    label: e.name,
    recordId: e.id,
    newestTimestamp: newest === null ? null : new Date(newest).toISOString(),
  };
}

/** entityFact node + its attribution (fact -> entity) and provenance
 *  (fact -> session) edges — sourceMeetingId is NOT NULL on this table, so
 *  the provenance edge always exists. */
function buildEntityFactNode(f: EntityFactRow, edges: BrainGraphEdge[]): BuiltNode {
  edges.push({ fromId: entityFactNodeId(f.id), toId: entityNodeId(f.entityId), kind: 'attribution' });
  edges.push({ fromId: entityFactNodeId(f.id), toId: sessionNodeId(f.sourceMeetingId), kind: 'provenance' });
  return {
    id: entityFactNodeId(f.id),
    type: 'entityFact',
    label: f.content,
    recordId: f.id,
    newestTimestamp: f.createdAt.toISOString(),
  };
}

/** twinFact node + its provenance edge only — not owned by an entity, so
 *  never an attribution edge. A null sourceMeetingId yields NO provenance
 *  edge (hard constraint). */
function buildTwinFactNode(f: TwinFactRow, edges: BrainGraphEdge[]): BuiltNode {
  if (f.sourceMeetingId) {
    edges.push({ fromId: twinFactNodeId(f.id), toId: sessionNodeId(f.sourceMeetingId), kind: 'provenance' });
  }
  return {
    id: twinFactNodeId(f.id),
    type: 'twinFact',
    label: f.fact,
    recordId: f.id,
    newestTimestamp: f.createdAt.toISOString(),
  };
}

/**
 * Assemble the graph from already scope-filtered rows: resolves the referenced
 * meeting set in ONE bulk query, then builds session/entity/fact nodes and
 * their attribution/provenance/participation edges in memory.
 */
async function assembleGraph(db: DB, inputs: GraphInputs): Promise<BrainGraph> {
  const { entityRows, linkRows, entityFactRows, twinFactRows } = inputs;
  const meetingIds = collectReferencedMeetingIds(inputs);

  const meetingRows: MeetingRow[] =
    meetingIds.size > 0
      ? await db
          .select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt, endedAt: meetings.endedAt })
          .from(meetings)
          .where(inArray(meetings.id, [...meetingIds]))
      : [];

  const meetingById = new Map(meetingRows.map((m) => [m.id, m]));
  const linksByEntity = groupBy(linkRows, (l) => l.entityId);
  const factsByEntity = groupBy(entityFactRows, (f) => f.entityId);

  const edges: BrainGraphEdge[] = [];
  const nodes: BuiltNode[] = [
    ...buildSessionNodes(meetingRows),
    ...entityRows.map((e) =>
      buildEntityNode(e, linksByEntity.get(e.id) ?? [], factsByEntity.get(e.id) ?? [], meetingById, edges),
    ),
    ...entityFactRows.map((f) => buildEntityFactNode(f, edges)),
    ...twinFactRows.map((f) => buildTwinFactNode(f, edges)),
  ];

  return capAndFinalize(nodes, edges);
}

async function buildEverythingGraph(db: DB): Promise<BrainGraph> {
  const [{ entityRows, linkRows }, entityFactRows, twinFactRows] = await Promise.all([
    loadEntitiesAndLinks(db),
    db
      .select({
        id: entityFacts.id,
        entityId: entityFacts.entityId,
        content: entityFacts.content,
        sourceMeetingId: entityFacts.sourceMeetingId,
        createdAt: entityFacts.createdAt,
      })
      .from(entityFacts),
    // Forgotten facts excluded AT THE QUERY — never filtered afterward.
    db
      .select({
        id: twinFacts.id,
        fact: twinFacts.fact,
        sourceMeetingId: twinFacts.sourceMeetingId,
        createdAt: twinFacts.createdAt,
      })
      .from(twinFacts)
      .where(eq(twinFacts.status, 'active')),
  ]);
  return assembleGraph(db, { entityRows, linkRows, entityFactRows, twinFactRows });
}

async function buildSessionGraph(db: DB, meetingId: string): Promise<BrainGraph> {
  const { entityRows: allEntities, linkRows: allLinks } = await loadEntitiesAndLinks(db);

  // Entities directly linked to THIS session...
  const linkedEntityIds = new Set(allLinks.filter((l) => l.meetingId === meetingId).map((l) => l.entityId));
  const entityRows = allEntities.filter((e) => linkedEntityIds.has(e.id));
  // ...but each surviving entity still shows ALL its sessions (brainTreeService convention).
  const linkRows = allLinks.filter((l) => linkedEntityIds.has(l.entityId));

  const [entityFactRows, twinFactRows] = await Promise.all([
    linkedEntityIds.size > 0
      ? db
          .select({
            id: entityFacts.id,
            entityId: entityFacts.entityId,
            content: entityFacts.content,
            sourceMeetingId: entityFacts.sourceMeetingId,
            createdAt: entityFacts.createdAt,
          })
          .from(entityFacts)
          .where(inArray(entityFacts.entityId, [...linkedEntityIds]))
      : Promise.resolve([]),
    // Session scope: only twin facts actually learned FROM this session — still
    // excluding forgotten ones at the query.
    db
      .select({
        id: twinFacts.id,
        fact: twinFacts.fact,
        sourceMeetingId: twinFacts.sourceMeetingId,
        createdAt: twinFacts.createdAt,
      })
      .from(twinFacts)
      .where(and(eq(twinFacts.status, 'active'), eq(twinFacts.sourceMeetingId, meetingId))),
  ]);

  return assembleGraph(db, { entityRows, linkRows, entityFactRows, twinFactRows });
}

/**
 * Build the memory-graph payload for the given scope. Structural DB reads
 * only — no AI. See the file header for invariants and the cap contract.
 */
export async function buildBrainGraph(params: { scope: BrainGraphScope }): Promise<BrainGraph> {
  const db = getDb();
  if (params.scope === 'everything') return buildEverythingGraph(db);
  return buildSessionGraph(db, params.scope.meetingId);
}
