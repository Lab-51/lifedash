// @vitest-environment jsdom
// === FILE PURPOSE ===
// BrainMemoryGraph (TWIN-GRAPH.1 Task 3) — the force-directed memory canvas.
// Covers rendering from a fixture, Obsidian-style hover highlighting, the honest
// "+N not shown" cap indicator, the reduced-motion path, and — the phase's
// headline constraint — SETTLE DISCIPLINE: the component's frame loop stops dead
// once the simulation settles, leaving zero pending rAF/intervals at idle.
//
// TWO THINGS THAT WOULD OTHERWISE MAKE THE TIMER ASSERTIONS LIE, both verified
// against the installed sources rather than assumed:
//
//  1. d3-force starts a d3-timer at construction and that CANNOT be prevented
//     (forceLayout.start() calls simulation.stop() immediately, but d3-timer's
//     already-pending frame callback plus its 1s poke interval are only cleared
//     by d3 itself on its next wake, ~17ms later). So a naive "zero timers right
//     after mount" assertion would fail for a reason that is NOT this component.
//     The settle test therefore measures across TWO windows: it counts frames
//     after the graph has fully settled (by which point d3's one-shot transient
//     is long gone), then asserts that a second, later window adds EXACTLY ZERO.
//     That is the real requirement — nothing may be scheduling frames at idle —
//     and it is immune to the transient rather than papering over it.
//
//  2. d3-timer captures `window.requestAnimationFrame.bind(window)` at MODULE
//     LOAD time (see node_modules/d3-timer/src/timer.js). A vi.spyOn installed
//     later therefore never sees d3's own frames — the spy counts THIS
//     component's frames only. That is why the reduced-motion test can assert a
//     hard "not called at all".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BrainGraph, BrainGraphEdge, BrainGraphNode } from '../../../shared/types';
import BrainMemoryGraph from '../brain-graph/BrainMemoryGraph';
import { ForceLayout } from '../brain-graph/forceLayout';
import { useMemoryGraphStore } from '../../stores/memoryGraphStore';

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

const KEY = 'everything';
const NOW_ISO = new Date().toISOString();

function node(
  id: string,
  type: BrainGraphNode['type'],
  label: string,
  recordId: string,
  degree: number,
): BrainGraphNode {
  return { id, type, label, recordId, degree, newestTimestamp: NOW_ISO };
}

/** Ada (person) --participation--> Kickoff (session); a fact attributed to Ada and
 *  sourced from Kickoff; an unrelated topic and a twin fact. */
function graphFixture(droppedCount = 0): BrainGraph {
  const nodes: BrainGraphNode[] = [
    node('entity:e1', 'person', 'Ada Lovelace', 'e1', 3),
    node('entity:e2', 'topic', 'Roadmap', 'e2', 0),
    node('entity-fact:f1', 'entityFact', 'Prefers async updates', 'f1', 2),
    node('twin-fact:t1', 'twinFact', 'Ships on Fridays', 't1', 1),
    node('session:m1', 'session', 'Kickoff', 'm1', 3),
  ];
  const edges: BrainGraphEdge[] = [
    { fromId: 'entity-fact:f1', toId: 'entity:e1', kind: 'attribution' },
    { fromId: 'entity-fact:f1', toId: 'session:m1', kind: 'provenance' },
    { fromId: 'entity:e1', toId: 'session:m1', kind: 'participation' },
    { fromId: 'twin-fact:t1', toId: 'session:m1', kind: 'provenance' },
  ];
  return { nodes, edges, droppedCount };
}

function seed(graph: BrainGraph = graphFixture()): void {
  useMemoryGraphStore.getState().setGraph(KEY, graph);
}

function nodeEl(id: string): Element {
  const el = document.querySelector(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`no node element for ${id}`);
  return el;
}

