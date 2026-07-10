// === FILE PURPOSE ===
// Post-session dispatcher seam (V3.4). A tiny hook registry that runs registered
// modules ONCE after a meeting brief is generated, so the V3.4 learning features
// hang off a single, error-isolated seam instead of each editing generateBrief:
//   - Task 2 registers per-session FACT extraction
//   - Task 4 registers session EMBEDDING
//   - Task 6 registers ENTITY extraction
//
// === CONTRACT (why it is shaped this way) ===
//  - FIRE-AND-FORGET: dispatchPostSession() returns void immediately; hooks run on
//    a detached async chain. A brief NEVER waits on learning work.
//  - ERROR-ISOLATED: a hook that throws or rejects can NEVER fail, delay, or
//    corrupt the brief — each hook is individually try/caught; one failing hook
//    does not stop the others.
//  - ORDER-PRESERVING: hooks run sequentially in REGISTRATION order (the V3.4 plan
//    requires facts-before-entities), so a later hook may rely on an earlier one
//    having completed.
//
// meetingIntelligenceService.generateBrief() is the ONLY caller — it invokes
// dispatchPostSession() once, after the brief is persisted. That call site is
// frozen for the phase; new work registers a hook here instead of editing it.

import { createLogger } from './logger';
import type { MeetingBrief } from '../../shared/types';

const log = createLogger('PostSession');

/** What every post-session hook receives. Kept minimal: the meetingId (fetch
 *  anything else you need) plus the just-generated brief so fact/embedding hooks
 *  need not re-fetch it. Accepted live suggestions are intentionally NOT passed —
 *  only some hooks need them and re-fetching for all would be wasted work; a hook
 *  that wants them queries live_suggestions by meetingId itself. */
export interface PostSessionContext {
  meetingId: string;
  brief: MeetingBrief;
}

/** A registered post-session hook. May be sync or async; may throw/reject freely —
 *  the dispatcher isolates it. */
export type PostSessionHook = (ctx: PostSessionContext) => void | Promise<void>;

const hooks: PostSessionHook[] = [];

/** Register a hook to run after each session's brief. Registration order is the
 *  run order (facts before entities, per the V3.4 plan). */
export function registerPostSessionHook(hook: PostSessionHook): void {
  hooks.push(hook);
}

/** Clear all registered hooks. Test-only — keeps suites isolated. */
export function _resetPostSessionHooks(): void {
  hooks.length = 0;
}

async function runHooks(ctx: PostSessionContext): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(ctx);
    } catch (err) {
      // Error-isolated: a failing hook can never affect the brief or later hooks.
      log.error(`Post-session hook failed for meeting ${ctx.meetingId}:`, err);
    }
  }
}

/**
 * Run all registered post-session hooks for a finished session. Fire-and-forget:
 * returns immediately; hooks run on a detached, fully error-isolated chain. Safe to
 * call unconditionally — a no-op when nothing is registered.
 */
export function dispatchPostSession(ctx: PostSessionContext): void {
  // `void` marks the detached promise as intentionally un-awaited (satisfies
  // no-floating-promises). runHooks never rejects, so nothing escapes.
  void runHooks(ctx);
}
