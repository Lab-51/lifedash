# PLAN — TWIN-READ.2: Riverbank Memory Graph (rows, river dendrites, pinned card, scoped attention)

> Created 2026-08-05 via /nexus-discussion → design mockups → user selection. Standard track, Tier 1.
> **Own file** because `PLAN.md` holds TRANS-HALL.1's record and `PLAN-TWIN-READ.md` holds
> TWIN-READ.1's — both phases are complete and separately held at smoke gates; their plan files
> must not be rewritten.
> **Builds directly on TWIN-READ.1** (stored labels, disclosure store, synaptic vocabulary, dark
> canvas), which is code-complete and gate-verified. Target: next release after 2.7.0, shipping
> together with the other held phases.

## The problem this fixes (user-reported 2026-08-05, from the REAL .1 render)

The user ran TWIN-READ.1's actual build and posted a screenshot:

> *"The effects are great but i still think that the way it is now is a bit weird and
> structurally not that clear."*

Diagnosis from that screenshot, all verified against the code:
1. **The gulf** — hubs float a full tier-gap above their facts; every dendrite is a long
   near-parallel cable crossing empty space, so the connection reads as *distance*, not
   *belonging*. Facts pool at the far edge of their band like sediment.
2. **The boxes** — four bordered lane rectangles read as four app panels, not one organism, and
   equal widths regardless of content (Commitments·2 as wide as Domain·15) amplify the emptiness.
3. **Label pile-up** — .1 fixed *what* text goes on a node but not *where* nodes and labels go;
   the force layout packs facts with zero awareness of label width, so wrapped captions collide.
4. **Dead canvas** — content hugs the top 60%; no centre of mass.

## How the direction was chosen (this is the paper trail)

/nexus-discussion produced three structurally distinct candidates (Orbit radial / Canopy tight
columns / Riverbank horizontal mindmap). All three were built as an interactive HTML comparison
page using the app's REAL tokens (surface gradient, `#3ee8e4`/`#6bfbf7`/`#e8a33e`, 3.5→0.75px
taper, soma ring alphas, curvature .16, shimmer timing) and a dataset mirroring the user's real
counts (11/4/15/2, Czech mixed in). The user chose **Riverbank**, then drove two refinement
rounds, each re-verified by a scripted Playwright click-through with zero console errors.

**THE DESIGN CONTRACT IS THE MOCKUP:** `.planning/design/twin-memory-layout-variants.html`
(open with `?v=riverbank`). Executing agents MUST read that file — its geometry constants,
interaction grammar and comments are the specification. Where this plan and the mockup disagree
on a visual detail, the mockup wins.

## User decisions (2026-08-05, all explicit)

1. **Riverbank replaces the tiered-lane canvas** — twin on the left, category hubs mid-canvas,
   ONE ROW PER FACT on the right. Collisions become impossible by construction, not by tuning.
   (Orbit and Canopy were seen rendered and passed over; clustering stays deferred from .1.)
2. **Rows are short titles only** (`labelFor()` — the stored-label investment from .1 Task 1 is
   the row text). The full sentence moves entirely into the card; **click is the reveal, not
   hover**. .1's hover-full-text-on-node is retired on this surface.
3. **The card is the app's OWN pinned inspector** — the user explicitly asked for "the same type
   of floating modal as the session Brain": `GraphPinnedCardLayer` + `TwinMemoryInspector`,
   reused as-is. Node-anchored, connector line + dot, flip/clamp — NOT a centered dialog.
4. **Dendrites are river-delta S-curves** — cubics with HORIZONTAL tangents at both ends
   (branches leave the hub flowing right and arrive flowing right), bend point jittered per edge
   (deterministic id-hash, never `Math.random()`). The bowed quadratics read as wrong on
   horizontal runs; the user called them "weird" and approved the S-curves on sight.
5. **Attention is scoped by category** — hovered/pinned fact fully lit; its own category held
   readable (hub/trunk/heading/zone lit, siblings at mid-level ~0.55); every OTHER category —
   nodes, captions, headings, hubs, trunks — dimmed to ~0.25. The twin core NEVER dims. A pinned
   card keeps its subject lit when the pointer wanders off.
