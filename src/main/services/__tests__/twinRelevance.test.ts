// === FILE PURPOSE ===
// Unit tests for twinRelevance: learned facts are reordered by how much they
// share with the meeting at hand, stably, without ever dropping or altering one.
// Pure module — no mocks beyond the logger its fold helper imports.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { rankFactsByRelevance, meetingRelevanceText } from '../twinRelevance';

const FACTS = [
  'The office move is scheduled for spring',
  'Northwind renewal depends on the audit result',
  'Quarterly hiring plan was approved',
];

describe('rankFactsByRelevance', () => {
  it('puts the fact sharing words with the meeting first, keeping every fact', () => {
    const out = rankFactsByRelevance(FACTS, 'We reviewed the Northwind audit before the renewal call');
    expect(out[0]).toBe(FACTS[1]);
    expect([...out].sort()).toEqual([...FACTS].sort());
  });

  it('keeps the supplied (recency) order when nothing overlaps or the context is empty', () => {
    expect(rankFactsByRelevance(FACTS, 'completely different subject matter')).toEqual(FACTS);
    expect(rankFactsByRelevance(FACTS, '   ')).toEqual(FACTS);
  });

  it('is stable among equally relevant facts', () => {
    const facts = ['Budget for alpha', 'Budget for beta', 'Budget for gamma'];
    expect(rankFactsByRelevance(facts, 'budget')).toEqual(facts);
  });

  it('weights a word rare among the facts above two that most facts share', () => {
    // The first three facts share "budget" and "review"; only the last says "Kestrel".
    // By plain word count the shared pair wins (2 of 4 words against 1 of 3); by
    // rarity the one word that singles a fact out wins.
    const facts = [
      'Budget review covers hiring',
      'Budget review covers travel',
      'Budget review covers office',
      'Kestrel contract signed',
    ];
    expect(rankFactsByRelevance(facts, 'budget review kestrel')[0]).toBe(facts[3]);
  });

  it('a short specific fact beats long generic ones when the context is a whole transcript', () => {
    const facts = [
      'The team reviewed the weekly status update and agreed that everyone should keep sharing progress notes before the meeting',
      'During the meeting the team agreed that the weekly planning notes should be shared with everyone before the review',
      'Zephyr launch slips',
    ];
    const transcript = [
      'Okay team, this is the weekly meeting, thanks everyone for joining.',
      'We agreed last time that the planning notes get shared before the review.',
      'Status update from me: progress is fine on most things, we keep going.',
      'One real change though, the Zephyr launch slips by two weeks.',
      'Sharing the notes after the meeting, as usual.',
    ].join('\n');
    expect(rankFactsByRelevance(facts, transcript)[0]).toBe(facts[2]);
  });

  it('a word every fact contains adds nothing, however many such words match', () => {
    // "team", "budget" and "review" are in all three facts, so they say nothing about
    // which fact this meeting is about; only "Kestrel" does.
    const facts = [
      'Team budget review postponed',
      'Team budget review approved hiring',
      'Team budget review: Marta Kowalski leads Kestrel',
    ];
    expect(rankFactsByRelevance(facts, 'team budget review, kestrel came up')[0]).toBe(facts[2]);
  });

  it('ignores words of three letters or fewer', () => {
    const facts = ['Ana and Bob are off', 'Kestrel audit done'];
    // Every word of the first fact is short; matching "and"/"are"/"off" says nothing.
    expect(rankFactsByRelevance(facts, 'and we are off to the kestrel review')[0]).toBe(facts[1]);
  });

  it('keeps a short word that carries a digit', () => {
    const facts = ['Hiring plan approved', 'Budget moved to Q3'];
    expect(rankFactsByRelevance(facts, 'what about q3')[0]).toBe(facts[1]);
  });

  it('matches across diacritics and inflected endings', () => {
    const facts = ['Unrelated housekeeping note', 'Marta owns the Brno invoices'];
    expect(rankFactsByRelevance(facts, 'Martě asked about the invoice from brno')[0]).toBe(facts[1]);
  });
});

describe('meetingRelevanceText', () => {
  it('joins the title and the transcript lines, tolerating missing parts', () => {
    expect(meetingRelevanceText({ title: 'Sync', segments: [{ content: 'one' }, { content: 'two' }] })).toBe(
      'Sync\none\ntwo',
    );
    expect(meetingRelevanceText({})).toBe('');
  });
});
