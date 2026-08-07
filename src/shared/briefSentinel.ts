// === FILE PURPOSE ===
// The failure-sentinel contract for a meeting brief that failed to generate
// (AI-RESIL.1). Historical-data prefix contract: rows already in user
// databases contain EXACTLY the BRIEF_FAILURE_SENTINEL string as their full
// summary text; newer rows append a "\n\nReason: ..." paragraph after it.
// isFailedBriefText() does a PREFIX match (not equality, not `includes`) so
// both old and new rows are recognized identically.
//
// Lives in src/shared/, not a service module: meetingIntelligenceService
// (generateBrief, main process) and embeddingService (main process, AI-RESIL.1
// Task 2) both need the same predicate, and neither imports the other — a
// shared module rules out that import cycle rather than picking one service to
// own it.
//
// Pure, no I/O — safe to import from both main and renderer code.

/** Persisted as a brief's summary when generation fails outright OR resolves
 *  empty (see meetingIntelligenceService.generateBrief). Byte-identical to the
 *  original literal — existing rows in user databases contain EXACTLY this
 *  string with nothing appended, so isFailedBriefText's prefix match must keep
 *  recognizing them unchanged. */
export const BRIEF_FAILURE_SENTINEL = 'AI brief generation failed. The transcript is available for manual review.';

/**
 * True when `text` is a failed-brief summary — either an old row (the sentinel
 * alone) or a new one (the sentinel plus an appended reason paragraph). A
 * prefix match, not equality and not `includes`, so a genuine brief that
 * happens to quote the sentinel mid-text is never misclassified. Defensive
 * against non-string input at runtime (never throws).
 */
export function isFailedBriefText(text: string): boolean {
  return typeof text === 'string' && text.startsWith(BRIEF_FAILURE_SENTINEL);
}
