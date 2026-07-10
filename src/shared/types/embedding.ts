// === V3.4 semantic-index (embedding) types ===
// The status shape the embedding Settings surface reads (progress, route,
// model-mismatch, backfill-dismissed). Lives in shared/types so both the preload
// bridge and the renderer's SemanticIndexSection reference ONE definition through
// the typed ElectronAPI — no local casts. Mirrors embeddingService.ts's shape.

/** Which provider the index is embedding through, and whether it stays on-device. */
export interface EmbeddingRoute {
  providerName: string;
  isLocal: boolean;
}

/** Backfill/rebuild progress + provenance for the "Semantic index" Settings section. */
export interface EmbeddingStatus {
  indexed: number;
  total: number;
  running: boolean;
  /** null when no embedding model is configured for the Embedding task. */
  route: EmbeddingRoute | null;
  /** Present when the stored index model differs from the current one (→ rebuild affordance). */
  mismatch: { stored: string; current: string } | null;
  backfillDismissed: boolean;
}
