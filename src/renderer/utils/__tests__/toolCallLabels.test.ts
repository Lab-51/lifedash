// The 22-identical-rows bug: a model can emit many tool calls in ONE step
// (stepCountIs bounds steps, not calls), and the chat rendered one row per call
// with a label that discarded the query — so an answer arrived buried under
// twenty interchangeable "Searched transcript" lines.
import { describe, it, expect } from 'vitest';
import { describeToolCall, describeToolEvent, groupToolCalls } from '../toolCallLabels';
import type { ToolCallRecord } from '../../../shared/types';

const search = (id: string, query?: string): ToolCallRecord => ({
  id,
  name: 'searchTranscript',
  args: query === undefined ? {} : { query },
});

describe('describeToolCall / describeToolEvent — the query is the information', () => {
  it('names what was searched for', () => {
    expect(describeToolCall(search('c1', 'pricing'))).toBe('Searched transcript for “pricing”');
    expect(describeToolEvent('searchTranscript', { query: 'pricing' })).toBe('Searching transcript for “pricing”…');
  });

  it('falls back to the bare label when no query is present', () => {
    expect(describeToolCall(search('c1'))).toBe('Searched transcript');
    expect(describeToolCall(search('c1', '   '))).toBe('Searched transcript');
    expect(describeToolEvent('searchTranscript', undefined)).toBe('Searching transcript…');
  });

  it('still labels the other tools it always did', () => {
    expect(describeToolCall({ id: 'c', name: 'getMeetingContext', args: {} })).toBe('Loaded meeting context');
    expect(describeToolCall({ id: 'c', name: 'createCardInInbox', args: { title: 'Ship it' } })).toBe(
      'Created card: "Ship it"',
    );
    expect(describeToolCall({ id: 'c', name: 'somethingNew', args: {} })).toBe('Ran somethingNew');
  });
});

describe('groupToolCalls — collapsing the wall of identical rows', () => {
  it('collapses a run of identical calls into one counted row', () => {
    const grouped = groupToolCalls([search('a', 'x'), search('b', 'x'), search('c', 'x')]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ label: 'Searched transcript for “x”', count: 3, failed: false });
  });

  it('keeps DIFFERENT queries as separate rows — they are different work', () => {
    const grouped = groupToolCalls([search('a', 'pricing'), search('b', 'hiring')]);

    expect(grouped.map((g) => g.label)).toEqual([
      'Searched transcript for “pricing”',
      'Searched transcript for “hiring”',
    ]);
  });

  it('only merges ADJACENT duplicates, preserving the real order of work', () => {
    const grouped = groupToolCalls([
      search('a', 'x'),
      search('b', 'x'),
      { id: 'w', name: 'getTranscriptWindow', args: {} },
      search('c', 'x'),
    ]);

    expect(grouped.map((g) => [g.label, g.count])).toEqual([
      ['Searched transcript for “x”', 2],
      ['Read transcript window', 1],
      ['Searched transcript for “x”', 1],
    ]);
  });

  it('never merges a failure into a success — the icon would misreport the run', () => {
    const grouped = groupToolCalls([search('a', 'x'), search('b', 'x')], (call) => call.id === 'b');

    expect(grouped.map((g) => [g.count, g.failed])).toEqual([
      [1, false],
      [1, true],
    ]);
  });

  it('handles the empty case', () => {
    expect(groupToolCalls([])).toEqual([]);
  });
});
