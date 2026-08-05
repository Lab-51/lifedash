// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinMemoryGraphCanvas — the TIERED, force-simulated twin memory canvas, which
// TWIN-READ.2 Task 2 replaced with the riverbank and RETAINED UNREFERENCED, the
// same way TwinMemoryPanel and BrainMindMap are retained. This file is what
// makes that retention honest: the component still has to work, so reversing the
// swap stays a one-line question rather than an archaeology project.
//
// It renders the canvas DIRECTLY (the host now mounts TwinMemoryRiverCanvas), and
// covers only what is SPECIFIC TO THIS COMPONENT and therefore has no home in
// TwinMemoryGraph.test.tsx any more:
//   * the drawn tier rails and lane regions — the "structured, not Obsidian"
//     chrome the riverbank replaced with headings beside its hubs;
//   * simulate-then-freeze: it really animates, and then it really stops;
//   * the hover-swaps-to-full-text caption, retired on the river surface but
//     still the contract here;
//   * `isLabelVisible`, the disclosure-not-zoom rule, asserted directly.
// The behaviour both canvases share (disclosure, counts, keyboard, the safety
// triad) is exercised against the LIVE canvas in TwinMemoryGraph.test.tsx and is
// deliberately not duplicated here.
//
// d3 FACT the timer assertions depend on, verified in an earlier phase against
// the installed sources: d3-timer captures requestAnimationFrame at MODULE LOAD,
// so a later vi.spyOn never sees d3's own frames — which is what lets the
// reduced-motion test assert a hard "not called at all".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import '@testing-library/jest-dom';
import type { TwinGraphEdge, TwinGraphNode, TwinMemoryGraph } from '../../../../shared/types';

// jsdom has no matchMedia — the canvas's reduced-motion hook reads it.
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

const { default: TwinMemoryGraphCanvas, isLabelVisible } = await import('../TwinMemoryGraphCanvas');

const NOW_ISO = new Date().toISOString();
const NO_IDS: ReadonlySet<string> = new Set<string>();
const LONG_FACT = 'Prefers async written updates over status meetings, especially before 10am';

function fact(id: string, label: string, category: TwinGraphNode['category'], text?: string): TwinGraphNode {
  return {
    id: `fact:${id}`,
    type: 'fact',
    tier: 2,
    label,
    recordId: id,
    category,
    degree: 1,
    newestTimestamp: NOW_ISO,
    sourceMeetingId: null,
    sourceMeetingTitle: null,
    ...(text ? { text } : {}),
  };
}

/** Twin -> two populated hubs -> three facts, one of them carrying a full
 *  sentence far longer than its caption. */
function graphFixture(): TwinMemoryGraph {
  const nodes: TwinGraphNode[] = [
    {
      id: 'twin',
      type: 'twin',
      tier: 0,
      label: 'You',
      recordId: 'singleton',
      category: null,
      degree: 2,
      newestTimestamp: NOW_ISO,
    },
    {
      id: 'category:preference',
      type: 'category',
      tier: 1,
      label: 'Preference',
      recordId: 'preference',
      category: 'preference',
      degree: 3,
      newestTimestamp: NOW_ISO,
    },
    {
      id: 'category:person',
      type: 'category',
      tier: 1,
      label: 'Person',
      recordId: 'person',
      category: 'person',
      degree: 2,
      newestTimestamp: NOW_ISO,
    },
    fact('f1', 'Async updates', 'preference', LONG_FACT),
    fact('f2', 'Reviews PRs', 'preference'),
    fact('f3', 'Ada leads platform', 'person'),
  ];
  const edges: TwinGraphEdge[] = [
    { fromId: 'twin', toId: 'category:preference', kind: 'twin-hub' },
    { fromId: 'twin', toId: 'category:person', kind: 'twin-hub' },
    { fromId: 'category:preference', toId: 'fact:f1', kind: 'hub-fact' },
    { fromId: 'category:preference', toId: 'fact:f2', kind: 'hub-fact' },
    { fromId: 'category:person', toId: 'fact:f3', kind: 'hub-fact' },
  ];
  return { nodes, edges, droppedCount: 0 };
}

const onInspect = vi.fn();

/** Disclosure lives in a store in the app; here the harness holds it, so a hub
 *  click really does open its lane rather than only calling back. */
function Harness({ open = [] as string[] }) {
  const [expandedLanes, setExpandedLanes] = useState<ReadonlySet<string>>(new Set(open));
  return (
    <TwinMemoryGraphCanvas
      graph={graphFixture()}
      entering={NO_IDS}
      expandedLanes={expandedLanes}
      onToggleLane={(category) =>
        setExpandedLanes((current) => {
          const next = new Set(current);
          if (!next.delete(category)) next.add(category);
          return next;
        })
      }
      onInspect={onInspect}
    />
  );
}

function nodeEl(id: string): Element {
  const el = document.querySelector(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`no node element for ${id}`);
  return el;
}

