# PLAN — AI-CTX.1: Context-Budgeted Brief Pipeline + Chat-Task Routing Coherence

> Own plan file (convention: PLAN.md holds AI-RESIL.1's record + open smoke checklist;
> PLAN-AI-RESIL2.md holds AI-RESIL.2's). Planned 2026-08-07 via /nexus-discussion →
> /nexus-plan. Tier 1, Standard track. Target release: v2.10.0.

## Rationale

Field failure on a MacBook Pro M2 16GB: **"request (22202 tokens) exceeds the available
context size (16384 tokens)"** — `builtin/Meta-Llama-3.1-8B-Instruct-Q4_K_M`, brief
generation, deterministic on every Regenerate. AI-RESIL.1's failure card worked exactly as
designed (classified reason, no twin poisoning); this phase is the capacity layer above it.

Mechanism (code-verified 2026-08-07):
1. The builtin sidecar runs with `--ctx-size 16384` (`llamaRuntimeConfig.ts:33`) — a
   deliberate VRAM bound (whisper shares the GPU; on 16GB Apple Silicon, Metal's working
   set is ~10-11GB shared with weights + whisper + the embedding sidecar + Electron).
   **Raising it is NOT the fix** — 32k context costs ~2GiB more KV cache (this model's
   GQA layout ≈ 128KB/token f16) and the next longer meeting overflows any fixed number.
2. `generateBrief` sends the ENTIRE transcript unbudgeted (`meetingIntelligenceService.ts:724`),
   plus prior-brief threading sized by a 48,000-char cloud-era budget (≈12k tokens — 75%
   of the builtin window on its own) plus suppression + twin profile. `generateActionItems`
   (line 837) has the identical unbounded-transcript defect, just unreported so far.
3. The threading trimmer already yields to prompt length (`trimBriefsToBudget`) — the
   budget machinery exists but is sized against no real provider window and cannot chunk.

Second defect, from the user's follow-up requirement ("the model selected at first usage
must be specified"): the setup wizard writes the explicit model pick for ONLY
`live_assistant` + `embedding` (`localBuiltin.ts:121`, deliberate per its comment), and
`summarization` is NOT in `TASK_MODEL_FALLBACKS` (`ai-provider.ts:561`), so briefs resolve
via first-enabled-provider + the `'default'` sentinel, which the builtin runtime resolves
to the **alphabetically first** chat GGUF (`llamaRuntimeConfig.ts:124` `resolveModel`).
With 2+ downloaded models: the meeting records on the picked model, then the post-session
brief silently runs a DIFFERENT model — a forced multi-GB cold swap per meeting, queued
behind AI-RESIL.2's recording pin.

## User decisions (2026-08-07, all three recommended options accepted)

- **Routing fix = inheritance at resolution** (extend `TASK_MODEL_FALLBACKS`), not
  wizard-writes-all-rows: one change covers wizard AND Settings users; explicit per-task
  assignments still win; no stored rows rewritten.
- **Budget gate covers ALL providers**: builtin exact (16,384 via `chatCtxSize()`); cloud
  ≈100k budget; LM Studio/Ollama documented conservative defaults. No path can silently
  overflow.
- **Chunk summaries are THROWAWAY** — memory only, final brief persists with an honest
  "built in N passes" note. **No migration — head stays 0048.**

## Non-goals (recorded)

- Intel-feed briefs (`intelBriefService.ts`) — already item-capped and description-sliced.
- Embedding of long transcripts — separate pipeline (`EMBED_UBATCH` chunking).
- A context-size Settings knob — the elastic prompt makes it unnecessary on 16GB-class
  machines; revisit only if high-VRAM users ask.
- External-provider serialization (unchanged AI-RESIL.2 scope decision).

## Baseline (from `fbebb9d` tree, all local gates green)

- `npx vitest run`: **2554 passed / 8 skipped / 0 failed (194 files)**
- `npx tsc --noEmit`: clean · `npx eslint src/`: **0 errors / 374 warnings** (pair)
- `npx prettier --check src/`: 2 pre-existing HTML warnings
- Migration head: **0048** (must not change this phase)

## Agent economy & parallelization (user-requested)

- **Task 1 ∥ Task 2 — run concurrently** (file-disjoint: Task 1 touches
  `promptBudget.ts`/`llamaRuntimeConfig.ts`; Task 2 touches `ai-provider.ts`/
  `localBuiltin.ts`). No chain markers — these are independent, not chained.
- **Task 3 starts when Task 1 completes** (imports `promptBudget.ts`). Task 3 is
  file-disjoint from Task 2 and may run concurrently with it if Task 2 is still open.
- **Task 4 (closing gate) runs strictly last**, alone.

<phase n="AI-CTX.1" name="Context-Budgeted Brief Pipeline + Chat-Task Routing Coherence">
  <context>
    A long meeting's brief deterministically fails on the builtin runtime because the
    prompt is assembled with no awareness of the provider's context window (16,384 tokens,
    a deliberate VRAM bound that must NOT be raised), and the first-usage model pick does
    not govern the summarization task, so a second downloaded model triggers silent
    cross-model cold swaps. Fix: (a) a per-provider prompt budget with fit-check and
    chunked map-reduce fallback in generateBrief/generateActionItems; (b) chat-task
    config inheritance from live_assistant at resolution time.
    @src/main/services/llamaRuntimeConfig.ts
    @src/main/services/meetingIntelligenceService.ts
    @src/main/services/ai-provider.ts
    @src/renderer/components/setup-wizard/localBuiltin.ts
    @src/shared/types/ai.ts
    @src/main/services/__tests__/meetingIntelligenceService.briefFailure.test.ts
    @src/main/services/__tests__/meetingIntelligenceService.threading.test.ts
  </context>

  <task type="auto" n="1">
    <n>Prompt budget module — per-provider windows, token estimation, segment chunking</n>
    <files>src/main/services/promptBudget.ts (new), src/main/services/__tests__/promptBudget.test.ts (new), src/main/services/llamaRuntimeConfig.ts</files>
    <action>
      Create `src/main/services/promptBudget.ts`, a pure derivation module (no IPC, no
      side effects — same testability discipline as llamaRuntimeConfig.ts). WHY: the brief
      pipeline needs one authoritative answer to "how many prompt chars fit this
      provider?", and it must be unit-testable without a sidecar.

      1. In `llamaRuntimeConfig.ts`, export the currently-private `chatCtxSize()` (one-word
         change: `export function chatCtxSize`). WHY: the budget must track the REAL spawn
         flag including the `LIFEDASH_LLAMA_CTX` env override — a duplicated constant would
         drift.

      2. `promptBudget.ts` exports:
         - `CHARS_PER_TOKEN = 3.5` — deliberately BELOW the codebase's existing ≈4
           chars/token convention (see THREADING_TOTAL_CHAR_BUDGET's comment). WHY: the
           user's meetings are frequently Czech, which tokenizes denser than English;
           under-estimating tokens overflows the window (the exact field failure), while
           over-estimating merely triggers chunking earlier — the safe direction.
         - `estimateTokens(text: string): number` = `Math.ceil(text.length / CHARS_PER_TOKEN)`.
         - `contextWindowTokens(providerName: AIProviderName): number` — a table:
           `builtin` → `chatCtxSize()` (exact); `openai` / `anthropic` / `google` / `kimi`
           → 100_000 (a BUDGET deliberately below every current cloud window, not a claim
           about any model's true max); `lmstudio` → 8_192 and `ollama` → 4_096 —
           documented heuristic floors, with a comment stating honestly that these servers'
           context is user-configured on their side and unknowable from LifeDash; the
           floor bounds the damage and the classified overflow error (Task 3) remains the
           fallback if the user configured less.
         - `promptCharBudget(provider: Pick<ResolvedProvider, 'providerName' | 'maxTokens'>): number`
           = `(contextWindowTokens(name) − (maxTokens ?? 4096) − 1024) * CHARS_PER_TOKEN`,
           floored at a small positive minimum. The 4096 default output reserve mirrors
           TASK_MIN_OUTPUT_TOKENS' floor scale; the 1024 covers chat-template/message
           framing overhead the char measurement cannot see. For builtin this yields
           ≈(16384−4096−1024)×3.5 ≈ 39k chars — a ~90-min dense meeting becomes 2-3 chunks.
         - `chunkSegments(segments: { startTime: number; content: string }[], charBudget: number): { startTime: number; content: string }[][]`
           — sort by startTime, greedy-fill chunks by each segment's FORMATTED line length
           (same `[MM:SS] content` shape formatTranscript emits, so the measure matches
           what is sent), never splitting inside a segment; a single segment exceeding the
           whole budget goes alone into its own chunk (pathological, keep it — never drop
           content silently). Contract: flattening the chunks in order reproduces the
           sorted input exactly; every chunk ≤ budget except the single-oversized-segment
           case; exactly one chunk when the total fits.

      3. Tests (`promptBudget.test.ts`): provider table incl. builtin honoring a set/unset
         `LIFEDASH_LLAMA_CTX` (chatCtxSize reads env per call — save/restore in the test);
         estimation rounding; budget floor; chunking properties above, including no-loss,
         order preservation, single-chunk fast path, and the oversized-single-segment case.
    </action>
    <verify>
      `npx vitest run src/main/services/__tests__/promptBudget.test.ts src/main/services/__tests__/llamaRuntimeService.test.ts src/main/services/__tests__/llamaRuntimeService.swap.test.ts src/main/services/__tests__/llamaRuntimeService.pin.test.ts` — new file green, all three llamaRuntimeService files unregressed (the export change touches their module).
      `npx eslint src/main/services/promptBudget.ts src/main/services/llamaRuntimeConfig.ts src/main/services/__tests__/promptBudget.test.ts` — 0 errors.
      `npx prettier --write` then `--check` on the three touched/created files.
    </verify>
    <done>promptBudget.ts exists with the five exports above and passing property tests; chatCtxSize() exported; llamaRuntimeService* tests unregressed.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
  </task>

  <task type="auto" n="2">
    <n>Chat-task config inheritance from live_assistant at resolution</n>
    <files>src/main/services/ai-provider.ts, src/main/services/__tests__/ai-provider.taskRouting.test.ts (new), src/renderer/components/setup-wizard/localBuiltin.ts</files>
    <action>
      Extend `TASK_MODEL_FALLBACKS` (ai-provider.ts:561) so EVERY chat-class member of the
      `AITaskType` union (src/shared/types/ai.ts:29) maps to `'live_assistant'` — read the
      union at execution time and include all members EXCEPT `live_assistant` itself,
      `embedding` (its unconfigured⇒null privacy guard at ai-provider.ts:634 must remain
      byte-identical), and `transcription` (not an LLM chat task). The four existing
      entries (live_triage, twin_interview, twin_learning, knowledge_qa) stay as they are.

      WHY: the wizard's first-usage pick writes ONLY live_assistant+embedding
      (localBuiltin.builtinTaskModelPatch, deliberate), so summarization — the brief's
      task — falls through to first-enabled-provider + the 'default' sentinel, which the
      builtin runtime resolves to the alphabetically-FIRST chat GGUF. With two downloaded
      models this means a forced cross-model cold swap after every meeting, queued behind
      the AI-RESIL.2 recording pin. Inheritance at resolution fixes wizard AND
      Settings-configured users in one place; per DECISIONS.md, one chat model for all
      chat tasks IS the correct configuration for local hardware.

      Constraints — the resolution ORDER is unchanged:
      1. explicit `taskModels[task]` always wins (verify a user's explicit summarization →
         cloud assignment still resolves to cloud);
      2. inheritance applies only when the task's own config is unset AND live_assistant's
         exists;
      3. the final first-enabled-provider + DEFAULT_MODELS fallback is retained untouched
         for users with no live_assistant config at all;
      4. `TASK_MIN_OUTPUT_TOKENS` floors stay keyed to the REQUESTED task type (e.g.
         twin_learning inheriting live_assistant's config keeps its own 4096 floor —
         existing behavior, pin it with a test).

      Update the two now-stale doc comments: the TASK_MODEL_FALLBACKS block comment
      (ai-provider.ts:553-560) and builtinTaskModelPatch's comment
      (localBuiltin.ts:111-120), which names the four inheriting tasks explicitly.
      Comment-only change in localBuiltin.ts — its tests must pass unmodified.

      New test file `ai-provider.taskRouting.test.ts` (naming per ai-provider.google/embed
      convention), mocking the db the way existing ai-provider tests do: the four
      constraint cases above plus summarization-inherits-live_assistant (provider id,
      model, temperature, maxTokens all flow through).

      This supersedes part of the AI-RESIL.1 'default'-sentinel behavior — the executing
      agent appends a DECISIONS.md entry (append-only file) recording the inheritance
      decision and its user approval date.
    </action>
    <verify>
      `npx vitest run src/main/services/__tests__/ai-provider.taskRouting.test.ts src/main/services/__tests__/ai-provider.google.test.ts src/main/services/__tests__/ai-provider.embed.test.ts src/renderer/components/setup-wizard/__tests__/localBuiltin.test.ts` — new file green, existing ai-provider + localBuiltin tests unregressed.
      `npx eslint src/main/services/ai-provider.ts src/main/services/__tests__/ai-provider.taskRouting.test.ts` — 0 errors.
      `npx prettier --write` then `--check` on touched/created files.
    </verify>
    <done>Every chat-class task inherits live_assistant's config when unset; explicit assignments and the embedding null-guard proven untouched by tests; both stale comments corrected; DECISIONS.md entry appended.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
    <assumptions>The AITaskType union is the authoritative task list; any task type string used at call sites but absent from the union (grep to confirm none) would silently miss inheritance.</assumptions>
  </task>

  <task type="auto" n="3">
    <n>Budget gate + chunked map-reduce in generateBrief and generateActionItems</n>
    <files>src/main/services/meetingIntelligenceService.ts, src/main/services/__tests__/meetingIntelligenceService.contextBudget.test.ts (new), SPEC.md</files>
    <preconditions>
      - Task 1 complete (imports promptBudget.ts)
    </preconditions>
    <action>
      Wire the budget into both transcript-consuming paths. WHY each piece: the context
      window is a hard physical bound on the machines this app ships to (16GB Apple
      Silicon), so the PROMPT must become elastic — and never silently, because the brief
      prompt's own contract says "cover every distinct topic".

      A. Single-pass path (the common case — MUST stay byte-identical):
         After resolving the provider in generateBrief, compute
         `budget = promptCharBudget(provider)`. Assemble exactly as today. Replace the
         threading call's implicit 48,000-char default with a provider-derived budget:
         pass `Math.min(THREADING_TOTAL_CHAR_BUDGET, budget - userPrompt.length - systemPrompt.length)`
         (floored at 0) as trimBriefsToBudget's totalBudget argument — the 48k cap remains
         the ceiling for large-window providers, the provider window governs small ones.
         Fit check: `estimateTokens(systemPrompt + userPrompt) + (maxTokens ?? 4096) + 1024
         ≤ contextWindowTokens(name)` → exactly today's single generateBriefText call.
         REGRESSION PIN: a test must capture the assembled prompt for a fits-case fixture
         and assert it is byte-identical to the pre-change assembly (build the expectation
         from the current code's output BEFORE modifying, and commit it as a literal).

      B. Chunked path (transcript too large for one pass):
         1. Chunk via `chunkSegments(meeting.segments, chunkBudget)` where chunkBudget =
            budget minus the chunk-pass system prompt's length minus small headroom.
         2. Per chunk, SEQUENTIALLY (one sidecar — parallel requests would just queue on
            --parallel 1 and complicate failure attribution): call generate() with a NEW
            compact chunk-summary system prompt: language-aware via getLanguageName (write
            in the transcript's language), instructing: preserve EVERY distinct topic,
            decision, action item with owner/date, open question; terse bullets; no
            invented content; header `Part i of N of meeting "<title>"`. The chunk pass
            gets NO twin profile, NO threading, NO suppression, NO prep briefing — those
            belong to the final pass only, keeping chunk prompts small and factual.
         3. Any chunk throwing OR returning empty → persist the classified failure card
            via the existing buildBriefFailureText machinery with `dispatch: false`, and
            STOP — no partial brief, no partial dispatch (AI-RESIL.1's contract).
         4. Final reduce pass: user prompt = meeting title + "Part summaries (N parts):" +
            the chunk summaries + prep-briefing section + threading preamble + confirmed
            live context (i.e., every preamble today's single pass carries), system prompt =
            getSummarizationPrompt + language line + twin profile injection — so the final
            brief keeps template-awareness, threading continuity, and twin voice.
            If the assembled reduce prompt ITSELF exceeds the budget (pathological
            many-hour meeting), apply the same map-reduce to the chunk summaries treated
            as pseudo-segments — loop, max 2 extra levels, then classified failure card.
            Bound the loop explicitly; never recurse unbounded.
         5. Append to the persisted brief markdown a final line
            `_Summarized in N passes (long meeting)._` — the honest label the user chose
            (English v1; accepted limitation, note in DECISIONS.md entry).
      C. generateActionItems: same gate, same chunking. Fits → unchanged (regression-pin
         its prompt too). Over → per-chunk extraction using the SAME action system prompt
         (template + language + suppression instruction per chunk — suppression is already
         char-capped at 4,000); parse each chunk's items; merge in chunk order; dedupe
         case-insensitively on whitespace-normalized description equality (cross-chunk
         boundary repeats); then the EXISTING post-generate path (existence recheck, FK
         catch, insert) unchanged.
      D. `classifyBriefFailure`: add one branch BEFORE the catch-all matching
         /exceeds the available context size|maximum context length|context.window/i →
         reason text naming the real situation: the request outgrew the model's context
         window and the chunking gate should have prevented it (i.e., if this card is ever
         seen again it means the estimate was wrong — a diagnosable bug, not noise).
         Belt-and-braces: with a correct gate this branch should never fire.
      E. Keep generateBrief's eslint complexity ≤ 15 the way AI-RESIL.1 did: all new
         branching goes into private helpers (e.g. generateBriefChunked,
         reduceChunkSummaries, buildChunkPrompt) — extraction, not gate-widening.
      F. SPEC.md: add contract "A long meeting still gets a brief": GIVEN a transcript
         whose prompt exceeds the provider's context window, WHEN a brief or action items
         are generated, THEN the chunked path produces real output and a context-overflow
         failure card is never persisted for length alone; AND GIVEN a transcript that
         fits, THEN the assembled prompt is unchanged from the single-pass behavior.

      Tests (contextBudget.test.ts, mocking generate/resolveTaskModel exactly as
      briefFailure.test.ts does): fits → one generate call + byte-identical prompt pin;
      overflow → N chunk calls then 1 reduce call, chunk prompts contain no twin/threading
      markers, reduce prompt contains all N summaries + threading preamble; chunk 2
      failing → sentinel card persisted + dispatch skipped; empty chunk output → same;
      action-item chunk merge dedupes a boundary-duplicated item; overflow classification
      branch; reduce-overflow loop terminates at the bound with a failure card.
    </action>
    <verify>
      `npx vitest run src/main/services/__tests__/meetingIntelligenceService.contextBudget.test.ts src/main/services/__tests__/meetingIntelligenceService.briefFailure.test.ts src/main/services/__tests__/meetingIntelligenceService.threading.test.ts src/main/services/__tests__/meetingIntelligenceService.liveSuppression.test.ts src/main/services/__tests__/meetingIntelligenceService.twinProfile.test.ts src/main/services/__tests__/meetingIntelligenceService.raceAbsorption.test.ts src/main/services/__tests__/meetingIntelligenceService.antiDup.test.ts` — new file green, all six existing meetingIntelligenceService test files unregressed (they pin the prompts this task must not change in the fits-case).
      `npx eslint src/main/services/meetingIntelligenceService.ts` — 0 errors (complexity ceiling 15 holds).
      `npx prettier --write` then `--check` on touched/created files.
    </verify>
    <done>A transcript exceeding the provider window produces a real brief + action items via bounded map-reduce with the N-passes note; a fitting transcript's prompts are proven byte-identical; failure semantics (classified card, dispatch only on success) hold on every chunk-path exit; SPEC.md contract added.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
    <assumptions>
      - Chunk-summary QUALITY on an 8B model is unprovable by automation — that judgment is deliberately deferred to this phase's manual smoke gate.
      - briefFailure/threading tests exercise prompt assembly through mockable seams; if any existing test hard-pins a full prompt string that Task 3 must extend (the N-passes note only appears on the chunked path, so fits-case pins should survive), update the pin ONLY where the chunked path is the subject.
    </assumptions>
  </task>

  <task type="auto" n="4">
    <n>Closing gate — full-suite verification against the final tree</n>
    <files>(none — this task writes NO production code; findings route back to the owning task)</files>
    <preconditions>
      - Tasks 1-3 complete
    </preconditions>
    <action>
      Run the project's four gates sequentially and alone (documented contention rule),
      against the final tree. Per the AI-RESIL.2 lesson, run `npx prettier --write` on all
      files touched this phase BEFORE `--check`. If ANY gate fails, route the finding back
      to the owning task — do not fix production code inside the gate. If a routed-back
      fix lands, RE-RUN all gates against the final tree (a gate run against a stale tree
      is not a gate).
    </action>
    <verify>
      1. `npx vitest run` — expect the 2554/8/0 (194 files) baseline plus exactly the new
         tests Tasks 1-3 added (three new test files), zero regressions; record the pair.
      2. `npx tsc --noEmit` — clean, zero output.
      3. `npx eslint src/` — exactly 0 errors / 374 warnings asserted as a PAIR; verify
         composition on the touched files (not just the total, per the MEET-DEL.1 lesson);
         `eslint.config.mjs` byte-identical to HEAD via git hash-object.
      4. `npx prettier --check src/` — exactly the 2 pre-existing HTML warnings.
      5. Migration head still **0048** (`drizzle/meta/_journal.json`) — this phase ships
         no migration.
    </verify>
    <done>All five checks pass against the final tree in one uninterrupted sequence; numbers recorded in STATE.md/SUMMARY.md.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
  </task>
</phase>

## Manual smoke checklist (phase gate — runs AFTER the closing gate, can share a session with the two outstanding AI-RESIL checklists)

1. **The field case:** on a machine with the builtin runtime (ideally the M2 16GB pattern),
   Regenerate the brief on a real long meeting (the ~22k-token one that produced the
   failure card). Expect: a real brief carrying "_Summarized in N passes_", chunk passes
   visible in the log, no failure card, post-session learning dispatched.
2. **Routing coherence:** download TWO chat models where the wizard-picked one sorts
   alphabetically SECOND. Record a short meeting. Expect: brief + action items run on the
   picked model (sidecar log shows NO "switching model X -> Y" after the session).
3. **Regression:** a normal short meeting → brief looks and reads exactly as before, no
   N-passes note, single generate call in the log.
4. **Failure honesty:** stop the sidecar binary mid-chunk (or configure an unreachable
   model) on a long meeting → classified failure card, twin learns nothing.
