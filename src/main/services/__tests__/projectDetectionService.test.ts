// === FILE PURPOSE ===
// Unit tests for projectDetectionService — covers parsing, validation,
// hallucination guard, edge cases, and error handling. The classifier must
// NEVER throw to the caller — every failure path returns a DetectionResult.

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

import { detectProjectFromTranscript, type DetectionProject } from '../projectDetectionService';
import { generate, resolveTaskModel } from '../ai-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function project(id: string, name: string, description: string | null = null): DetectionProject {
  return { id, name, description };
}

function mockProvider() {
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

function mockResponse(jsonText: string) {
  return { text: jsonText, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectProjectFromTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTaskModel).mockResolvedValue(mockProvider() as never);
  });

  // -------------------------------------------------------------------------
  // Empty / no-op paths
  // -------------------------------------------------------------------------

  it('returns null without calling LLM when project list is empty', async () => {
    const result = await detectProjectFromTranscript({
      transcript: 'We discussed the website redesign at length today.',
      projects: [],
    });

    expect(result.projectId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason).toBe('no projects available');
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns null without calling LLM when transcript is empty', async () => {
    const result = await detectProjectFromTranscript({
      transcript: '   ',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.reason).toBe('empty transcript');
    expect(generate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Provider resolution
  // -------------------------------------------------------------------------

  it('returns null with reason "no AI provider configured" when no provider resolves', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValueOnce(null);

    const result = await detectProjectFromTranscript({
      transcript: 'Discussing the website redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.reason).toBe('no AI provider configured');
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses a custom modelResolver when provided', async () => {
    const custom = vi.fn().mockResolvedValue(mockProvider());
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":"p1","confidence":0.9,"reason":"clear"}') as never,
    );

    await detectProjectFromTranscript({
      transcript: 'About the website redesign project.',
      projects: [project('p1', 'Website Redesign')],
      modelResolver: custom,
    });

    expect(custom).toHaveBeenCalledOnce();
    expect(resolveTaskModel).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Happy path: high-confidence match
  // -------------------------------------------------------------------------

  it('returns the matched projectId when LLM returns a valid high-confidence result', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse(
        '{"projectId":"p1","confidence":0.92,"reason":"transcript references the website redesign"}',
      ) as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'We talked about button colors and the hero section.',
      projects: [project('p1', 'Website Redesign'), project('p2', 'API Refactor')],
    });

    expect(result.projectId).toBe('p1');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.reason).toContain('redesign');
  });

  // -------------------------------------------------------------------------
  // Code-fenced JSON
  // -------------------------------------------------------------------------

  it('strips markdown code fences from the LLM response', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('```json\n{"projectId":"p1","confidence":0.85,"reason":"matches"}\n```') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBe('p1');
    expect(result.confidence).toBe(0.85);
  });

  // -------------------------------------------------------------------------
  // Hallucination guard
  // -------------------------------------------------------------------------

  it('treats hallucinated projectId (not in input list) as null', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":"FAKE_ID","confidence":0.95,"reason":"yes"}') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'Some transcript.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('hallucinated');
  });

  // -------------------------------------------------------------------------
  // Null projectId acceptance
  // -------------------------------------------------------------------------

  it('accepts a valid null projectId response from the LLM', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":null,"confidence":0.2,"reason":"no clear match"}') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'Random conversation about lunch.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.confidence).toBe(0.2);
    expect(result.reason).toBe('no clear match');
  });

  // -------------------------------------------------------------------------
  // JSON parse failure
  // -------------------------------------------------------------------------

  it('returns null + parse error reason when LLM returns non-JSON', async () => {
    vi.mocked(generate).mockResolvedValue(mockResponse('not JSON at all, just prose') as never);

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason).toMatch(/parse error/);
  });

  // -------------------------------------------------------------------------
  // Invalid response shape
  // -------------------------------------------------------------------------

  it('returns null + invalid shape reason when JSON is missing required fields', async () => {
    vi.mocked(generate).mockResolvedValue(mockResponse('{"foo":"bar"}') as never);

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.reason).toBe('invalid response shape');
  });

  it('returns null when confidence is non-numeric', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":"p1","confidence":"high","reason":"yes"}') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Confidence clamping
  // -------------------------------------------------------------------------

  it('clamps confidence values into [0, 1] range', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":"p1","confidence":1.5,"reason":"too high"}') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.confidence).toBe(1);
  });

  it('clamps negative confidence to 0', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":"p1","confidence":-0.5,"reason":"weird"}') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.confidence).toBe(0);
  });

  // -------------------------------------------------------------------------
  // LLM throws
  // -------------------------------------------------------------------------

  it('returns null + llm error reason when generate throws', async () => {
    vi.mocked(generate).mockRejectedValueOnce(new Error('Network down'));

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.reason).toContain('llm error');
    expect(result.reason).toContain('Network down');
  });

  it('never throws even when modelResolver throws', async () => {
    const customResolver = vi.fn().mockRejectedValue(new Error('Resolver crashed'));

    const result = await detectProjectFromTranscript({
      transcript: 'About something.',
      projects: [project('p1', 'Website Redesign')],
      modelResolver: customResolver,
    });

    expect(result.projectId).toBeNull();
    expect(result.reason).toBe('model resolution failed');
  });

  // -------------------------------------------------------------------------
  // Single-project scenario — must NOT force-match
  // -------------------------------------------------------------------------

  it('passes through an LLM-decided null even when only one project is available', async () => {
    vi.mocked(generate).mockResolvedValue(
      mockResponse('{"projectId":null,"confidence":0.1,"reason":"transcript unrelated"}') as never,
    );

    const result = await detectProjectFromTranscript({
      transcript: 'Discussion about completely unrelated topic.',
      projects: [project('only', 'Website Redesign')],
    });

    expect(result.projectId).toBeNull();
    expect(result.confidence).toBe(0.1);
  });

  // -------------------------------------------------------------------------
  // Prompt construction (ensures projects are passed through)
  // -------------------------------------------------------------------------

  it('includes project ids and names in the user prompt sent to the LLM', async () => {
    vi.mocked(generate).mockResolvedValue(mockResponse('{"projectId":"p1","confidence":0.9,"reason":"ok"}') as never);

    await detectProjectFromTranscript({
      transcript: 'Talk about the redesign.',
      projects: [project('p1', 'Website Redesign', 'Customer-facing site'), project('p2', 'API Refactor')],
    });

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.prompt).toContain('p1');
    expect(callArg.prompt).toContain('Website Redesign');
    expect(callArg.prompt).toContain('Customer-facing site');
    expect(callArg.prompt).toContain('p2');
    expect(callArg.prompt).toContain('API Refactor');
    expect(callArg.taskType).toBe('project_detection');
  });

  it('truncates the transcript to 500 words for classification', async () => {
    vi.mocked(generate).mockResolvedValue(mockResponse('{"projectId":"p1","confidence":0.9,"reason":"ok"}') as never);

    // 600-word transcript
    const longTranscript = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');

    await detectProjectFromTranscript({
      transcript: longTranscript,
      projects: [project('p1', 'Website Redesign')],
    });

    const callArg = vi.mocked(generate).mock.calls[0][0];
    // Word 499 should be present (last in window), word 500 should not
    expect(callArg.prompt).toContain('word499');
    expect(callArg.prompt).not.toContain('word500');
  });

  // -------------------------------------------------------------------------
  // generateFn override (for testing)
  // -------------------------------------------------------------------------

  it('uses a custom generateFn when provided', async () => {
    const fakeGenerate = vi
      .fn()
      .mockResolvedValue(mockResponse('{"projectId":"p1","confidence":0.95,"reason":"matched"}'));

    const result = await detectProjectFromTranscript({
      transcript: 'About the redesign.',
      projects: [project('p1', 'Website Redesign')],
      generateFn: fakeGenerate as never,
    });

    expect(result.projectId).toBe('p1');
    expect(fakeGenerate).toHaveBeenCalledOnce();
    // The default generate from ai-provider must NOT have been called
    expect(generate).not.toHaveBeenCalled();
  });
});
