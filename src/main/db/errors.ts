// === FILE PURPOSE ===
// Tiny predicate for recognizing a PGlite/Postgres foreign-key-violation error
// (SQLSTATE 23503) by its `.code` — never by string-matching the message, which
// may carry sensitive generated content (e.g. an AI brief's summary text).
//
// === WHY THIS EXISTS (MEET-DEL.1) ===
// Several post-session writers (meetingIntelligenceService, twinMemoryService,
// entityFactService, postSessionDispatcher) can race a meeting's deletion: the
// meeting is deleted while a long-running LLM call is in flight, and the
// eventual insert hits the FK the deleted row left behind. Each of those writers
// needs to recognize that ONE specific failure shape and absorb it as a benign,
// logged, typed no-op — never a raw SQL error, never a swallowed genuine bug.
// Main-process-only (the renderer never sees a raw driver error), so this lives
// under src/main/db/, not src/shared/.

/** Postgres SQLSTATE for foreign_key_violation. */
const FOREIGN_KEY_VIOLATION_CODE = '23503';

/**
 * True when `err` is a database error carrying the foreign_key_violation SQLSTATE
 * (23503) — the shape PGlite's DatabaseError (mirroring node-postgres) surfaces on
 * a constraint failure. Identifies the error by code, never by parsing the message.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === FOREIGN_KEY_VIOLATION_CODE
  );
}
