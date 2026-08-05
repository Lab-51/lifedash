// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinMemoryGraph — TwinPage's Memory tab, rendering the RIVERBANK canvas since
// TWIN-READ.2 Task 2 (twin left, category hubs mid, one row per fact right).
// Four things are on trial here, and none of them is decoration:
//
//  1. THE SAFETY TRIAD SURVIVED THE REPLACEMENT, and survived it KEYBOARD-FIRST:
//     provenance ("learned in <session>", "a past session" when the source is
//     gone, never a raw id), one-tap forget with optimistic removal + rollback +
//     a ~5s undo, and the pause-learning kill-switch. Each is exercised through
//     the keyboard, not just the mouse — a forget you can only reach by hovering
//     is a regression. NOT ONE of these tests changed when the canvas was
//     swapped, which is the strongest statement available that the replacement
//     kept the contract.
//  2. PROGRESSIVE DISCLOSURE (TWIN-READ.1 Task 2): the graph OPENS COLLAPSED and
//     a lane's facts are ABSENT FROM THE DOM until its hub is activated — which
//     is why almost every test below has to open a lane before it can touch a
//     fact. That inconvenience IS the feature: an unopened lane costs nothing to
//     read and nothing to lay out.
//  3. THE GROWTH CASCADE (TWIN-READ.2 Task 2) — the user's explicit requirement
//     that the organic feel survive the retirement of the force simulation. It
//     is CSS, so no rAF/timer counter can see it; it is therefore asserted
//     STRUCTURALLY: the classes, the per-row delays, their determinism, and —
//     the trap this phase named in advance — that NOTHING is still animating
//     once the cascade's window has passed.
//  4. IDLENESS IS NOW STRUCTURAL, not enforced. The riverbank's layout is
//     closed-form arithmetic, so there is no frame loop to stop: the settle
//     tests at the bottom assert that requestAnimationFrame is never called AT
//     ALL, which is a stronger claim than the tiered canvas's "it stopped".
//
// TWO ENVIRONMENT FACTS THE ASSERTIONS BELOW DEPEND ON:
//   * d3-timer captures requestAnimationFrame at MODULE LOAD, so a later
//     vi.spyOn cannot see d3's own frames. Here that only strengthens things:
//     this canvas asks for no frames of its own, and the spy proves it.
//   * jsdom implements inline `animation-delay` (verified), which is what lets
//     the cascade's stagger be read back off the elements rather than inferred.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { TwinFact, TwinGraphEdge, TwinGraphNode, TwinMemoryGraph } from '../../../../shared/types';
import { TWIN_LEARNING_PAUSED_SETTING_KEY } from '../../../../shared/types/twin';
import { FACT_RADIUS, TITLE_OFFSET_X } from '../riverLayout';
import { estimatedTitleWidth } from '../riverCanvasModel';

// jsdom's document.visibilityState is a read-only getter fixed at 'visible', so
// the Page Visibility gate on the core shimmer is driven from here. Defined once,
// reset per test — see the shimmer describe for why a CSS animation needs its own
// test at all.
let documentVisibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => documentVisibility,
});

// jsdom has no matchMedia — the reduced-motion hook reads it. Flipped per test.
let prefersReducedMotion = false;
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: prefersReducedMotion,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const twinBuildMemoryGraph = vi.fn();
const twinMemoryForget = vi.fn();
const twinMemoryRestore = vi.fn();
const twinMemoryBackfillLabels = vi.fn();
const setSetting = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('electronAPI', {
  twinBuildMemoryGraph,
  twinMemoryForget,
  twinMemoryRestore,
  twinMemoryBackfillLabels,
  setSetting,
});

const { default: TwinMemoryGraph } = await import('../TwinMemoryGraph');
const { useTwinMemoryGraphStore, NO_ENTERING_NODES, NO_EXPANDED_LANES } =
  await import('../../../stores/twinMemoryGraphStore');
const { useSettingsStore } = await import('../../../stores/settingsStore');

const NOW_ISO = new Date().toISOString();

function core(): TwinGraphNode {
  return {
    id: 'twin',
    type: 'twin',
    tier: 0,
    label: 'You',
    recordId: 'singleton',
    category: null,
    degree: 2,
    newestTimestamp: NOW_ISO,
  };
}

function hub(category: TwinGraphNode['category'], label: string, degree: number): TwinGraphNode {
  return {
    id: `category:${category}`,
    type: 'category',
    tier: 1,
    label,
    recordId: String(category),
    category,
    degree,
    newestTimestamp: NOW_ISO,
  };
}

function fact(
  id: string,
  label: string,
  category: TwinGraphNode['category'],
  source: { id: string | null; title: string | null },
): TwinGraphNode {
  return {
    id: `fact:${id}`,
    type: 'fact',
    tier: 2,
    label,
    recordId: id,
    category,
    degree: 1,
    newestTimestamp: NOW_ISO,
    sourceMeetingId: source.id,
    sourceMeetingTitle: source.title,
  };
}

/** Twin -> two populated hubs -> three facts. One fact keeps its source session,
 *  one has lost it (the SET NULL case), one lives in the other lane. */
function graphFixture(droppedCount = 0): TwinMemoryGraph {
  const nodes: TwinGraphNode[] = [
    core(),
    hub('preference', 'Preference', 3),
    hub('person', 'Person', 2),
    fact('f1', 'Prefers async updates over meetings', 'preference', { id: 'meeting-1', title: 'Weekly Sync' }),
    fact('f2', 'Reviews PRs before standup', 'preference', { id: null, title: null }),
    fact('f3', 'Ada leads the platform team', 'person', { id: 'meeting-2', title: 'Kickoff' }),
  ];
  const edges: TwinGraphEdge[] = [
    { fromId: 'twin', toId: 'category:preference', kind: 'twin-hub' },
    { fromId: 'twin', toId: 'category:person', kind: 'twin-hub' },
    { fromId: 'category:preference', toId: 'fact:f1', kind: 'hub-fact' },
    { fromId: 'category:preference', toId: 'fact:f2', kind: 'hub-fact' },
    { fromId: 'category:person', toId: 'fact:f3', kind: 'hub-fact' },
  ];
  return { nodes, edges, droppedCount };
}

/** graphFixture() plus one new fact in the ALREADY-POPULATED 'preference' lane —
 *  the common live-growth case: no new category, so it stays lane-local. */
function grownFixture(): TwinMemoryGraph {
  const base = graphFixture();
  const newFact = fact('f4', 'Ships weekly release notes', 'preference', { id: 'meeting-3', title: 'Retro' });
  return {
    ...base,
    nodes: [...base.nodes, newFact],
    edges: [...base.edges, { fromId: 'category:preference', toId: 'fact:f4', kind: 'hub-fact' }],
  };
}

/** graphFixture() plus a BRAND NEW category — one this graph never had a hub
 *  for before. The river's "a new category inserts a block" case: pure
 *  arithmetic (computeRiverLayout has no notion of "before"), so what this
 *  fixture exercises is the CANVAS's arrival grammar around it — collapsed by
 *  default, never auto-expanded, canonically ordered among the lanes that
 *  were already there. 'project' is chosen deliberately, not 'commitment':
 *  CATEGORY_LANE_ORDER sorts it BETWEEN 'person' and 'preference', so it
 *  proves the block actually gets INSERTED (shifting 'preference' down), not
 *  merely appended after everything that was already there. */
function newCategoryFixture(): TwinMemoryGraph {
  const base = graphFixture();
  const newHub = hub('project', 'Project', 1);
  const newFact = fact('f5', 'Ship the v3 release notes', 'project', { id: 'meeting-4', title: 'Planning' });
  return {
    ...base,
    nodes: [...base.nodes, newHub, newFact],
    edges: [
      ...base.edges,
      { fromId: 'twin', toId: 'category:project', kind: 'twin-hub' },
      { fromId: 'category:project', toId: 'fact:f5', kind: 'hub-fact' },
    ],
  };
}

/** A real fact sentence — the thing the old renderer chopped at 34 characters. */
const LONG_FACT = 'Prefers async written updates over status meetings, especially before 10am';

/** One lane holding both label paths: a properly labelled fact whose full text is
 *  far longer than its caption, and a fact with NO stored label at all (a
 *  pre-migration row, or one the model declined to label). */
function labelFixture(): TwinMemoryGraph {
  const labelled: TwinGraphNode = {
    ...fact('L1', 'Async updates', 'preference', { id: 'meeting-1', title: 'Weekly Sync' }),
    text: LONG_FACT,
  };
  const unlabelled: TwinGraphNode = {
    ...fact('L2', '', 'preference', { id: null, title: null }),
    text: 'The Q3 pricing decision was deferred to the board meeting',
  };
  return {
    nodes: [core(), hub('preference', 'Preference', 3), labelled, unlabelled],
    edges: [
      { fromId: 'twin', toId: 'category:preference', kind: 'twin-hub' },
      { fromId: 'category:preference', toId: 'fact:L1', kind: 'hub-fact' },
      { fromId: 'category:preference', toId: 'fact:L2', kind: 'hub-fact' },
    ],
    droppedCount: 0,
  };
}

/** Load a graph. The app opens every lane COLLAPSED, so this alone renders the
 *  twin core and the hubs and NOTHING else. */
function seed(graph: TwinMemoryGraph = graphFixture()): void {
  useTwinMemoryGraphStore.getState().setGraph(graph);
}

/** Load a graph with both populated lanes already open — what a test that is
 *  about facts rather than about disclosure needs. */
function seedOpen(graph: TwinMemoryGraph = graphFixture()): void {
  seed(graph);
  useTwinMemoryGraphStore.getState().toggleLane('preference');
  useTwinMemoryGraphStore.getState().toggleLane('person');
}

function nodeEl(id: string): Element {
  const el = document.querySelector(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`no node element for ${id}`);
  return el;
}

/** The hub that discloses a lane, by its lane key. */
function hubEl(category: string): Element {
  return nodeEl(`category:${category}`);
}

/** A node's caption element. Throws rather than returning null, so "the label is
 *  missing" fails as loudly as "the label is wrong". */
function labelEl(id: string): Element {
  const el = nodeEl(id).querySelector('text');
  if (!el) throw new Error(`no label element for ${id}`);
  return el;
}

/** The caption's wrapped lines, in order — SVG has no wrapping, so each line is
 *  its own <tspan> and the line breaks are directly assertable. Only the twin
 *  core wears a wrapped caption on this canvas; a ROW's title is one line (see
 *  titleOf). */
function labelLinesOf(id: string): string[] {
  return [...labelEl(id).querySelectorAll('tspan')].map((t) => t.textContent ?? '');
}

/** The caption's lines rejoined — what the user actually reads. */
function labelTextOf(id: string): string {
  return labelLinesOf(id).join(' ');
}

/** A ROW's title. One line of an already-capped label, so it is plain text
 *  rather than wrapped tspans — and it is the SHORT caption, always: on this
 *  canvas the full sentence lives in the card, never on the row. */
function titleOf(id: string): string {
  const el = nodeEl(id).querySelector('[data-row-title]');
  if (!el) throw new Error(`no row title for ${id}`);
  return el.textContent ?? '';
}

/** A lane's heading — the chrome beside its hub ("Preferences · 2"). */
function laneHeadingEl(category: string): Element {
  const el = document.querySelector(`[data-lane-region="${category}"]`);
  if (!el) throw new Error(`no lane heading for ${category}`);
  return el;
}

