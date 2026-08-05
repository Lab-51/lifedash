# PLAN — TWIN-READ.1: Readable Memory Graph (stored labels, progressive disclosure, synaptic visuals)

> Created 2026-08-04 via /nexus-discussion → /nexus-plan. Standard track, Tier 1.
> **Own file** because `PLAN.md` still holds TRANS-HALL.1 (its smoke gate is separately
> outstanding) and `PLAN-TWIN-GRAPH.md` is TWIN-GRAPH.2's record.
> **Builds directly on TWIN-GRAPH.2**, which is code-complete and gate-verified but whose
> manual smoke gate is deliberately folded into this phase (user decision — see below).

## The problem this fixes (user-reported 2026-08-04, after seeing .2 render)

> *"it's still pretty bad with the text being as it is. it will be literally unreadable when
> there will be so much more elements."*

Verified in code, not guessed:
- **`twinFacts.fact` is a sentence**, and the renderer puts that sentence on the node as a
  single line of SVG `<text>` at 11px, hard-truncated at 34 chars
  (`graphVisuals.ts:119 truncateLabel`). SVG text has no wrapping and no ellipsis — the manual
  truncate exists *because* of that.
- **Every visible fact renders its label at once.** `labelVisible()` in
  `TwinMemoryGraphCanvas.tsx:528` returns `showLabels` for all facts above zoom
  `LABEL_ZOOM_THRESHOLD = 0.75`. No per-lane budget, no collision awareness.

So each node is a 34-character fragment of prose — long enough to collide with its neighbours,
too short to mean anything. At the hundreds-of-facts scale this graph is designed for, it
degrades into noise. **The root error is treating a fact as a label. A fact is a document.**

## User decisions (2026-08-04, all explicit)

1. **Labels are LLM-written and stored** — a new `twinFacts.label` column filled at extraction,
   with a backfill pass for existing facts. (Rejected: deriving the label in code — chosen
   against on quality, e.g. *"The Q3 pricing decision was deferred to the board meeting"* would
   derive to *"The Q3 pricing decision"*, losing the point.)
2. **Clustering ("+38 more") is DEFERRED in favour of progressive navigation** — the user's own
   proposal, and a better one: clustering hides the tail by prominence, which is a *guess* about
   what matters; progressive disclosure lets the user's click state what matters. The tiers are
   already a disclosure ladder.
3. **Fact click → the inspector card must keep working exactly as it does today** (user asked
   explicitly not to lose it).
4. **Always-dark graph canvas**, in both light and dark app themes — glow and gradients only
   read on dark, and two visual languages would be twice the surface to get wrong.
5. **Ambient shimmer on the twin core node ONLY** — a documented, deliberate supersession of the
   zero-idle-GPU rule, scoped to one element and gated on tab visibility. (Rejected: shimmer on
   all nodes — a permanent animation loop competes with Whisper and the local LLM for the GPU,
   which is the whole reason the rule exists.)
6. **TWIN-GRAPH.2's open smoke gate is folded into this phase's** — the user already saw .2
   render, and a separate formal pass would re-test something about to change.

## Design

### Progressive disclosure replaces "show everything"
```
  collapsed (default)                 after clicking PREFERENCES
     ( T W I N )                           ( T W I N )
    ╱     │     ╲                         ╱     │     ╲
[WORK·31][PREFS·42][GOALS·12]      [WORK·31][PREFS·42][GOALS·12]
                                               │
                                       ┌───────┴────────┐
                                       │ ○ async standups│
                                       │ ○ no meetings   │
                                       │   before 10am   │
                                       │ ○ prefers Rust  │
                                       └─────────────────┘
```
One expanded lane is ~40 labels, not ~600. **Two consequences that shrink this phase:**
- The three-tier semantic-zoom LOD originally proposed is **dropped as unnecessary** — with
  stored short labels plus disclosure, *label at rest, full text on focus* is enough.
- Readability stops depending on zoom-threshold tuning; it is bounded by construction.

**Accepted cost, stated plainly:** a fact learned during a recording now blooms into a
*collapsed* lane, so the "watching it learn" moment weakens to a hub count-bump + pulse.
Task 5 owns making that read well.

### The synaptic visual language (all pure SVG, no new dependency)
1. **Soma nodes** — filled core + two concentric low-alpha rings. Cheap glow **without SVG
   filters** (`feGaussianBlur` per node gets expensive fast; layered strokes do not).