function labelTextOf(id: string): string {
  const el = nodeEl(id).querySelector('text');
  if (!el) throw new Error(`no label element for ${id}`);
  return [...el.querySelectorAll('tspan')].map((t) => t.textContent ?? '').join(' ');
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  prefersReducedMotion = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TwinMemoryGraphCanvas (retained) — the drawn tier structure', () => {
  it('draws a labelled region per POPULATED category, and names what each tier means', () => {
    render(<Harness />);

    const lanes = [...document.querySelectorAll('[data-lane-key]')].map((el) => el.getAttribute('data-lane-key'));
    expect(lanes).toEqual(['person', 'preference']);
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    expect(screen.getByText('YOU')).toBeInTheDocument();
    expect(screen.getByText('CATEGORIES')).toBeInTheDocument();
    expect(screen.getByText('LEARNED FACTS')).toBeInTheDocument();
  });

  it('draws every connection as a filled tapered QUADRATIC ribbon — this canvas’s own curve family', () => {
    render(<Harness open={['preference', 'person']} />);

    const dendrites = [...document.querySelectorAll('[data-edge-key]')];
    expect(dendrites).toHaveLength(5);
    for (const el of dendrites) {
      expect(el.getAttribute('fill')).toMatch(/^url\(#twin-dendrite-/);
      expect(el.getAttribute('stroke')).toBe('none');
      const d = el.getAttribute('d') ?? '';
      expect(d).not.toContain('NaN');
      expect((d.match(/Q/g) ?? []).length).toBe(2);
    }
    expect(document.querySelectorAll('[data-terminal-for]')).toHaveLength(5);
  });

  it('opens collapsed and reveals a lane’s facts when its hub is activated', () => {
    render(<Harness />);

    expect(document.querySelectorAll('[data-node-type="fact"]')).toHaveLength(0);
    expect(nodeEl('category:preference')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(nodeEl('category:preference'));

    expect(document.querySelector('[data-node-id="fact:f1"]')).not.toBeNull();
    expect(document.querySelector('[data-node-id="fact:f3"]')).toBeNull();
    expect(nodeEl('category:preference')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('TwinMemoryGraphCanvas (retained) — hover reveals the full text', () => {
  it('captions a node with its SHORT label at rest and the WHOLE fact on hover', () => {
    render(<Harness open={['preference']} />);

    expect(nodeEl('fact:f1').querySelector('text')).toHaveAttribute('data-label-mode', 'rest');
    expect(labelTextOf('fact:f1')).toBe('Async updates');

    fireEvent.mouseEnter(nodeEl('fact:f1'));

    expect(nodeEl('fact:f1').querySelector('text')).toHaveAttribute('data-label-mode', 'full');
    expect(labelTextOf('fact:f1')).toBe(LONG_FACT);
  });

  it('isLabelVisible reads DISCLOSURE, never zoom', () => {
    expect(isLabelVisible({ type: 'twin', category: null }, new Set(), false)).toBe(true);
    expect(isLabelVisible({ type: 'category', category: 'preference' }, new Set(), false)).toBe(true);
    expect(isLabelVisible({ type: 'fact', category: 'preference' }, new Set(), false)).toBe(false);
    expect(isLabelVisible({ type: 'fact', category: 'preference' }, new Set(['preference']), false)).toBe(true);
    expect(isLabelVisible({ type: 'fact', category: 'preference' }, new Set(), true)).toBe(true);
  });
});

describe('TwinMemoryGraphCanvas (retained) — simulate-then-freeze', () => {
  it('animates while settling, then schedules NOTHING once settled', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const intervalSpy = vi.spyOn(window, 'setInterval');
    render(<Harness open={['preference', 'person']} />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(rafSpy.mock.calls.length).toBeGreaterThan(10); // it really did animate
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'true');

    const framesAtIdle = rafSpy.mock.calls.length;
    const intervalsAtIdle = intervalSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtIdle);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAtIdle);
  });

  it('reduced motion: renders the settled layout with no animation frame at all', () => {
    prefersReducedMotion = true;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<Harness open={['preference', 'person']} />);

    const canvas = screen.getByTestId('twin-memory-graph-canvas');
    expect(canvas).toHaveAttribute('data-reduced-motion', 'true');
    expect(canvas).toHaveAttribute('data-settled', 'true');
    expect(rafSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-node-id]')).toHaveLength(6);
  });

  it('unmounting mid-flight cancels the pending frame', () => {
    vi.useFakeTimers();
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = render(<Harness open={['preference', 'person']} />);

    act(() => {
      vi.advanceTimersByTime(100); // a handful of frames — still hot
    });
    expect(screen.getByTestId('twin-memory-graph-canvas')).toHaveAttribute('data-settled', 'false');

    unmount();
    expect(cancelSpy).toHaveBeenCalled();

    const framesAtUnmount = rafSpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rafSpy.mock.calls.length).toBe(framesAtUnmount);
  });
});