/** A node's positioning transform, as written. */
function rowTransform(id: string): string {
  return nodeEl(id).getAttribute('transform') ?? '';
}

// ---------------------------------------------------------------------------
// Helpers for TWIN-READ.2 Task 4 — category-scoped attention. Opacity is read
// as a plain numeric ATTRIBUTE, never a computed style (jsdom computes none).
// ---------------------------------------------------------------------------

/** Any element's `opacity` ATTRIBUTE, as a number. */
function opacityOf(el: Element): number {
  return Number(el.getAttribute('opacity'));
}

/** A row/hub's own attention opacity — absent (null) on the twin core, which
 *  never carries the attribute at all. */
function attentionOf(id: string): number {
  return opacityOf(nodeEl(id));
}

/** The wrapping `<g data-dendrite>` for a connection ending at `toId` — the
 *  element attention opacity is set on, one level out from the `<path
 *  data-edge-key>` a kind/direction selector finds. */
function dendriteGroupFor(kind: 'twin-hub' | 'hub-fact', toId: string): Element {
  const path = [...document.querySelectorAll(`[data-kind="${kind}"]`)].find((el) =>
    el.getAttribute('data-edge-key')?.endsWith(`>${toId}`),
  );
  if (!path) throw new Error(`no ${kind} edge ending at ${toId}`);
  const group = path.closest('[data-dendrite]');
  if (!group) throw new Error(`no dendrite group for ${toId}`);
  return group;
}

/** A category's trunk (twin -> hub) connection group. */
function trunkGroupFor(category: string): Element {
  return dendriteGroupFor('twin-hub', `category:${category}`);
}

/** A fact's own branch (hub -> fact) connection group. */
function branchGroupFor(factId: string): Element {
  return dendriteGroupFor('hub-fact', factId);
}

/** A row/hub's own animation slot — the outer `[data-node-id]` control's
 *  direct-child `<g>`, which owns bloom XOR growth XOR (nested one level
 *  further) the attend-tap. Never the element attention opacity is set on. */
function animationSlotOf(id: string): Element | null {
  return nodeEl(id).querySelector('g');
}

/** `active` mirrors TwinPage: the Memory tab stays MOUNTED while the Profile tab
 *  is showing (the badge counts from there), so "not active" is a real state the
 *  component has to handle, not a synonym for unmounted. */
function renderGraph(onCountChange?: (n: number) => void, active = true) {
  return render(
    <MemoryRouter>
      <TwinMemoryGraph onCountChange={onCountChange} active={active} />
    </MemoryRouter>,
  );
}

/** Flip the window's visibility and deliver the native event the hook listens
 *  for. Wrapped in act() because it lands as a React state update. */
