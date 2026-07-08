// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the Digital Twin DEEP interview panel (V3.3.5 Task 2). Mocks
// window.electronAPI (twinInterviewNext / twinInterviewSynthesize) to verify the
// load-bearing behaviour: it asks the first question on mount, loops through Q&A
// (accumulating turns), supports Skip + Finish-now anytime, synthesizes on the
// model's `done` signal or on finish and hands the draft UP via onDraft (never
// saving itself), and degrades to a NON-BLOCKING notice offering the manual form
// whenever an AI turn is skipped/failed.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeepInterviewPanel from '../DeepInterviewPanel';
import type { TwinProfileSections } from '../../../../shared/types/twin';

const twinInterviewNext = vi.fn();
const twinInterviewSynthesize = vi.fn();

vi.stubGlobal('electronAPI', { twinInterviewNext, twinInterviewSynthesize });

const DRAFT: Partial<TwinProfileSections> = {
  identity: { name: 'Ada' },
  projects: [{ name: 'Replatform' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeepInterviewPanel — the question loop', () => {
  it('asks the first question on mount and shows progress', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'What is your role?' });
    render(<DeepInterviewPanel brief="A senior PM" onBack={vi.fn()} onDraft={vi.fn()} />);

    expect(await screen.findByText('What is your role?')).toBeInTheDocument();
    expect(screen.getByText(/question 1 of up to 8/i)).toBeInTheDocument();
    // Seeded from the brief and asked with an empty Q&A.
    expect(twinInterviewNext).toHaveBeenCalledWith({ brief: 'A senior PM', profileSoFar: {}, qa: [] });
  });

  it('advances to the next question, accumulating the answered turn', async () => {
    twinInterviewNext
      .mockResolvedValueOnce({ status: 'ok', question: 'Q1?' })
      .mockResolvedValueOnce({ status: 'ok', question: 'Q2?' });
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I am a PM' } });
    fireEvent.click(screen.getByRole('button', { name: /next question/i }));

    expect(await screen.findByText('Q2?')).toBeInTheDocument();
    expect(screen.getByText(/question 2 of up to 8/i)).toBeInTheDocument();
    expect(twinInterviewNext.mock.calls[1][0].qa).toEqual([{ question: 'Q1?', answer: 'I am a PM' }]);
  });

  it('Next question is disabled until an answer is typed', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);
    await screen.findByText('Q1?');
    expect(screen.getByRole('button', { name: /next question/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ok' } });
    expect(screen.getByRole('button', { name: /next question/i })).toBeEnabled();
  });

  it('Skip question advances without requiring an answer, recording an empty turn', async () => {
    twinInterviewNext
      .mockResolvedValueOnce({ status: 'ok', question: 'Q1?' })
      .mockResolvedValueOnce({ status: 'ok', question: 'Q2?' });
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);

    await screen.findByText('Q1?');
    fireEvent.click(screen.getByRole('button', { name: /skip question/i }));

    expect(await screen.findByText('Q2?')).toBeInTheDocument();
    expect(twinInterviewNext.mock.calls[1][0].qa).toEqual([{ question: 'Q1?', answer: '' }]);
  });
});

describe('DeepInterviewPanel — synthesis handoff', () => {
  it('auto-synthesizes when the model reports done and hands the draft up via onDraft', async () => {
    twinInterviewNext
      .mockResolvedValueOnce({ status: 'ok', question: 'Q1?' })
      .mockResolvedValueOnce({ status: 'done' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'ok', draft: DRAFT });
    const onDraft = vi.fn();
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={onDraft} />);

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } });
    fireEvent.click(screen.getByRole('button', { name: /next question/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(DRAFT));
    expect(twinInterviewSynthesize.mock.calls[0][0].qa).toEqual([{ question: 'Q1?', answer: 'answer' }]);
  });

  it('Finish now synthesizes immediately, including the current in-progress answer', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'ok', draft: DRAFT });
    const onDraft = vi.fn();
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={onDraft} />);

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(DRAFT));
    expect(twinInterviewSynthesize.mock.calls[0][0].qa).toEqual([{ question: 'Q1?', answer: 'my answer' }]);
  });
});

describe('DeepInterviewPanel — AI failure degrades to the manual path', () => {
  it('shows a non-blocking notice offering the form when the first question is skipped (no model)', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'skipped', reason: 'no-model' });
    const onBack = vi.fn();
    render(<DeepInterviewPanel brief="" onBack={onBack} onDraft={vi.fn()} />);

    expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fill the form instead/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows a non-blocking notice and never calls onDraft when synthesis is skipped', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'skipped', reason: 'failed' });
    const onDraft = vi.fn();
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={onDraft} />);

    await screen.findByText('Q1?');
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));

    expect(await screen.findByText(/couldn't continue/i)).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('"Back to options" always returns to the mode choice', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    const onBack = vi.fn();
    render(<DeepInterviewPanel brief="" onBack={onBack} onDraft={vi.fn()} />);

    await screen.findByText('Q1?');
    fireEvent.click(screen.getByRole('button', { name: /back to options/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onDraft when the panel unmounts before synthesis resolves (finding #6.4)', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    let resolveSynth!: (v: unknown) => void;
    twinInterviewSynthesize.mockReturnValue(new Promise((r) => (resolveSynth = r)));
    const onDraft = vi.fn();
    const { unmount } = render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={onDraft} />);

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));

    // The user navigates away (the wizard removes the panel) mid-synthesis…
    unmount();
    // …and only THEN does the slow synthesize resolve.
    resolveSynth({ status: 'ok', draft: DRAFT });
    await Promise.resolve();
    await Promise.resolve();

    expect(onDraft).not.toHaveBeenCalled();
  });
});

describe('DeepInterviewPanel — a11y (finding #6.6)', () => {
  it('announces the question (aria-live) and moves focus to the answer box each turn', async () => {
    twinInterviewNext
      .mockResolvedValueOnce({ status: 'ok', question: 'Q1?' })
      .mockResolvedValueOnce({ status: 'ok', question: 'Q2?' });
    render(<DeepInterviewPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);

    // The question sits in a polite live region and is tied to the answer box.
    const q1 = await screen.findByText('Q1?');
    expect(q1).toHaveAttribute('aria-live', 'polite');
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('aria-describedby', q1.getAttribute('id'));
    // Focus lands on the answer box so keyboard users can type immediately…
    expect(box).toHaveFocus();

    // …and it re-focuses when the next question loads (not dropped to <body>).
    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: /next question/i }));
    await screen.findByText('Q2?');
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
});
