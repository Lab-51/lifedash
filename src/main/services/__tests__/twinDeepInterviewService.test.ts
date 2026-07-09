// === FILE PURPOSE ===
// Unit tests for the Digital Twin DEEP interview service (V3.3.5 Task 2). Mocks
// ai-provider (resolveTaskModel/generate) to verify the load-bearing contract:
// invoke-per-turn one-shot calls (NOT streaming) tagged `twin_interview`, the
// 8-question hard cap, the model-driven `done` signal, JSON-schema validation with
// retry-ONCE-then-skip on malformed output, and graceful skip (never throws) when
// no model is configured or generation fails. Every failure returns a
// { status: 'skipped', reason } / { status: 'done' } result — never a rejection —
// so the wizard always degrades to the manual path.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), generate: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { interviewNext, interviewSynthesize } from '../twinDeepInterviewService';
import { resolveTaskModel, generate } from '../ai-provider';
import type { TwinQATurn } from '../../../shared/types/twin';

const PROVIDER = {
  providerId: 'p1',
  providerName: 'lmstudio',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'local',
  temperature: 0,
  maxTokens: 512,
};

/** Build N answered Q&A turns for cap/loop tests. */
function turns(n: number): TwinQATurn[] {
  return Array.from({ length: n }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
});

describe('interviewNext — the question loop', () => {
  it('resolves against the twin_interview task type and returns the next question', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":false,"question":"What is your role?"}' } as never);
    const result = await interviewNext({ brief: 'A senior PM', profileSoFar: {}, qa: [] });
    expect(resolveTaskModel).toHaveBeenCalledWith('twin_interview');
    expect(result).toEqual({ status: 'ok', question: 'What is your role?' });
  });

  it('uses a plain invoke (generate), never streaming, tagged twin_interview', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":false,"question":"Who do you work with?"}' } as never);
    await interviewNext({ brief: '', profileSoFar: {}, qa: [] });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generate).mock.calls[0][0].taskType).toBe('twin_interview');
  });

  it('seeds the prompt with the brief and prior answers', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":false,"question":"Next?"}' } as never);
    await interviewNext({
      brief: 'Founder of Acme',
      profileSoFar: {},
      qa: [{ question: 'Your name?', answer: 'Ada' }],
    });
    const prompt = vi.mocked(generate).mock.calls[0][0].prompt;
    expect(prompt).toContain('Founder of Acme');
    expect(prompt).toContain('Ada');
  });

  it('returns { done } when the model reports sufficient coverage', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":true}' } as never);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: turns(3) });
    expect(result).toEqual({ status: 'done' });
  });

  it('strips a ```json code fence before parsing', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '```json\n{"done":false,"question":"Fenced?"}\n```' } as never);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: [] });
    expect(result).toEqual({ status: 'ok', question: 'Fenced?' });
  });
});

describe('interviewNext — the 8-question hard cap', () => {
  it('returns { done } at 8 asked questions WITHOUT calling the model', async () => {
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: turns(8) });
    expect(result).toEqual({ status: 'done' });
    expect(resolveTaskModel).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('still asks at 7 asked questions (under the cap)', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":false,"question":"Last one?"}' } as never);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: turns(7) });
    expect(result).toEqual({ status: 'ok', question: 'Last one?' });
  });
});

describe('interviewNext — validate/retry/skip discipline', () => {
  it('skips with reason "no-model" when no provider is configured (no generate call)', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: [] });
    expect(result).toEqual({ status: 'skipped', reason: 'no-model' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('retries once with the rejection appended, then succeeds', async () => {
    vi.mocked(generate)
      .mockResolvedValueOnce({ text: 'not json at all' } as never)
      .mockResolvedValueOnce({ text: '{"done":false,"question":"Recovered?"}' } as never);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: [] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generate).mock.calls[1][0].prompt).toContain('previous reply was rejected');
    expect(result).toEqual({ status: 'ok', question: 'Recovered?' });
  });

  it('skips with reason "failed" after two malformed replies — never throws', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'still not json' } as never);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: [] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('treats done:false with no question as malformed (retry then skip)', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":false}' } as never);
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: [] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" (no retry) when generation throws', async () => {
    vi.mocked(generate).mockRejectedValue(new Error('model offline'));
    const result = await interviewNext({ brief: 'x', profileSoFar: {}, qa: [] });
    expect(generate).toHaveBeenCalledTimes(1); // a network failure is not a JSON problem — no re-prompt
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });
});

