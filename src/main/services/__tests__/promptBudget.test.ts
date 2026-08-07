// Unit tests for the prompt budget module (AI-CTX.1 Task 1). Pure derivation, no
// sidecar involved — 'electron' is mocked only because llamaRuntimeConfig.ts (the
// chatCtxSize source) imports it at module scope; nothing here touches `app`.

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp',
    getPath: () => '/tmp',
  },
}));

import { CHARS_PER_TOKEN, estimateTokens, contextWindowTokens, promptCharBudget, chunkSegments } from '../promptBudget';
import type { AIProviderName } from '../../../shared/types/ai';

const CLOUD_PROVIDERS: AIProviderName[] = ['openai', 'anthropic', 'google', 'kimi'];

describe('estimateTokens', () => {
  it('divides by CHARS_PER_TOKEN and rounds up', () => {
    expect(CHARS_PER_TOKEN).toBe(3.5);
    expect(estimateTokens('a'.repeat(7))).toBe(2); // 7 / 3.5 = 2 exactly
    expect(estimateTokens('a'.repeat(8))).toBe(3); // 8 / 3.5 = 2.28.. -> ceil 3
  });

  it('never under-counts an empty or tiny string', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
  });
});

describe('contextWindowTokens', () => {
  it('builtin reads chatCtxSize() — default 16384 when LIFEDASH_LLAMA_CTX is unset', () => {
    const saved = process.env.LIFEDASH_LLAMA_CTX;
    delete process.env.LIFEDASH_LLAMA_CTX;
    try {
      expect(contextWindowTokens('builtin')).toBe(16384);
    } finally {
      if (saved !== undefined) process.env.LIFEDASH_LLAMA_CTX = saved;
    }
  });

  it('builtin honours the LIFEDASH_LLAMA_CTX override', () => {
    const saved = process.env.LIFEDASH_LLAMA_CTX;
    process.env.LIFEDASH_LLAMA_CTX = '8192';
    try {
      expect(contextWindowTokens('builtin')).toBe(8192);
    } finally {
      if (saved === undefined) delete process.env.LIFEDASH_LLAMA_CTX;
      else process.env.LIFEDASH_LLAMA_CTX = saved;
    }
  });

  it.each(CLOUD_PROVIDERS)('%s budgets 100_000 tokens', (name) => {
    expect(contextWindowTokens(name)).toBe(100_000);
  });

  it('lmstudio floors at 8_192', () => {
    expect(contextWindowTokens('lmstudio')).toBe(8_192);
  });

  it('ollama floors at 4_096', () => {
    expect(contextWindowTokens('ollama')).toBe(4_096);
  });
});

describe('promptCharBudget', () => {
  it('builtin at default ctx/maxTokens yields ~39k chars', () => {
    const saved = process.env.LIFEDASH_LLAMA_CTX;
    delete process.env.LIFEDASH_LLAMA_CTX;
    try {
      // (16384 - 4096 - 1024) * 3.5 = 39424
      expect(promptCharBudget({ providerName: 'builtin', maxTokens: undefined })).toBe(39424);
    } finally {
      if (saved !== undefined) process.env.LIFEDASH_LLAMA_CTX = saved;
    }
  });

  it('respects a configured maxTokens reserve', () => {
    // (100_000 - 8_000 - 1024) * 3.5 = 318_416
    expect(promptCharBudget({ providerName: 'openai', maxTokens: 8_000 })).toBe(318_416);
  });

  it('floors at a small positive minimum instead of going negative', () => {
    // ollama: (4_096 - 4_096 - 1024) * 3.5 is negative
    const budget = promptCharBudget({ providerName: 'ollama', maxTokens: undefined });
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBe(2_000);
  });
});

describe('chunkSegments', () => {
  function seg(startTime: number, content: string) {
    return { startTime, content };
  }

  it('returns exactly one chunk when everything fits', () => {
    const segments = [seg(0, 'hello'), seg(1000, 'world')];
    const chunks = chunkSegments(segments, 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it('preserves order and loses nothing when flattened, and sorts unsorted input', () => {
    const segments = [seg(5000, 'third'), seg(0, 'first'), seg(2000, 'second')];
    const chunks = chunkSegments(segments, 10_000);
    const flattened = chunks.flat();
    expect(flattened.map((s) => s.content)).toEqual(['first', 'second', 'third']);
  });

  it('splits into multiple chunks that each stay within budget, never splitting a segment', () => {
    // Each formatted line is "[00:00] " (8 chars) + content. Use a small budget that
    // only fits one segment per chunk to force a split.
    const segments = [seg(0, 'a'.repeat(20)), seg(1000, 'b'.repeat(20)), seg(2000, 'c'.repeat(20))];
    const budget = 30; // one line (~28 chars) fits, two do not
    const chunks = chunkSegments(segments, budget);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
    // No chunk here exceeds budget since no single segment alone exceeds it.
    for (const chunk of chunks) {
      const renderedLength = chunk
        .map((s) => {
          const minutes = Math.floor(s.startTime / 60000);
          const seconds = Math.floor((s.startTime % 60000) / 1000);
          return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${s.content}`;
        })
        .join('\n').length;
      expect(renderedLength).toBeLessThanOrEqual(budget);
    }
    expect(chunks.flat().map((s) => s.content)).toEqual([
      segments[0].content,
      segments[1].content,
      segments[2].content,
    ]);
  });

  it('gives a single oversized segment its own chunk instead of dropping content', () => {
    const huge = seg(0, 'x'.repeat(1000));
    const small = seg(1000, 'y');
    const chunks = chunkSegments([huge, small], 50);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual([huge]);
    expect(chunks[1]).toEqual([small]);
  });

  it('returns no chunks for empty input', () => {
    expect(chunkSegments([], 1000)).toEqual([]);
  });
});
