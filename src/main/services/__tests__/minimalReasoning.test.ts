// === FILE PURPOSE ===
// minimalReasoningOptions is scoped to OpenAI's original GPT-5 family: those models
// get reasoningEffort 'minimal', everything else (later GPT-5.x, other providers)
// gets no provider option at all.

import { describe, it, expect } from 'vitest';
import { minimalReasoningOptions } from '../minimalReasoning';

describe('minimalReasoningOptions', () => {
  it.each(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-mini-2025-08-07'])('sets minimal effort for %s', (model) => {
    expect(minimalReasoningOptions('openai', model)).toEqual({ openai: { reasoningEffort: 'minimal' } });
  });

  it.each(['gpt-5.2', 'gpt-5.1-mini', 'gpt-4.1-mini', 'o4-mini', 'gpt-5-codex'])('leaves %s untouched', (model) => {
    expect(minimalReasoningOptions('openai', model)).toBeUndefined();
  });

  it('leaves other providers untouched even with a gpt-5 model id', () => {
    expect(minimalReasoningOptions('lmstudio', 'gpt-5-mini')).toBeUndefined();
    expect(minimalReasoningOptions('kimi', 'gpt-5')).toBeUndefined();
  });
});
