// === FILE PURPOSE ===
// Unit tests for the Twin web-research service (V3.3.5 Task 4). Mocks the AI SDK
// boundary (ai.generateText + the three frontier provider adapters), ai-provider
// (resolveTaskModel), and secure-storage, to verify the load-bearing contract:
//   - checkSupport() reports honest per-provider capability (frontier => supported,
//     everything else => unsupported, no cloud call);
//   - researchWeb() degrades honestly: no-model -> skipped/no-model, non-web provider
//     -> unsupported (NO cloud call), and runs a native web-search generation for the
//     frontier providers with schema-constrained validate-retry-skip extraction and
//     citations pulled from the model's url sources.
// The UNSUPPORTED path is always tested (per the task's preflight-gated design).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  openaiWebSearch: vi.fn(() => ({ __tool: 'openai-web' })),
  anthropicWebSearch: vi.fn(() => ({ __tool: 'anthropic-web' })),
  googleSearch: vi.fn(() => ({ __tool: 'google-search' })),
}));

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../secure-storage', () => ({ decryptString: vi.fn((s: string) => `dec:${s}`) }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('ai', () => ({ generateText: vi.fn(), stepCountIs: vi.fn(() => 'STOP') }));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() =>
    Object.assign((id: string) => ({ __model: 'openai', id }), { tools: { webSearch: h.openaiWebSearch } }),
  ),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() =>
    Object.assign((id: string) => ({ __model: 'anthropic', id }), {
      tools: { webSearch_20250305: h.anthropicWebSearch },
    }),
  ),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() =>
    Object.assign((id: string) => ({ __model: 'google', id }), { tools: { googleSearch: h.googleSearch } }),
  ),
}));

import { checkSupport, researchWeb } from '../twinWebResearchService';
import { resolveTaskModel } from '../ai-provider';
import { decryptString } from '../secure-storage';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const PAYLOAD = { company: 'Acme Corp', industry: 'B2B SaaS' };

function providerOf(providerName: string, model = 'm') {
  return {
    providerId: 'p1',
    providerName,
    apiKeyEncrypted: 'enc',
    baseUrl: null,
    model,
    temperature: 0,
    maxTokens: 1024,
  };
}

/** A generateText result: JSON text + optional per-step url sources. */
function genResult(text: string, stepSources: unknown[][] = [], topSources: unknown[] = []) {
  return { text, steps: stepSources.map((sources) => ({ sources })), sources: topSources };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue(providerOf('openai') as never);
});

describe('checkSupport — honest per-provider capability (no cloud call)', () => {
  it('resolves against the twin_interview task type', async () => {
    await checkSupport();
    expect(resolveTaskModel).toHaveBeenCalledWith('twin_interview');
  });

  it('is unsupported when no model is configured', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const s = await checkSupport();
    expect(s.supported).toBe(false);
    expect(s.reason).toMatch(/no ai model/i);
  });

  it.each(['ollama', 'lmstudio', 'kimi'])('is unsupported for the non-frontier provider %s', async (name) => {
    vi.mocked(resolveTaskModel).mockResolvedValue(providerOf(name) as never);
    const s = await checkSupport();
    expect(s.supported).toBe(false);
    expect(s.reason).toContain(name);
    expect(s.reason).toMatch(/frontier/i);
  });

  it.each(['openai', 'anthropic', 'google'])('is supported for the frontier provider %s', async (name) => {
    vi.mocked(resolveTaskModel).mockResolvedValue(providerOf(name) as never);
    const s = await checkSupport();
    expect(s.supported).toBe(true);
    expect(s.reason).toContain(name);
  });

  it('never triggers a generation (checkSupport is a pure capability check)', async () => {
    await checkSupport();
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('researchWeb — degradation (the unsupported path is always covered)', () => {
  it('resolves against the twin_interview task type', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('{}') as never);
    await researchWeb(PAYLOAD);
    expect(resolveTaskModel).toHaveBeenCalledWith('twin_interview');
  });

  it('skips with reason "no-model" when nothing is configured — no cloud call', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const res = await researchWeb(PAYLOAD);
    expect(res).toEqual({ status: 'skipped', reason: 'no-model' });
    expect(generateText).not.toHaveBeenCalled();
  });

  it.each(['ollama', 'lmstudio', 'kimi'])(
    'returns "unsupported" for the non-web provider %s WITHOUT any cloud call',
    async (name) => {
      vi.mocked(resolveTaskModel).mockResolvedValue(providerOf(name) as never);
      const res = await researchWeb(PAYLOAD);
      expect(res).toEqual({ status: 'unsupported' });
      expect(generateText).not.toHaveBeenCalled();
      expect(createOpenAI).not.toHaveBeenCalled();
    },
  );
});

