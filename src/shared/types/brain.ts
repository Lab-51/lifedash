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