6. **The outstanding combined smoke gate folds forward once more.** The user's screenshot review
   of the .1 render effectively *began* that smoke test — verdict: visual language accepted,
   structure rejected — and re-testing a surface about to be replaced would be waste. **ONE
   combined manual gate now covers TWIN-GRAPH.2 + TWIN-READ.1 + TWIN-READ.2.**
7. **The organic feel survives determinism — a hard requirement, stated verbatim:** *"make sure
   we keep the organic feel in terms of animation, clicks etc. Don't want to lose that."*
   Retiring the force sim removes the settle motion that made the graph feel alive; the plan
   must replace it with an equivalent one-shot motion vocabulary (the growth cascade below),
   not with instant re-layout. A functionally perfect build that pops in mechanically FAILS
   this phase.

## Design

### Deterministic layout replaces the force simulation — on this surface only
Riverbank positions are pure arithmetic (vertical allocation ∝ visible rows, fixed columns for
twin/hubs/facts). There is nothing for a force simulation to do, so the twin canvas stops using
one: **zero idle rAF/timers becomes structural rather than enforced**. d3-force remains
untouched for the retained `BrainMemoryGraph`; `forceLayout.ts` is not modified.

### Organic motion without a simulation (user requirement — see decision 7)
The force sim's settle motion was the organism's heartbeat; determinism must replace it, not
delete it. The river's motion vocabulary — every item interaction- or data-triggered, one-shot,
ending clean:
- **Growth cascade on expand**: a lane's contents do not pop in — they GROW. Each S-ribbon
  draws outward from the hub (dash-reveal along the centerline, or an equivalent hub-origin
  reveal), and its row fades/slides its last few px into place, **staggered per row**
  (deterministic delay ≈ index × 20-30ms plus id-hash jitter — never `Math.random()`), with the
  springy ease the mockup already uses (`cubic-bezier(.22,1,.36,1)` — ease-out with a breath of
  overshoot, so motion reads as *grown*, not slid). Collapse reverses faster and un-staggered.
- **Mount settle**: the first render of a lane that opens expanded plays the same cascade once.
- **Touch feedback on every click/hover**: attend briefly emphasises the soma (one-shot
  transform scale, a hair — no persistent fill), and fires the existing activation pulse; the
  pinned card's connector appears with a short draw-in.
- **Arrivals bloom** (`brain-node-enter`), undo-restores re-bloom — carried from .1/.2 as-is.
- **Nothing linear, nothing infinite**: the core shimmer stays the only idle animation, with
  its existing gates.
