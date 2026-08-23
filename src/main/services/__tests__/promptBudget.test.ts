// Unit tests for the prompt budget module (AI-CTX.1 Task 1, extended by
// BRIEF-QUAL.1 with the fit gate and chunk budget moved here out of
// meetingIntelligenceService). Pure derivation, no sidecar involved — 'electron'
// is mocked only because llamaRuntimeConfig.ts (the chatCtxSize source) imports it
// at module scope; nothing here touches `app`.

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp',
    getPath: () => '/tmp',
  },
}));

import {
  CHARS_PER_TOKEN,
  estimateTokens,
  contextWindowTokens,
  promptCharBudget,
  chunkSegments,
  fitsWindow,
  chunkBudget,
  formatLine,
} from '../promptBudget';
import type { AIProviderName } from '../../../shared/types/ai';

const CLOUD_PROVIDERS: AIProviderName[] = ['openai', 'anthropic', 'google', 'kimi'];

describe('estimateTokens', () => {
  it('divides by CHARS_PER_TOKEN and rounds up', () => {
    // 2.0, not 3.5: measured on Qwen3-4B (~2.09 chars/token on Czech-heavy text)
    // and gpt-5-mini (~2.6 on the real cs-mix meeting) — see the constant's doc.
    expect(CHARS_PER_TOKEN).toBe(2.0);
    expect(estimateTokens('a'.repeat(8))).toBe(4); // 8 / 2 = 4 exactly
    expect(estimateTokens('a'.repeat(9))).toBe(5); // 9 / 2 = 4.5 -> ceil 5
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
  it('builtin at default ctx/maxTokens yields ~22.5k chars', () => {
    const saved = process.env.LIFEDASH_LLAMA_CTX;
    delete process.env.LIFEDASH_LLAMA_CTX;
    try {
      // (16384 - 4096 - 1024) * 2.0 = 22528
      expect(promptCharBudget({ providerName: 'builtin', maxTokens: undefined })).toBe(22528);
    } finally {
      if (saved !== undefined) process.env.LIFEDASH_LLAMA_CTX = saved;
    }
  });

  it("the summarization task's new 4096 output floor does NOT move the builtin budget", () => {
    // BRIEF-QUAL.1 adds `summarization: 4096` to TASK_MIN_OUTPUT_TOKENS, so a
    // previously-unconfigured summarization provider now arrives here with
    // maxTokens: 4096 instead of undefined. That is deliberately a no-op: the
    // default reserve was ALREADY 4096, so the chunking threshold does not move
    // for unconfigured users.
    const saved = process.env.LIFEDASH_LLAMA_CTX;
    delete process.env.LIFEDASH_LLAMA_CTX;
    try {
      expect(promptCharBudget({ providerName: 'builtin', maxTokens: 4096 })).toBe(22528);
      expect(promptCharBudget({ providerName: 'builtin', maxTokens: 4096 })).toBe(
        promptCharBudget({ providerName: 'builtin', maxTokens: undefined }),
      );
    } finally {
      if (saved !== undefined) process.env.LIFEDASH_LLAMA_CTX = saved;
    }
  });

  it('CAPS the output reserve at 4096 — a raised cloud cap never shrinks a local budget', () => {
    // BRIEF-QUAL.1 (2026-08-22): summarization's cap is raised to 16384 on cloud
    // providers so a whole meeting's JSON fits. Without the reserve cap that number
    // would flow into the budget math and cost 12k tokens' worth of prompt chars.
    const saved = process.env.LIFEDASH_LLAMA_CTX;
    delete process.env.LIFEDASH_LLAMA_CTX;
    try {
      const undefinedCap = promptCharBudget({ providerName: 'builtin', maxTokens: undefined });
      expect(promptCharBudget({ providerName: 'builtin', maxTokens: 4096 })).toBe(undefinedCap);
      expect(promptCharBudget({ providerName: 'builtin', maxTokens: 16_384 })).toBe(undefinedCap);
      expect(undefinedCap).toBe(22528);
      // The same cap applies to the fit gate, or the two would disagree.
      const prompt = 'b'.repeat(22_528);
      expect(fitsWindow({ providerName: 'builtin', maxTokens: undefined }, '', prompt)).toBe(true);
      expect(fitsWindow({ providerName: 'builtin', maxTokens: 16_384 }, '', prompt)).toBe(true);
    } finally {
      if (saved !== undefined) process.env.LIFEDASH_LLAMA_CTX = saved;
    }
  });

  it('still honours a SMALLER configured reserve — the cap is a ceiling, not a floor', () => {
    // (100_000 - 2_000 - 1024) * 2.0 = 193_952
    expect(promptCharBudget({ providerName: 'openai', maxTokens: 2_000 })).toBe(193_952);
  });

  it('respects a configured maxTokens reserve', () => {
    // Capped at DEFAULT_OUTPUT_RESERVE_TOKENS: (100_000 - 4_096 - 1024) * 2.0 = 189_760
    expect(promptCharBudget({ providerName: 'openai', maxTokens: 8_000 })).toBe(189_760);
  });

  it('floors at a small positive minimum instead of going negative', () => {
    // ollama: (4_096 - 4_096 - 1024) * 2.0 is negative
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

describe('fitsWindow (moved here from meetingIntelligenceService — same numbers)', () => {
  const builtin = { providerName: 'builtin' as const, maxTokens: undefined };

  it('accepts a prompt that leaves room for the output reserve and framing', () => {
    // 16384 window - 4096 default reserve - 1024 framing = 11264 tokens of prompt.
    // 11264 * 2.0 = 22528 chars exactly at the edge.
    expect(fitsWindow(builtin, 'a'.repeat(1_000), 'b'.repeat(21_528))).toBe(true);
  });

  it('rejects a prompt one estimated token past the window', () => {
    expect(fitsWindow(builtin, 'a'.repeat(1_000), 'b'.repeat(21_530))).toBe(false);
  });

  it('charges a SMALLER configured maxTokens against the window; a larger one is capped', () => {
    const frugal = { providerName: 'builtin' as const, maxTokens: 1_024 };
    const generous = { providerName: 'builtin' as const, maxTokens: 8_192 };
    // A smaller reserve buys prompt room...
    expect(fitsWindow(frugal, '', 'b'.repeat(28_670))).toBe(true);
    expect(fitsWindow(builtin, '', 'b'.repeat(28_670))).toBe(false);
    // ...while a larger one is capped at the 4096 default, so it changes nothing.
    expect(fitsWindow(generous, '', 'b'.repeat(22_528))).toBe(true);
    expect(fitsWindow(generous, '', 'b'.repeat(22_530))).toBe(false);
  });

  it('measures the system and user prompt TOGETHER', () => {
    const half = 'x'.repeat(12_000);
    expect(fitsWindow(builtin, half, half)).toBe(false); // 24_000 chars combined
    expect(fitsWindow(builtin, '', half)).toBe(true);
  });
});

describe('chunkBudget (moved here from meetingIntelligenceService — same numbers)', () => {
  it('is the prompt budget minus the system prompt minus 512 chars of header headroom', () => {
    const provider = { providerName: 'builtin' as const, maxTokens: undefined };
    const system = 's'.repeat(2_000);
    // 22528 - 2000 - 512
    expect(chunkBudget(provider, system)).toBe(20_016);
  });

  it('floors at 1000 chars so a starved window still makes progress', () => {
    const provider = { providerName: 'ollama' as const, maxTokens: undefined };
    // ollama's prompt budget is already at its own 2000 floor; a 3000-char system
    // prompt would drive the chunk budget negative.
    expect(chunkBudget(provider, 's'.repeat(3_000))).toBe(1_000);
  });
});

describe('formatLine', () => {
  it('renders the [MM:SS] content shape the budget is measured with', () => {
    expect(formatLine({ startTime: 0, content: 'Kickoff' })).toBe('[00:00] Kickoff');
    expect(formatLine({ startTime: 125_000, content: 'Budget' })).toBe('[02:05] Budget');
  });
});