function setWindowHidden(hidden: boolean): void {
  documentVisibility = hidden ? 'hidden' : 'visible';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** A restored/forgotten fact row, as the memory channels return it. */
function twinFact(overrides: Partial<TwinFact> = {}): TwinFact {
  return {
    id: 'f1',
    fact: 'Prefers async updates over meetings',
    label: null,
    category: 'preference',
    sourceMeetingId: 'meeting-1',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Tab until `target` holds focus, so the assertion is about REACHABILITY rather
 *  than a brittle exact tab count. Throws if it is not reachable at all. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: Element, max = 8): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  if (document.activeElement !== target) throw new Error('target was never reached by keyboard');
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  prefersReducedMotion = false;
  documentVisibility = 'visible';
  twinBuildMemoryGraph.mockResolvedValue(graphFixture());
  twinMemoryBackfillLabels.mockResolvedValue({ status: 'ok', labeled: 0, remaining: 0 });
  useTwinMemoryGraphStore.setState({
    graph: null,
    entering: NO_ENTERING_NODES,
    expandedLanes: NO_EXPANDED_LANES,
  });
  useSettingsStore.setState({ settings: {} } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TwinMemoryGraph — riverbank structure (legible, not decorative)', () => {
  it('renders one element per VISIBLE node, one path per edge, and tags every node with its tier and lane', () => {
    seedOpen();
    renderGraph();

    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(6);
    // Two trunks (twin -> each hub) and one branch per disclosed row.
    expect(document.querySelectorAll('[data-edge-key]')).toHaveLength(5);
    expect(nodeEl('twin')).toHaveAttribute('data-tier', '0');
    expect(nodeEl('category:preference')).toHaveAttribute('data-tier', '1');
    expect(nodeEl('fact:f1')).toHaveAttribute('data-tier', '2');
    expect(nodeEl('fact:f1')).toHaveAttribute('data-category', 'preference');
    expect(nodeEl('fact:f3')).toHaveAttribute('data-category', 'person');
  });

  it('heads every POPULATED lane beside its hub — the structure you navigate, drawn while collapsed', () => {
    seed();
    renderGraph();

    // One heading per populated lane, canonical order, no empty lanes. Present
    // while COLLAPSED: the structure is what you navigate, so it is never hidden.
    const lanes = [...document.querySelectorAll('[data-lane-region]')].map((el) => el.getAttribute('data-lane-region'));
    expect(lanes).toEqual(['person', 'preference']);
    expect(laneHeadingEl('person')).toHaveTextContent('People · 1');
    expect(laneHeadingEl('preference')).toHaveTextContent('Preferences · 2');
    // The heading is scenery; the hub beside it carries the accessible name, so
    // the count is never announced twice.
    expect(laneHeadingEl('preference')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lays every row out on its OWN line, inside its own lane, at one row pitch', () => {
    seedOpen();
    renderGraph();

    // The whole point of the riverbank: collisions are impossible by
    // construction. Two facts in one lane sit exactly ROW_PITCH apart, in the
    // same column, and the other lane's row is nowhere near either of them.
    const y = (id: string): number => Number(/translate\(([-\d.]+),([-\d.]+)\)/.exec(rowTransform(id))![2]);
    const x = (id: string): number => Number(/translate\(([-\d.]+),([-\d.]+)\)/.exec(rowTransform(id))![1]);
    expect(y('fact:f2') - y('fact:f1')).toBe(30);
    expect(x('fact:f1')).toBe(x('fact:f2'));
    expect(x('fact:f3')).toBe(x('fact:f1')); // one fact column for the whole river
    expect(Math.abs(y('fact:f3') - y('fact:f1'))).toBeGreaterThan(30);
  });

  it('positions every node at a finite coordinate (a NaN would blank the canvas)', () => {
    seedOpen();
    renderGraph();

    for (const el of document.querySelectorAll('[data-node-id]')) {
      const transform = el.getAttribute('transform') ?? '';
      const match = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(transform);
      expect(match, `bad transform: ${transform}`).not.toBeNull();
      expect(Number.isFinite(Number(match![1]))).toBe(true);
      expect(Number.isFinite(Number(match![2]))).toBe(true);
    }
  });

  it('renders the honest "+N not shown" indicator when the main-side cap dropped facts', () => {
    seed(graphFixture(7));
    renderGraph();
    expect(screen.getByTestId('twin-memory-graph-dropped')).toHaveTextContent('+7 not shown');
  });

  it('shows the empty-state explainer, not an empty canvas, when nothing has been learned', () => {
    seed({ nodes: [core()], edges: [], droppedCount: 0 });
    renderGraph();

    expect(screen.getByText('No facts learned yet')).toBeInTheDocument();
    expect(screen.queryByTestId('twin-memory-graph-canvas')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.1 Task 2 — PROGRESSIVE DISCLOSURE. The user's report was that the
// graph "will be literally unreadable when there will be so much more
// elements". The fix is not a zoom threshold: a collapsed lane's facts are not
// in the DOM and not in the simulation, so readability is bounded by
// construction rather than tuned.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — progressive disclosure', () => {
  it('opens COLLAPSED — the core and its hubs, no facts at all, and every lane says what it holds', () => {
    seed();
    renderGraph();

    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-node-type="fact"]')).toHaveLength(0);
    expect(document.querySelector('[data-node-id="fact:f1"]')).toBeNull();

    // The counts are the honest, FULL counts — a collapsed lane must not report
    // 0 just because nothing of it is drawn.
    expect(screen.getByRole('button', { name: 'Category: Preferences, 2 learned facts' })).toBe(hubEl('preference'));
    expect(screen.getByRole('button', { name: 'Category: People, 1 learned fact' })).toBe(hubEl('person'));
    expect(screen.getByText('Preferences').textContent).toBe('Preferences · 2');
    expect(screen.getByText('People').textContent).toBe('People · 1');
  });

  it('marks every hub as a collapsed disclosure control', () => {
    seed();
    renderGraph();

    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'false');
    expect(hubEl('person')).toHaveAttribute('aria-expanded', 'false');
    // Nodes that disclose nothing must not claim to.
    expect(nodeEl('twin')).not.toHaveAttribute('aria-expanded');
  });

  it('clicking a hub reveals ITS facts and only its facts', () => {
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));

    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    expect(document.querySelector('[data-node-id="fact:f2"]')).not.toBeNull();
    // The other lane stayed shut — this is disclosure, not "show everything".
    expect(document.querySelector('[data-node-id="fact:f3"]')).toBeNull();
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'true');
    expect(hubEl('person')).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking the same hub again collapses it', () => {
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));
    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();

    fireEvent.click(hubEl('preference'));

    expect(document.querySelector('[data-node-id="fact:f1"]')).toBeNull();
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a second lane WITHOUT closing the first — lanes are navigation, not an accordion', () => {
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));
    fireEvent.click(hubEl('person'));

    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    expect(document.querySelector('[data-node-id="fact:f3"]')).not.toBeNull();
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'true');
    expect(hubEl('person')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a hub is a disclosure control, not a record — activating it never opens the inspector', () => {
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));

    expect(screen.queryByTestId('twin-memory-inspector')).toBeNull();
  });

  it('keeps the lanes the user opened across a refresh AND a live update', async () => {
    seed();
    renderGraph();
    fireEvent.click(hubEl('preference'));

    // A live update lands (a new fact in the open lane) — the disclosure state
    // lives in the store, so it is not collateral damage of a graph replacement.
    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    expect(document.querySelector('[data-node-id="fact:f4"]')).not.toBeNull();
    // ...and the lane the user never opened is still shut.
    expect(document.querySelector('[data-node-id="fact:f3"]')).toBeNull();
  });

  it('a fact arriving in a COLLAPSED lane stays out of the DOM but bumps that lane’s count', async () => {
    seed();
    renderGraph();
    expect(screen.getByRole('button', { name: 'Category: Preferences, 2 learned facts' })).toBeInTheDocument();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect(document.querySelector('[data-node-id="fact:f4"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Category: Preferences, 3 learned facts' })).toBe(hubEl('preference'));
    expect(screen.getByText('Preferences').textContent).toBe('Preferences · 3');
  });

  it('expansion needs NO frame loop — the layout is arithmetic, so it is settled the instant it renders', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seed();
    renderGraph();

    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');
    fireEvent.click(hubEl('preference'));
    // The revealed rows are already at their final positions: there is nothing
    // to simulate, so "settled" never flips.
    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');

    // ...and the growth that DOES play is CSS, so it schedules no frame at all.
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('reduced motion: a lane opens instantly, with no animation frame at all', () => {
    prefersReducedMotion = true;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));

    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.2 Task 2 — THE GROWTH CASCADE. The user's requirement, verbatim:
// *"make sure we keep the organic feel in terms of animation, clicks etc. Don't
// want to lose that."* Retiring the force simulation deleted the settle motion
// that used to supply it, so a lane's contents GROW rather than appear.
//
// >>> WHY THESE ASSERTIONS ARE STRUCTURAL. <<< The cascade is CSS: it schedules
// neither requestAnimationFrame nor setInterval, so the idleness tests at the
// bottom of this file pass straight THROUGH it without noticing — the same
// blindness that forced the core shimmer to have its own gate tests. What can be
// asserted, and is, is everything that would actually break: the classes exist,
// the per-row delays increase downstream, the same lane cascades identically
// every time, a collapse carries none of the stagger, and — the trap this phase
// named in advance — NOTHING is left animating once the window has passed. A
// lingering `forwards`/`both` fill would pin opacity forever and silently defeat
// the attention dimming that lands on top of it later.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — the growth cascade (the organic requirement)', () => {
  /** Elements currently carrying a cascade class, in DOM order. */
  function growing(className: string): Element[] {
    return [...document.querySelectorAll(`.${className}`)];
  }

  /** Each element's animation delay in ms — the stagger, read back off the DOM
   *  rather than inferred (jsdom does implement inline animation-delay). */
  function delaysOf(elements: Element[]): number[] {
    return elements.map((el) => Number.parseFloat((el as SVGElement).style.animationDelay || '0'));
  }

  it('a lane GROWS open: every row and its own branch carry the cascade, staggered downstream', () => {
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));

    const rows = growing('twin-river-row-grow');
    const branches = growing('twin-river-branch-grow');
    expect(rows).toHaveLength(2);
    expect(branches).toHaveLength(2); // one per revealed row — the trunk never cascades

    const rowDelays = delaysOf(rows);
    expect(rowDelays[0]).toBeGreaterThanOrEqual(0);
    // STRICTLY increasing: the jitter is a fraction of the pitch precisely so a
    // cascade can never read as a shuffle.
    expect(rowDelays[1]).toBeGreaterThan(rowDelays[0]);
    // A branch grows WITH the row it carries — same delay, same order — so the
    // row lands on a ribbon that has already arrived.
    expect(delaysOf(branches)).toEqual(rowDelays);
    // Only the lane that opened grows: the shut one contributes nothing at all.
    expect(document.querySelector('[data-node-id="fact:f3"]')).toBeNull();
  });

  it('is DETERMINISTIC — the same lane, reopened, cascades with exactly the same delays', () => {
    vi.useFakeTimers();
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));
    const first = delaysOf(growing('twin-river-row-grow'));
    expect(first).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(3000); // let it finish and clear
    });
    fireEvent.click(hubEl('preference')); // collapse
    fireEvent.click(hubEl('preference')); // ...and grow it again

    // Same input, same motion. The jitter is an id hash, never Math.random —
    // which is what makes this assertion possible to write at all.
    expect(delaysOf(growing('twin-river-row-grow'))).toEqual(first);
  });

  it('leaves NOTHING animating behind it — after the window every cascade class is gone', () => {
    vi.useFakeTimers();
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));
    expect(growing('twin-river-row-grow').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // THE NAMED TRAP OF THIS PHASE. An animation that outlived its window would
    // pin its final value forever and beat every normal declaration — which is
    // exactly how an enter animation silently defeats attention dimming.
    expect(growing('twin-river-row-grow')).toHaveLength(0);
    expect(growing('twin-river-branch-grow')).toHaveLength(0);
    expect(growing('twin-river-tap')).toHaveLength(0);
    // ...and the rows are still there, carrying no inline animation either.
    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    for (const el of document.querySelectorAll('[data-node-id] > g')) {
      expect(el.getAttribute('style')).toBeFalsy();
    }
  });

  it('COLLAPSE reverses faster and un-staggered — the toggled hub taps, and that is all', () => {
    vi.useFakeTimers();
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(hubEl('preference'));

    // A collapsing lane's rows leave the DOM outright (that is what makes cost
    // scale with what is open), so there is nothing left to stagger out.
    expect(growing('twin-river-row-grow')).toHaveLength(0);
    expect(growing('twin-river-branch-grow')).toHaveLength(0);
    // What the click DOES get is its tactile answer, on the hub itself.
    expect(hubEl('preference').querySelector('.twin-river-tap')).not.toBeNull();
    expect(growing('twin-river-tap')).toHaveLength(1);
  });

  it('the first render of an ALREADY-OPEN lane plays the cascade once — arriving is a growth too', () => {
    seedOpen();
    renderGraph();

    // The mount settle: three rows across two lanes, all growing.
    expect(growing('twin-river-row-grow')).toHaveLength(3);
    expect(growing('twin-river-branch-grow')).toHaveLength(3);
    // ...and no hub taps, because nothing was clicked.
    expect(growing('twin-river-tap')).toHaveLength(0);
  });

  it('reduced motion: a lane opens INSTANTLY — no cascade class, no delay, nothing scheduled', () => {
    prefersReducedMotion = true;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference'));

    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull(); // it did open
    expect(growing('twin-river-row-grow')).toHaveLength(0);
    expect(growing('twin-river-branch-grow')).toHaveLength(0);
    expect(growing('twin-river-tap')).toHaveLength(0);
    for (const el of document.querySelectorAll('[data-node-id] > g')) {
      expect(el.getAttribute('style')).toBeFalsy();
    }
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ROW TITLES (TWIN-READ.1 Task 3's stored labels, TWIN-READ.2's placement). The
// report that started .1 named the text directly: "it's still pretty bad with
// the text being as it is". The root error was treating a fact as a label —
// `twinFacts.fact` is a SENTENCE, chopped at 34 characters onto one unwrappable
// line. The riverbank finishes the fix: the row wears the SHORT stored label on
// its own line beside its soma, and the full sentence lives in the card, one
// CLICK away — .1's hover-swaps-to-full-text is retired on this surface,
// because a caption that grew on hover would push its neighbours around.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — row titles', () => {
  it('titles a row with its SHORT stored label, not a slice of the sentence', () => {
    seedOpen(labelFixture());
    renderGraph();

    expect(titleOf('fact:L1')).toBe('Async updates');
    // The retired behaviour, named so a regression is unmistakable: the first 33
    // characters of the sentence plus an ellipsis.
    expect(titleOf('fact:L1')).not.toContain('…');
    expect(titleOf('fact:L1')).not.toContain(LONG_FACT.slice(0, 33));
  });

  it('the row is ONE control — soma and title together, named by the FULL sentence', () => {
    seedOpen(labelFixture());
    renderGraph();

    const row = nodeEl('fact:L1');
    // One control, not two: the title and the soma live inside the same
    // role="button", and a hit target spans the row so the pointer never has to
    // find a 5px disc.
    expect(row).toHaveAttribute('role', 'button');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row.querySelector('[data-row-title]')).not.toBeNull();
    expect(row.querySelector('[data-soma-core]')).not.toBeNull();
    expect(row.querySelector('[data-row-hit]')).not.toBeNull();
    expect(screen.getByRole('button', { name: `Learned fact: ${LONG_FACT}` })).toBe(row);
    // The row's own title stays SHORT — the full sentence is the accessible
    // name and the card's job, never the canvas's.
    expect(row).toHaveTextContent('Async updates');
  });

  it('CLICK is the reveal, not hover — a row title never swaps under the pointer', () => {
    seedOpen(labelFixture());
    renderGraph();

    fireEvent.mouseEnter(nodeEl('fact:L1'));
    expect(titleOf('fact:L1')).toBe('Async updates');
    fireEvent.mouseLeave(nodeEl('fact:L1'));
    expect(titleOf('fact:L1')).toBe('Async updates');

    // TWIN-READ.2 decision 2, in one assertion: the sentence is revealed by
    // opening the card, and a row that grew or shrank on hover would push its
    // neighbours around — the collision this layout exists to make impossible.
    fireEvent.click(nodeEl('fact:L1'));
    expect(titleOf('fact:L1')).toBe('Async updates');
    expect(within(screen.getByTestId('twin-memory-inspector')).getByText(LONG_FACT)).toBeInTheDocument();
  });

  it('keyboard focus does not swap the title either — parity with the pointer, both ways', async () => {
    const user = userEvent.setup();
    seedOpen(labelFixture());
    renderGraph();

    await tabTo(user, nodeEl('fact:L1'), 12);

    expect(titleOf('fact:L1')).toBe('Async updates');
    // ...and the whole sentence is what a screen reader is given, focused or not.
    expect(nodeEl('fact:L1')).toHaveAttribute('aria-label', `Learned fact: ${LONG_FACT}`);
  });

  it('renders the DERIVED fallback for an unlabelled fact — never a blank row', () => {
    seedOpen(labelFixture());
    renderGraph();

    // Straight from the shared labelFor() accessor, not a second derivation here.
    expect(titleOf('fact:L2')).toBe('The Q3 pricing decision…');
    expect(titleOf('fact:L2').trim().length).toBeGreaterThan(0);
    // ...and the whole sentence is still one click away.
    fireEvent.click(nodeEl('fact:L2'));
    expect(
      within(screen.getByTestId('twin-memory-inspector')).getByText(
        'The Q3 pricing decision was deferred to the board meeting',
      ),
    ).toBeInTheDocument();
  });

  it('haloes every caption with the NATIVE paint-order knockout, so text survives crossing a ribbon', () => {
    seedOpen(labelFixture());
    renderGraph();

    const captions: SVGElement[] = [
      labelEl('twin') as SVGElement,
      laneHeadingEl('preference') as SVGElement,
      nodeEl('fact:L1').querySelector('[data-row-title]') as SVGElement,
      nodeEl('fact:L2').querySelector('[data-row-title]') as SVGElement,
    ];
    for (const el of captions) {
      expect(el.style.getPropertyValue('paint-order')).toBe('stroke');
      expect(el.getAttribute('stroke')).toBe('var(--color-chrome)');
      expect(Number(el.getAttribute('stroke-width'))).toBeGreaterThan(0);
    }
  });

  it('keeps STRUCTURE captioned while everything is collapsed — it is what you navigate by', () => {
    seed(labelFixture()); // collapsed: the core and its hub, nothing else
    renderGraph();

    expect(labelTextOf('twin')).toBe('You');
    expect(laneHeadingEl('preference')).toHaveTextContent('Preferences · 2');
    // No zoom threshold is involved any more — zoom is not an input to what is
    // captioned. Disclosure is: a collapsed lane shows its heading and count and
    // no row titles at all, because it has no rows.
    expect(document.querySelectorAll('[data-row-title]')).toHaveLength(0);
  });

  it('a title is INSTANT — hovering a row schedules no frame at all', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seedOpen(labelFixture());
    renderGraph();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    fireEvent.mouseEnter(nodeEl('fact:L1'));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.1 Task 4 — THE SYNAPTIC VISUAL LANGUAGE. What is on trial here is
// not "does it look nice" (jsdom paints nothing and computes no layout, so no
// test can claim that). It is the set of structural facts the look is built
// from, each of which a refactor could quietly undo:
//
//   * a dendrite is a FILLED, CLOSED, TAPERED outline — not a stroke. The taper
//     itself is measured in synapticVisuals.test.ts, where the path math lives;
//     here we prove the renderer actually emits that shape and fills it.
//   * every connection ends in a synaptic terminal, and every node is a soma.
//   * the activation pulse is one-shot: it APPEARS on touch and is GONE after.
//   * a collapsed lane recedes, and doing so never dims a control.
//   * THE CORE SHIMMER — the phase's one sanctioned exception to zero-idle-GPU.
//
// >>> WHY THE SHIMMER NEEDS ITS OWN TESTS AT ALL. <<< A CSS animation schedules
// neither requestAnimationFrame nor setInterval, so the settle-discipline test
// at the bottom of this file — which is exactly those two counters — passes
// straight THROUGH a permanently animating element without noticing it. The
// supersession is deliberate and scoped (one node, three gates), so it is proved
// deliberately: present when it should be, and absent on each gate in turn.
// Class names below are written as literals on purpose: the assertion that
// matters is that the renderer and globals.css agree on the same string.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — synaptic visual language', () => {
  it('gives the graph its own DARK surface — in the light theme exactly as in the dark one', () => {
    seedOpen();
    const { unmount } = renderGraph();
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveClass('twin-graph-surface');
    unmount();

    // The app's light theme is html.light (+ design-modern for the palette). The
    // canvas keeps its own surface either way — glow and gradients only read on
    // dark, and the class re-pins the dark palette for its whole subtree so the
    // captions inside stay legible rather than inheriting the page's light ink.
    document.documentElement.classList.add('light', 'design-modern');
    try {
      seedOpen();
      renderGraph();
      expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveClass('twin-graph-surface');
    } finally {
      document.documentElement.classList.remove('light', 'design-modern');
    }
  });

  it('draws every connection as a FILLED river-delta S-curve, not a uniform stroke', () => {
    seedOpen();
    renderGraph();

    const dendrites = [...document.querySelectorAll('[data-edge-key]')];
    expect(dendrites).toHaveLength(5);
    for (const el of dendrites) {
      // Filled with its gradient and explicitly NOT stroked: the taper is in the
      // outline, so a stroke width would be the old diagram look creeping back.
      expect(el.getAttribute('fill')).toMatch(/^url\(#twin-river-dendrite-/);
      expect(el.getAttribute('stroke')).toBe('none');
      expect(el.getAttribute('stroke-width')).toBeNull();

      const d = el.getAttribute('d') ?? '';
      expect(d).not.toContain('NaN'); // a NaN would silently void the path
      expect(d.endsWith('Z')).toBe(true); // closed: it encloses an area to fill
      // TWO CUBICS, not the tiered ribbon's two quadratics: horizontal tangents
      // at both ends are what stop a horizontal run bowing up and over — the
      // shape the user rejected on sight in the TWIN-READ.1 render.
      expect((d.match(/C/g) ?? []).length).toBe(2);
      expect(d).not.toContain('Q');
    }
  });

  it('paints each connection with a LEFT-TO-RIGHT parent-hue → child-hue gradient', () => {
    seedOpen();
    renderGraph();

    const hubToFact = document.getElementById('twin-river-dendrite-hub-fact');
    expect(hubToFact).not.toBeNull();
    // The river flows left to right, so its two shared defs do too — one def per
    // KIND still renders exactly what one per edge would.
    expect(hubToFact).toHaveAttribute('x1', '0');
    expect(hubToFact).toHaveAttribute('x2', '1');
    expect(hubToFact).toHaveAttribute('y1', '0');
    expect(hubToFact).toHaveAttribute('y2', '0');
    const stops = [...hubToFact!.querySelectorAll('stop')];
    expect(stops).toHaveLength(2);
    expect(stops[0].getAttribute('stop-color')).toBe('var(--color-primary-300)'); // the hub's hue
    expect(stops[1].getAttribute('stop-color')).toBe('var(--color-warm)'); // the fact's hue
    // Direction without motion: it firms up as it arrives.
    expect(Number(stops[0].getAttribute('stop-opacity'))).toBeLessThan(Number(stops[1].getAttribute('stop-opacity')));

    expect(document.getElementById('twin-river-dendrite-twin-hub')).not.toBeNull();
  });

  it('terminates every FACT branch in a synaptic dot — and a trunk in none', () => {
    seedOpen();
    renderGraph();

    const terminals = [...document.querySelectorAll('[data-terminal-for]')];
    // One per disclosed row, and none on the two trunks: a trunk ends at a hub
    // that is already a control carrying its own count, and a dot there would
    // read as a second, unclickable affordance.
    expect(terminals).toHaveLength(3);
    for (const dot of terminals) {
      expect(Number.isFinite(Number(dot.getAttribute('cx')))).toBe(true);
      expect(Number.isFinite(Number(dot.getAttribute('cy')))).toBe(true);
      expect(Number(dot.getAttribute('r'))).toBeGreaterThan(0);
    }
    const branchKeys = [...document.querySelectorAll('[data-edge-key][data-kind="hub-fact"]')].map((el) =>
      el.getAttribute('data-edge-key'),
    );
    expect(terminals.map((el) => el.getAttribute('data-terminal-for'))).toEqual(branchKeys);
    expect(document.querySelectorAll('[data-edge-key][data-kind="twin-hub"]')).toHaveLength(2);
  });

  it('draws every node as a soma — a filled core inside two concentric low-alpha rings', () => {
    seedOpen();
    renderGraph();

    for (const id of ['twin', 'category:preference', 'fact:f1']) {
      const rings = [...nodeEl(id).querySelectorAll('[data-soma-ring]')];
      expect(rings.map((ring) => ring.getAttribute('data-soma-ring'))).toEqual(['outer', 'inner']);
      // Low alpha is what makes layered discs read as a glow instead of a target
      // — and it is why no per-node feGaussianBlur is needed.
      for (const ring of rings) expect(Number(ring.getAttribute('opacity'))).toBeLessThan(0.4);
      expect(nodeEl(id).querySelector('[data-soma-core]')).not.toBeNull();
    }
  });

  it('brightens a node’s rings when the user attends to it', () => {
    seedOpen();
    renderGraph();

    const ringOpacity = (): number =>
      Number(nodeEl('fact:f1').querySelector('[data-soma-ring]')?.getAttribute('opacity'));
    const atRest = ringOpacity();

    fireEvent.mouseEnter(nodeEl('fact:f1'));

    expect(ringOpacity()).toBeGreaterThan(atRest);
  });

  it('fires a ONE-SHOT activation pulse outward along a touched node’s connections, then removes it', () => {
    vi.useFakeTimers();
    seedOpen();
    renderGraph();
    act(() => {
      vi.advanceTimersByTime(8000); // settle first — a pulse is not the settle
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);

    fireEvent.mouseEnter(hubEl('preference'));

    // Its three connections and no others: twin -> preference, and the two facts.
    const pulsed = [...document.querySelectorAll('[data-pulse-for]')];
    expect(pulsed).toHaveLength(3);
    for (const el of pulsed) expect(el).toHaveClass('twin-dendrite-pulse');
    // OUTWARD from what was touched: the connection the hub OWNS plays forward,
    // the one it RECEIVES plays reversed. A highlight converging on the node you
    // just touched would read as the graph answering back, not as activation.
    const directions = Object.fromEntries(
      pulsed.map((el) => [el.getAttribute('data-pulse-for'), el.getAttribute('data-pulse-direction')]),
    );
    expect(Object.values(directions).filter((d) => d === 'forward')).toHaveLength(2);
    expect(Object.values(directions).filter((d) => d === 'reverse')).toHaveLength(1);

    // ...and it is GONE afterwards. An animation class that outlived its
    // animation would be a permanent GPU tenant — the one thing this canvas
    // must never leave behind.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);
  });

  it('pulses on keyboard activation too — the feedback is not pointer-only', () => {
    vi.useFakeTimers();
    seedOpen();
    renderGraph();

    fireEvent.keyDown(nodeEl('fact:f1'), { key: 'Enter' });

    expect(document.querySelectorAll('[data-pulse-for]').length).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);
  });

  it('reduced motion: touching a node fires no pulse at all', () => {
    prefersReducedMotion = true;
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(hubEl('preference'));

    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);
  });

  it('attenuates a COLLAPSED lane and brings the opened one forward', () => {
    seed();
    renderGraph();

    const region = (key: string): Element => {
      const el = document.querySelector(`[data-lane-region="${key}"]`);
      if (!el) throw new Error(`no lane region for ${key}`);
      return el;
    };

    expect(Number(region('preference').getAttribute('opacity'))).toBeCloseTo(0.35);
    expect(Number(region('person').getAttribute('opacity'))).toBeCloseTo(0.35);

    fireEvent.click(hubEl('preference'));

    expect(Number(region('preference').getAttribute('opacity'))).toBe(1);
    expect(region('preference')).toHaveAttribute('data-lane-expanded', 'true');
    // Depth, not a blanket dim: the lane the user did not open still recedes.
    expect(Number(region('person').getAttribute('opacity'))).toBeCloseTo(0.35);
  });

  it('never attenuates a CONTROL — a collapsed lane’s hub stays full-strength, focusable and named', () => {
    seed();
    renderGraph();

    // The scenery recedes; the button that opens it does not. Opacity is
    // decoration and is never a substitute for disabled/aria-hidden semantics.
    // Nothing is attended here either (TWIN-READ.2 Task 4's SEPARATE axis),
    // so the hub's own opacity attribute reads the neutral 'lit' value too.
    const collapsedHub = hubEl('person');
    expect(Number(collapsedHub.getAttribute('opacity'))).toBe(1);
    expect(collapsedHub).not.toHaveAttribute('aria-hidden');
    expect(collapsedHub).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Category: People, 1 learned fact' })).toBe(collapsedHub);
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.2 Task 4 — CATEGORY-SCOPED ATTENTION. The mockup's own model: the
// attended fact (row, branch, terminal) and its category's anchors (hub,
// trunk, heading) read fully lit; same-category siblings hold at a legible
// mid-level; every OTHER category recedes; the twin core never dims. On hover
// AND focus, identically — and a pinned fact keeps its subject lit when the
// pointer wanders off.
//
// THE FILL-MODE REGRESSION IS FIRST, on purpose (written before the rest of
// this file's attention tests, mirroring how it was implemented): the mockup
// caught a lingering `forwards`/`both` fill pinning `opacity:1` and silently
// defeating dimming forever, because an animation beats a normal declaration.
// A node that has EVER bloomed must still dim correctly afterwards.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — a bloomed node still dims (the fill-mode regression)', () => {
  it('a fact that just arrived (bloom) still dims once attention shifts to another category', async () => {
    seedOpen();
    renderGraph();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    // f4 just bloomed into the already-open 'preference' lane.
    const f4 = nodeEl('fact:f4');
    expect(f4).toHaveAttribute('data-entering', 'true');
    const bloomSlot = animationSlotOf('fact:f4');
    expect(bloomSlot?.getAttribute('style')).toContain('brain-node-enter');
    // THE NAMED TRAP ITSELF, read straight off the rendered style string: a
    // lingering forwards/both fill is what silently defeats dimming, because
    // an animation beats a normal declaration — the exact bug the mockup
    // caught, and the reason this describe block exists at all.
    expect(bloomSlot?.getAttribute('style')).not.toMatch(/forwards|both/);

    // Nothing is attended yet — neutral, fully lit, same as every other row.
    expect(attentionOf('fact:f4')).toBe(1);

    // Attend a fact in the OTHER category — f4, mid-bloom, must STILL dim.
    fireEvent.mouseEnter(nodeEl('fact:f3'));
    expect(attentionOf('fact:f4')).toBeCloseTo(0.25);
  });

  it('an undo-restored fact (the SAME bloom path) also still dims afterwards', async () => {
    // Mirrors "drops the lane heading's count on forget, and undo restores it
    // WITH a bloom" (the forget+undo describe block below) exactly, through
    // the REAL forget -> undo UI flow — then adds the attention assertion.
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    twinMemoryRestore.mockResolvedValue(twinFact());
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget:/ }));
    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('f1'));

    fireEvent.click(await screen.findByRole('button', { name: /undo/i }));
    await waitFor(() => expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull());

    // Restored via the identical `entering`/bloom mechanism as any arrival.
    expect(nodeEl('fact:f1')).toHaveAttribute('data-entering', 'true');

    // ...and still must dim once something else is attended.
    fireEvent.mouseEnter(nodeEl('fact:f3'));
    expect(attentionOf('fact:f1')).toBeCloseTo(0.25);
  });
});