describe('interviewSynthesize — the Q&A -> editable draft', () => {
  it('resolves against twin_interview and returns a validated draft across sections', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: '{"brief":{"statement":"Senior PM at Acme"},"identity":{"name":"Ada","role":"PM"},"projects":[{"name":"Replatform"}],"goals":["Ship v3"]}',
    } as never);
    const result = await interviewSynthesize({ brief: 'A senior PM', qa: turns(2) });
    expect(resolveTaskModel).toHaveBeenCalledWith('twin_interview');
    expect(vi.mocked(generate).mock.calls[0][0].taskType).toBe('twin_interview');
    expect(result).toEqual({
      status: 'ok',
      draft: {
        brief: { statement: 'Senior PM at Acme' },
        identity: { name: 'Ada', role: 'PM' },
        projects: [{ name: 'Replatform' }],
        goals: ['Ship v3'],
      },
    });
  });

  it('strips unknown keys from the draft', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: '{"identity":{"name":"Ada"},"totallyUnknown":123}',
    } as never);
    const result = await interviewSynthesize({ brief: 'x', qa: turns(1) });
    expect(result).toEqual({ status: 'ok', draft: { identity: { name: 'Ada' } } });
  });

  it('accepts an empty object (nothing extractable) as a valid empty draft', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{}' } as never);
    const result = await interviewSynthesize({ brief: 'x', qa: turns(1) });
    expect(result).toEqual({ status: 'ok', draft: {} });
  });

  it('skips with reason "no-model" when no provider is configured', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const result = await interviewSynthesize({ brief: 'x', qa: turns(1) });
    expect(result).toEqual({ status: 'skipped', reason: 'no-model' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('retries once then skips with reason "failed" on malformed output', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'not json' } as never);
    const result = await interviewSynthesize({ brief: 'x', qa: turns(1) });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" on schema mismatch after retry (project missing name)', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"projects":[{"description":"no name"}]}' } as never);
    const result = await interviewSynthesize({ brief: 'x', qa: turns(1) });
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" (no retry) when generation throws', async () => {
    vi.mocked(generate).mockRejectedValue(new Error('model offline'));
    const result = await interviewSynthesize({ brief: 'x', qa: turns(1) });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });
});

describe('roleContext-aware prompts (orchestrated deep flow) — gap-focused', () => {
  const ROLE_CONTEXT = 'A B2B SaaS product manager owns the roadmap and works across engineering, design, and sales.';

  it('interviewNext includes the research background and steers to the GAPS the user knows', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: '{"done":false,"question":"Which projects are you leading?"}',
    } as never);
    await interviewNext({ brief: 'A senior PM', profileSoFar: {}, qa: [], roleContext: ROLE_CONTEXT });
    const prompt = vi.mocked(generate).mock.calls[0][0].prompt;
    expect(prompt).toContain(ROLE_CONTEXT);
    expect(prompt).toContain('Researched role/industry BACKGROUND');
    expect(prompt).toContain('GAPS');
    expect(prompt).toContain('REAL projects');
    // Steering does not clobber the existing brief/transcript wiring.
    expect(prompt).toContain('A senior PM');
  });

  it('interviewNext prompt is byte-identical with no roleContext vs an empty roleContext', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"done":true}' } as never);
    const base = { brief: 'A senior PM', profileSoFar: {}, qa: [{ question: 'Q1', answer: 'A1' }] };
    await interviewNext(base);
    await interviewNext({ ...base, roleContext: '   ' });
    const promptA = vi.mocked(generate).mock.calls[0][0].prompt;
    const promptB = vi.mocked(generate).mock.calls[1][0].prompt;
    expect(promptB).toBe(promptA);
    expect(promptA).not.toContain('Researched role/industry BACKGROUND');
  });

  it('interviewSynthesize includes the research background as interpret-only context', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"identity":{"role":"PM"}}' } as never);
    await interviewSynthesize({ brief: 'A senior PM', qa: turns(2), roleContext: ROLE_CONTEXT });
    const prompt = vi.mocked(generate).mock.calls[0][0].prompt;
    expect(prompt).toContain(ROLE_CONTEXT);
    expect(prompt).toContain('Researched role/industry BACKGROUND');
    expect(prompt).toContain('never fabricate people or projects');
  });

  it('interviewSynthesize prompt is unchanged when no roleContext is provided', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{}' } as never);
    await interviewSynthesize({ brief: 'A senior PM', qa: turns(1) });
    const prompt = vi.mocked(generate).mock.calls[0][0].prompt;
    expect(prompt).not.toContain('Researched role/industry BACKGROUND');
  });
});
