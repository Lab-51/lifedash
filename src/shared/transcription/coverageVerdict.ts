// === FILE PURPOSE ===
// Turns a meeting's TranscriptionCoverage record (and a suspect-span count
// from suspectDetector.ts) into one badge-ready verdict (TRANS-COV.1 Task 3).
//
// Suspect spans are a REVIEW PROMPT, never a coverage fact: a span can be a
// false positive, and coverage is a hard count of windows the pipeline knows
// it dropped. So `suspectCount` is echoed into `reasons` for display but never
// changes `verdict` — see the phase's own framing in the coverage types file.
//
// Pure — no zod, no node/main-process imports, only a type-only import from
// the shared types module (erased at compile time) — importable everywhere.

import type { CoverageChannel, TranscriptionCoverage } from '../types/transcriptionCoverage';

export type CoverageVerdict = 'complete' | 'partial' | 'recovered' | 'unknown';

export interface CoverageVerdictResult {
  verdict: CoverageVerdict;
  /** Short, plain-English sentences. No numbers beyond the suspect-span
   *  count, so this can be rendered directly under a badge. */
  reasons: string[];
}

const CHANNELS: readonly CoverageChannel[] = ['mic', 'system', 'mixed'];

/** Decide the verdict and its base reasons from the coverage record alone,
 *  before the suspect-span reason is appended. */
function verdictFromCoverage(coverage: TranscriptionCoverage | null): {
  verdict: CoverageVerdict;
  reasons: string[];
} {
  if (!coverage) {
    return { verdict: 'unknown', reasons: ['This meeting has no coverage record.'] };
  }
  if (coverage.endedBy === 'recovered') {
    return {
      verdict: 'recovered',
      reasons: ['The recording ended abnormally and was recovered on the next launch.'],
    };
  }

  const hasFailedChannel = CHANNELS.some((channel) => coverage.channels[channel].failed > 0);
  const hasUnresolvedGap = coverage.gaps.some((gap) => gap.reason === 'failed' || gap.reason === 'unknown');
  if (hasFailedChannel || hasUnresolvedGap) {
    const reasons: string[] = [];
    if (hasFailedChannel) reasons.push('Some windows failed to transcribe.');
    if (hasUnresolvedGap) reasons.push('Part of the recording has no transcript.');
    return { verdict: 'partial', reasons };
  }

  return { verdict: 'complete', reasons: [] };
}

/**
 * Combine a coverage record with a suspect-span count into one verdict.
 * `coverage` is null for any meeting predating TRANS-COV.1 (or one whose
 * coverage write failed) — that is 'unknown', never 'complete': the pipeline
 * genuinely does not know.
 */
export function coverageVerdict(coverage: TranscriptionCoverage | null, suspectCount: number): CoverageVerdictResult {
  const { verdict, reasons } = verdictFromCoverage(coverage);
  if (suspectCount > 0) {
    reasons.push(`${suspectCount} suspect span${suspectCount === 1 ? '' : 's'}`);
  }
  return { verdict, reasons };
}