describe('TwinMemoryGraph — category-scoped attention: the three levels', () => {
  it('lights the attended fact + its own branch/hub/trunk/heading; holds a sibling at mid; dims every OTHER category; never the twin', () => {
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(nodeEl('fact:f1')); // 'preference'

    // The attended fact itself, and its own connection.
    expect(attentionOf('fact:f1')).toBe(1);
    expect(opacityOf(branchGroupFor('fact:f1'))).toBe(1);
    // Its category's anchors: hub, trunk, heading.
    expect(attentionOf('category:preference')).toBe(1);
    expect(opacityOf(trunkGroupFor('preference'))).toBe(1);
    expect(opacityOf(laneHeadingEl('preference'))).toBeCloseTo(1);

    // A same-category SIBLING row and its own branch: mid, never lit.
    expect(attentionOf('fact:f2')).toBeCloseTo(0.55);
    expect(opacityOf(branchGroupFor('fact:f2'))).toBeCloseTo(0.55);

    // Every OTHER category: its row, branch, hub, trunk and heading all dim.
    expect(attentionOf('fact:f3')).toBeCloseTo(0.25);
    expect(opacityOf(branchGroupFor('fact:f3'))).toBeCloseTo(0.25);
    expect(attentionOf('category:person')).toBeCloseTo(0.25);
    expect(opacityOf(trunkGroupFor('person'))).toBeCloseTo(0.25);
    expect(opacityOf(laneHeadingEl('person'))).toBeCloseTo(0.25);

    // The twin core: not merely "lit" — never even carries the attribute.
    expect(nodeEl('twin')).not.toHaveAttribute('opacity');
  });

  it('is neutral (full opacity everywhere) when a HUB or the twin is hovered — only a fact drives the dim wave', () => {
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(hubEl('preference'));
    expect(attentionOf('fact:f3')).toBe(1);
    expect(attentionOf('category:person')).toBe(1);
    fireEvent.mouseLeave(hubEl('preference'));

    fireEvent.mouseEnter(nodeEl('twin'));
    expect(attentionOf('fact:f1')).toBe(1);
    expect(attentionOf('fact:f3')).toBe(1);
  });

  it('keyboard focus reaches the IDENTICAL model as hover', () => {
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(nodeEl('fact:f1'));
    const viaHover = {
      self: attentionOf('fact:f1'),
      sibling: attentionOf('fact:f2'),
      other: attentionOf('fact:f3'),
      otherHub: attentionOf('category:person'),
    };
    fireEvent.mouseLeave(nodeEl('fact:f1'));
    expect(attentionOf('fact:f1')).toBe(1); // sanity: neutral once nothing is hovered or pinned

    fireEvent.focus(nodeEl('fact:f1'));
    expect(attentionOf('fact:f1')).toBe(viaHover.self);
    expect(attentionOf('fact:f2')).toBe(viaHover.sibling);
    expect(attentionOf('fact:f3')).toBe(viaHover.other);
    expect(attentionOf('category:person')).toBe(viaHover.otherHub);
  });

  it('a dimmed row and a dimmed hub stay focusable, keep their accessible name, and are never aria-hidden', () => {
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(nodeEl('fact:f1')); // attends 'preference' — 'person' dims

    const otherRow = nodeEl('fact:f3');
    expect(attentionOf('fact:f3')).toBeCloseTo(0.25);
    expect(otherRow).toHaveAttribute('tabindex', '0');
    expect(otherRow).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('button', { name: /Ada leads the platform team/ })).toBe(otherRow);

    const otherHub = hubEl('person');
    expect(attentionOf('category:person')).toBeCloseTo(0.25);
    expect(otherHub).toHaveAttribute('tabindex', '0');
    expect(otherHub).not.toHaveAttribute('aria-hidden');
  });

  it('reduced motion KEEPS dimming but drops the pulse and the opacity ease', () => {
    prefersReducedMotion = true;
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(nodeEl('fact:f1'));

    expect(attentionOf('fact:f3')).toBeCloseTo(0.25); // dimming itself: unaffected — it is state
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0); // the pulse: gated
    expect(nodeEl('fact:f1')).not.toHaveClass('transition-opacity'); // the ease: gated
    expect(nodeEl('fact:f3')).not.toHaveClass('transition-opacity');
    expect(hubEl('person')).not.toHaveClass('transition-opacity');
  });
});

