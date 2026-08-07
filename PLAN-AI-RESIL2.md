# PLAN — AI-RESIL.2: Built-in runtime swap discipline (option C, reshaped)

> Created 2026-08-07 via /nexus-plan, continuing the AI-RESIL.1 conversation. Standard
> track, Tier 1. Own file because PLAN.md holds AI-RESIL.1's record and that phase's
> manual smoke gate is still outstanding (the PLAN-TWIN-READ precedent).
> User decisions (2026-08-07): option C proceeds NOW; the recording pin is INCLUDED
> (queue-based — chosen by the user against the orchestrator's starvation-risk
> recommendation, trade-off recorded below and in DECISIONS.md at the closing gate);
> AI-RESIL.1 committed first (`b1e991d`, pushed).

## The problem this fixes (recon 2026-08-07, code-verified)
The original option C ("serialize LM Studio calls, unload via its API") was written
for a provider the user does not run. On the BUILT-IN runtime the real defect is a
**mutual-kill race**, not co-residency:

- `builtinFetch` calls `ensureRunning(role, requestedModel)` on EVERY request
  (src/main/services/ai-provider.ts:226).
- `ensureRunning` for a different model does `stop(role)` → cold-start
  (src/main/services/llamaRuntimeService.ts:440-445) with ZERO awareness of in-flight
  generations on the current process.
- So a request for model Y issued while model X is mid-generation KILLS X's process
  under the live request. The AI SDK's retry re-requests X, which kills Y's cold load
  in turn — a ping-pong of mutual kills that produces repeating failures even when
  each individual load would fit the 180s health window.
- Same-model concurrency is already safe: chat runs `--parallel` slots
  (src/main/services/llamaRuntimeConfig.ts:172); only CROSS-model requests conflict.
- During a recording, live_triage/live_assistant fire on cadence; a different-model
  request landing between two triage calls finds the role momentarily idle, swaps the
  session's model out, and the next triage call pays a multi-GB cold reload —
  drain-alone cannot prevent this, which is what the recording pin is for.

## What this phase does NOT do (honest limits, record in DECISIONS.md)
- Two configured chat models remain SLOW (a cold swap per alternation) — this phase
  makes that configuration non-fatal, not fast. One model for all chat tasks (the
  AI-RESIL.1 banner) remains the correct configuration.
- External providers (LM Studio/Ollama) get no serialization: their failure mode is
  co-residency (covered by the banner), they don't have the kill defect (nothing
  stops their processes), and the user doesn't run them.
- The pin's accepted trade-off: an other-model request during a recording WAITS for
  the session to end (user decision — queue, not fail-fast). A regenerate clicked
  mid-meeting completes after the session stops. The wait is visible in the log.

## Execution shape
- **Task 1 → Task 2 strictly sequential** — Task 2 builds on Task 1's queue/mutex.
  NO chain (both are `complex`; the frozen chain criteria forbid chaining complex
  tasks). Fresh context each.
- **Task 3 strictly last** — closing gate, writes no production code.

## Baseline (from `b1e991d`, tree clean, pushed)
Suite: **2515 passed / 8 skipped / 0 failed (192 test files)**, sequential per the
project's contention rule. `tsc --noEmit` clean. eslint: **0 errors / 374 warnings**
(composition, not just total). Prettier: 2 pre-existing HTML warnings. Migration
head: 0048 — **this phase adds NO migration**.

