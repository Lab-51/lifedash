// @vitest-environment jsdom
// BRIEF-EVID.1 Task 5 — the Full-notes disclosure gains a settledness label and
// an evidence chip per decision/commitment.
//
// The load-bearing test here is the FIRST one: a v1 structure must render exactly
// what the pure `structureToText` produces, line for line, with no chip and no
// label. BriefFullNotes now walks the structure itself instead of splitting that
// text, so nothing but this assertion stops the two from drifting — and drift is
// not cosmetic: `structureToText` also feeds the twin/entity readers and the
// semantic index, which must never ingest a chip.
//
// All content below is invented (memory feedback_no_real_meeting_data).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BriefFullNotes from '../BriefFullNotes';
import { structureToText } from '../../../shared/utils/briefRecordText';
import type { Commitment, Decision, MeetingStructure } from '../../../shared/types/briefStructure';

const PROVENANCE = {
  provider: 'lmstudio',
  model: 'qwen3-4b-instruct',
  passes: 1,
  extractedAt: '2026-02-14T09:30:00.000Z',
  schemaVersion: 2 as const,
};

/** A v1 record as it sits in the database before this phase: no `status`, no
 *  `quote`, no `evidence` on any item. Cast because those fields are required on
 *  the v2 types — the point of the fixture is that the OLD shape still renders. */
function v1Structure(): MeetingStructure {
  return {
    topics: [{ title: 'Greenhouse irrigation retrofit', detail: 'Drip lines swap to the north field first.' }],
    decisions: [{ statement: 'Push the retrofit to next quarter', rationale: 'Parts are back-ordered' }],
    commitments: [{ owner: 'Talia Osei', task: 'Confirm the parts delivery window', due: 'Monday', explicit: true }],
    openQuestions: ['Who approves the vendor change?'],
    terms: ['drip line'],
    provenance: { ...PROVENANCE, schemaVersion: 1 },
  } as unknown as MeetingStructure;
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    statement: 'Push the retrofit to next quarter',
    rationale: null,
    status: 'agreed',
    quote: null,
    evidence: null,
    ...overrides,
  };
}

function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    owner: 'Talia Osei',
    task: 'Confirm the parts delivery window',
    due: null,
    explicit: true,
    quote: null,
    evidence: null,
    ...overrides,
  };
}

function makeStructure(overrides: Partial<MeetingStructure> = {}): MeetingStructure {
  return {
    topics: [],
    decisions: [],
    commitments: [],
    openQuestions: [],
    terms: [],
    provenance: PROVENANCE,
    ...overrides,
  };
}

/** What `renderLine` does to a record line, as visible text: a `### ` heading
 *  loses its marker, a `- ` bullet gains the bullet glyph the span renders. */
function asRendered(line: string): string {
  if (line.startsWith('### ')) return line.slice(4);
  if (line.startsWith('- ')) return `•${line.slice(2)}`;
  return line;
}

function renderedLines(container: HTMLElement): string[] {
  const body = container.querySelector('details > div');
  return Array.from(body?.children ?? []).map((el) => el.textContent ?? '');
}

describe('BriefFullNotes — a v1 record renders exactly as the pure renderer says', () => {
  it('matches structureToText line for line, with no status label and no chip', () => {
    const structure = v1Structure();
    const { container } = render(<BriefFullNotes structure={structure} onShowEvidence={vi.fn()} />);

    const expected = structureToText(structure)
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map(asRendered);

    expect(renderedLines(container)).toEqual(expected);
    // No chip, no badge, and therefore nothing clickable inside the disclosure.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryByText('unsupported')).not.toBeInTheDocument();
    expect(screen.queryByText('agreed')).not.toBeInTheDocument();
    expect(screen.queryByText('proposed')).not.toBeInTheDocument();
  });

  it('still renders nothing at all for an all-empty structure', () => {
    const { container } = render(<BriefFullNotes structure={makeStructure()} />);
    expect(container.querySelector('details')).toBeNull();
  });
});

describe('BriefFullNotes — settledness label', () => {
  it('labels each decision with its own status', () => {
    const structure = makeStructure({
      decisions: [
        makeDecision({ statement: 'Swap the north field lines', status: 'agreed' }),
        makeDecision({ statement: 'Move the vendor review', status: 'proposed' }),
        makeDecision({ statement: 'Cut the second pump', status: 'objected' }),
      ],
    });
    render(<BriefFullNotes structure={structure} />);

    expect(screen.getByText('agreed')).toBeInTheDocument();
    expect(screen.getByText('proposed')).toBeInTheDocument();
    expect(screen.getByText('objected')).toBeInTheDocument();
    // The statements themselves are untouched by the label.
    expect(screen.getByText(/Swap the north field lines/)).toBeInTheDocument();
  });
});

describe('BriefFullNotes — evidence chip', () => {
  const EXCERPT = 'we will confirm the delivery window on Monday';

  it('renders an mm:ss button carrying the excerpt, and jumps on click', () => {
    const onShowEvidence = vi.fn();
    const structure = makeStructure({
      commitments: [makeCommitment({ quote: EXCERPT, evidence: { startTime: 65_000, excerpt: EXCERPT } })],
    });
    render(<BriefFullNotes structure={structure} onShowEvidence={onShowEvidence} />);

    const chip = screen.getByRole('button', { name: 'Show passage at 01:05' });
    expect(chip).toHaveTextContent('01:05');
    expect(chip).toHaveAttribute('title', EXCERPT);

    fireEvent.click(chip);
    expect(onShowEvidence).toHaveBeenCalledTimes(1);
    expect(onShowEvidence).toHaveBeenCalledWith(EXCERPT);
  });

  it('degrades to a static label when the host cannot jump anywhere', () => {
    const structure = makeStructure({
      decisions: [makeDecision({ quote: EXCERPT, evidence: { startTime: 0, excerpt: EXCERPT } })],
    });
    const { container } = render(<BriefFullNotes structure={structure} />);

    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('flags a quote the transcript could not support, with no button to press', () => {
    const structure = makeStructure({
      decisions: [makeDecision({ quote: 'nobody actually said this', evidence: null })],
    });
    const { container } = render(<BriefFullNotes structure={structure} onShowEvidence={vi.fn()} />);

    const badge = screen.getByText('unsupported');
    expect(badge.closest('span')).toHaveAttribute('title', 'The transcript has no passage matching this quote');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('shows nothing for an item the model never quoted', () => {
    const structure = makeStructure({ commitments: [makeCommitment({ quote: null, evidence: null })] });
    const { container } = render(<BriefFullNotes structure={structure} onShowEvidence={vi.fn()} />);

    expect(screen.queryByText('unsupported')).not.toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