describe('TwinMemoryGraph — a pinned fact stays attended when the pointer leaves', () => {
  it('re-lights the pinned fact once the pointer settles elsewhere and back, without a SECOND pulse', () => {
    vi.useFakeTimers();
    seedOpen();
    renderGraph();
    act(() => {
      vi.advanceTimersByTime(3000); // let the mount-settle cascade finish first
    });

    fireEvent.click(nodeEl('fact:f1')); // pins f1 ('preference')
    act(() => {
      vi.advanceTimersByTime(700); // let the pin-click's own pulse clear
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);
    expect(attentionOf('fact:f1')).toBe(1);

    fireEvent.mouseEnter(nodeEl('fact:f3')); // a DIFFERENT category — attention shifts away
    expect(attentionOf('fact:f1')).toBeCloseTo(0.25);
    act(() => {
      vi.advanceTimersByTime(700); // let f3's OWN hover-pulse clear before the leave
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);

    fireEvent.mouseLeave(nodeEl('fact:f3')); // pointer leaves — settles BACK onto the pin
    expect(attentionOf('fact:f1')).toBe(1);
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0); // no NEW pulse on the settle-back
  });
});

// ---------------------------------------------------------------------------
// THE SOMA TAP-ON-ATTEND — Task 3 investigated this and deliberately left it
// for Task 4: the row's inner <g> (growth XOR bloom) is the row's ONE
// animation slot, so a tap must live one level DEEPER, wrapping just the
// soma — TwinMemoryRiverStructure.tsx's hub already showed the pattern.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — attend briefly emphasises the soma, never competing with bloom/cascade', () => {
  it('wraps just the soma in its own nested group, one level inside the row’s single animation slot', () => {
    vi.useFakeTimers();
    seedOpen();
    renderGraph();
    act(() => {
      vi.advanceTimersByTime(3000); // let the mount-settle cascade finish first
    });

    fireEvent.mouseEnter(nodeEl('fact:f1'));

    const animSlot = animationSlotOf('fact:f1');
    expect(animSlot).not.toBeNull();
    // Never the SAME slot as bloom/growth — that is the whole point.
    expect(animSlot?.getAttribute('class') ?? '').not.toContain('twin-river-tap');

    const tapGroup = animSlot?.querySelector('g') ?? null;
    expect(tapGroup).not.toBeNull();
    expect(tapGroup).toHaveClass('twin-river-tap');
    expect(tapGroup?.querySelector('[data-soma-core]')).not.toBeNull(); // wraps just the soma
  });

  it('never taps under reduced motion — it piggybacks on the pulse, which never fires there', () => {
    prefersReducedMotion = true;
    seedOpen();
    renderGraph();

    fireEvent.mouseEnter(nodeEl('fact:f1'));

    expect(document.querySelectorAll('.twin-river-tap')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// THE CORE SHIMMER — the ONE documented exception to "zero idle rAF/timers",
// and the only ambient animation on this canvas.
//
// It is scoped to a single element because a permanent animation loop competes
// with local Whisper transcription and a local LLM for the same GPU, which is
// the entire reason the graph freezes at all. Three gates, each tested on its
// own below, because a gate that silently stopped working would cost the user
// battery and thermal headroom while showing no symptom at all.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — the core shimmer (the sanctioned exception)', () => {
  /** The shimmering element, or null. Deliberately queried from the WHOLE
   *  document, not from the core node — "only the core shimmers" is half the
   *  claim, and scoping the query would assume it. */
  function shimmering(): Element[] {
    return [...document.querySelectorAll('.twin-core-shimmer')];
  }

  it('breathes the TWIN CORE, and nothing else on the canvas', () => {
    seedOpen();
    renderGraph();

    expect(shimmering()).toHaveLength(1);
    expect(nodeEl('twin').querySelector('.twin-core-shimmer')).not.toBeNull();
    // Not a hub, not a fact — widening the scope is the change this must never
    // silently accumulate.
    expect(hubEl('preference').querySelector('.twin-core-shimmer')).toBeNull();
    expect(nodeEl('fact:f1').querySelector('.twin-core-shimmer')).toBeNull();
  });

  it('STOPS when the Memory tab is not the one on screen (the component stays mounted)', () => {
    seedOpen();
    renderGraph(undefined, false);

    // Still rendered — the badge counts from here while Profile is showing —
    // but not animating.
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(6);
    expect(shimmering()).toHaveLength(0);
  });

  it('STOPS when the window itself is hidden, and resumes when it comes back', () => {
    seedOpen();
    renderGraph();
    expect(shimmering()).toHaveLength(1);

    setWindowHidden(true);
    expect(shimmering()).toHaveLength(0);

    setWindowHidden(false);
    expect(shimmering()).toHaveLength(1);
  });

  it('never runs under prefers-reduced-motion', () => {
    prefersReducedMotion = true;
    seedOpen();
    renderGraph();

    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(6);
    expect(shimmering()).toHaveLength(0);
  });

  it('is CSS-only: it shimmers throughout an idle window without scheduling one frame or timer', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seedOpen();
    renderGraph();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');

    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // This is the honest statement of the supersession: the counters below are
    // exactly what the settle-discipline test measures, and they cannot see the
    // shimmer — which is still running, as the last assertion shows. That is why
    // the three gate tests above exist instead of relying on this one.
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
    expect(shimmering()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// THE INSPECTOR READS THE MEMORY, NOT ITS CAPTION. This is the card a user reads
// immediately before pressing Forget, so what it renders is a safety question,
// not a display one. Task 1 changed what `label` MEANS on a node (full sentence
// -> 2-4 word caption), which silently shrank this paragraph; restoring the full
// sentence restores what the card showed before the phase. Nothing else about
// the card moved — provenance, forget+undo and the tab order are unchanged.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — the inspector shows the whole fact', () => {
  it('renders the FULL sentence, not the short caption the node wears', () => {
    seedOpen(labelFixture());
    renderGraph();

    fireEvent.click(nodeEl('fact:L1'));

    const card = screen.getByTestId('twin-memory-inspector');
    expect(within(card).getByText(LONG_FACT)).toBeInTheDocument();
    // The caption belongs on the node; putting it here would ask the user to
    // forget a memory they were only shown two words of.
    expect(card).not.toHaveTextContent('Async updates');
    // ...and the forget action is still right there, on the whole fact.
    expect(within(card).getByRole('button', { name: /^Forget:/ })).toBeInTheDocument();
  });

  it('still shows an UNLABELLED fact in full — never blank, never just the derived caption', () => {
    seedOpen(labelFixture());
    renderGraph();

    fireEvent.click(nodeEl('fact:L2'));

    const card = screen.getByTestId('twin-memory-inspector');
    expect(within(card).getByText('The Q3 pricing decision was deferred to the board meeting')).toBeInTheDocument();
    // The node's caption for this fact is the derived 'The Q3 pricing decision…'
    // — the card must not stop there.
    expect(card).not.toHaveTextContent('The Q3 pricing decision…');
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.2 Task 3 — the pinned card is REUSED (GraphPinnedCardLayer +
// TwinMemoryInspector, unchanged), so what is actually on trial here is the
// two things Task 3 adapted: the ANCHOR (the row's full extent, not its dot
// — the pre-named trap) and the UNPIN grammar (Esc already worked via the
// inspector's own handler; empty-canvas click is new, added fresh because
// neither this canvas nor BrainMemoryGraph — the shared card's other
// consumer, proven separately in its own test file — had it before).
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — pinned card anchor (the row, not the dot)', () => {
  it('anchors the card past the ROW TITLE, not the soma', () => {
    seedOpen(labelFixture());
    renderGraph();

    // Widen the pinned card's OWN container measurement so the default
    // RIGHT-of-node placement never flips to the LEFT — the left side is
    // untouched by this fix (nothing sits left of a row), so only the
    // unflipped case can prove the widening reached the real wiring, not
    // just riverCanvasModel's math in isolation.
    const canvasSvg = document.querySelector('[data-testid="twin-memory-graph-canvas"] svg')!;
    Object.defineProperty(canvasSvg, 'clientWidth', { configurable: true, value: 2000 });
    Object.defineProperty(canvasSvg, 'clientHeight', { configurable: true, value: 1000 });

    fireEvent.click(nodeEl('fact:L1'));

    const rowX = Number(/translate\((-?[\d.]+),/.exec(rowTransform('fact:L1'))![1]);
    const dotOnlyX = rowX + FACT_RADIUS; // the OLD anchor this task replaces
    const expectedX = rowX + TITLE_OFFSET_X + estimatedTitleWidth('Async updates');

    const connector = screen.getByTestId('memory-graph-connector');
    expect(Number(connector.getAttribute('x1'))).toBeCloseTo(expectedX, 2);
    // The trap, named: a dot-only anchor would land on top of the very title
    // that was just clicked.
    expect(Number(connector.getAttribute('x1'))).toBeGreaterThan(dotOnlyX + 50);
  });

  it('re-pinning a different row moves the card and its connector to it', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    const firstY = screen.getByTestId('memory-graph-connector').getAttribute('y1');
    expect(
      within(screen.getByTestId('twin-memory-inspector')).getByText(/Prefers async updates over meetings/),
    ).toBeInTheDocument();

    fireEvent.click(nodeEl('fact:f3')); // a different lane — a different row entirely

    expect(screen.getByTestId('memory-graph-connector').getAttribute('y1')).not.toBe(firstY);
    expect(
      within(screen.getByTestId('twin-memory-inspector')).getByText(/Ada leads the platform team/),
    ).toBeInTheDocument();
  });
});

describe('TwinMemoryGraph — unpin grammar (Esc + empty-canvas click)', () => {
  it('a click on any control — row, hub, twin core — never unpins, only empty canvas does', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    expect(screen.getByTestId('twin-memory-inspector')).toBeInTheDocument();

    // A hub toggle is a control click too — it must not close the pin as a
    // side effect of its own click bubbling up to the canvas.
    fireEvent.click(hubEl('person'));
    expect(screen.getByTestId('twin-memory-inspector')).toBeInTheDocument();

    // The twin core is a control — clicking it RE-PINS, it does not unpin.
    fireEvent.click(nodeEl('twin'));
    expect(screen.getByTestId('twin-memory-inspector')).toBeInTheDocument();

    // Only a click that lands on neither — the empty river — unpins.
    fireEvent.click(document.querySelector('[data-testid="twin-memory-graph-canvas"] svg')!);
    expect(screen.queryByTestId('twin-memory-inspector')).toBeNull();
  });

  it("Esc still unpins too — the inspector's own handler, unchanged", () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('twin-memory-inspector')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ORGANIC TOUCH: pinning gives tactile feedback — the connector LINE draws
// out of the row toward the card, a pure Math.hypot sweep (never
// getTotalLength(), which jsdom does not implement), and the dot keeps a
// plain fade. The named trap of this whole phase applies here too: no
// lingering forwards/both fill, because Task 4 layers attention dimming on
// top and a persistent fill beats a normal declaration — that guarantee is a
// CSS-authorship fact (globals.css's graph-connector-draw-in specifies no
// fill-mode, so it defaults to `none`), not something jsdom can compute,
// since it never applies rules from an actual CSS file.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — pinning is tactile (connector draw-in, no persistent fill)', () => {
  it('the connector LINE sweeps out from the node toward the card, not simply appearing', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));

    const connector = screen.getByTestId('memory-graph-connector');
    expect(connector).toHaveClass('graph-connector-draw-in');

    // The sweep length is pure arithmetic off the line's OWN rendered
    // endpoints — never a measured/getTotalLength() value.
    const x1 = Number(connector.getAttribute('x1'));
    const y1 = Number(connector.getAttribute('y1'));
    const x2 = Number(connector.getAttribute('x2'));
    const y2 = Number(connector.getAttribute('y2'));
    const expectedLength = Math.hypot(x2 - x1, y2 - y1);
    expect(Number(connector.getAttribute('stroke-dasharray'))).toBeCloseTo(expectedLength, 5);
    expect(connector.style.getPropertyValue('--connector-length')).toBe(String(expectedLength));

    // The dot keeps its own, simpler fade — it has no length to sweep.
    expect(connector.nextElementSibling?.getAttribute('style')).toContain('animation');
  });

  it('replays the sweep on a re-pin — the geometry is fresh for the newly pinned row, not stale', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(nodeEl('fact:f3')); // a different lane — a different geometry entirely

    const connector = screen.getByTestId('memory-graph-connector');
    expect(connector).toHaveClass('graph-connector-draw-in');
    const x1 = Number(connector.getAttribute('x1'));
    const y1 = Number(connector.getAttribute('y1'));
    const x2 = Number(connector.getAttribute('x2'));
    const y2 = Number(connector.getAttribute('y2'));
    expect(Number(connector.getAttribute('stroke-dasharray'))).toBeCloseTo(Math.hypot(x2 - x1, y2 - y1), 5);
  });

  it('reduced motion: the connector appears with no animation at all', () => {
    prefersReducedMotion = true;
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));

    const connector = screen.getByTestId('memory-graph-connector');
    expect(connector).not.toHaveAttribute('stroke-dasharray');
    expect(connector.getAttribute('class')).toBeFalsy();
    expect(connector.getAttribute('style')).toBeFalsy();
    expect(connector.nextElementSibling?.getAttribute('style')).toBeFalsy(); // the dot too
  });
});

// ---------------------------------------------------------------------------
// SAFETY TRIAD 1/3 — PROVENANCE. Never a raw id, never fabricated.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — provenance', () => {
  it('names the session a fact was learned in', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));

    expect(screen.getByTestId('twin-memory-inspector')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'learned in Weekly Sync' })).toBeInTheDocument();
    expect(screen.getByLabelText('Category: Preferences')).toBeInTheDocument();
  });

  it('falls back to "a past session" — and offers no dead link — when the source is gone', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f2'));

    expect(screen.getByText('learned in a past session')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /learned in/i })).not.toBeInTheDocument();
    // The id is never shown as a stand-in for a name.
    expect(screen.queryByText(/meeting-/)).toBeNull();
  });

  it('offers no forget action on structure (the twin core is not a memory)', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('twin'));

    expect(screen.getByTestId('twin-memory-inspector')).toHaveTextContent('3 learned facts across your whole memory');
    expect(screen.queryByRole('button', { name: /^Forget:/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SAFETY TRIAD 2/3 — ONE-TAP FORGET + ~5s UNDO, with rollback.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — forget + undo', () => {
  it('removes the fact optimistically and offers an undo focused on Undo', async () => {
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget: Prefers async/ }));

    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('f1'));
    expect(document.querySelector('[data-node-id="fact:f1"]')).toBeNull();

    const snackbar = await screen.findByRole('status');
    expect(snackbar).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: /undo/i })).toHaveFocus();
  });

  it('undo restores the fact through twin:memory-restore and refetches the graph', async () => {
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    twinMemoryRestore.mockResolvedValue(twinFact());
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget:/ }));
    fireEvent.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(twinMemoryRestore).toHaveBeenCalledWith('f1'));
    await waitFor(() => expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learned facts' })).toHaveFocus();
  });

  it("drops the lane heading's count on forget, and undo restores it WITH a bloom", async () => {
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    twinMemoryRestore.mockResolvedValue(twinFact());
    seedOpen();
    renderGraph();
    expect(laneHeadingEl('preference')).toHaveTextContent('Preferences · 2');

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget:/ }));

    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('f1'));
    expect(laneHeadingEl('preference')).toHaveTextContent('Preferences · 1');

    fireEvent.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull());
    expect(laneHeadingEl('preference')).toHaveTextContent('Preferences · 2');
    // The restore is a genuine ARRIVAL — the same one-shot bloom as any other,
    // not a special-cased "put it back" render.
    expect(nodeEl('fact:f1')).toHaveAttribute('data-entering', 'true');
    expect(nodeEl('fact:f1').querySelector('g')?.getAttribute('style')).toContain('brain-node-enter');
  });

  it('treats a NULL from twinMemoryForget as a FAILURE — the fact comes back and says so', async () => {
    // A resolved promise that forgot nothing. Reporting success here would leave
    // a phantom undo for a fact that never moved.
    twinMemoryForget.mockResolvedValue(null);
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget:/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/may have already been removed/i);
    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull(); // rolled back
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('rolls the optimistic removal back when the IPC call throws', async () => {
    twinMemoryForget.mockRejectedValue(new Error('ipc down'));
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget:/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/please try again/i);
    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SAFETY TRIAD 3/3 — the kill-switch. Reflected and flipped, never re-implemented.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — pause learning kill-switch', () => {
  it('flips the twin.learningPaused setting and nothing else', async () => {
    seed();
    renderGraph();

    fireEvent.click(screen.getByRole('button', { name: /pause learning/i }));

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(TWIN_LEARNING_PAUSED_SETTING_KEY, 'true'));
    // The gate lives main-side; this surface owns no other write.
    expect(setSetting).toHaveBeenCalledTimes(1);
  });

  it('reflects the paused setting with a pressed toggle and an explicit banner', () => {
    useSettingsStore.setState({ settings: { [TWIN_LEARNING_PAUSED_SETTING_KEY]: 'true' } } as never);
    seed();
    renderGraph();

    expect(screen.getByText(/learning is paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume learning/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows no banner while learning is active', () => {
    seed();
    renderGraph();
    expect(screen.queryByText(/learning is paused/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ACCESSIBILITY: all three affordances reachable WITHOUT a pointer — and, since
// TWIN-READ.1 Task 2, reachable THROUGH the disclosure layer rather than around
// it. A fact behind a collapsed lane that only a mouse can open would put the
// forget action further out of reach, which is exactly what the phase forbids.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — keyboard reachability of the safety triad', () => {
  it('reaches and operates the pause kill-switch by Tab + Enter alone', async () => {
    const user = userEvent.setup();
    seed();
    renderGraph();

    await tabTo(user, screen.getByRole('button', { name: /pause learning/i }));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(TWIN_LEARNING_PAUSED_SETTING_KEY, 'true'));
  });

  it('every graph node is a tabbable, named control — the inspector is not pointer-only', () => {
    seedOpen();
    renderGraph();

    const factNode = nodeEl('fact:f1');
    expect(factNode).toHaveAttribute('role', 'button');
    expect(factNode).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Learned fact: Prefers async updates over meetings' })).toBe(factNode);
    expect(screen.getByRole('button', { name: 'Twin: You' })).toBe(nodeEl('twin'));
  });

  it('Enter on a HUB opens its lane, and the revealed facts are tabbable controls', async () => {
    const user = userEvent.setup();
    seed();
    renderGraph();

    fireEvent.keyDown(hubEl('preference'), { key: 'Enter' });

    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'true');
    // Reachable, not merely present: Tab walks from the hub into what it opened.
    await tabTo(user, nodeEl('fact:f1'), 12);
  });

  it('Space on a hub toggles it too — native button semantics, not Enter-only', () => {
    seed();
    renderGraph();

    fireEvent.keyDown(hubEl('preference'), { key: ' ' });
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(hubEl('preference'), { key: ' ' });
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'false');
  });

  it('a fact revealed BY THE KEYBOARD still opens the inspector, and Forget is still reachable', async () => {
    const user = userEvent.setup();
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    seed();
    renderGraph();

    // Open the lane with the keyboard, then activate the fact it revealed.
    fireEvent.keyDown(hubEl('preference'), { key: 'Enter' });
    fireEvent.keyDown(nodeEl('fact:f1'), { key: 'Enter' });

    const card = screen.getByTestId('twin-memory-inspector');
    expect(card).toHaveFocus();

    const forget = screen.getByRole('button', { name: /^Forget: Prefers async/ });
    await tabTo(user, forget);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('f1'));
    expect(await screen.findByRole('button', { name: /undo/i })).toHaveFocus();
  });

  it('Enter on a node opens the inspector, moves focus into it, and Tab reaches Forget', async () => {
    const user = userEvent.setup();
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    seedOpen();
    renderGraph();

    fireEvent.keyDown(nodeEl('fact:f1'), { key: 'Enter' });

    // Keyboard activation moves focus INTO the card (a click deliberately does not).
    const card = screen.getByTestId('twin-memory-inspector');
    expect(card).toHaveFocus();

    // ...and from there the forget action is genuinely reachable and operable.
    const forget = screen.getByRole('button', { name: /^Forget: Prefers async/ });
    await tabTo(user, forget);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('f1'));
    // ...and the undo that follows focuses itself, so the keyboard never strands.
    expect(await screen.findByRole('button', { name: /undo/i })).toHaveFocus();
  });

  it('a genuinely keyboard-only path — Tab to a row, Enter, Tab to Forget — never touches a pointer', async () => {
    const user = userEvent.setup();
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    seedOpen();
    renderGraph();

    // Reach the row by REAL Tab traversal (not a direct keyDown shortcut) —
    // this is what proves the row is reachable, not just that its handler
    // works when invoked directly.
    await tabTo(user, nodeEl('fact:f1'), 12);
    await user.keyboard('{Enter}');

    const card = screen.getByTestId('twin-memory-inspector');
    expect(card).toHaveFocus();

    const forget = screen.getByRole('button', { name: /^Forget: Prefers async/ });
    await tabTo(user, forget);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('f1'));
  });

  it('a mouse-opened inspector does NOT steal focus', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));

    expect(screen.getByTestId('twin-memory-inspector')).not.toHaveFocus();
  });

  it('Escape closes the inspector', () => {
    seedOpen();
    renderGraph();

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('twin-memory-inspector')).toBeNull();
  });
});

