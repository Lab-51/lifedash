// === FILE PURPOSE ===
// Proves coverageVerdict.ts's priority order (unknown > recovered > partial >
// complete) and that a suspect-span count is echoed into `reasons` without
// ever changing the verdict (TRANS-COV.1 Task 3).

import { describe, it, expect } from 'vitest';
import { coverageVerdict } from '../coverageVerdict';
import { emptyCoverageTally, type TranscriptionCoverage } from '../../types/transcriptionCoverage';

function makeCoverage(overrides: Partial<TranscriptionCoverage> = {}): TranscriptionCoverage {
  return {
    ...emptyCoverageTally(),
    version: 1,
    endedBy: 'stop',
    audioMs: 60_000,
    provider: 'local',
    model: 'ggml-base.bin',
    windowStampMs: 10_000,
    windowAdvanceMs: 9_000,
    retranscribed: [],
    ...overrides,
  };
}

describe('coverageVerdict', () => {
  it('is unknown when there is no coverage record', () => {
    expect(coverageVerdict(null, 0)).toEqual({
      verdict: 'unknown',
      reasons: ['This meeting has no coverage record.'],
    });
  });

  it('is recovered when the session ended by crash recovery', () => {
    const result = coverageVerdict(makeCoverage({ endedBy: 'recovered' }), 0);
    expect(result.verdict).toBe('recovered');
  });

  it('stays recovered even when a channel also has failed windows', () => {
    const coverage = makeCoverage({ endedBy: 'recovered' });
    coverage.channels.mic.failed = 2;
    expect(coverageVerdict(coverage, 0).verdict).toBe('recovered');
  });

  it('is partial when any channel has a failed window', () => {
    const coverage = makeCoverage();
    coverage.channels.system.failed = 1;
    const result = coverageVerdict(coverage, 0);
    expect(result.verdict).toBe('partial');
    expect(result.reasons).toContain('Some windows failed to transcribe.');
  });

  it('is partial when a failed/unknown gap exists even with clean counters', () => {
    const coverage = makeCoverage({
      gaps: [{ startMs: 0, endMs: 10_000, channel: 'mic', reason: 'unknown' }],
    });
    expect(coverageVerdict(coverage, 0).verdict).toBe('partial');
  });

  it('is complete with clean counters and no gaps', () => {
    expect(coverageVerdict(makeCoverage(), 0)).toEqual({ verdict: 'complete', reasons: [] });
  });

  it('echoes the suspect count into reasons without changing a complete verdict', () => {
    const result = coverageVerdict(makeCoverage(), 3);
    expect(result.verdict).toBe('complete');
    expect(result.reasons).toEqual(['3 suspect spans']);
  });

  it('uses the singular form for exactly one suspect span', () => {
    expect(coverageVerdict(makeCoverage(), 1).reasons).toEqual(['1 suspect span']);
  });

  it('still echoes suspect spans under a partial verdict', () => {
    const coverage = makeCoverage();
    coverage.channels.mixed.failed = 1;
    const result = coverageVerdict(coverage, 2);
    expect(result.verdict).toBe('partial');
    expect(result.reasons).toContain('2 suspect spans');
  });
});
