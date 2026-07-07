// === FILE PURPOSE ===
// Unit tests for the Twin creation-wizard AI assist (V3.3 Task 4). Mocks
// ai-provider (resolveTaskModel/generate) to verify the load-bearing contract:
// a one-shot invoke (NOT streaming) with the twin_interview task type, per-
// section JSON-schema validation, retry-ONCE-then-skip on malformed output, and
// graceful skip (never throws) when no model is configured or generation fails.
// The wizard must stay fully usable manually, so every failure returns a
// { status: 'skipped', reason } result rather than rejecting.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), generate: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { draftSection } from '../twinInterviewService';
import { resolveTaskModel, generate } from '../ai-provider';

const PROVIDER = {
  providerId: 'p1',
  providerName: 'lmstudio',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'local',
  temperature: 0,
  maxTokens: 512,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
});

describe('draftSection — provider resolution', () => {
  it('resolves against the twin_interview task type', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"name":"Ada"}' } as never);
    await draftSection('identity', 'I am Ada');
    expect(resolveTaskModel).toHaveBeenCalledWith('twin_interview');
  });

  it('skips with reason "no-model" when no provider is configured (no throw)', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const result = await draftSection('identity', 'I am Ada');
    expect(result).toEqual({ status: 'skipped', reason: 'no-model' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses a plain invoke (generate), never a streaming call, tagged twin_interview', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{}' } as never);
    await draftSection('domain', 'SaaS billing at Acme');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generate).mock.calls[0][0].taskType).toBe('twin_interview');
    expect(vi.mocked(generate).mock.calls[0][0].prompt).toBe('SaaS billing at Acme');
  });
});

describe('draftSection — object sections', () => {
  it('parses an identity object', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{"name":"Ada","role":"Founder"}' } as never);
    const result = await draftSection('identity', 'x');
    expect(result).toEqual({ status: 'ok', draft: { name: 'Ada', role: 'Founder' } });
  });

  it('strips a ```json code fence before parsing', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '```json\n{"tone":"concise"}\n```' } as never);
    const result = await draftSection('preferences', 'keep it short');
    expect(result).toEqual({ status: 'ok', draft: { tone: 'concise' } });
  });

  it('accepts an empty object (nothing relevant in the answer)', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '{}' } as never);
    const result = await draftSection('identity', 'no useful info');
    expect(result).toEqual({ status: 'ok', draft: {} });
  });
});

describe('draftSection — list sections', () => {
  it('parses a projects array', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: '[{"name":"Replatform","description":"move to Stripe"}]',
    } as never);
    const result = await draftSection('projects', 'x');
    expect(result).toEqual({ status: 'ok', draft: [{ name: 'Replatform', description: 'move to Stripe' }] });
  });

  it('parses a goals array of strings', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '["Ship v3","Hire QA"]' } as never);
    const result = await draftSection('goals', 'x');
    expect(result).toEqual({ status: 'ok', draft: ['Ship v3', 'Hire QA'] });
  });
});

describe('draftSection — validate/retry/skip discipline', () => {
  it('retries once with the rejection appended, then succeeds', async () => {
    vi.mocked(generate)
      .mockResolvedValueOnce({ text: 'not json at all' } as never)
      .mockResolvedValueOnce({ text: '{"name":"Ada"}' } as never);

    const result = await draftSection('identity', 'about me');

    expect(generate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generate).mock.calls[1][0].prompt).toContain('previous reply was rejected');
    expect(result).toEqual({ status: 'ok', draft: { name: 'Ada' } });
  });

  it('skips with reason "failed" after two malformed replies — never throws', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'still not json' } as never);
    const result = await draftSection('identity', 'about me');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" on schema mismatch after retry (e.g. project missing name)', async () => {
    vi.mocked(generate).mockResolvedValue({ text: '[{"description":"no name"}]' } as never);
    const result = await draftSection('projects', 'about me');
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" (no retry) when generation throws — does not propagate', async () => {
    vi.mocked(generate).mockRejectedValue(new Error('model offline'));
    const result = await draftSection('identity', 'about me');
    expect(generate).toHaveBeenCalledTimes(1); // generation failure is not a JSON problem — no re-prompt
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });
});
