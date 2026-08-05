// === FILE PURPOSE ===
// Shared types for the "living brain" mind map (V3.2 Task 1).
//
// buildBrainTree (main process) produces a HIERARCHICAL tree payload describing
// the workspace/session knowledge structure, plus a flat cross-links array. The
// renderer (Task 2+) lays out the tree with d3-hierarchy and draws crossLinks as
// on-demand dashed overlays. These types are the IPC contract between the two.
//
// Node ids are STABLE/deterministic — derived purely from entity type + entity
// id (or a fixed synthetic key for group/root nodes) — because Task 4's
// live-growth diff calls buildBrainTree twice and diffs node-id sets to find
// entering nodes. Never derive an id from array index, timestamp, or random.

// 'person'/'topic' are the V3.4 flat-entity nodes (the Brain's first semantic
// layer) — an entity node's type IS its TwinEntityKind, so it styles distinctly.
export type BrainNodeType =
  | 'workspace'
  | 'project'
  | 'group'
  | 'column'
  | 'session'
  | 'card'
  | 'decision'
  | 'question'
  | 'person'
  | 'topic';

export interface BrainNode {
  /** STABLE across refetches — `${type}:${entityId}` for entity nodes, or a
   *  fixed synthetic key for group/root nodes (e.g. `group:sessions:${projectId}`). */
  id: string;
  type: BrainNodeType;
  label: string;
  /** Underlying entity id; null for synthetic group/workspace-root nodes. */
  entityId: string | null;
  /** Number of direct children actually present AFTER empty-branch pruning. */
  childCount: number;
  children: BrainNode[];
}

export interface CrossLink {
  fromId: string;
  toId: string;
  kind: 'provenance' | 'accepted';
}

export interface BrainTree {
  root: BrainNode;
  crossLinks: CrossLink[];
}

/** 'workspace' for the whole-workspace map, or a single session's local map. */
export type BrainScope = 'workspace' | { meetingId: string };

// ---------------------------------------------------------------------------
// Memory graph (TWIN-GRAPH.1 Task 1) — a flat, force-directed replacement for
// the tidy tree above. Separate IPC contract (`brain:build-graph`); BrainNode/
// BrainTree/BrainScope above are UNCHANGED and still power buildBrainTree.
//
// Node scope is memory-centric: entities (person/topic), their entityFacts,
// the twin's own active-status twinFacts, and the sessions referenced by any
// provenance/participation edge. No project/board/card nodes in v1.
//
// Prominence is split by design: this contract carries only the INPUTS
// (degree, newestTimestamp) a renderer needs to compute a score — never a
// final score — so tuning the blend never changes this IPC shape.
// ---------------------------------------------------------------------------

/** Entities keep their TwinEntityKind as the node type (styles distinctly,
 *  same convention as BrainNodeType); the two fact ledgers and `session`
 *  round out the memory-centric node set. */
export type BrainGraphNodeType = 'person' | 'topic' | 'entityFact' | 'twinFact' | 'session';

export interface BrainGraphNode {
  /** STABLE across refetches — `${prefix}:${recordId}`, prefix matching the
   *  source table: `entity`, `entity-fact`, `twin-fact`, or `session`. */
  id: string;
  type: BrainGraphNodeType;
  /** Entity name, fact content, or session title. */
  label: string;
  /** Underlying DB row id (entities.id / entityFacts.id / twinFacts.id / meetings.id). */
  recordId: string;
  /** Prominence INPUT: edges touching this node in the RETURNED graph (i.e.
   *  computed after the 1500-node cap, so it always matches `edges`). */
  degree: number;
  /** Prominence INPUT: ISO timestamp of the most recent activity relevant to
   *  this node (a fact's own createdAt; a session's endedAt ?? startedAt; an
   *  entity's newest linked fact/session) — null if nothing dates it. */
  newestTimestamp: string | null;
}

/** No entity<->entity edges in v1 — relatedness reads through shared session
 *  nodes (do not add a fourth kind for that). */
export type BrainGraphEdgeKind = 'attribution' | 'provenance' | 'participation';

export interface BrainGraphEdge {
  fromId: string;
  toId: string;
  kind: BrainGraphEdgeKind;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  /** Fact nodes dropped by the 1500-node cap — entities/sessions are NEVER
   *  dropped. 0 in the common case (the cap is a backstop, not a normal
   *  path); never silently truncated. */
  droppedCount: number;
}

/** 'everything' for the whole-workspace graph, or a single session's local
 *  graph — mirrors BrainScope's shape with graph-specific literal names. */
export type BrainGraphScope = 'everything' | { meetingId: string };
