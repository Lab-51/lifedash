// @vitest-environment jsdom
// TRANS-COV.1 Task 5 — RetranscribeControl: absent while recording or with no
// pending span, present otherwise with the largest downloaded model
// preselected, and its snap-to-rows widening (Task 4 review finding: the
// service deletes whole overlapping rows but only reads audio for the
// requested span, so the UI must widen BEFORE sending or it silently drops
// text — see RetranscribeControl.tsx's own header).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const getWhisperModels = vi.fn();
const retranscribeSpan = vi.fn();

vi.stubGlobal('electronAPI', { getWhisperModels, retranscribeSpan });

const { useRecordingStore } = await import('../../stores/recordingStore');
const { default: RetranscribeControl, snapSpanToRows } = await import('../meeting-detail/RetranscribeControl');
import type { TranscriptSegment, WhisperModel } from '../../../shared/types';

function makeModel(overrides: Partial<WhisperModel> = {}): WhisperModel {
  return {
    name: 'model',
    fileName: 'ggml-model.bin',
    size: '75 MB',
    description: '',
    available: true,
    recommended: false,
    ...overrides,
  };
}

function makeSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'seg-1',
    meetingId: 'meet-1',
    content: 'hello',
    startTime: 0,
    endTime: 10000,
    speaker: null,
    createdAt: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRecordingStore.setState({ isRecording: false });
  getWhisperModels.mockResolvedValue([
    makeModel({ name: 'small', fileName: 'small.bin', size: '75 MB' }),
    makeModel({ name: 'large', fileName: 'large.bin', size: '1.5 GB', recommended: true }),
    makeModel({ name: 'medium', fileName: 'medium.bin', size: '466 MB' }),
    makeModel({ name: 'not-downloaded', fileName: 'ghost.bin', size: '9 GB', available: false }),
  ]);
  retranscribeSpan.mockResolvedValue({
    ok: true,
    replaced: 1,
    inserted: 1,
    segments: [makeSegment({ id: 'new-1', content: 'Replacement' })],
    clampedEndMs: 10000,
  });
});

describe('snapSpanToRows', () => {
  it('widens a mid-row span to cover the whole row it starts in', () => {
    const segments = [makeSegment({ startTime: 5000, endTime: 15000 })];
    expect(snapSpanToRows({ startMs: 8000, endMs: 12000 }, segments)).toEqual({ startMs: 0, endMs: 20000 });
  });

  it('snaps a pure-gap span (no overlapping row) to 10-second window stamps', () => {
    expect(snapSpanToRows({ startMs: 12000, endMs: 18000 }, [])).toEqual({ startMs: 10000, endMs: 20000 });
  });

  it('leaves an already row- and window-aligned span unchanged', () => {
    const segments = [makeSegment({ startTime: 0, endTime: 10000 })];
    expect(snapSpanToRows({ startMs: 0, endMs: 10000 }, segments)).toEqual({ startMs: 0, endMs: 10000 });
  });
});

describe('RetranscribeControl', () => {
  it('renders nothing while a recording is active, even with a pending span', async () => {
    useRecordingStore.setState({ isRecording: true });
    const { container } = render(
      <RetranscribeControl
        meetingId="meet-1"
        segments={[makeSegment()]}
        pendingSpan={{ startMs: 0, endMs: 10000 }}
        onApplied={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    // The models effect still fires (hooks run unconditionally) — settle it
    // inside act() so the null result holds after that update too.
    await waitFor(() => expect(getWhisperModels).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with no pending span', async () => {
    const { container } = render(
      <RetranscribeControl meetingId="meet-1" segments={[makeSegment()]} pendingSpan={null} onApplied={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    await waitFor(() => expect(getWhisperModels).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('is present otherwise, with the largest downloaded model preselected', async () => {
    render(
      <RetranscribeControl
        meetingId="meet-1"
        segments={[makeSegment()]}
        pendingSpan={{ startMs: 0, endMs: 10000 }}
        onApplied={vi.fn()}
      />,
    );
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select).toHaveValue('large.bin'));
    // The undownloaded model is never offered.
    expect(screen.queryByText(/9 GB/)).not.toBeInTheDocument();
    expect(screen.getByText(/Redo 00:00–00:10 with large/)).toBeInTheDocument();
  });

  it('sends the SNAPPED span, applies the result, and toasts on success', async () => {
    const onApplied = vi.fn();
    render(
      <RetranscribeControl
        meetingId="meet-1"
        segments={[makeSegment({ startTime: 0, endTime: 10000 })]}
        pendingSpan={{ startMs: 3000, endMs: 8000 }}
        onApplied={onApplied}
      />,
    );
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: /redo this span/i }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(retranscribeSpan).toHaveBeenCalledWith({
      meetingId: 'meet-1',
      startMs: 0,
      endMs: 10000,
      modelFileName: 'large.bin',
    });
    const [segments, note] = onApplied.mock.calls[0];
    expect(segments).toEqual([expect.objectContaining({ id: 'new-1', content: 'Replacement' })]);
    expect(note).toEqual(
      expect.objectContaining({ startMs: 0, endMs: 10000, model: 'large.bin', replaced: 1, inserted: 1 }),
    );
  });

  it('shows the typed failure reason and applies nothing', async () => {
    retranscribeSpan.mockResolvedValue({
      ok: false,
      reason: 'no-audio',
      detail: 'This session has no recording file.',
    });
    const onApplied = vi.fn();
    render(
      <RetranscribeControl
        meetingId="meet-1"
        segments={[makeSegment()]}
        pendingSpan={{ startMs: 0, endMs: 10000 }}
        onApplied={onApplied}
      />,
    );
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: /redo this span/i }));

    expect(await screen.findByText('no-audio: This session has no recording file.')).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });
});