describe('TwinMemoryGraph — the Memory tab badge', () => {
  it('reports the ACTIVE fact count up, and again after a forget', async () => {
    twinMemoryForget.mockResolvedValue(twinFact({ status: 'forgotten' }));
    const onCountChange = vi.fn();
    seedOpen();
    renderGraph(onCountChange);

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(3)); // hubs + core are structure

    fireEvent.click(nodeEl('fact:f1'));
    fireEvent.click(screen.getByRole('button', { name: /^Forget:/ }));

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });

  it('counts the whole ledger, not what is on screen — collapsing a lane is not forgetting', async () => {
    const onCountChange = vi.fn();
    seed(); // every lane collapsed: nothing drawn but the structure
    renderGraph(onCountChange);

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(3));
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.1 Task 1's backfill, given a face (Task 2's assigned scope). The
// channel is a typed no-op when learning is paused or no model is configured —
// a silent button in those cases would read as broken, so every branch says
// what happened.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — label backfill trigger', () => {
  it('runs one backfill chunk and refetches so the improved labels actually appear', async () => {
    twinMemoryBackfillLabels.mockResolvedValue({ status: 'ok', labeled: 2, remaining: 0 });
    seed();
    renderGraph();

    fireEvent.click(screen.getByRole('button', { name: /improve labels/i }));

    await waitFor(() => expect(twinMemoryBackfillLabels).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Improved 2 labels.')).toBeInTheDocument();
    // A relabel changes no node id, so only a FORCED refetch can surface it.
    await waitFor(() => expect(twinBuildMemoryGraph).toHaveBeenCalled());
  });

  it('says so when the pause gate skipped it, instead of looking like a dead button', async () => {
    twinMemoryBackfillLabels.mockResolvedValue({ status: 'skipped', reason: 'paused', labeled: 0, remaining: 4 });
    seed();
    renderGraph();

    fireEvent.click(screen.getByRole('button', { name: /improve labels/i }));

    expect(await screen.findByText(/learning is paused — resume it to improve labels/i)).toBeInTheDocument();
    expect(twinBuildMemoryGraph).not.toHaveBeenCalled(); // nothing changed, nothing to refetch
  });

  it('says so when no model is configured — the derived fallback still covers those facts', async () => {
    twinMemoryBackfillLabels.mockResolvedValue({ status: 'skipped', reason: 'no-model', labeled: 0, remaining: 4 });
    seed();
    renderGraph();

    fireEvent.click(screen.getByRole('button', { name: /improve labels/i }));

    expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument();
  });

  it('invites another run while facts remain, because one call is one bounded chunk', async () => {
    twinMemoryBackfillLabels.mockResolvedValue({ status: 'ok', labeled: 20, remaining: 7 });
    seed();
    renderGraph();

    fireEvent.click(screen.getByRole('button', { name: /improve labels/i }));

    expect(await screen.findByText(/improved 20 labels — 7 to go\. run it again to continue\./i)).toBeInTheDocument();
  });

  it('reports a failure rather than swallowing it', async () => {
    twinMemoryBackfillLabels.mockRejectedValue(new Error('ipc down'));
    seed();
    renderGraph();

    fireEvent.click(screen.getByRole('button', { name: /improve labels/i }));

    expect(await screen.findByText(/could not improve labels/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ACCESSIBILITY: reduced motion renders the finished layout, with no animation.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — reduced motion', () => {
  it('renders the SETTLED layout with no animation frame at all', () => {
    prefersReducedMotion = true;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seedOpen();
    renderGraph();

    const canvas = screen.getByTestId('twin-memory-graph-canvas');
    expect(canvas).toHaveAttribute('data-reduced-motion', 'true');
    expect(canvas).toHaveAttribute('data-settled', 'true'); // already at rest on first paint
    expect(rafSpy).not.toHaveBeenCalled(); // see file header note 2
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(6);
    // Nothing is animating in: no entrance style anywhere.
    for (const el of document.querySelectorAll('[data-node-id] > g')) {
      expect(el.getAttribute('style')).toBeFalsy();
    }
  });
});

// ---------------------------------------------------------------------------
// TWIN-GRAPH.2 Task 4 — LIVE GROWTH. The gap Task 3 left open: its refresh
// triggers were mount / tab activation / post-undo only, so a fact learned
// while the user is ALREADY sitting on this tab never appeared until they
// left and returned. A live-refresh trigger now calls this same store's
// refresh() (see hooks/useTwinMemoryLiveSync.ts, exercised at the IPC-listener
// level in its own test file) — here we exercise what happens to THIS
// component once that refresh lands: the entering fact blooms in place and
// the settle-discipline guarantee still holds afterward.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — live growth (TWIN-GRAPH.2 Task 4)', () => {
  it('a live-refresh bloom animates ONLY the entering fact, then re-freezes (settle discipline still holds)', async () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seedOpen();
    renderGraph();

    // Settle the initial graph first — exactly as a user who has been sitting
    // on the tab for a while.
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');

    // The live-refresh trigger's real effect: the store's own refresh(),
    // landing while the component is already mounted and visible.
    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect([...useTwinMemoryGraphStore.getState().entering]).toEqual(['fact:f4']);
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(7);
    expect(nodeEl('fact:f4')).toHaveAttribute('data-entering', 'true');
    expect(nodeEl('fact:f4').querySelector('g')?.getAttribute('style')).toContain('brain-node-enter');
    // A pre-existing fact is untouched: not marked entering, no entrance style.
    expect(nodeEl('fact:f1')).not.toHaveAttribute('data-entering');
    expect(nodeEl('fact:f1').querySelector('g')?.getAttribute('style')).toBeFalsy();

    // It re-settles...
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');

    // ...and RE-FREEZES: Task 3's own settle-discipline guarantee (zero
    // scheduling at idle) must still hold after a live bloom, not just after
    // the very first settle.
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });

  it('reduced motion: a live-growth bloom appears with NO animation and schedules no frame', async () => {
    prefersReducedMotion = true;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seedOpen();
    renderGraph();
    expect(rafSpy).not.toHaveBeenCalled();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');
    expect(rafSpy).not.toHaveBeenCalled(); // never started a frame loop at all
    // Still marked as the arriving node (observable state)...
    expect(nodeEl('fact:f4')).toHaveAttribute('data-entering', 'true');
    // ...but renders with NO entrance animation, per the reduced-motion rule.
    expect(nodeEl('fact:f4').querySelector('g')?.getAttribute('style')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.1 Task 5 — LIVE GROWTH UNDER DISCLOSURE. Progressive disclosure
// (Task 2) filters an arriving fact clean out of the DOM when its lane is
// shut, which silently drops the "watching it learn" moment the test above
// proves for an OPEN lane. This restores it AT THE HUB by reusing Task 4's
// activation pulse verbatim — same class, same DENDRITE_PULSE_MS, same
// one-shot setTimeout clearing — never a second mechanism.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — live growth under disclosure (TWIN-READ.1 Task 5)', () => {
  it('a fact arriving in a COLLAPSED lane pulses its hub — the "watching it learn" moment, restored', async () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seed(); // every lane collapsed — the app's default opening state
    renderGraph();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    // Disclosure holds: the fact itself never entered the DOM, and the lane
    // was never auto-expanded to reveal it — nothing yanks the view out from
    // under a user reading something else.
    expect(document.querySelector('[data-node-id="fact:f4"]')).toBeNull();
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'false');
    // The count needs no new code — laneCounts already reads the FULL payload
    // (Task 2), so it bumps on its own.
    expect(screen.getByText('Preferences').textContent).toBe('Preferences · 3');

    // ...but the hub carries the SAME activation pulse a touch would fire, on
    // the one connection a collapsed lane still draws: twin -> hub.
    const pulsed = [...document.querySelectorAll('[data-pulse-for]')];
    expect(pulsed).toHaveLength(1);
    expect(pulsed[0].getAttribute('data-pulse-for')).toContain('>category:preference');
    expect(pulsed[0]).toHaveClass('twin-dendrite-pulse');
    // OUTWARD from the hub, toward the twin — the hub is the connection's
    // TARGET, exactly the same rule Task 4 proved for a touched fact.
    expect(pulsed[0]).toHaveAttribute('data-pulse-direction', 'reverse');

    // It is a genuine ONE-SHOT (gone once its animation ends)...
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);

    // ...and the settle-discipline guarantee holds for THIS arrival path too:
    // once it settles back down, nothing is left scheduled.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });

  it('reduced motion: a collapsed-lane arrival bumps the count with NO pulse and NO animation', async () => {
    prefersReducedMotion = true;
    seed();
    renderGraph();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect(screen.getByText('Preferences').textContent).toBe('Preferences · 3'); // the count still updates
    expect(document.querySelector('[data-node-id="fact:f4"]')).toBeNull();
    expect(hubEl('preference')).toHaveAttribute('aria-expanded', 'false'); // never auto-expanded
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0); // no pulse, no animation at all
  });

  it('arrival in an EXPANDED lane blooms the fact itself and does NOT also pulse the hub', async () => {
    seedOpen();
    renderGraph();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    // TWIN-GRAPH.2's existing behaviour, untouched: the fact itself spawns at
    // its hub and blooms in (see the Task 4 describe block above).
    expect(nodeEl('fact:f4')).toHaveAttribute('data-entering', 'true');
    // The hub pulse is the COLLAPSED-lane SUBSTITUTE for that bloom, not an
    // addition on top of it — an already-visible arrival needs no second cue.
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);
  });

  it('toggling an UNRELATED lane afterward does not replay a stale pulse', async () => {
    vi.useFakeTimers();
    seed();
    renderGraph();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(1);

    // Let the pulse run its course on its own.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);

    // Opening a DIFFERENT lane must not resurrect it — the effect that fires
    // triggerPulse is keyed on the arrival itself ([entering, graph]), never
    // on expandedLanes. Toggled directly on the store (not via a hub click,
    // which carries its OWN Task 4 click-feedback pulse) so this proves the
    // arrival effect specifically, not the unrelated interactive one.
    act(() => {
      useTwinMemoryGraphStore.getState().toggleLane('person');
    });
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(0);
  });

  it('never steals focus from a safety-triad control while it pulses', async () => {
    seed();
    renderGraph();

    // Land on a real triad control first — the pause-learning kill-switch.
    const pauseButton = screen.getByRole('button', { name: 'Pause learning' });
    pauseButton.focus();
    expect(document.activeElement).toBe(pauseButton);

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(1); // it did pulse
    expect(document.activeElement).toBe(pauseButton); // ...without moving focus
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.2 Task 5 — LIVE GROWTH UNDER THE RIVER GEOMETRY. The grammar
// above (collapsed pulses its hub, expanded blooms the row, neither
// auto-expands) is TWIN-READ.1 Task 5's own suite, UNCHANGED since Task 2
// swapped the canvas underneath it — the strongest evidence available that
// the river carried it over rather than reimplementing it. What THIS phase
// closes: the row's INSERTION ORDER (asserted nowhere before), a BRAND NEW
// CATEGORY arriving (never exercised before), and the judgement call Task 4
// left open on the table — does an arriving fact's BRANCH draw in too, or
// only its row?
//
// >>> THE JUDGEMENT CALL, DECIDED: yes, the branch grows too. <<< The tiered
// canvas bloomed a fact's edge alongside its node on arrival
// (TwinMemoryDendrite's own `entering` prop, `brain-link-enter`); the river
// dropped that when the growth cascade replaced the settle motion, leaving a
// gap Task 4 named explicitly. Reusing the cascade's OWN class at zero delay
// — rather than inventing a second animation — keeps the fix to a single
// conditional in the canvas: see TwinMemoryRiverCanvas's `edges.map`. A
// trunk never qualifies: there is exactly one per hub, and a hub is not
// "new" just because a fact landed beneath it.
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — river-specific live growth (TWIN-READ.2 Task 5)', () => {
  it('an arriving row lands AFTER its existing siblings, at one row pitch — insertion order, not just presence', async () => {
    seedOpen();
    renderGraph();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    const y = (id: string): number => Number(/translate\(([-\d.]+),([-\d.]+)\)/.exec(rowTransform(id))![2]);
    const x = (id: string): number => Number(/translate\(([-\d.]+),([-\d.]+)\)/.exec(rowTransform(id))![1]);
    // f4 is the THIRD row of 'preference' (after f1, f2) — appended below its
    // siblings, never spliced above them or left overlapping either one.
    expect(y('fact:f4') - y('fact:f2')).toBe(30);
    expect(y('fact:f4') - y('fact:f1')).toBe(60);
    expect(x('fact:f4')).toBe(x('fact:f1'));
  });

  it("an arriving fact's branch GROWS in with it — the hub-origin reveal, not a static ribbon", async () => {
    vi.useFakeTimers();
    seedOpen();
    renderGraph();
    act(() => {
      vi.advanceTimersByTime(3000); // let the mount-settle cascade finish first
    });
    expect(branchGroupFor('fact:f1')).not.toHaveClass('twin-river-branch-grow'); // sanity: settled

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    const branch = branchGroupFor('fact:f4');
    expect(branch).toHaveClass('twin-river-branch-grow');
    expect((branch as SVGElement).style.animationDelay).toBe('0ms');
    // An arrival cue, not a blanket re-grow of the whole lane: a sibling
    // branch that did NOT just arrive stays exactly as it was...
    expect(branchGroupFor('fact:f1')).not.toHaveClass('twin-river-branch-grow');
    // ...and the trunk is not "new" just because a fact landed beneath it.
    expect(trunkGroupFor('preference')).not.toHaveClass('twin-river-branch-grow');
  });

  it("the branch bloom needs no cleanup timer to stay clean — the CSS animation ends itself, exactly like the row's own bloom", async () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seedOpen();
    renderGraph();
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });
    expect(branchGroupFor('fact:f4')).toHaveClass('twin-river-branch-grow');

    // Nothing was ever scheduled for this: `backwards` fill-mode plus a
    // fixed-length CSS animation ends clean entirely on its own, so there is
    // no timer to arm and therefore nothing an idle window could catch.
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });

  it('reduced motion: an arriving branch never grows, matching its row', async () => {
    prefersReducedMotion = true;
    seedOpen();
    renderGraph();

    twinBuildMemoryGraph.mockResolvedValue(grownFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    expect(branchGroupFor('fact:f4')).not.toHaveClass('twin-river-branch-grow');
  });

  it('a fact arriving under a BRAND NEW category inserts a hub and SHIFTS the blocks below it — collapsed by default, canonically ordered, and finite throughout', async () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seed(); // 'preference' + 'person', both collapsed
    renderGraph();
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(3); // twin + 2 hubs

    const y = (id: string): number => Number(/translate\(([-\d.]+),([-\d.]+)\)/.exec(rowTransform(id))![2]);
    const preferenceYBefore = y('category:preference');

    twinBuildMemoryGraph.mockResolvedValue(newCategoryFixture());
    await act(async () => {
      await useTwinMemoryGraphStore.getState().refresh();
    });

    // A genuinely new hub appeared, still collapsed by default (never
    // auto-expanded) and pulsing exactly like any other collapsed arrival —
    // no second mechanism for "the category itself is new".
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(4); // twin + 3 hubs
    expect(hubEl('project')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-node-id="fact:f5"]')).toBeNull();
    expect(document.querySelectorAll('[data-pulse-for]')).toHaveLength(1);

    // Canonical order, not insertion order — 'project' sorts BETWEEN the two
    // lanes that were already there (CATEGORY_LANE_ORDER), so it is truly
    // INSERTED, not appended.
    const lanes = [...document.querySelectorAll('[data-lane-region]')].map((el) => el.getAttribute('data-lane-region'));
    expect(lanes).toEqual(['person', 'project', 'preference']);

    // ...and 'preference' — which sits BELOW the new block now — genuinely
    // SHIFTED to make room for it. This is the plan's own river analogue of
    // TWIN-READ.1's accepted non-local caveat: it snaps to the new arithmetic
    // rather than easing there (Task 2's deliberate decision, not fought here).
    expect(y('category:preference')).toBeGreaterThan(preferenceYBefore);

    // The layout stays finite throughout: every node lands at a real number.
    for (const el of document.querySelectorAll('[data-node-id]')) {
      const transform = el.getAttribute('transform') ?? '';
      const match = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(transform);
      expect(match, `bad transform: ${transform}`).not.toBeNull();
      expect(Number.isFinite(Number(match![1]))).toBe(true);
      expect(Number.isFinite(Number(match![2]))).toBe(true);
    }

    // ...and it costs nothing at idle, exactly like any other arrival.
    act(() => {
      vi.advanceTimersByTime(2000); // the pulse ends
    });
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });
});

