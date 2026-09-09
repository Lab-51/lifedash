// @vitest-environment jsdom
// TRANS-COV.1 Task 5 — CoverageBadge renders coverageVerdict's four outcomes
// with the right copy, and a gap button hands its exact bounds to the host.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CoverageBadge from '../meeting-detail/CoverageBadge';
import { emptyCoverageTally } from '../../../shared/types';
import type { TranscriptionCoverage } from '../../../shared/types';

function makeCoverage(overrides: Partial<TranscriptionCoverage> = {}): TranscriptionCoverage {
  return {
    ...emptyCoverageTally(),
    version: 1,
    endedBy: 'stop',
    audioMs: 60000,
    provider: 'local',
    model: 'ggml-base.bin',
    windowStampMs: 10000,
    windowAdvanceMs: 9000,
    retranscribed: [],
    ...overrides,
  };
}

describe('CoverageBadge', () => {
  it('shows a quiet "Complete" label with no gaps for a fully-covered meeting', () => {
    render(<CoverageBadge coverage={makeCoverage()} suspectCount={0} onShowSpan={vi.fn()} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the muted unknown copy for a meeting with no coverage record, and never says complete', () => {
    render(<CoverageBadge coverage={null} suspectCount={0} onShowSpan={vi.fn()} />);
    expect(screen.getByText('coverage unknown (recorded before coverage tracking)')).toBeInTheDocument();
    expect(screen.queryByText(/complete/i)).not.toBeInTheDocument();
  });

  it('warns for a partial meeting and its gap button reports the gap bounds', () => {
    const onShowSpan = vi.fn();
    const tally = emptyCoverageTally();
    const coverage = makeCoverage({
      channels: { ...tally.channels, mic: { ...tally.channels.mic, failed: 1 } },
      gaps: [{ startMs: 10000, endMs: 20000, channel: 'mic', reason: 'failed' }],
    });
    render(<CoverageBadge coverage={coverage} suspectCount={0} onShowSpan={onShowSpan} />);

    const toggle = screen.getByRole('button', { name: /partial/i });
    expect(toggle).toHaveAttribute('title', expect.stringContaining('Some windows failed to transcribe.'));
    fireEvent.click(toggle);

    const gapButton = screen.getByRole('button', { name: /00:10.*00:20.*mic.*failed/i });
    fireEvent.click(gapButton);
    expect(onShowSpan).toHaveBeenCalledWith(10000, 20000);
  });

  it('labels a recovered meeting distinctly, with the untranscribed tail as its one gap', () => {
    const onShowSpan = vi.fn();
    const coverage = makeCoverage({
      endedBy: 'recovered',
      gaps: [{ startMs: 50000, endMs: 65000, channel: 'mixed', reason: 'unknown' }],
    });
    render(<CoverageBadge coverage={coverage} suspectCount={0} onShowSpan={onShowSpan} />);

    fireEvent.click(screen.getByRole('button', { name: /recovered after an abnormal stop/i }));
    fireEvent.click(screen.getByRole('button', { name: /00:50.*01:05/i }));
    expect(onShowSpan).toHaveBeenCalledWith(50000, 65000);
  });

  it('appends the suspect-span count to the reasons without changing the complete verdict', () => {
    render(<CoverageBadge coverage={makeCoverage()} suspectCount={2} onShowSpan={vi.fn()} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toHaveAttribute('title', '2 suspect spans');
  });
});
