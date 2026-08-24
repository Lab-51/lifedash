// === Preload bridge: Brain (V3.2 Task 1) — hierarchical mind-map data for the
// whole workspace or a single session — PLUS per-entity learned facts
// (BRAIN-UX.1 Task 1): list/forget are real; analyze-history is an honest
// not-implemented stub until Task 3 lands. PLUS user-driven "Merge into…"
// (ENTITY-NAME.1 Task 3): entityMergeCandidates lists same-kind targets;
// entityMerge never rejects on a guard failure — see MergeEntityResult. ===
import { ipcRenderer } from 'electron';
import type {
  BrainScope,
  BrainTree,
  BrainGraphScope,
  BrainGraph,
  EntityFact,
  AnalyzeEntityHistoryResult,
  EntityMergeCandidate,
  MergeEntityResult,
} from '../../shared/types';

export const brainBridge = {
  buildBrainTree: (scope: BrainScope): Promise<BrainTree> => ipcRenderer.invoke('brain:build-tree', scope),

  // TWIN-GRAPH.1 Task 1 — memory graph (entities + facts + twin ledger + source
  // sessions as one flat graph). Distinct from buildBrainTree above.
  buildBrainGraph: (scope: BrainGraphScope): Promise<BrainGraph> => ipcRenderer.invoke('brain:build-graph', scope),

  entityListFacts: (entityId: string): Promise<EntityFact[]> => ipcRenderer.invoke('entity:list-facts', entityId),
  entityForgetFact: (factId: string): Promise<void> => ipcRenderer.invoke('entity:forget-fact', factId),
  entityAnalyzeHistory: (entityId: string): Promise<AnalyzeEntityHistoryResult> =>
    ipcRenderer.invoke('entity:analyze-history', entityId),

  entityMergeCandidates: (entityId: string): Promise<EntityMergeCandidate[]> =>
    ipcRenderer.invoke('entity:merge-candidates', entityId),
  entityMerge: (payload: { sourceId: string; targetId: string }): Promise<MergeEntityResult> =>
    ipcRenderer.invoke('entity:merge', payload),
};