// ---------------------------------------------------------------------------
// THE HARD CONSTRAINT: idle must cost literally nothing, because a permanent
// render loop competes with local Whisper and a local LLM for the same GPU.
//
// The riverbank makes that STRUCTURAL rather than enforced. Its layout is
// closed-form arithmetic, so there is no simulation to freeze and no frame loop
// to stop — the assertion below is therefore the strongest form available:
// requestAnimationFrame is never called AT ALL, through mount, expand, collapse
// and interaction alike. (The core shimmer is CSS and is invisible to these
// counters by construction; it has its own four gate tests above.)
// ---------------------------------------------------------------------------
describe('TwinMemoryGraph — idleness (no frame loop exists at all)', () => {
  it('schedules NOTHING across mount, expand, collapse and an idle window', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seed();
    renderGraph();

    fireEvent.click(hubEl('preference')); // grow it open
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(hubEl('preference')); // ...and shut it again
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
    expect(rafSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it('unmounting mid-cascade leaves no timer holding a setState', () => {
    vi.useFakeTimers();
    seedOpen(); // opens expanded: the mount settle is in flight on the first commit
    const { unmount } = renderGraph();

    expect(document.querySelectorAll('.twin-river-row-grow').length).toBeGreaterThan(0);
    const pending = vi.getTimerCount();
    expect(pending).toBeGreaterThan(0); // the cascade's own clear-down is armed

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    // Nothing left to fire means nothing can setState on an unmounted tree.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
  });
});
