// === FILE PURPOSE ===
// The pure half of TWIN-READ.1 Task 3's label fix: `wrapLabelLines`, the
// deterministic CHARACTER-budget word wrap the twin memory graph captions its
// nodes with, plus the native halo props.
//
// WHY A CHARACTER BUDGET IS THE POINT, not a shortcut: a spike against this
// project's jsdom found SVG text measurement entirely absent (`getBBox`,
// `getComputedTextLength`, `getSubStringLength` are not functions on jsdom's
// SVGElement) and `<foreignObject>` content unmeasurable (every offset/scroll/
// rect is 0 — jsdom has no layout engine). Any measurement-based wrap would
// therefore be untestable: the test could only assert that a stub was called.
// A character budget behaves IDENTICALLY in the app and here, which is what
// makes the assertions below real.
//
// The invariants that matter are all about NOT LOSING TEXT: whitespace collapses
// rather than producing blank lines, a word too long to break on is hard-chunked
// instead of overflowing its lane, and content dropped past the line cap is
// marked with an ellipsis rather than vanishing silently.

import { describe, it, expect } from 'vitest';
import { LABEL_HALO_PROPS, LABEL_LINE_CHARS, LABEL_MAX_LINES, truncateLabel, wrapLabelLines } from '../graphVisuals';

describe('wrapLabelLines', () => {
  it('keeps a short label on a single line, untouched', () => {
    expect(wrapLabelLines('Async updates')).toEqual(['Async updates']);
  });

  it('breaks on word boundaries and never exceeds the character budget', () => {
    const lines = wrapLabelLines('Prefers async written updates over status meetings', 20, 6);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    // Nothing was lost or reordered: the lines rejoin to the original.
    expect(lines.join(' ')).toBe('Prefers async written updates over status meetings');
  });

  it('collapses runs of whitespace instead of emitting blank lines', () => {
    expect(wrapLabelLines('  Reviews   PRs \n before standup  ', 40, 4)).toEqual(['Reviews PRs before standup']);
  });

  it('hard-chunks a word with no break opportunity rather than letting it overflow', () => {
    const lines = wrapLabelLines('supercalifragilisticexpialidocious', 10, 6);

    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
    expect(lines.join('')).toBe('supercalifragilisticexpialidocious');
  });

  it('ellipsises the last line when content overflows the line cap — never drops it silently', () => {
    const lines = wrapLabelLines('one two three four five six seven eight nine ten', 10, 2);

    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  });

  it('adds NO ellipsis when the text fits exactly within the cap', () => {
    const lines = wrapLabelLines('one two three four', 10, 2);

    expect(lines).toEqual(['one two', 'three four']);
    expect(lines.join(' ')).not.toContain('…');
  });

  it('returns no lines for blank input, so the caller can render nothing rather than an empty box', () => {
    expect(wrapLabelLines('')).toEqual([]);
    expect(wrapLabelLines('   \n  ')).toEqual([]);
  });

  it('survives a degenerate budget without looping or emitting NaN-width lines', () => {
    const lines = wrapLabelLines('abc def', 0, 0);

    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeGreaterThan(0);
  });

  it('holds factLabel.ts’s 40-character ceiling WITHOUT truncating, at the resting defaults', () => {
    // The longest label the shared accessor can ever produce (40 chars) must
    // wrap, not get cut — a stored label is already short on purpose.
    const longest = 'Quarterly pricing review deferred agai…';
    const lines = wrapLabelLines(longest, LABEL_LINE_CHARS, LABEL_MAX_LINES);

    expect(lines.length).toBeLessThanOrEqual(LABEL_MAX_LINES);
    expect(lines.join(' ')).toBe(longest);
  });
});

describe('LABEL_HALO_PROPS', () => {
  it('uses the NATIVE paint-order knockout over a theme surface colour, not a hand-rolled shadow', () => {
    expect(LABEL_HALO_PROPS.style).toEqual({ paintOrder: 'stroke' });
    expect(LABEL_HALO_PROPS.stroke).toBe('var(--color-chrome)');
    expect(LABEL_HALO_PROPS.strokeWidth).toBeGreaterThan(0);
  });
});

describe('truncateLabel (retained for the entity graph)', () => {
  it('still behaves exactly as BrainMemoryGraph depends on', () => {
    expect(truncateLabel('short')).toBe('short');
    expect(truncateLabel('x'.repeat(40))).toBe(`${'x'.repeat(33)}…`);
  });
});