2. **Dendrite connections — the highest-impact single change.** Uniform 1px strokes are what
   read as "diagram". Replace with a **filled tapered bézier ribbon**: ~3.5px at the hub end
   tapering to ~0.75px at the fact end. Pure path math.
3. **Gradient per connection**, hub hue → fact hue at low alpha — signal direction without motion.
4. **Synaptic terminal** — a small filled dot where a connection meets its fact node. The detail
   that sells "synapse" over "line".
5. **Activation pulse** — on hover/click, a one-shot highlight travels outward along the node's
   connections (~500 ms via `stroke-dashoffset`, then removed). Interaction-triggered, so the
   freeze guarantee holds.
6. **Depth by attenuation** — collapsed lanes ~35% opacity, expanded lane full, focused node's
   direct neighbours lit while the rest dim. Reads as attention, not decoration.

## Hard constraints

- **The fact inspector is UNTOUCHED.** Clicking a fact opens `TwinMemoryInspector` in
  `GraphPinnedCard` exactly as today. Disclosure changes what is *on screen*, never what a fact
  click *does*.
- **The safety triad stays intact and keyboard-reachable** (carried from TWIN-GRAPH.2):
  provenance ("a past session" when the source is gone, **never a raw id**), one-tap forget +
  ~5 s undo with rollback, pause-learning kill-switch that only reflects the main-side gate.
  **Progressive disclosure must not put any of them further out of reach** — collapsed lanes
  must still be keyboard-navigable to their facts.
- **Zero idle rAF/timers — with exactly ONE documented exception: the core-node shimmer.**
  Note the technical trap: **a CSS animation schedules neither rAF nor `setInterval`, so the
  existing settle-discipline test would pass straight through the shimmer.** The rule being
  superseded is the *spirit* (idle GPU work), so this needs a DECISIONS.md entry **and** a test
  proving the shimmer stops when the tab is hidden.
- **`prefers-reduced-motion` disables ALL of it** — no shimmer, no activation pulse, no bloom,
  no expand animation. Settled layout, rendered once. Accessibility carve-out, non-negotiable.