All of it is one-shot with NO persistent fill-modes (the attention system must still win
afterwards — the mockup's fill-mode bug is the named trap), gated off entirely under
`prefers-reduced-motion`, and leaves zero scheduled work once finished.

### New canvas beside the old, per the house retention convention
`TwinMemoryGraphCanvas.tsx` is 969 lines with `complexity` as a hard lint ERROR — .1's final
gate explicitly said "split before the next phase touches it". We do one better: **build
`TwinMemoryRiverCanvas.tsx` fresh** (composed from small modules), swap it in at
`TwinMemoryGraph.tsx`, and RETAIN the old canvas unreferenced — exactly as `BrainMindMap` and
`TwinMemoryPanel` are retained. Its tests that describe behaviour we keep are migrated; the old
canvas's own test file stays green against the retained component.

### What carries over unchanged (do not rebuild)
- **Disclosure**: `twinMemoryGraphStore`'s `expandedLanes`/`toggleLane`, opens collapsed, counts
  from the full payload, multi-lane-open. Hubs stay real buttons with `aria-expanded`.
- **Safety triad**: provenance ("a past session" when the source is gone, never a raw id),
  forget + ~5s undo via `TwinMemoryUndoSnackbar`, pause kill-switch main-side. The inspector IS
  the card — its behaviour contract does not change.
- **Labels**: `labelFor()` titles, `fullTextOf()` in the card, halo props, backfill button.
- **Synaptic vocabulary**: soma rings, terminal dots, per-kind gradients (re-oriented for
  left→right flow), activation pulse classes + `setTimeout` clearing, always-dark surface,
  core shimmer, `twin-memory` live-sync scope.

### Traps pre-named (each burned us once already — do not rediscover them)
- **jsdom measures nothing**: row-anchor width for the pinned card must come from a
  DETERMINISTIC character-based estimate (the .1 Task 3 convention), never `getBBox`/
  `getComputedTextLength`/`getTotalLength`.
- **Animation fill-modes fight attention**: the mockup proved a lingering `both`/`forwards`
  fill on an enter animation pins `opacity:1` forever and silently defeats dimming (animations
  beat normal declarations). Every one-shot animation must end clean — no persistent fill on
  anything the attention system dims, and a test must cover "bloomed node still dims".
- **Riverbank anchors to the ROW, not the dot**: the caption sits beside the soma, so a card
  anchored at the circle edge covers the very title that was clicked. Anchor to the row's full
  extent (dot + estimated title width).
- **Vitest contention**: run `npm test` ALONE, gates sequential; a zero-error mass collection
  failure is contention, not a regression.

## Hard constraints

- **The fact inspector's behaviour is unchanged**: a fact click opens `TwinMemoryInspector` in
  the pinned card with provenance, forget+undo and the pause switch intact — same components,
  same contract. Only the anchor geometry adapts.
- **The safety triad stays intact and keyboard-reachable**: hubs and rows are real tabbable
  controls; Enter/Space opens; a fact in a collapsed lane is reachable by keyboard expansion.
  Attention dimming is decoration — a dimmed row stays focusable, readable on focus, and never
  `aria-hidden`.
- **Zero idle rAF/timers — with exactly ONE exception: the core shimmer** (already built, gates
  already tested). The deterministic layout must not smuggle in polling, observers-on-a-timer,
  or perpetual transitions. Settle-discipline tests carry over adapted: after mount, expand,
  arrival, forget, undo — an idle window schedules nothing.
- **`prefers-reduced-motion` disables ALL motion** — no shimmer, no pulse, no bloom, no height
  transition animation. Attention DIMMING remains (it is state, not motion). Count updates
  render instantly.
- **Facts never leave their category block** — structural by construction now; assert it anyway
  (a row renders inside its lane's allocated band).
- **The session Brain canvas stays byte-identical to HEAD** — `BrainTabPanel`, `BrainMindMap`,
  `brainStore`, `brainLiveSync`, `useBrainLiveSync`, `BrainInspector`, `SessionWorkspace`,
  `LiveModeOverlay`. Verify by CONTENT HASH (`git show HEAD:<f> | git hash-object --stdin` vs
  `git hash-object <f>`), NOT by `git diff` on a pathspec — a mistyped path diffs empty and
  passes vacuously (LEARNINGS.md 2026-08-05).
- **`GraphPinnedCard.tsx` is reused, not rewritten.** If the row anchor needs a wider shape,
  extend ADDITIVELY (its `AnchoredNode` note says exactly how) — `BrainMemoryGraph`'s use of it
  must be unaffected.
- **TRANS-HALL.1's files are off-limits** — `transcriptionService.ts`, `whisperModelManager.ts`,
  `transcriptCleanupService.ts`, `voice-input.ts`, `main.ts`, `src/shared/transcription/`.
- **Retained-unreferenced set grows but stays green**: `TwinMemoryPanel`+parts, `BrainMindMap`,
  and now `TwinMemoryGraphCanvas.tsx` + `TwinMemoryLaneChrome.tsx` (+ their tests, migrated or
  retained). Nothing retained is deleted or edited beyond what a shared type forces.
- **The organic feel is a requirement, not a nicety** (explicit user instruction 2026-08-05):
  expansion, arrival and interaction motion must follow the growth-cascade vocabulary above.
  Lanes popping in instantly, linear easing, or click interactions with no tactile response
  fail the phase even with every functional test green — the smoke gate judges feel.
- **No new npm dependency. No `feGaussianBlur`. No `Math.random()` in layout.**

## Baselines
Capture fresh at execution start and hold: no new failures, no new eslint warnings. Current:
**2326 passed / 8 skipped / 0 failed (180 test files); `tsc --noEmit` clean; eslint 375 problems
(0 errors, 375 warnings)**; prettier has 2 pre-existing HTML warnings (`logo_preview.html`,
`index.html`) that are NOT regressions. eslint must hold with `eslint.config.mjs` untouched.

<phase n="1" name="TWIN-READ.2: Riverbank Memory Graph">
  <context>
    Replace the twin memory graph's tiered-lane force layout with the user-chosen Riverbank
    geometry: twin left, category hubs mid, one row per fact right, river-delta S-curve
    dendrites, titles-only rows, the app's own pinned inspector card on click, and
    category-scoped attention dimming. Deterministic layout — the force sim retires on this
    surface. THE MOCKUP IS THE CONTRACT — read it first:
    @.planning/design/twin-memory-layout-variants.html

    @src/renderer/components/twin/TwinMemoryGraphCanvas.tsx
    @src/renderer/components/twin/TwinMemoryGraph.tsx
    @src/renderer/components/twin/TwinMemoryLaneChrome.tsx
    @src/renderer/components/twin/TwinMemoryInspector.tsx
    @src/renderer/components/twin/synapticVisuals.ts
    @src/renderer/components/twin/TwinMemoryDendrite.tsx
    @src/renderer/components/twin/TwinMemorySoma.tsx
    @src/renderer/components/brain-graph/GraphPinnedCard.tsx
    @src/renderer/components/brain-graph/graphVisuals.ts
    @src/renderer/stores/twinMemoryGraphStore.ts
    @src/renderer/styles/globals.css
  </context>

  <task type="auto" n="1">
    <n>River geometry engine — riverLayout.ts + S-curve ribbons in synapticVisuals</n>
    <files>src/renderer/components/twin/riverLayout.ts (new), src/renderer/components/twin/riverLayout.test.ts (new), src/renderer/components/twin/synapticVisuals.ts, src/renderer/components/twin/__tests__/synapticVisuals.test.ts</files>
    <action>
      Pure, DOM-free geometry. `riverLayout.ts` exports one function that maps
      (graph payload, expandedLanes, viewport width) -> positions: twin at the left anchor,
      one hub per populated category in a vertical stack (block height ∝ visible rows when
      expanded, fixed block when collapsed, gaps between), one row per fact (fixed row pitch,
      fact column x, title x), total canvas height (grows with content, floor for near-empty).
      Take the mockup's proven constants as the starting values (ROW pitch 30, twin/hub/fact
      column ratios, block gap) and export them as named constants. Deterministic: same input,
      same output; id-hash jitter only where the mockup jitters (S-bend fraction).

      Extend `synapticVisuals.ts` ADDITIVELY below its boundary: `sRibbonPath()` — the filled
      tapered ribbon bounded by two cubics with horizontal end tangents (offset vertically;
      exact at the endpoints where tangents are horizontal) — and `sCenterlinePath()` for the
      pulse track, both TOTAL (non-finite input -> '' or a finite point, matching the file's
      contract), plus a river terminal-point helper (arrival is horizontal by construction, so
      the terminal sits just short of the soma on the incoming side).

      Also add the left→right per-kind gradient defs (x-axis objectBoundingBox) beside the
      existing top-down ones — the two-shared-defs rationale from .1 Task 4 still holds because
      every river edge flows left→right.
    </action>
    <verify>
      Unit tests: allocation ∝ visible rows; collapsed block fixed; heights sum + gaps = total;
      every row lands inside its own category band (the never-leaves-lane assertion, now
      structural); determinism (two calls, identical output); forgotten facts shrink the
      allocation. Ribbon tests: closed path, two C segments, taper widths measured from the d
      string, total on garbage input. `npx tsc --noEmit` clean; suite green vs baseline.
    </verify>
    <done>The complete river geometry is computable, pure and unit-proven before any component consumes it, and the S-curve vocabulary lives in synapticVisuals beside the rest of the synaptic language.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
  </task>

  <task type="auto" n="2">
    <n>TwinMemoryRiverCanvas — new canvas, swap in, old canvas retained</n>
    <files>src/renderer/components/twin/TwinMemoryRiverCanvas.tsx (new), src/renderer/components/twin/TwinMemoryGraph.tsx, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx, src/renderer/styles/globals.css</files>
    <action>
      Build the river canvas FRESH as a composition of the existing small modules (soma, label,
      pulse vocabulary, riverLayout, sRibbon) — target well under 500 lines by construction; do
      NOT copy the 969-line canvas and edit it down. Render: always-dark surface (reuse
      `twin-graph-surface`), twin core with the existing shimmer gates, hub buttons with
      `aria-expanded` + count (lane heading text left of the hub, count in the accessible name),
      S-ribbon trunks and branches with terminal dots, and title-only rows — `labelFor(node)`
      with the halo, the WHOLE row (soma + title) one tabbable `role="button"` control whose
      accessible name is the FULL text (`fullTextOf`), matching .1's parity decision.

      Disclosure: reuse the store as-is. Collapsed lane = hub + heading + count only, facts
      absent from the DOM. **Expansion plays the GROWTH CASCADE from the plan's motion
      vocabulary — this is where the organic requirement lives or dies:** each branch draws
      outward from the hub and its row settles in staggered (deterministic per-row delay,
      id-hash jitter, the springy `cubic-bezier(.22,1,.36,1)` ease), block heights ease as
      one-shots, collapse reverses faster and un-staggered, and the first mount of an expanded
      lane plays the cascade once. No persistent fill-modes anywhere. All of it gated off under
      reduced motion (instant render). Document the motion vocabulary in the component header.

      Keep the existing zoom/pan + fit-to-view wiring pattern if the current canvas's is
      cleanly liftable; otherwise scroll-based tall canvas like the mockup — state which you
      chose and why in the component header. Deterministic layout means NO rAF loop exists at
      all; adapt the settle-discipline test into "idle schedules nothing" for the new canvas
      (mount, expand, collapse — then an idle window with zero new rAF/intervals).

      Swap: `TwinMemoryGraph.tsx` renders the river canvas. `TwinMemoryGraphCanvas.tsx` and
      `TwinMemoryLaneChrome.tsx` become retained-unreferenced; migrate the behaviour tests we
      keep (disclosure, keyboard, counts) to target the new canvas, leave the old component's
      own test file green against the retained component.

      globals.css: additive only — height-transition class if needed; reuse `brain-node-enter`
      and the `twin-*` classes; NO persistent fill-mode on anything attention will dim.
    </action>
    <verify>
      Tests: opens collapsed (facts absent from DOM, counts correct); hub click + keyboard
      expands/collapses with `aria-expanded`; rows render stored-label titles (derived fallback
      when unlabelled, never blank); full text is the row's accessible name; S-ribbon paths are
      filled closed cubics, not strokes; terminals present; dark surface in both themes; shimmer
      present/absent per its three gates; **the growth cascade is asserted structurally**:
      expanded rows carry the cascade class with monotonically increasing per-row delays
      (deterministic — same input, same delays), collapse carries none of the stagger, and after
      the cascade's window every animation class is gone (no persistent fill); reduced motion
      renders instantly with zero animation/transition classes; idle-schedules-nothing test
      green. Old canvas retained: zero non-test importers,
      its test file still green. Suite green vs baseline; tsc clean; eslint 375/0 with config
      untouched.
    </verify>
    <done>The Memory tab renders the riverbank geometry through a fresh sub-500-line canvas, disclosure and labels carry over intact, the old canvas is retained unreferenced, and idleness is structural.</done>
    <confidence>MEDIUM</confidence>
    <complexity>complex</complexity>
    <preconditions>
      - Task 1 completed
    </preconditions>
  </task>

  <task type="auto" n="3">
    <n>Pinned inspector card on river rows — reuse, adapt the anchor</n>
    <files>src/renderer/components/twin/TwinMemoryRiverCanvas.tsx, src/renderer/components/brain-graph/GraphPinnedCard.tsx, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      Wire the EXISTING `GraphPinnedCardLayer` + `TwinMemoryInspector` into the river canvas:
      row click (or Enter/Space) pins the card; clicking another row re-pins; empty-canvas
      click and Esc unpin — mirror whatever the current canvas's unpin grammar is exactly, and
      keep the connector line + dot.

      THE ANCHOR IS THE ROW, NOT THE DOT: anchor the card to the row's full extent — soma x
      through soma x + estimated title width (DETERMINISTIC char-budget estimate; jsdom measures
      nothing). If `AnchoredNode`'s `{x, y, radius}` cannot express that asymmetric extent,
      extend `GraphPinnedCard` ADDITIVELY (optional field or a second anchor helper) so
      `BrainMemoryGraph`'s existing use compiles and behaves unchanged — check its call sites
      before and after.

      Inside the card, `TwinMemoryInspector` is UNTOUCHED: full sentence body, category chip,
      provenance (session link, or plain "a past session"), Forget + undo snackbar, pause
      switch reflection — all already built and tested. Do not fork it.

      Organic touch: pinning gives tactile feedback — the connector line draws in briefly
      (one-shot, reduced-motion gated) rather than appearing, and the attended soma takes its
      brief emphasis from Task 4's vocabulary. The card itself must not animate position while
      open.
    </action>
    <verify>
      Tests: row click pins the card showing the FULL sentence (not the caption); re-pin moves
      it; Esc and empty-canvas click unpin; keyboard-only path — Tab to row, Enter, Tab to
      Forget — works; forget from the card removes the row, drops the lane count, undo restores
      (bloom on restore); provenance renders "a past session" for a deleted source, never an id;
      `BrainMemoryGraph`'s pinned-card tests still green (additive-extension proof). Suite green
      vs baseline; tsc clean.
    </verify>
    <done>Clicking a river row opens the app's own pinned inspector beside that row with the connector attached, every safety-triad affordance works keyboard-only, and the shared card component's other consumer is provably unaffected.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
    <preconditions>
      - Task 2 completed
    </preconditions>
  </task>

  <task type="auto" n="4">
    <n>Category-scoped attention — three levels, pinned persistence, fill-mode hygiene</n>
    <files>src/renderer/components/twin/TwinMemoryRiverCanvas.tsx, src/renderer/components/twin/synapticVisuals.ts, src/renderer/styles/globals.css, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      Implement the mockup's attention model on hover AND focus: attended fact (row, branch,
      terminal) fully lit; its category's anchors (hub, trunk, heading) lit; same-category
      sibling rows+branches at the mid level (~0.55); every other category — rows, titles,
      headings, hubs, trunks — at the dim level (~0.25); the twin core never dims. Export the
      three levels as named constants in synapticVisuals (the mockup's 1 / .55 / .25 are the
      starting values). Fire the existing activation pulse on attend; keep the setTimeout
      clearing discipline.

      A PINNED fact stays attended when the pointer leaves; hovering elsewhere shifts attention
      temporarily and it settles back on the pinned fact (no pulse re-fire on the settle-back).

      Touch feedback: attend briefly emphasises the soma (one-shot transform scale, subtle —
      no persistent fill, so dimming still wins afterwards). Attention level TRANSITIONS ease
      (the ~150ms opacity ease the mockup used) so focus shifts breathe rather than snap —
      note this is a transition on a state change, not idle animation.

      Dimming is state, not motion: it PERSISTS under reduced motion; only the pulse is gated.
      Dimmed rows remain focusable and are never aria-hidden; focus on a dimmed row attends it
      (so keyboard users get the same model).

      FILL-MODE HYGIENE, tested: no animation in the twin canvas leaves a persistent fill that
      overrides the attention opacity — specifically, a node that has EVER bloomed (arrival or
      undo-restore) must still dim correctly afterwards. The mockup caught exactly this bug;
      write the regression test first.
    </action>
    <verify>
      Tests assert computed state via classes/attributes (jsdom computes no styles beyond
      inline/class presence): attended row lit, sibling semi, other-category row+heading+hub
      dim, twin never dims; focus produces the same classes as hover; pinned fact re-lit after
      pointer leaves without a second pulse; post-bloom node dims (regression); reduced motion
      keeps dimming but never the pulse class. Suite green vs baseline; tsc clean; eslint 375/0.
    </verify>
    <done>Attention reads as focus-plus-context exactly as the user approved, keyboard focus gets the identical model, a pinned subject stays lit, and no animation can ever silently defeat the dimming again.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
    <preconditions>
      - Tasks 2 and 3 completed
    </preconditions>
  </task>

  <task type="auto" n="5">
    <n>Live growth under river geometry</n>
    <files>src/renderer/components/twin/TwinMemoryRiverCanvas.tsx, src/renderer/stores/twinMemoryGraphStore.ts, src/renderer/components/twin/__tests__/TwinMemoryGraph.test.tsx</files>
    <action>
      Carry .1 Task 5's arrival grammar into the river: a fact arriving in a COLLAPSED lane
      bumps the hub count and pulses the hub (existing single-slot pulse vocabulary — the
      known multi-category-batch limit stands, recorded not fixed); arriving in an EXPANDED
      lane inserts its row (siblings below shift via the one-shot height/position transition)
      and blooms via `brain-node-enter`. Do NOT auto-expand a lane on arrival. A new category
      inserts a block and shifts the blocks below it — the river analogue of .1's accepted
      non-local caveat; state it, don't fight it.

      The live-sync path (`twin-memory` scope -> debounced store refresh) is untouched; the
      canvas only re-renders from store data. Reduced motion: counts and rows update instantly,
      no pulse, no bloom, no transition.

      After every arrival path the idle-schedules-nothing guarantee must hold (the pulse's
      setTimeout clears; transitions are one-shot).
    </action>
    <verify>
      Tests: collapsed arrival bumps count + applies hub pulse WITHOUT revealing facts; expanded
      arrival inserts the row with the bloom class and correct order; neither auto-expands; new
      category inserts a block (layout stays finite, ordering correct); reduced motion updates
      with zero animation classes; idle window after each path schedules nothing. Suite green vs
      baseline; tsc clean.
    </verify>
    <done>A newly learned fact is visible whether or not its lane is open, nothing yanks the view, reduced motion stays static, and idleness survives every arrival path.</done>
    <confidence>HIGH</confidence>
    <complexity>standard</complexity>
    <preconditions>
      - Tasks 2 and 4 completed
    </preconditions>
  </task>

  <task type="auto" n="6">
    <n>Gates, records, and the (now triple) combined manual smoke</n>
    <files>STATE.md, SUMMARY.md, ROADMAP.md, DECISIONS.md</files>
    <action>
      Final gate. Full suite, `npx tsc --noEmit`, eslint, prettier on touched files —
      SEQUENTIALLY, suite ALONE. Compare against the fresh baseline; eslint must hold with
      `eslint.config.mjs` untouched.

      Audit the diff against every hard constraint above, each with evidence — and verify the
      eight session-Brain files by CONTENT HASH at their REAL paths, not by pathspec diff
      (LEARNINGS.md 2026-08-05 records exactly how that check went vacuous last phase).

      Records: ROADMAP — add TWIN-READ.2; update TWIN-GRAPH.2 and TWIN-READ.1 sections to state
      their gates folded here. DECISIONS.md — APPEND, never rewrite: (a) Riverbank chosen over
      Orbit/Canopy via rendered mockups after the .1 structure was rejected — include that the
      mockup-first round replaced a third blind rebuild, and that the mockup file is the design
      record; (b) deterministic layout supersedes the force simulation on the twin surface
      (simulate-then-freeze -> nothing-to-simulate), d3-force retained for BrainMemoryGraph;
      (c) titles-only rows + click-to-card supersede .1's hover-full-text-on-node, with the
      reuse of GraphPinnedCard/TwinMemoryInspector stated as the reason the card cost almost
      nothing; (d) category-scoped three-level attention, dimming-is-state-not-motion under
      reduced motion; (e) the third fold of the smoke gate, and why (the user's live review of
      .1 WAS the first half of that smoke test).

      Then STOP for the user's manual smoke test — ONE combined gate covering TWIN-GRAPH.2,
      TWIN-READ.1 and TWIN-READ.2. The feel IS the acceptance; a tuning round on row pitch,
      attention levels, cascade stagger or S-curve bend is an expected, non-failure outcome. The
      checklist must cover: opens collapsed and legible; expand/collapse by mouse and keyboard —
      **and does expansion read as GROWTH (branches drawing outward, rows cascading in with the
      springy ease) rather than a mechanical pop? This question is on the checklist by explicit
      user instruction — losing the organic feel fails the phase**; titles readable at 15+ rows;
      card pins beside the row with the connector's draw-in, full sentence, provenance, forget +
      undo, pause switch; category attention on hover and focus, transitions eased not snapping;
      live arrival in collapsed and expanded lanes during a real recording; backfill improves
      titles; reduced motion; shimmer stops when the tab hides; and Task Manager GPU near-zero
      at idle.
    </action>
    <verify>
      All gates green vs baseline; constraint audit with evidence in SUMMARY.md; Brain-8
      content-hash check recorded explicitly; records updated (DECISIONS append-only, verified
      by prefix hash); the combined smoke test requested with its checklist and the outcome
      recorded.
    </verify>
    <done>Gates clean, constraints audited with evidence, records honest about what superseded what and why the gate folded again, and one combined smoke test requested — phase completion blocked on user confirmation.</done>
    <confidence>HIGH</confidence>
    <complexity>simple</complexity>
  </task>
</phase>
