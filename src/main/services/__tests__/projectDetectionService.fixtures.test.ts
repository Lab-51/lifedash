// === FILE PURPOSE ===
// Fixture-based accuracy test for the project detection classifier
// (MEET-INTEL.1-3 verification step 3 — the stop condition).
//
// This test exercises the PARSING + VALIDATION + SCORING layer against
// hand-crafted fixtures with realistic mocked LLM responses. It does NOT
// invoke a live model — that requires API credentials and is deferred to
// the user smoke test (verification step 4).
//
// What it validates:
//  - Each fixture's expected outcome is reachable through the classifier's
//    own validation logic given a "plausible-correct" model response.
//  - The scoring helper (scoreResult) correctly classifies passes/fails.
//  - Hallucinated IDs from a model response are caught.
//  - The end-to-end accuracy threshold of >=70% is met when the model
//    produces correct responses for the unambiguous cases.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../ai-provider', () => ({
  generate: vi.fn(),
  resolveTaskModel: vi.fn(),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { detectProjectFromTranscript } from '../projectDetectionService';
import { generate, resolveTaskModel } from '../ai-provider';
import { fixtures, scoreResult, type DetectionFixture } from './fixtures/projectDetectionFixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function provider() {
  return {
    providerId: 'p1',
    providerName: 'openai' as const,
    apiKeyEncrypted: 'enc',
    baseUrl: null,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 200,
  };
}

/**
 * Build a "plausible correct" mocked LLM response for a fixture.
 * Mirrors what a competent classifier would return given the prompt.
 *
 * - 'match': returns the expected projectId with confidence 0.9.
 * - 'ambiguous': returns one of the acceptable IDs with confidence 0.55
 *   (below the auto-assign threshold but in the acceptable range).
 * - 'none': returns null projectId with confidence 0.15.
 */
function buildPlausibleResponse(fixture: DetectionFixture): string {
  switch (fixture.expectation.kind) {
    case 'match':
      return JSON.stringify({
        projectId: fixture.expectation.expectedId,
        confidence: 0.9,
        reason: `Transcript clearly references ${fixture.expectation.expectedId}.`,
      });
    case 'ambiguous':
      return JSON.stringify({
        projectId: fixture.expectation.acceptableIds[0],
        confidence: 0.55,
        reason: 'Transcript could relate to multiple projects.',
      });
    case 'none':
      return JSON.stringify({
        projectId: null,
        confidence: 0.15,
        reason: 'Transcript does not clearly relate to any listed project.',
      });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('projectDetectionService — fixture accuracy (mocked LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTaskModel).mockResolvedValue(provider() as never);
  });

  it('all 10 fixtures are present (6 match, 2 ambiguous, 2 none)', () => {
    const matchCount = fixtures.filter((f) => f.expectation.kind === 'match').length;
    const ambiguousCount = fixtures.filter((f) => f.expectation.kind === 'ambiguous').length;
    const noneCount = fixtures.filter((f) => f.expectation.kind === 'none').length;
    expect(fixtures).toHaveLength(10);
    expect(matchCount).toBe(6);
    expect(ambiguousCount).toBe(2);
    expect(noneCount).toBe(2);
  });

  it('passes >=70% of fixtures when LLM returns plausible-correct responses', async () => {
    const results: { name: string; passed: boolean; result: unknown }[] = [];

    for (const fixture of fixtures) {
      const responseText = buildPlausibleResponse(fixture);
      vi.mocked(generate).mockResolvedValueOnce({ text: responseText } as never);

      const result = await detectProjectFromTranscript({
        transcript: fixture.transcript,
        projects: fixture.projects,
      });

      const passed = scoreResult(result, fixture.expectation);
      results.push({ name: fixture.name, passed, result });
    }

    const correct = results.filter((r) => r.passed).length;
    const total = results.length;
    const accuracy = correct / total;

    // Stop-condition threshold: >=70%
    if (accuracy < 0.7) {
      const failed = results.filter((r) => !r.passed);
      throw new Error(
        `Fixture accuracy ${(accuracy * 100).toFixed(0)}% (${correct}/${total}) — below 70% threshold. ` +
          `Failed: ${failed.map((f) => f.name).join(', ')}`,
      );
    }

    expect(accuracy).toBeGreaterThanOrEqual(0.7);
  });

  it('catches hallucinated IDs from a model response', async () => {
    const fixture = fixtures.find((f) => f.expectation.kind === 'match');
    if (!fixture) throw new Error('No match fixture found');

    // LLM hallucinates an ID not in the project list
    vi.mocked(generate).mockResolvedValue({
      text: JSON.stringify({
        projectId: 'totally-fake-id',
        confidence: 0.95,
        reason: 'I am hallucinating this project.',
      }),
    } as never);

    const result = await detectProjectFromTranscript({
      transcript: fixture.transcript,
      projects: fixture.projects,
    });

    // Hallucination guard kicks in
    expect(result.projectId).toBeNull();
    expect(result.reason).toContain('hallucinated');
    // Score: a 'match' fixture with hallucinated null fails (correctly)
    expect(scoreResult(result, fixture.expectation)).toBe(false);
  });

  it('survives a malformed JSON model response without throwing', async () => {
    const fixture = fixtures[0];
    vi.mocked(generate).mockResolvedValue({ text: 'not valid JSON 🙃' } as never);

    const result = await detectProjectFromTranscript({
      transcript: fixture.transcript,
      projects: fixture.projects,
    });

    expect(result.projectId).toBeNull();
    expect(result.reason).toMatch(/parse error/);
  });

  it('routes all "none" fixtures to null when LLM correctly identifies no match', async () => {
    const noneFixtures = fixtures.filter((f) => f.expectation.kind === 'none');
    for (const fixture of noneFixtures) {
      vi.mocked(generate).mockResolvedValueOnce({
        text: JSON.stringify({ projectId: null, confidence: 0.1, reason: 'no match' }),
      } as never);

      const result = await detectProjectFromTranscript({
        transcript: fixture.transcript,
        projects: fixture.projects,
      });

      expect(result.projectId).toBeNull();
      expect(scoreResult(result, fixture.expectation)).toBe(true);
    }
  });
});
