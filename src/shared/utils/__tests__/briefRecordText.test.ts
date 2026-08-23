// Unit tests for the deterministic structure-to-text renderer (BRIEF-QUAL.2).
// Pure functions, no mocks. Fixture content below is entirely invented — no real
// meeting text (memory feedback_no_real_meeting_data).

import { describe, it, expect } from 'vitest';
import { structureToText, countsLabel, briefRecordText } from '../briefRecordText';
import type { MeetingStructure } from '../../types/briefStructure';

const PROVENANCE = {
  provider: 'lmstudio',
  model: 'qwen3-4b-instruct',
  passes: 2,
  extractedAt: '2026-02-14T09:30:00.000Z',
  schemaVersion: 1 as const,
};

function makeStructure(overrides: Partial<MeetingStructure> = {}): MeetingStructure {
  return {
    topics: [{ title: 'Warehouse routing pilot', detail: 'Pilot expands to the north dock next month.' }],
    decisions: [{ statement: 'Delay the pilot expansion two weeks', rationale: 'Forklift telemetry is still noisy' }],
    commitments: [
      { owner: 'Priya Nandakumar', task: 'Recalibrate the dock sensors', due: 'next Tuesday', explicit: true },
    ],
    openQuestions: ['Who signs off on the telemetry vendor swap?'],
    terms: ['dock telemetry', 'pilot expansion'],
    provenance: PROVENANCE,
    ...overrides,
  };
}

function makeEmptyStructure(): MeetingStructure {
  return { topics: [], decisions: [], commitments: [], openQuestions: [], terms: [], provenance: PROVENANCE };
}