<phase n="AI-RESIL.2" name="Built-in runtime swap discipline">
  <context>
    The built-in llama sidecar must never kill an in-flight generation to satisfy a
    different model's request, concurrent different-model requests must order rather
    than interleave stop/start, and while a recording session runs the chat role is
    pinned to the live assistant's model so cadence work never pays a mid-session
    cold swap. All discipline lives in llamaRuntimeService (which owns the process)
    plus the builtinFetch instrumentation in ai-provider; the embedding role is a
    separate process and gains the same generic per-role mechanism but no special
    casing. No IPC changes, no schema changes, no renderer changes.
    JS is single-threaded: "mutex" here means an async critical section (a promise
    chain per role), and counter reads between awaits are already atomic — the
    subtlety is exclusively in WHERE the awaits sit and in releasing exactly once.
    @src/main/services/llamaRuntimeService.ts
    @src/main/services/llamaRuntimeConfig.ts
    @src/main/services/ai-provider.ts
    @src/main/services/__tests__/llamaRuntimeService.test.ts
  </context>

  <task type="auto" n="1">
    <n>In-flight tracking + serialized drain-aware swap</n>
    <files>src/main/services/llamaRuntimeService.ts, src/main/services/ai-provider.ts, src/main/services/__tests__/llamaRuntimeService.swap.test.ts (new), src/main/services/__tests__/llamaRuntimeService.test.ts (only if existing cases need the new seams)</files>
    <action>
      In llamaRuntimeService:
      1. Per-role in-flight counter with an acquire/release pair (exported for the
         builtinFetch instrumentation). Release must be EXACTLY-ONCE per acquire
         (guard flag) — double-release would let a swap proceed under a live request,
         which is the exact bug class this phase exists to kill.
      2. Per-role async critical section around ensureRunning's check/drain/stop/
         start path so two concurrent different-model requests ORDER (second waits
         for the first's full swap) instead of interleaving stop()/spawn. Keep the
         same-model fast path (running model matches → touch + return) OUTSIDE the
         critical section — it must stay concurrent; `--parallel` slots make it safe.
      3. Drain-before-swap: inside the critical section, when a swap is required and
         the role's in-flight count is > 0, WAIT until it reaches 0 or
         DRAIN_CAP_MS = 120_000 elapses, then proceed. Log honestly on entry
         ("chat sidecar swap to <Y> queued behind N in-flight request(s)") and on cap
         expiry ("drain cap reached — proceeding, N request(s) will be cut"). The cap
         exists because a hung stream must never deadlock every future local call;
         a cut request surfaces as a network error that AI-RESIL.1's
         classifyBriefFailure already renders readably.
      4. stop() (including the shutdown stop-all) must never hang on the discipline:
         queued waiters reject with a clear typed message, and the idle auto-stop
         only fires at in-flight 0 (it effectively already does via touch(), but
         assert it in a test rather than assume it).
      In ai-provider's builtinFetch:
      5. Acquire around the proxied fetch; release when the RESPONSE IS CONSUMED,
         not when fetch() resolves — body consumption outlives the fetch promise.
         keepAliveWhileStreaming already pipes event-streams through a
         TransformStream: release in flush AND cancel/error. Non-stream responses
         pipe through the same counting wrapper (or release-on-body-end equivalent);
         a response with no body releases immediately; a thrown fetch releases in a
         finally. WHY this precision: an early release re-opens the kill window at
         the tail of every generation — the longest and most expensive moment to
         lose one.
      Scope guard: do NOT touch generate()/streamGenerate() signatures, the provider
      factory cache, or any task-model plumbing — the discipline is invisible above
      builtinFetch.
    </action>
    <verify>
      npx vitest run src/main/services/__tests__/llamaRuntimeService.swap.test.ts src/main/services/__tests__/llamaRuntimeService.test.ts — new cases (fake timers): different-model request during an in-flight generation waits for drain, exactly ONE stop+start, the first request's response completes un-killed; two concurrent different-model requests produce ordered swaps, never interleaved stop/spawn; same-model concurrent requests never queue; drain cap 120s fires, swap proceeds, honest log; stop() during a queued swap rejects waiters cleanly with no hang; release is exactly-once under stream error/cancel. Existing llamaRuntimeService cases unregressed.
      npx eslint src/main/services/llamaRuntimeService.ts src/main/services/ai-provider.ts — 0 errors.
    </verify>
    <done>No code path can stop a role's process while its in-flight count is non-zero (except the logged 120s drain cap); cross-model requests serialize; same-model concurrency and the embedding role's independence are preserved; builtinFetch releases exactly once per request including stream tails.</done>
    <confidence>HIGH</confidence>
    <complexity>complex</complexity>
  </task>

  <task type="auto" n="2">
    <n>Recording pin — the session's model holds the chat role</n>
    <files>src/main/services/llamaRuntimeService.ts, recording lifecycle wiring site (locate in recon: the main-side seam where a session recording actually starts/stops — recordingState transitions; MEET-DEL.1 reached recordingState from main without new IPC, follow that route), src/main/services/__tests__/llamaRuntimeService.pin.test.ts (new)</files>
    <action>
      In llamaRuntimeService: setChatModelPin(modelId: string | null). Semantics
      while a pin is set:
      - ensureRunning('chat', pinnedModel) proceeds normally — INCLUDING swapping
        away a non-pinned loaded model via Task 1's drain discipline (the pin is set
        knowing the model upfront, so a stray earlier model cannot squat the role).
      - ensureRunning('chat', otherModel) QUEUES until the pin clears — user decision
        2026-08-07: queue, NOT fail-fast; the starvation trade-off (a mid-meeting
        regenerate completes after the session ends) is accepted and must be visible:
        log "chat request for <Y> queued behind recording pin (<pinned>)".
      - Clearing the pin wakes queued requests FIFO into the normal Task 1
        discipline. The embedding role ignores the pin entirely.
      - Edge cases that MUST hold: a crash-restart of the pinned process keeps the
        pin; stop()/shutdown clears the pin and rejects queued waiters (no hang on
        quit); double recording-start is idempotent; an abortSignal on a queued
        request dequeues it.
      Wiring (separate concern, deliberately NOT inside the request path): at the
      recording-start seam, resolve resolveTaskModel('live_assistant'); IF
      providerName === 'builtin', setChatModelPin(its model) — else set NO pin
      (cloud/LM Studio live assistant leaves the runtime unpinned). At recording
      stop AND every recording-failure path, clear the pin in a finally — a leaked
      pin would starve every other local task indefinitely, which is worse than the
      bug this phase fixes. Import direction: the wiring site imports ai-provider
      and llamaRuntimeService; llamaRuntimeService imports NOTHING new (no cycle —
      it must stay task-ignorant).
    </action>
    <verify>
      npx vitest run src/main/services/__tests__/llamaRuntimeService.pin.test.ts — under a pin: other-model queues with the honest log, pinned model proceeds and may displace a squatting model; clear wakes FIFO; stop()/shutdown clears + rejects; crash-restart keeps the pin; abort dequeues. Wiring tests: builtin live_assistant → pin set on start, cleared on stop AND on a simulated failure path; cloud live_assistant → no pin ever set.
      npx vitest run src/main/services/__tests__/llamaRuntimeService.swap.test.ts — Task 1 discipline unregressed with the pin layered on.
    </verify>
    <done>While recording with a builtin live assistant, the chat role provably cannot swap away from the session's model; other-model work queues visibly and completes after the session; the pin can never leak past a recording's end by any exit path.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
    <assumptions>
      - The recording lifecycle exposes a usable main-side start/stop seam (recordingState pattern proven by MEET-DEL.1); if start/stop turns out to be renderer-driven only, the wiring lands beside the existing main-side recording-state transition instead — semantics unchanged.
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Closing gate — full suite, tsc, eslint composition, state files</n>
    <files>STATE.md, SUMMARY.md, DECISIONS.md, ISSUES.md (only if deferrals arise)</files>
    <action>
      Writes NO production code (route failures back to the owning task). Run
      sequentially and alone: (1) npx vitest run — baseline 2515/8/0 (192 files)
      plus this phase's new tests, 0 failures, honest count comparison; (2) npx tsc
      --noEmit — zero output; (3) npx eslint src/ — 0 errors, warning COMPOSITION
      compared against the 374 baseline, eslint.config.mjs untouched. Prettier
      unchanged (2 pre-existing HTML warnings).
      Update STATE.md; overwrite SUMMARY.md; APPEND one DECISIONS.md entry covering:
      (a) drain-before-swap + per-role serialization and the 120s cap rationale;
      (b) the recording pin INCLUDED by explicit user decision against the
      starvation recommendation, queue-not-fail semantics, and the accepted
      mid-meeting-regenerate trade-off; (c) external-provider serialization still
      out of scope and why; (d) two-model configs are now non-fatal but still slow —
      the banner remains the real fix.
    </action>
    <verify>
      All three gates green at the stated thresholds; STATE.md reflects the new position and baseline; DECISIONS.md entry appended (append-only verified by prefix check); SUMMARY.md written.
    </verify>
    <done>All automated gates green with honest composition comparison; state files updated; the ONLY outstanding item is the manual smoke checklist below.</done>
    <confidence>HIGH</confidence>
    <complexity>simple</complexity>
  </task>
</phase>

## Manual smoke checklist (user, after Task 3 — the phase is NOT done until this passes)
Runs together with AI-RESIL.1's still-outstanding smoke where convenient (same
scenario, now expected to SUCCEED instead of merely failing readably).
1. Two different built-in chat models configured (banner visible — leave it): trigger
   a brief Regenerate while another chat task uses the other model → BOTH complete
   (slow is expected), the log shows "swap ... queued behind N in-flight request(s)",
   and no repeating failure cards appear.
2. Start a recording with live_assistant on a built-in model; mid-session, Regenerate
   a brief routed to a DIFFERENT built-in model → the log shows it queued behind the
   recording pin, live triage cadence continues unaffected, and the regenerate
   completes shortly after the session stops.
3. Stop the app mid-queue (quit while a request is pinned-queued) → clean shutdown,
   no hang, no zombie llama-server (check Task Manager).
4. Consolidate to one model via the AI-RESIL.1 banner → everything is fast again;
   AI-RESIL.1's own checklist items (reasoned failure card when the runtime is
   genuinely broken, learning only on success, startup sweep count) verified in the
   same session if not already done.