- **Facts never leave their category lane** (TWIN-GRAPH.2's structural promise).
- **Backfill must degrade gracefully** — pause-gated, resumable, never blocks the UI, and a fact
  with no stored label must still render via the derived fallback rather than blank.
- **`TwinMemoryPanel` + parts stay retained unreferenced**; their tests stay green.
- **The session Brain canvas stays byte-identical to HEAD** — `BrainTabPanel`, `BrainMindMap`,
  `brainStore`, `brainLiveSync`, `useBrainLiveSync`, `BrainInspector`, `SessionWorkspace`,
  `LiveModeOverlay`. It was reverted after TWIN-GRAPH.1's mis-target; re-entering the diff would
  undo that correction.
- **TRANS-HALL.1's files are off-limits** — `transcriptionService.ts`, `whisperModelManager.ts`,
  `transcriptCleanupService.ts`, `voice-input.ts`, `main.ts`, `src/shared/transcription/`.
- **No new npm dependency.**

## Baselines
Capture fresh at execution start and hold: no new failures, no new eslint warnings. Current:
**2216 passed / 8 skipped / 0 failed (177 test files); `tsc --noEmit` clean; eslint 375 problems
(0 errors, 375 warnings)**; prettier has 2 pre-existing HTML warnings (`logo_preview.html`,
`index.html`) that are NOT regressions.

<phase n="1" name="TWIN-READ.1: Readable Memory Graph">
  <context>
    The twin memory graph renders each fact's full sentence as a truncated one-line SVG label,
    all at once above a zoom threshold — unreadable at scale. Fix: LLM-written stored short
    labels, progressive disclosure (collapsed lanes, click to expand), full text on focus, and a
    synaptic visual language on an always-dark canvas. See prose above for decisions and
    constraints — read it all before starting any task.

    @src/renderer/components/twin/TwinMemoryGraph.tsx
    @src/renderer/components/twin/TwinMemoryGraphCanvas.tsx
    @src/renderer/components/twin/TwinMemoryLaneChrome.tsx
    @src/renderer/components/twin/TwinMemoryInspector.tsx
    @src/renderer/components/brain-graph/graphVisuals.ts
    @src/renderer/components/brain-graph/tieredLayout.ts
    @src/renderer/stores/twinMemoryGraphStore.ts
    @src/main/services/twinGraphService.ts
    @src/main/services/twinMemoryService.ts
    @src/main/db/schema/twin.ts
  </context>

  <task type="auto" n="1">
    <n>twinFacts.label — migration, extraction, backfill, labelFor() accessor</n>
    <files>src/main/db/schema/twin.ts, drizzle migration (new), src/main/services/twinMemoryService.ts, src/main/services/twinGraphService.ts, src/shared/types/twin.ts, src/shared/twin/factLabel.ts (new), src/shared/twin/factLabel.test.ts (new), src/main/services/__tests__/twinMemoryService.test.ts</files>
    <action>
      Add a nullable `label` text column to `twinFacts` (nullable is deliberate — every existing
      row starts unlabelled and must still render).

      Extraction: `twinMemoryService.extractFacts` asks the model for a 2-4 word label alongside
      each fact and persists it. Keep the prompt change minimal and additive; a model that
      ignores the field must not break extraction — a missing label is simply null.

      `src/shared/twin/factLabel.ts` — ONE exported `labelFor(fact)` used by every surface:
      returns the stored label when present, else a DERIVED fallback (first clause / first ~4
      words, capped). This fallback is what guarantees an unlabelled or backfill-pending fact
      never renders blank. Pure, no I/O, unit-tested both directions.

      Backfill: a user-triggerable pass that labels existing unlabelled facts via the local
      model. MUST be pause-gated (respect `twin.learningPaused`), resumable, chunked, never
      block the UI, and degrade to a typed no-op when no model is configured — the derived
      fallback covers that case, so backfill failing is a quality regression, never a breakage.
      Follow the `entity:analyze-history` precedent (user-triggered, never automatic, never on a
      schedule) rather than inventing a new mechanism.

      `twinGraphService` returns `label` on fact nodes so the renderer never re-derives.
    </action>
    <verify>
      Migration applies cleanly on an existing DB with rows. Unit tests: labelFor prefers the
      stored label; falls back for null/empty; the fallback is capped and never blank for
      non-empty input. Extraction persists a label when the model supplies one and stores null
      when it does not. Backfill: labels only unlabelled rows, no-ops when paused, typed no-op
      with no model configured, and is resumable. `npx tsc --noEmit` clean; suite green vs baseline.
    </verify>
    <done>Facts carry a short stored label, every surface reads it through one accessor with a derived fallback, and existing facts can be backfilled without ever rendering blank.</done>
    <confidence>MEDIUM</confidence>
    <complexity>standard</complexity>
    <assumptions>
      - The local model reliably returns a short label field alongside the fact (verify: a missing/garbage label must degrade to null, not corrupt extraction)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Progressive disclosure — collapsed lanes, click to expand</n>
    <files>src/renderer/components/twin/TwinMemoryGraphCanvas.tsx, src/renderer/components/twin/TwinMemoryLaneChrome.tsx, src/renderer/stores/twinMemoryGraphStore.ts, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      The graph opens COLLAPSED: twin core + category hubs with their fact counts. Clicking a hub
      expands that lane's facts; clicking it again collapses. Expansion state lives in the store
      (which lanes are open), so it survives a refresh and a live update.

      Whether more than one lane may be open at once is your call — default to allowing it, since
      lanes are spatially separate and the user compared this to navigation, not to an accordion.
      State the choice in the component header.

      Layout: collapsed lanes contribute only their hub to the simulation, so the settled layout
      is dramatically smaller. Expanding reheats — LANE-LOCAL where possible (reuse the existing
      lane-local reheat proven in TWIN-GRAPH.2) — then re-freezes.

      KEYBOARD AND ACCESSIBILITY ARE LOAD-BEARING HERE: hubs are real buttons with
      `aria-expanded`; facts in a collapsed lane must still be reachable (expanding via keyboard
      then tabbing in). Progressive disclosure must not push the safety triad further away.

      DO NOT CHANGE what a fact click does — `TwinMemoryInspector` in `GraphPinnedCard` opens
      exactly as today, with provenance, forget+undo and the pause switch untouched.
    </action>
    <verify>
      Tests: opens collapsed (facts absent from the DOM, hub counts correct); clicking a hub
      reveals its facts and only its facts; clicking again collapses; expansion survives a store
      refresh; hubs expose `aria-expanded` and toggle by keyboard; a fact reached after keyboard
      expansion still opens the inspector with forget reachable. Settle-discipline test still
      green (expansion animates then re-freezes). Suite green vs baseline; tsc clean.
    </verify>
    <done>The graph opens legible and near-empty, lanes open on click and by keyboard, expansion state persists, and the fact inspector behaves exactly as before.</done>
    <confidence>HIGH</confidence>
    <complexity>complex</complexity>
  </task>

  <task type="auto" n="3">
    <n>Label rendering — stored label at rest, wrapped full text on focus</n>
    <files>src/renderer/components/brain-graph/graphVisuals.ts, src/renderer/components/twin/TwinMemoryGraphCanvas.tsx, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      SPIKE FIRST — there is ZERO `foreignObject` precedent anywhere in this renderer (verified:
      every label is raw SVG `<text>`). Before building on it, prove in a throwaway test whether
      `<foreignObject>` renders and measures correctly under this project's jsdom setup, or
      whether manual `<tspan>` line-breaking is required. Report which and why; delete the spike.

      Then: render `labelFor(node)` at rest (short, so it fits on one line at normal zoom), and
      the FULL fact text wrapped when the node is hovered/focused/inspected. Retire
      `truncateLabel`'s 34-char sentence-fragment path for fact nodes — it exists only because a
      sentence was being forced onto a node.

      Legibility: add a text halo (`paint-order: stroke` + background-coloured stroke) so any
      label survives crossing a connection. Keep lane headings and hub labels readable at ALL
      zooms — they are the structure.

      Replace `labelVisible`'s all-or-nothing zoom gate with something disclosure-aware: within
      an expanded lane show labels; collapsed lanes show only hub + count.
    </action>
    <verify>
      Spike result stated in the task log (foreignObject vs tspan, with the evidence). Tests:
      a fact renders its stored label at rest and its FULL text on focus; an unlabelled fact
      renders the derived fallback, never blank; hub and lane labels present at low zoom;
      halo applied. Suite green vs baseline; tsc clean; eslint no new warnings.
    </verify>
    <done>At rest every fact shows a short readable label, focus reveals the full wrapped text, nothing renders blank, and labels stay legible over connections.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
    <assumptions>
      - `foreignObject` works under this project's jsdom test setup (VERIFY IN THE SPIKE — fall back to tspan wrapping if not)
    </assumptions>
  </task>

  <task type="auto" n="4">
    <n>Synaptic visual language — dark canvas, dendrites, activation pulse</n>
    <files>src/renderer/components/twin/TwinMemoryGraphCanvas.tsx, src/renderer/components/brain-graph/graphVisuals.ts, src/renderer/components/twin/TwinMemoryLaneChrome.tsx, src/renderer/styles/globals.css, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      Implement the six-piece visual language from the prose above. Pure SVG, NO new dependency,
      and NO per-node `feGaussianBlur` filters (layered low-alpha rings instead — filters on
      hundreds of nodes get expensive fast).

      1. Soma nodes: filled core + two concentric low-alpha rings; brighter ring on focus.
      2. Dendrite connections: replace the uniform stroke with a FILLED tapered bézier ribbon
         (~3.5px at the hub end → ~0.75px at the fact end). This is the highest-impact change —
         uniform strokes are what make it read as a diagram.
      3. Per-connection `linearGradient`, hub hue → fact hue, low alpha.
      4. Synaptic terminal dot where a connection meets its fact node.
      5. Activation pulse: one-shot travelling highlight along a node's connections on
         hover/click (~500ms, `stroke-dashoffset`, removed after). Interaction-triggered only.
      6. Depth: collapsed lanes ~35% opacity, expanded lane full, focused node's neighbours lit.

      ALWAYS-DARK CANVAS in both app themes (user decision) — give the graph its own dark surface
      that reads as deliberate, not broken, in light theme. Chrome outside the canvas keeps the
      app theme.

      CORE SHIMMER (the documented exception): a slow CSS pulse on the twin core node ONLY. It
      MUST stop when the Memory tab is not visible, and MUST NOT run under
      `prefers-reduced-motion`. Note the trap: a CSS animation schedules neither rAF nor
      `setInterval`, so the existing settle-discipline test will NOT catch it — you must add an
      explicit test that the shimmer stops when the tab is hidden.

      Reduced motion disables shimmer, pulse and expand animation entirely.
    </action>
    <verify>
      Tests: dark canvas surface applied under both themes; dendrite paths are filled tapered
      shapes (not uniform strokes); terminal dots present; activation pulse class applies on
      hover/click and is removed after; collapsed lanes attenuated; core shimmer present, ABSENT
      when the tab is hidden, and ABSENT under reduced motion; settle-discipline test still green.
      Suite green vs baseline; tsc clean; eslint no new warnings; prettier clean.
    </verify>
    <done>The graph reads as neural — soma nodes, tapered dendrites, gradient connections, synaptic terminals, activation pulse on touch — on a deliberate dark canvas, with the single core shimmer correctly scoped and reduced-motion honoured.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
  </task>

  <task type="auto" n="5">
    <n>Live growth under disclosure + reduced motion</n>
    <files>src/renderer/stores/twinMemoryGraphStore.ts, src/renderer/components/twin/TwinMemoryGraphCanvas.tsx, src/renderer/components/twin/TwinMemoryLaneChrome.tsx, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      Progressive disclosure weakens the "watching it learn" moment — a fact arriving in a
      COLLAPSED lane is invisible. Restore it at the hub: the hub's count bumps and the hub
      pulses (reusing the activation-pulse vocabulary from Task 4) so the arrival is legible
      without forcing the lane open.

      A fact arriving in an EXPANDED lane keeps TWIN-GRAPH.2's existing behaviour: spawns at its
      hub, lane-local reheat, `brain-node-enter`, re-freeze.

      Do NOT auto-expand a lane on arrival — that would yank the view while the user is reading
      something else. (If you disagree after building it, say so rather than changing it
      unilaterally.)

      Reduced motion: count updates with no pulse, no bloom, no animation.

      The settle-discipline guarantee must survive every path: after any arrival, the graph
      returns to zero scheduled frames.
    </action>
    <verify>
      Tests: arrival in a collapsed lane bumps the hub count and applies the pulse class WITHOUT
      revealing the lane's facts; arrival in an expanded lane blooms as before; neither
      auto-expands; reduced motion shows the count change with no animation class; the
      settle-discipline test passes after both arrival paths. Suite green vs baseline; tsc clean.
    </verify>
    <done>A newly learned fact is visible whether or not its lane is open, nothing yanks the view, reduced motion stays static, and the graph always re-freezes.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
    <preconditions>
      - Tasks 2 and 4 completed
    </preconditions>
  </task>

  <task type="auto" n="6">
    <n>Gates, records, and the combined manual smoke</n>
    <files>STATE.md, SUMMARY.md, ROADMAP.md, DECISIONS.md</files>
    <action>
      Final gate. Full suite, `npx tsc --noEmit`, eslint, prettier on touched files —
      SEQUENTIALLY, never concurrently. Compare against the captured baseline.

      Audit the diff against every hard constraint in the prose above, each with code-level
      evidence: fact-click inspector unchanged; safety triad intact AND still keyboard-reachable
      through disclosure; zero idle rAF/timers except the scoped core shimmer; reduced motion
      disables everything; facts never leave their lane; `TwinMemoryPanel` retained; the session
      Brain canvas still byte-identical to HEAD (`git diff` on all eight files must be EMPTY);
      TRANS-HALL.1 untouched; no new dependency.

      Records: ROADMAP — add TWIN-READ.1, and update the TWIN-GRAPH.2 section to note its smoke
      gate was folded here. DECISIONS.md — **APPEND, never rewrite**: (a) the stored-label
      decision and why derivation was rejected, (b) progressive navigation chosen over
      clustering, with clustering explicitly deferred not killed, (c) the always-dark canvas,
      (d) **the core-shimmer supersession of the zero-idle-GPU rule** — scope, why it is
      acceptable, and the fact that a CSS animation is invisible to the existing rAF-based test.

      Then STOP for the user's manual smoke test — ONE combined gate covering both TWIN-GRAPH.2
      and TWIN-READ.1 (user decision). The feel IS the acceptance, and a tuning round is an
      expected, non-failure outcome.
    </action>
    <verify>
      All gates green vs baseline; constraint audit with evidence in SUMMARY.md; the empty-diff
      check on the eight session-Brain files recorded explicitly; records updated (DECISIONS
      append-only, verified); the combined smoke test requested and its outcome recorded.
    </verify>
    <done>Gates clean, constraints audited with evidence, records honest about what superseded what, and one combined smoke test requested — phase completion blocked on user confirmation.</done>
    <confidence>HIGH</confidence>
    <complexity>simple</complexity>
  </task>
</phase>