describe('researchWeb — supported path (provider-native web search)', () => {
  const OK_TEXT =
    '{"domain":{"industry":"B2B SaaS","focus":"billing"},"vocabulary":[{"term":"ARR","meaning":"Annual Recurring Revenue"}]}';

  it('extracts a cited domain/vocabulary draft on success', async () => {
    vi.mocked(generateText).mockResolvedValue(
      genResult(OK_TEXT, [[{ sourceType: 'url', url: 'https://a.com', title: 'A' }]]) as never,
    );
    const res = await researchWeb(PAYLOAD);
    expect(res).toEqual({
      status: 'ok',
      draft: {
        domain: { industry: 'B2B SaaS', focus: 'billing' },
        vocabulary: [{ term: 'ARR', meaning: 'Annual Recurring Revenue' }],
      },
      citations: [{ title: 'A', url: 'https://a.com' }],
    });
  });

  it('strips a ```json code fence before parsing', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('```json\n{"domain":{"focus":"payments"}}\n```') as never);
    const res = await researchWeb(PAYLOAD);
    expect(res).toMatchObject({ status: 'ok', draft: { domain: { focus: 'payments' } } });
  });

  it('drives the OpenAI web-search tool via a bounded search loop (stopWhen)', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('{}') as never);
    await researchWeb(PAYLOAD);
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'dec:enc' });
    expect(h.openaiWebSearch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.tools).toHaveProperty('web_search');
    expect(call.stopWhen).toBe('STOP');
  });

  it('uses the Anthropic web-search server tool (with a maxUses cap)', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(providerOf('anthropic', 'claude') as never);
    vi.mocked(generateText).mockResolvedValue(genResult('{}') as never);
    await researchWeb(PAYLOAD);
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'dec:enc' });
    expect(h.anthropicWebSearch).toHaveBeenCalledWith({ maxUses: 5 });
    expect(vi.mocked(generateText).mock.calls[0][0].tools).toHaveProperty('web_search');
  });

  it('uses the Google search-grounding tool', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(providerOf('google', 'gemini') as never);
    vi.mocked(generateText).mockResolvedValue(genResult('{}') as never);
    await researchWeb(PAYLOAD);
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'dec:enc' });
    expect(h.googleSearch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateText).mock.calls[0][0].tools).toHaveProperty('google_search');
  });

  it('decrypts the stored API key before building the provider', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('{}') as never);
    await researchWeb(PAYLOAD);
    expect(decryptString).toHaveBeenCalledWith('enc');
  });

  it('prunes empty domain fields and empty vocabulary (nothing found is still ok)', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('{"domain":{"industry":"  "},"vocabulary":[]}') as never);
    const res = await researchWeb(PAYLOAD);
    expect(res).toEqual({ status: 'ok', draft: {}, citations: [] });
  });
});

describe('researchWeb — citations', () => {
  it('dedupes url sources and falls back to the url when a title is missing', async () => {
    vi.mocked(generateText).mockResolvedValue(
      genResult('{}', [
        [
          { sourceType: 'url', url: 'https://a.com', title: 'A' },
          { sourceType: 'url', url: 'https://a.com', title: 'A dup' },
          { sourceType: 'url', url: 'https://b.com' },
        ],
      ]) as never,
    );
    const res = await researchWeb(PAYLOAD);
    expect(res).toMatchObject({
      status: 'ok',
      citations: [
        { title: 'A', url: 'https://a.com' },
        { title: 'https://b.com', url: 'https://b.com' },
      ],
    });
  });

  it('ignores non-url (document) sources', async () => {
    vi.mocked(generateText).mockResolvedValue(
      genResult('{}', [[{ sourceType: 'document', title: 'a.pdf', mediaType: 'application/pdf' }]]) as never,
    );
    const res = await researchWeb(PAYLOAD);
    expect(res).toMatchObject({ status: 'ok', citations: [] });
  });

  it('falls back to the top-level sources when no step carries any', async () => {
    vi.mocked(generateText).mockResolvedValue(
      genResult('{}', [[]], [{ sourceType: 'url', url: 'https://top.com', title: 'Top' }]) as never,
    );
    const res = await researchWeb(PAYLOAD);
    expect(res).toMatchObject({ status: 'ok', citations: [{ title: 'Top', url: 'https://top.com' }] });
  });
});

describe('researchWeb — validate/retry/skip discipline', () => {
  it('retries once with the rejection appended, then succeeds', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(genResult('not json at all') as never)
      .mockResolvedValueOnce(genResult('{"domain":{"industry":"SaaS"}}') as never);
    const res = await researchWeb(PAYLOAD);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[1][0].prompt).toContain('previous reply was rejected');
    expect(res).toMatchObject({ status: 'ok', draft: { domain: { industry: 'SaaS' } } });
  });

  it('skips with reason "failed" after two malformed replies — never throws', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('still not json') as never);
    const res = await researchWeb(PAYLOAD);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" on schema mismatch after retry (vocab term missing meaning)', async () => {
    vi.mocked(generateText).mockResolvedValue(genResult('{"vocabulary":[{"term":"ARR"}]}') as never);
    const res = await researchWeb(PAYLOAD);
    expect(res).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('skips with reason "failed" (no retry) when generation throws — does not propagate', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('network down'));
    const res = await researchWeb(PAYLOAD);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ status: 'skipped', reason: 'failed' });
  });
});
