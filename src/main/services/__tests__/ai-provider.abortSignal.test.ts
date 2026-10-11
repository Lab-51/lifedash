// === FILE PURPOSE ===
// TWIN-LOOP.2 Task 6 (a): generate() accepts an optional abortSignal and forwards it to the
// AI SDK call, exactly like streamGenerate. Contract pinned here:
//   - the signal reaches generateText unchanged; omitted, the call is as before;
//   - an abort REJECTS - it is never an empty-string success, writes no usage row, is not
//     mapped to the "request too large" hint, and is not retried (one SDK call only).
// The AI SDK is mocked - no model is called.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

const h = vi.hoisted(() => ({ generateText: vi.fn(), insert: vi.fn() }));

vi.mock('ai', () => ({ generateText: h.generateText, streamText: vi.fn(), embedMany: vi.fn() }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn(() => ({ chat: vi.fn((m: string) => `model:${m}`) })) }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => vi.fn()) }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn(() => vi.fn()) }));
vi.mock('ollama-ai-provider', () => ({ createOllama: vi.fn(() => vi.fn()) }));
vi.mock('../secure-storage', () => ({ decryptString: vi.fn((blob: string) => blob) }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../db/connection', () => ({
  getDb: () => ({ insert: () => ({ values: h.insert }) }),
}));

import { generate, clearProviderCache } from '../ai-provider';
import { runTwinModelCall, TwinModelTimeoutError } from '../twinModelCall';

const BASE = {
  providerId: 'p-lms',
  providerName: 'lmstudio' as const,
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'local-model',
  taskType: 'twin_interview',
  prompt: 'hello',
};

const OK = {
  text: 'hi',
  reasoning: [],
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  finishReason: 'stop',
};

beforeEach(() => {
  clearProviderCache();
  vi.clearAllMocks();
  h.insert.mockResolvedValue(undefined);
});

describe('generate() abortSignal', () => {
  it('forwards the caller signal to the AI SDK call', async () => {
    (h.generateText as Mock).mockResolvedValue(OK);
    const signal = new AbortController().signal;

    await generate({ ...BASE, abortSignal: signal });

    expect(h.generateText).toHaveBeenCalledTimes(1);
    expect((h.generateText as Mock).mock.calls[0][0].abortSignal).toBe(signal);
  });

  it('without a signal the call is unchanged and still succeeds', async () => {
    (h.generateText as Mock).mockResolvedValue(OK);

    const result = await generate(BASE);

    expect(result.text).toBe('hi');
    expect((h.generateText as Mock).mock.calls[0][0].abortSignal).toBeUndefined();
  });

  it('an abort rejects: no empty success, no usage row, no retry', async () => {
    const controller = new AbortController();
    (h.generateText as Mock).mockImplementation(async (args: { abortSignal: AbortSignal }) => {
      controller.abort();
      throw args.abortSignal.reason;
    });

    await expect(generate({ ...BASE, abortSignal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(h.generateText).toHaveBeenCalledTimes(1);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('an abort is not rewritten into the local "request too large" hint', async () => {
    const controller = new AbortController();
    (h.generateText as Mock).mockImplementation(async () => {
      controller.abort();
      throw new Error('400 bad request: aborted');
    });
    await expect(generate({ ...BASE, abortSignal: controller.signal })).rejects.toThrow('400 bad request: aborted');

    // Control: the same error WITHOUT an abort is still mapped to the hint.
    (h.generateText as Mock).mockRejectedValue(new Error('400 bad request'));
    await expect(generate(BASE)).rejects.toThrow('Request too large for the local model');
  });

  it('a timeout from runTwinModelCall reaches the SDK request: the model call is really cancelled', async () => {
    // A model call that only ends when the signal it was handed aborts, like the real SDK.
    let sdkSawAbort = false;
    (h.generateText as Mock).mockImplementation(
      (args: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args.abortSignal?.addEventListener('abort', () => {
            sdkSawAbort = true;
            reject(args.abortSignal?.reason);
          });
        }),
    );

    const err = await runTwinModelCall((abortSignal) => generate({ ...BASE, abortSignal }), undefined, 50).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(TwinModelTimeoutError);
    expect(sdkSawAbort).toBe(true);
    expect(h.insert).not.toHaveBeenCalled();
  });
});