function positionOf(id: string): { x: number; y: number } {
  const transform = nodeEl(id).getAttribute('transform') ?? '';
  const match = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(transform);
  if (!match) throw new Error(`no position in transform: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** The fixture plus ONE newly-learned fact, attributed to Ada and nothing else —
 *  a single edge so the "strongest neighbour" anchor is unambiguous. */
const NEW_FACT_ID = 'entity-fact:f2';
function grownGraph(): BrainGraph {
  const base = graphFixture();
  return {
    nodes: [...base.nodes, node(NEW_FACT_ID, 'entityFact', 'Blocks Fridays for deep work', 'f2', 1)],
    edges: [...base.edges, { fromId: NEW_FACT_ID, toId: 'entity:e1', kind: 'attribution' }],
    droppedCount: 0,
  };
}

/** Push a refreshed payload into the store the way memoryGraphStore.refresh does
 *  — a new graph plus the diff's entering ids. */
function grow(): void {
  useMemoryGraphStore.setState((state) => ({
    scopes: { ...state.scopes, [KEY]: { graph: grownGraph(), entering: new Set([NEW_FACT_ID]) } },
  }));
}

beforeEach(() => {
  cleanup();
  prefersReducedMotion = false;
  useMemoryGraphStore.setState({ scopes: {}, activeScopeKey: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BrainMemoryGraph — rendering', () => {
  it('renders one element per graph node and one path per edge', () => {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);

    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(5);
    expect(document.querySelectorAll('[data-edge-key]')).toHaveLength(4);
    expect(nodeEl('entity:e1')).toHaveAttribute('data-node-type', 'person');
    expect(nodeEl('twin-fact:t1')).toHaveAttribute('data-node-type', 'twinFact');
    // Every node is reachable as a control (keyboard + screen reader).
    expect(screen.getByRole('button', { name: 'Person: Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session: Kickoff' })).toBeInTheDocument();
  });

  it('shows a placeholder instead of an empty canvas when no graph is loaded', () => {
    render(<BrainMemoryGraph scopeKey={KEY} />);
    expect(screen.getByText('No memories to show yet.')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(0);
  });

  it('positions every node at a finite coordinate (a NaN would blank the canvas)', () => {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);

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
    render(<BrainMemoryGraph scopeKey={KEY} />);
    expect(screen.getByTestId('memory-graph-dropped')).toHaveTextContent('+7 not shown');
  });

  it('renders no cap indicator when nothing was dropped', () => {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);
    expect(screen.queryByTestId('memory-graph-dropped')).toBeNull();
  });
});

describe('BrainMemoryGraph — hover highlighting', () => {
  it('lights the hovered node and its direct neighbours, fades everything else', () => {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);

    fireEvent.mouseOver(nodeEl('entity:e1')); // Ada: linked to the fact + the session

    expect(nodeEl('entity:e1')).not.toHaveAttribute('data-faded');
    expect(nodeEl('entity-fact:f1')).not.toHaveAttribute('data-faded');
    expect(nodeEl('session:m1')).not.toHaveAttribute('data-faded');
    // Unrelated memories recede.
    expect(nodeEl('entity:e2')).toHaveAttribute('data-faded', 'true');
    expect(nodeEl('twin-fact:t1')).toHaveAttribute('data-faded', 'true');
    // Edges light only if they TOUCH the hovered node: Ada's attribution and
    // participation edges stay lit; the fact->session and twinFact->session
    // provenance edges fade even though their endpoints are lit nodes.
    const edges = [...document.querySelectorAll('[data-edge-key]')];
    expect(edges.filter((e) => e.getAttribute('data-faded') === 'true')).toHaveLength(2);
  });

  it('reveals the hovered node label even while zoomed out below the label threshold', () => {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);
    expect(screen.queryByText('Ada Lovelace')).toBeNull();

    fireEvent.mouseOver(nodeEl('entity:e1'));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    fireEvent.mouseOut(nodeEl('entity:e1'));
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('clears the highlight on mouse-out (no re-simulation involved)', () => {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);

    fireEvent.mouseOver(nodeEl('entity:e1'));
    expect(nodeEl('entity:e2')).toHaveAttribute('data-faded', 'true');

    fireEvent.mouseOut(nodeEl('entity:e1'));
    expect(nodeEl('entity:e2')).not.toHaveAttribute('data-faded');
  });
});

describe('BrainMemoryGraph — inspection', () => {
  it('reports the clicked node to onInspect', () => {
    const onInspect = vi.fn();
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} onInspect={onInspect} />);

    fireEvent.click(nodeEl('session:m1'));

    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect.mock.calls[0][0]).toMatchObject({ id: 'session:m1', type: 'session', recordId: 'm1' });
  });

  it('anchors the pinned panel to its node and drops it when the node is gone', () => {
    seed();
    const { rerender } = render(
      <BrainMemoryGraph scopeKey={KEY} pinnedId="entity:e1" pinnedPanel={<div>panel body</div>} />,
    );
    expect(screen.getByTestId('memory-graph-pinned-card')).toHaveTextContent('panel body');

    rerender(<BrainMemoryGraph scopeKey={KEY} pinnedId="entity:nope" pinnedPanel={<div>panel body</div>} />);
    expect(screen.queryByTestId('memory-graph-pinned-card')).toBeNull();
  });
});

describe('BrainMemoryGraph — reduced motion (accessibility)', () => {
  it('renders the SETTLED layout with no animation frame at all', () => {
    prefersReducedMotion = true;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);

    const root = screen.getByTestId('brain-memory-graph');
    expect(root).toHaveAttribute('data-reduced-motion', 'true');
    // Already at rest on the very first paint — nothing left to animate...
    expect(root).toHaveAttribute('data-settled', 'true');
    // ...and this component asked for zero frames to get there (see file header
    // note 2: d3's own frames are invisible to this spy, so this counts ours).
    expect(rafSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// THE HARD CONSTRAINT: simulate-then-freeze. A permanent render loop would
// compete with Whisper and the local LLM for the same GPU, so idle must cost
// literally nothing.
// ---------------------------------------------------------------------------
describe('BrainMemoryGraph — settle discipline (zero rAF at idle)', () => {
  it('animates while settling, then schedules NOTHING once settled', () => {
    vi.useFakeTimers(); // fakes rAF too, so ~300 ticks run in milliseconds
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);

    // Window 1 — long enough for the simulation to reach rest (d3's alpha decay
    // settles in ~300 ticks; at one tick per 16ms frame that is well under 8s).
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(rafSpy.mock.calls.length).toBeGreaterThan(10); // it really did animate
    expect(screen.getByTestId('brain-memory-graph')).toHaveAttribute('data-settled', 'true');

    // Window 2 — idle. NOTHING may be scheduled: not one frame, not one interval.
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });

  // TWIN-GRAPH.1 Task 4 — a bloom is the SECOND sanctioned animation trigger, so
  // it must obey the same discipline: animate, then stop dead.
  it('re-freezes after a newly-learned memory blooms in', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('brain-memory-graph')).toHaveAttribute('data-settled', 'true');

    act(() => {
      grow();
    });
    expect(screen.getByTestId('brain-memory-graph')).toHaveAttribute('data-settled', 'false'); // it woke up
    const framesBeforeBloom = rafSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(rafSpy.mock.calls.length).toBeGreaterThan(framesBeforeBloom); // it really did animate
    expect(screen.getByTestId('brain-memory-graph')).toHaveAttribute('data-settled', 'true');

    // ...and idle costs exactly nothing again.
    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });

  it('unmounting mid-flight cancels the pending frame (a hidden Brain tab costs nothing)', () => {
    vi.useFakeTimers();
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    seed();
    const { unmount } = render(<BrainMemoryGraph scopeKey={KEY} />);

    act(() => {
      vi.advanceTimersByTime(100); // a handful of frames — still hot
    });
    expect(screen.getByTestId('brain-memory-graph')).toHaveAttribute('data-settled', 'false');

    unmount();
    expect(cancelSpy).toHaveBeenCalled();

    const framesAtUnmount = rafSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtUnmount);
  });
});

// ---------------------------------------------------------------------------
// THE EMOTIONAL PAYOFF: a memory the twin just learned grows OUT of what it is
// connected to, rather than teleporting in from its id-hash seed.
// ---------------------------------------------------------------------------
describe('BrainMemoryGraph — live growth', () => {
  function settleThenGrow(): void {
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    act(() => {
      grow();
    });
  }

  it('spawns a new node AT its strongest neighbour, not at its id-hash seed', () => {
    vi.useFakeTimers();
    settleThenGrow();

    // Read before any tick runs (fake rAF hasn't fired), so this is the spawn point.
    const anchor = positionOf('entity:e1'); // Ada — the fact's only neighbour
    const spawned = positionOf(NEW_FACT_ID);

    expect(Math.hypot(spawned.x - anchor.x, spawned.y - anchor.y)).toBeCloseTo(12, 5);
  });

  it('reheats the layout around exactly the entering nodes', () => {
    vi.useFakeTimers();
    const reheatSpy = vi.spyOn(ForceLayout.prototype, 'reheat');
    settleThenGrow();

    expect(reheatSpy).toHaveBeenCalledWith([NEW_FACT_ID]);
  });

  it('marks the arrival on the node so it blooms in once', () => {
    vi.useFakeTimers();
    settleThenGrow();

    expect(nodeEl(NEW_FACT_ID)).toHaveAttribute('data-entering', 'true');
    expect(nodeEl('entity:e1')).not.toHaveAttribute('data-entering');
    // The animation rides an INNER group — the outer one's transform attribute
    // positions the node and a CSS transform would override it.
    const inner = nodeEl(NEW_FACT_ID).querySelector('g');
    expect(inner?.getAttribute('style')).toContain('brain-node-enter');
  });

  it('does not touch a node that was already there', () => {
    vi.useFakeTimers();
    settleThenGrow();

    expect(nodeEl('entity:e1').querySelector('g')?.getAttribute('style')).toBeFalsy();
  });

  // ACCESSIBILITY: reduced motion means the memory is simply THERE.
  it('under reduced motion a new node appears with no animation and no frame', () => {
    prefersReducedMotion = true;
    seed();
    render(<BrainMemoryGraph scopeKey={KEY} />);
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const reheatSpy = vi.spyOn(ForceLayout.prototype, 'reheat');

    act(() => {
      grow();
    });

    expect(nodeEl(NEW_FACT_ID)).toBeInTheDocument();
    expect(nodeEl(NEW_FACT_ID)).toHaveAttribute('data-entering', 'true'); // state is still observable
    expect(nodeEl(NEW_FACT_ID).querySelector('g')?.getAttribute('style')).toBeFalsy();
    expect(reheatSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('brain-memory-graph')).toHaveAttribute('data-settled', 'true');
  });
});
