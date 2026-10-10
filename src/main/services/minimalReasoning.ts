// === FILE PURPOSE ===
// Provider options that turn hidden reasoning down to its minimum for tasks with a
// small output cap. OpenAI's original GPT-5 family (gpt-5, gpt-5-mini, gpt-5-nano)
// reasons at 'medium' by default and spends a 1024-token cap entirely on hidden
// reasoning, returning no text: live triage on gpt-5-mini had zero successful runs
// across the 2026-09 logs (finishReason 'length', 1024/1024 tokens spent reasoning).
// 'minimal' is scoped to that family only — later GPT-5.x models use a different
// effort scale, so they get no option rather than a value they may reject.

const GPT5_ORIGINAL_FAMILY = /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/;

export function minimalReasoningOptions(
  providerName: string,
  model: string,
): { openai: { reasoningEffort: 'minimal' } } | undefined {
  if (providerName !== 'openai' || !GPT5_ORIGINAL_FAMILY.test(model)) return undefined;
  return { openai: { reasoningEffort: 'minimal' } };
}
