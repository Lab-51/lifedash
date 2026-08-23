// @vitest-environment jsdom
// BriefSection.renderLine (BRIEF-QUAL.1 Task 4): the renderer stays heading-
// agnostic — legacy briefs (## / - / plain lines only) must render byte-for-byte
// identically to before, `### ` gains a smaller owner-group heading, and the
// `_Summarized in N passes (long meeting)._` footer renders as muted small text
// instead of a body paragraph. Also covers the "Regenerate to include them"
// participants-edited hint (Task 4's session-scoped store flag).
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import BriefSection from '../BriefSection';
import { useMeetingStore } from '../../stores/meetingStore';
import type { MeetingBrief } from '../../../shared/types';

function makeBrief(summary: string): MeetingBrief {
  return { id: 'brief-1', meetingId: 'meeting-1', summary, structure: null, createdAt: new Date().toISOString() };
}

describe('BriefSection — legacy rendering stays byte-identical', () => {
  beforeEach(() => {
    useMeetingStore.setState({ briefErrors: {}, participantsEditedAfterBrief: {} });
  });

  it('renders a legacy-shaped brief (## headings, - bullets, plain lines) unchanged', () => {
    const legacy = makeBrief('## Summary\nWe discussed the roadmap.\n- Ship the beta\n- Fix the crash bug');
    const { container } = render(
      <BriefSection meetingId="meeting-1" brief={legacy} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );

    const heading = screen.getByText('Summary');
    expect(heading.tagName).toBe('H4');
    expect(heading.className).toContain('font-semibold');

    expect(screen.getByText('We discussed the roadmap.').tagName).toBe('P');
    expect(screen.getByText('Ship the beta').tagName).toBe('P');
    expect(screen.getByText('Fix the crash bug').tagName).toBe('P');

    // No new heading level or footer styling leaks into a legacy brief.
    expect(container.querySelectorAll('h5')).toHaveLength(0);
  });

  it('skips blank lines exactly as before', () => {
    const legacy = makeBrief('## Summary\n\nOne line.\n\n');
    render(
      <BriefSection meetingId="meeting-1" brief={legacy} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );
    expect(screen.getByText('One line.')).toBeInTheDocument();
  });
});

describe('BriefSection — ### owner sub-headings (BRIEF-QUAL.1 Task 4)', () => {
  beforeEach(() => {
    useMeetingStore.setState({ briefErrors: {}, participantsEditedAfterBrief: {} });
  });

  it('renders a ### line as a smaller heading than ##', () => {
    const brief = makeBrief('## Follow-ups\n### Alex Chen\n- Send the doc\n### Unassigned\n- Book the room');
    render(
      <BriefSection meetingId="meeting-1" brief={brief} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );

    const section = screen.getByText('Follow-ups');
    expect(section.tagName).toBe('H4');
    const owner = screen.getByText('Alex Chen');
    expect(owner.tagName).toBe('H5');
    const unassigned = screen.getByText('Unassigned');
    expect(unassigned.tagName).toBe('H5');
    expect(screen.getByText('Send the doc')).toBeInTheDocument();
    expect(screen.getByText('Book the room')).toBeInTheDocument();
  });
});

describe('BriefSection — chunked-extraction footer (BRIEF-QUAL.1 Task 4)', () => {
  beforeEach(() => {
    useMeetingStore.setState({ briefErrors: {}, participantsEditedAfterBrief: {} });
  });

  it('renders the exact _Summarized in N passes (long meeting)._ line as muted small text', () => {
    const brief = makeBrief('## Summary\nLong meeting recap.\n\n_Summarized in 3 passes (long meeting)._');
    render(
      <BriefSection meetingId="meeting-1" brief={brief} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );

    const footer = screen.getByText('Summarized in 3 passes (long meeting).');
    expect(footer.tagName).toBe('P');
    expect(footer.className).toContain('italic');
    expect(footer.className).toContain('text-xs');
  });

  it('leaves a line that merely starts with an underscore, but is not the exact footer, as a normal paragraph', () => {
    const brief = makeBrief('_Note: not the footer line');
    render(
      <BriefSection meetingId="meeting-1" brief={brief} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );
    const line = screen.getByText('_Note: not the footer line');
    expect(line.className).not.toContain('italic');
  });
});

describe('BriefSection — participants-edited Regenerate hint', () => {
  beforeEach(() => {
    useMeetingStore.setState({ briefErrors: {}, participantsEditedAfterBrief: {} });
  });

  it('shows the hint next to Regenerate when participants changed after this brief', () => {
    useMeetingStore.setState({ participantsEditedAfterBrief: { 'meeting-1': true } });
    const brief = makeBrief('## Summary\nHello.');
    render(
      <BriefSection meetingId="meeting-1" brief={brief} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );
    expect(screen.getByText(/participants changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });

  it('does not show the hint when participants were not edited since the brief', () => {
    const brief = makeBrief('## Summary\nHello.');
    render(
      <BriefSection meetingId="meeting-1" brief={brief} isCompleted generatingBrief={false} onGenerate={() => {}} />,
    );
    expect(screen.queryByText(/participants changed/i)).not.toBeInTheDocument();
  });
});