describe('structureToText', () => {
  it('is deterministic — the same input produces the same string', () => {
    const structure = makeStructure();
    expect(structureToText(structure)).toBe(structureToText(structure));
  });

  it('returns an empty string when every section is empty', () => {
    expect(structureToText(makeEmptyStructure())).toBe('');
  });

  it('omits the Topics section when there are no topics', () => {
    expect(structureToText(makeStructure({ topics: [] }))).not.toContain('### Topics');
  });

  it('omits the Decisions section when there are no decisions', () => {
    expect(structureToText(makeStructure({ decisions: [] }))).not.toContain('### Decisions');
  });

  it('omits the Commitments section when there are no commitments', () => {
    expect(structureToText(makeStructure({ commitments: [] }))).not.toContain('### Commitments');
  });

  it('omits the Open questions section when there are none', () => {
    expect(structureToText(makeStructure({ openQuestions: [] }))).not.toContain('### Open questions');
  });

  it('omits the Terms section when there are none', () => {
    expect(structureToText(makeStructure({ terms: [] }))).not.toContain('### Terms');
  });

  it('renders a topic without a detail as just the title', () => {
    const text = structureToText(
      makeStructure({
        topics: [{ title: 'Standalone topic', detail: '' }],
        decisions: [],
        commitments: [],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Topics\n- Standalone topic');
  });

  it('renders a topic with a detail appended after an em dash', () => {
    const text = structureToText(
      makeStructure({
        topics: [{ title: 'Rollout plan', detail: 'Ships in three phases' }],
        decisions: [],
        commitments: [],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Topics\n- Rollout plan — Ships in three phases');
  });

  it('renders a decision without a rationale as just the statement', () => {
    const text = structureToText(
      makeStructure({
        topics: [],
        decisions: [{ statement: 'Ship on Friday', rationale: null }],
        commitments: [],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Decisions\n- Ship on Friday');
  });

  it('renders unassigned when a commitment owner is not marked explicit', () => {
    const text = structureToText(
      makeStructure({
        topics: [],
        decisions: [],
        commitments: [{ owner: 'Devon Ashworth', task: 'Send the recap', due: null, explicit: false }],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Commitments\n- Send the recap — unassigned');
  });

  it('renders the named owner when explicit is true', () => {
    const text = structureToText(
      makeStructure({
        topics: [],
        decisions: [],
        commitments: [{ owner: 'Devon Ashworth', task: 'Send the recap', due: null, explicit: true }],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Commitments\n- Send the recap — Devon Ashworth');
  });

  it('falls back to unassigned when explicit is true but there is no owner', () => {
    const text = structureToText(
      makeStructure({
        topics: [],
        decisions: [],
        commitments: [{ owner: null, task: 'Send the recap', due: null, explicit: true }],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Commitments\n- Send the recap — unassigned');
  });

  it('appends the due date in parentheses when set', () => {
    const text = structureToText(
      makeStructure({
        topics: [],
        decisions: [],
        commitments: [{ owner: 'Devon Ashworth', task: 'Send the recap', due: 'Friday', explicit: true }],
        openQuestions: [],
        terms: [],
      }),
    );
    expect(text).toBe('### Commitments\n- Send the recap — Devon Ashworth (due Friday)');
  });

  it('joins terms on one line separated by commas', () => {
    const text = structureToText(
      makeStructure({
        topics: [],
        decisions: [],
        commitments: [],
        openQuestions: [],
        terms: ['alpha', 'beta', 'gamma'],
      }),
    );
    expect(text).toBe('### Terms\nalpha, beta, gamma');
  });

  it('never includes provenance fields in the rendered text', () => {
    const text = structureToText(makeStructure());
    expect(text).not.toContain(PROVENANCE.provider);
    expect(text).not.toContain(PROVENANCE.model);
    expect(text).not.toContain(PROVENANCE.extractedAt);
    expect(text).not.toContain('passes');
  });

  it('keeps sections in fixed order, one blank line apart, with no trailing whitespace', () => {
    const text = structureToText(makeStructure());
    const topicsIdx = text.indexOf('### Topics');
    const decisionsIdx = text.indexOf('### Decisions');
    const commitmentsIdx = text.indexOf('### Commitments');
    const questionsIdx = text.indexOf('### Open questions');
    const termsIdx = text.indexOf('### Terms');

    expect(topicsIdx).toBe(0);
    expect(topicsIdx).toBeLessThan(decisionsIdx);
    expect(decisionsIdx).toBeLessThan(commitmentsIdx);
    expect(commitmentsIdx).toBeLessThan(questionsIdx);
    expect(questionsIdx).toBeLessThan(termsIdx);
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).not.toMatch(/[ \t]+$/m);
    expect(text.endsWith('\n')).toBe(false);
  });
});

describe('countsLabel', () => {
  it('uses singular forms when a count is exactly one', () => {
    expect(countsLabel(makeStructure())).toBe('1 topic · 1 decision · 1 commitment · 1 question');
  });

  it('uses plural forms when counts are greater than one', () => {
    const structure = makeStructure({
      topics: [
        { title: 'Topic one', detail: '' },
        { title: 'Topic two', detail: '' },
      ],
      decisions: [
        { statement: 'Decision one', rationale: null },
        { statement: 'Decision two', rationale: null },
      ],
      commitments: [
        { owner: null, task: 'Task one', due: null, explicit: false },
        { owner: null, task: 'Task two', due: null, explicit: false },
      ],
      openQuestions: ['Question one', 'Question two'],
    });
    expect(countsLabel(structure)).toBe('2 topics · 2 decisions · 2 commitments · 2 questions');
  });

  it('omits zero-count parts and ignores terms entirely', () => {
    const structure = makeStructure({ decisions: [], openQuestions: [], terms: ['still ignored'] });
    expect(countsLabel(structure)).toBe('1 topic · 1 commitment');
  });

  it('returns an empty string when every count is zero', () => {
    expect(countsLabel(makeEmptyStructure())).toBe('');
  });
});

describe('briefRecordText', () => {
  it('returns the summary unchanged, not even trimmed, when structure is null', () => {
    const summary = '  Summary with padding.  \n';
    expect(briefRecordText(summary, null)).toBe(summary);
  });

  it('returns the summary unchanged when the structure is all-empty', () => {
    const summary = 'Just a plain summary.';
    expect(briefRecordText(summary, makeEmptyStructure())).toBe(summary);
  });

  it('appends exactly one Full notes heading followed by the rendered structure', () => {
    const summary = 'Team discussed the pilot.';
    const structure = makeStructure();
    const result = briefRecordText(summary, structure);

    expect(result).toBe(`${summary}\n\n## Full notes\n${structureToText(structure)}`);
    expect(result.split('## Full notes').length - 1).toBe(1);
  });

  it('trims trailing whitespace off the summary before appending', () => {
    const summary = 'Team discussed the pilot.   \n\n';
    const result = briefRecordText(summary, makeStructure());
    expect(result.startsWith('Team discussed the pilot.\n\n## Full notes')).toBe(true);
  });
});
