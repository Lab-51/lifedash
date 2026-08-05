# PLAN — TWIN-GRAPH.2: Twin Memory Graph (tiered flow with category regions)

> Created 2026-08-04, replacing the withdrawn TWIN-GRAPH.1 plan **in this same file**.
> Standard track, Tier 1. **PLAN.md still belongs to TRANS-HALL.1** (held at its own,
> separate, outstanding manual smoke gate) — execute this one by name.

## Why this plan replaces the previous one

TWIN-GRAPH.1 built a force-directed memory graph and mounted it on the **session/project**
Brain canvas (`BrainTabPanel`, used by `SessionWorkspace` + `LiveModeOverlay`). **That was the
wrong surface.** The user meant the **twin's** brain: `TwinPage` → **Memory** tab, which today
renders `twin/TwinMemoryPanel` — a flat, newest-first list of the twin's learned facts.

The mis-targeting originated in the plan itself (its recon anchors and its "REPLACES the mind
map" decision both named `BrainMindMap`/`BrainTabPanel`), so the plan is rewritten rather than
amended. The session Brain canvas has already been **reverted to the tidy tree** and verified
(2105 passed / 8 skipped / 0 failed, tsc clean, eslint 375/0); `BrainTabPanel`, `BrainInspector`,
`brainLiveSync`, `useBrainLiveSync` are byte-identical to HEAD.

A second correction from the same conversation: the delivered graph was **"too much like
Obsidian — not structured enough."** A uniform force blob makes position meaningless. This plan
replaces that with **tiered flow + category regions**: position carries meaning, motion still
settles.

## User decisions (2026-08-04, explicit)
1. **Host: `TwinPage` → Memory tab.** Not the session Brain canvas.
2. **The graph REPLACES `TwinMemoryPanel`'s list** (not a toggle, not side-by-side).
3. **Layout: tiered flow with regions** — chosen over pure radial and over pure clustering.
4. Session Brain canvas: **reverted to the tidy tree.** Already done.

## The layout, concretely

```
                        ( T W I N )
            ╭───────────────┼───────────────╮
┌── WORK ───┴────┐ ┌─ PEOPLE ┴──────┐ ┌── GOALS ┴─────┐
│   [ hub ]      │ │   [ hub ]      │ │   [ hub ]     │
│    ╱    ╲      │ │    ╱  │  ╲     │ │    ╱   ╲      │
│   ○      ○     │ │   ○   ○   ○    │ │   ○     ○     │
│      ○         │ │       ○  ←new  │ │         ○     │
└────────────────┘ └────────────────┘ └───────────────┘
```
- **Tier = depth**: twin core (tier 0) → category hub (tier 1) → fact (tier 2).
- **Region = category**: each category owns a horizontal lane; facts settle **inside** their
  lane and never drift across.
- **Motion**: arrivals and transitions animate, then **freeze**. No idle physics.

**Lanes are structurally safe:** `twinFactCategoryEnum` is a bounded enum of exactly five —
`person`, `project`, `preference`, `domain`, `commitment` (`schema/twin.ts:52-58`). Never zero
lanes, never dozens. Uneven distribution makes one lane taller, not broken.

## ⚠️ The safety triad is the biggest risk in this plan

`TwinMemoryPanel`'s own header calls it "the auditability half of the twin's **locked** safety
triad." Replacing the list means these must be **re-provided in the graph UI, not lost**:
- **provenance** — "learned in \<session\>", resolved from the meetings store, *never a raw id,
  never fabricated*
- **one-tap forget + ~5 s undo** — `twin:memory-forget` (soft) / `twin:memory-restore`
- **pause-learning kill-switch** — reflects and flips `twin.learningPaused`; the gate itself is
  enforced main-side and must **never** be re-implemented in the renderer

**A forget affordance reachable only by hover is a regression.** Keyboard reachability and a
visible route to each action are non-negotiable (accessibility carve-out).

## What is reused (already built, verified, mounted nowhere)
- `brain-graph/forceLayout.ts` — d3-force controller, DOM-free, `start`/`tick`/`tickUntilSettled`/
  `onTick`/`reheat`/`stop`/`isSettled`. **Needs tier/lane constraints added.**
- `brain-graph/prominence.ts` — pure scoring (0.6 degree / 0.4 recency, 30-day decay) → radius +
  glow tier. Reusable as-is.
- `brain-graph/BrainMemoryGraph.tsx`, `graphVisuals.ts`, `GraphPinnedCard.tsx` — SVG renderer,
  zoom/fit/ResizeObserver plumbing, settle-discipline rAF loop. **Needs lane chrome + tier
  positioning; drops the entity-centric inspector contract.**
- `stores/memoryGraphStore.ts` — per-scope buckets, pendingLoads dedupe, optimistic
  `forgetNode` + rollback. **Note: `brainLiveSync` drives `brainStore` only again — this store
  currently has NO refresh trigger; its new host must arrange one.**
- `brain-inspector/FactInspector.tsx` — fact content, category badge, provenance link, forget.
- `d3-force@3.0.0` + `@types/d3-force@3.0.10`.
- `main/services/brainGraphService.ts` + `brain:build-graph` — **entity-centric; see Task 1.**

## Hard constraints
- **Zero timers/rAF at idle.** rAF only while unsettled, dragging, or animating an entrance;
  must stop when settled, proven by a settle-discipline test. `prefers-reduced-motion` renders
  the settled layout synchronously with no animation.
- **The safety triad survives the replacement** — provenance, one-tap forget + undo, pause
  kill-switch, all keyboard-reachable. The main-side gate is never re-implemented.
- **Forgotten facts never render** (`status='active'` filtered at the query).
- **Facts never leave their category lane.**
- **`TwinMemoryPanel` and its parts are RETAINED unreferenced**, per the project's
  code-retention convention (cf. BrainMindMap, Brainstorm/Ideas). Do NOT delete
  `TwinMemoryPanel.tsx`, `TwinMemoryFactRow.tsx`, `TwinMemoryUndoSnackbar.tsx` or their tests.
- **The session Brain canvas stays reverted.** Nothing in this phase may touch `BrainTabPanel`,
  `BrainMindMap`, `brainStore`, `brainLiveSync`, `useBrainLiveSync`, `BrainInspector`,
  `SessionWorkspace`, or `LiveModeOverlay`.
- **`TwinPage`'s Memory-tab badge count must keep working** (`onCountChange` → `memoryCount`).
- **TRANS-HALL.1 files are off-limits** — `transcriptionService.ts`, `whisperModelManager.ts`,
  `transcriptCleanupService.ts`, `voice-input.ts`, `main.ts`, `src/shared/transcription/`.

## Baselines
Capture fresh at execution start and hold: full suite, `npx tsc --noEmit`, eslint count,
prettier on touched files. Current: **2105 passed / 8 skipped / 0 failed (169 files); tsc clean;
eslint 375 problems (0 errors, 375 warnings)**; prettier has 2 pre-existing HTML warnings
(`logo_preview.html`, `index.html`) that are NOT regressions.

## Open question the user still owes an answer to
**The reference screenshot has never been seen by the executing session.** TWIN-GRAPH.1's plan
cites "user screenshot 2026-08-04 (neural-net-style nodes, curved animated connectors)", but the
image is not in context. The ASCII sketch above is the agreed approximation. **If the user
re-shares the screenshot, Task 3's visual treatment should be matched to it before build.**

<phase n="1" name="TWIN-GRAPH.2: Twin Memory Graph (tiered flow with category regions)">
  <context>
    Replace TwinPage's Memory-tab list with a tiered, lane-structured memory graph of the
    twin's learned facts. Reuse the force/prominence/renderer modules already built and
    verified but mounted nowhere. Carry the twin's locked safety triad into the graph UI.
    See prose above for decisions, reuse inventory and hard constraints — read it all first.

    @src/renderer/components/TwinPage.tsx
    @src/renderer/components/twin/TwinMemoryPanel.tsx
    @src/renderer/components/twin/TwinMemoryFactRow.tsx
    @src/renderer/components/twin/TwinMemoryUndoSnackbar.tsx
    @src/renderer/components/brain-graph/forceLayout.ts
    @src/renderer/components/brain-graph/prominence.ts
    @src/renderer/components/brain-graph/BrainMemoryGraph.tsx
    @src/renderer/stores/memoryGraphStore.ts
    @src/main/services/brainGraphService.ts
    @src/main/db/schema/twin.ts
  </context>

  <task type="auto" n="1">
    <n>Twin-centric graph data: twin:build-memory-graph</n>
    <files>src/main/services/twinGraphService.ts (new), src/main/services/__tests__/twinGraphService.test.ts (new), src/main/ipc/twin.ts, src/preload/domains/twin.ts, src/shared/types/twin.ts, src/shared/validation/schemas.ts</files>
    <action>
      DECIDE FIRST, and state the decision in the file header: extend `brainGraphService` or
      write a twin-centric sibling. Recommendation: a SIBLING. `brainGraphService` is
      entity-centric (entities are the hubs, facts attach to them); the twin memory graph is
      ledger-centric with a fixed 3-tier shape and 5 fixed category hubs. Forcing both into one
      service would make the cap and prominence rules diverge from their node meanings.

      Nodes: one `twin` core (tier 0); one hub per `twinFactCategoryEnum` value that HAS at
      least one active fact (tier 1 — never emit an empty lane); every ACTIVE twinFact (tier 2).
      Include each fact's `sourceMeetingId` and the meeting title so provenance renders without
      a second round-trip — this is what makes "learned in <session>" work without fabricating.
      Facts whose source meeting was deleted keep the fact and lose the link (schema uses SET
      NULL deliberately) — render "a past session", never a raw id.

      Edges: twin→hub, hub→fact. No fact↔fact edges (tiers are the structure).

      Emit prominence INPUTS only (degree, newest timestamp) — scoring stays in the renderer,
      exactly as TWIN-GRAPH.1 established, so tuning never touches IPC.

      Node cap: reuse the established backstop shape — drop least-prominent FACT nodes first,
      never the core or hubs, report `droppedCount` honestly.

      Tests (real-PGlite pattern, cf. brainGraphService.test.ts): tiers and edges correct;
      forgotten facts excluded at the query; empty categories emit no hub; null sourceMeetingId
      yields a fact with no provenance link; cap drops facts only and reports the count.
    </action>
    <verify>
      New service + IPC tests green. `npx tsc --noEmit` clean. Existing brain:build-graph and
      twin IPC tests untouched and green. Full suite green vs baseline.
    </verify>
    <done>One IPC call returns the twin's full memory graph — core, populated category hubs, active facts with provenance, prominence inputs and droppedCount — proven by PGlite-backed tests.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
  </task>

  <task type="auto" n="2">
    <n>Tiered layout: lane constraints in the force controller</n>
    <files>src/renderer/components/brain-graph/tieredLayout.ts (new), src/renderer/components/brain-graph/forceLayout.ts, src/renderer/components/brain-graph/__tests__/tieredLayout.test.ts (new), src/renderer/components/brain-graph/__tests__/forceLayout.test.ts</files>
    <action>
      Turn the uniform force blob into tiered flow with regions — this is the correction the
      user asked for, and the heart of this phase.

      Add tier + lane constraints WITHOUT breaking `forceLayout`'s existing API or its
      DOM-freedom (it stays node-env testable). Approach: a strong `forceY` per tier (tier index
      → y band) and a bounded `forceX` per category lane, plus lane-boundary clamping in a
      custom force so a fact can NEVER cross into a neighbouring lane. Lane x-centres are
      computed from the ordered set of populated categories; lane width divides the viewport.

      Keep: settle-then-freeze, `reheat`, drag (`fx`/`fy` + reheat), stable id-hash seeding.
      A dragged fact is clamped to its own lane on release.

      `tieredLayout.ts` holds the pure geometry (tier bands, lane centres/bounds, seed positions
      within a lane) so it is unit-testable without the simulation. Export lane/tier constants
      as named values — a tuning round must touch one file.

      Extend the existing forceLayout tests rather than replacing them. The perf test's
      self-calibrating budget stays as-is (do not regress it to a fixed constant).
    </action>
    <verify>
      Tests prove: every fact settles inside its own lane's x-bounds (no crossings, incl. after
      drag-release and after reheat); tier y-bands are ordered core &lt; hub &lt; fact; a single-lane
      graph and an empty graph both behave; layout still settles deterministically and stops.
      Node env, no jsdom pragma. tsc clean; suite green vs baseline.
    </verify>
    <done>Facts are provably confined to their category lane and their tier band, the layout still settles-then-freezes deterministically, and all geometry is pure and unit-tested.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
    <assumptions>
      - Lane clamping composes with d3-force without fighting collide/charge into jitter (verify: assert settled positions are stable across two consecutive settles)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>TwinMemoryGraph component + Memory-tab swap, safety triad carried over</n>
    <files>src/renderer/components/twin/TwinMemoryGraph.tsx (new), src/renderer/stores/twinMemoryGraphStore.ts (new), src/renderer/components/TwinPage.tsx, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx (new), src/renderer/stores/__tests__/twinMemoryGraphStore.test.ts (new)</files>
    <action>
      Depends on Tasks 1+2. The visible feature.

      Adapt `BrainMemoryGraph.tsx` into `TwinMemoryGraph.tsx` (copy-and-adapt; leave
      `BrainMemoryGraph` in place unreferenced per the retention convention). Reuse literally:
      the settle-discipline rAF loop, zoom/fit/ResizeObserver-with-jsdom-bail,
      `usePrefersReducedMotion`, `GraphPinnedCard`, curved-bézier edges, prominence-driven
      radius/glow read OFF the layout node.

      Draw the lane chrome: labelled category regions (subtle bounds/heading per lane), the twin
      core, hubs. Labels declutter by zoom threshold as before.

      Store: `twinMemoryGraphStore` modelled on `memoryGraphStore` (whose refresh trigger is
      currently orphaned — do not silently inherit that gap; wire this one to the twin's own
      data refresh, or refresh on tab focus + after forget/undo, and say which in the header).

      SAFETY TRIAD — the non-negotiable half of this task:
      - **provenance**: every fact node's inspector shows "learned in <session>" resolved via the
        meetings store, "a past session" when the link is null. Never a raw id.
      - **forget + undo**: one-tap forget on a fact (optimistic removal + rollback on error),
        and the ~5 s undo via `twin:memory-restore` — reuse `TwinMemoryUndoSnackbar` rather than
        rebuilding it.
      - **pause-learning**: the kill-switch stays visible on the Memory tab, reflecting and
        flipping `twin.learningPaused`. Never re-implement the main-side gate.
      - All three reachable by KEYBOARD, not hover-only.

      `TwinPage`: Memory tab renders `TwinMemoryGraph` instead of `TwinMemoryPanel`.
      **`onCountChange`/`memoryCount` badge must keep working** — the graph reports the active
      fact count up exactly as the list did.

      Tests (jsdom pragma + matchMedia mock): renders tiers/lanes/edges from a fixture; lane
      labels present; reduced-motion renders settled with NO rAF; forget → optimistic removal →
      undo restores; provenance renders the session name and the null fallback; pause toggle
      reflects the setting; count reported up; droppedCount renders "+N not shown"; PLUS the
      settle-discipline test (zero pending rAF/intervals once settled).
    </action>
    <verify>
      New component/store tests green incl. settle-discipline and all three safety affordances.
      TwinPage tests green (badge count intact). TwinMemoryPanel's own tests STILL green
      (retained code). tsc clean, eslint no new warnings, prettier clean, suite green vs baseline.
    </verify>
    <done>Twin → Memory shows the tiered lane graph, the safety triad (provenance / forget+undo / pause) is fully present and keyboard-reachable, the tab badge still counts, and the graph freezes at idle.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
    <preconditions>
      - Tasks 1 and 2 completed
    </preconditions>
  </task>

  <task type="auto" n="4">
    <n>Live growth + gates, records, manual smoke</n>
    <files>src/renderer/stores/twinMemoryGraphStore.ts, src/renderer/components/twin/TwinMemoryGraph.tsx, STATE.md, SUMMARY.md, ROADMAP.md, DECISIONS.md</files>
    <action>
      Live growth: a newly learned twin fact appears in its lane — spawn at its category hub,
      `reheat` that lane only, entrance animation consistent with `globals.css`
      `brain-node-enter`, then RE-FREEZE (the settle-discipline test must still pass).
      Reduced motion: appears without animation. Keep it lane-local — a new fact must not
      re-shuffle the whole canvas.

      Then the final gate: full suite, tsc, eslint, prettier — SEQUENTIALLY, never concurrently.
      Audit the diff against every hard constraint above (idle-zero-timers; safety triad intact
      and keyboard-reachable; forgotten facts excluded; facts never leave their lane;
      TwinMemoryPanel retained; session Brain untouched; badge count intact), each with code-level
      evidence.

      Records: tick ROADMAP deliverables; APPEND to DECISIONS.md (never rewrite) an entry
      recording the TWIN-GRAPH.1 → .2 correction — wrong surface, the Obsidian-vs-structure
      feedback, the tiered-lane design, and the list→graph replacement with the triad carried over.

      Then STOP for the user's manual smoke test. The feel IS the acceptance; a tuning round is
      an expected, non-failure outcome.
    </action>
    <verify>
      All gates green vs baseline; constraint audit with evidence in SUMMARY.md; records updated
      (DECISIONS append-only, verified); smoke test requested and outcome recorded.
    </verify>
    <done>A newly learned fact blooms into its lane and the graph re-freezes; gates clean; records consistent with what was built; user smoke test requested — phase completion blocked on user confirmation.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
    <preconditions>
      - Task 3 completed
    </preconditions>
  </task>
</phase>
