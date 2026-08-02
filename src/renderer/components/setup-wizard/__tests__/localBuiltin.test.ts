// LOCAL-RT.1 Task 5 — pure logic behind the wizard's built-in-AI branch.
// Asserted against the REAL shipped catalog, because the honesty rules here are
// claims about the actual models: which of them can call tools, which fit a small
// machine, and what the wizard is allowed to write into `ai.taskModels`.
import { describe, it, expect } from 'vitest';
import {
  SHORTLIST_SIZE,
  builtinTaskModelPatch,
  fittingModels,
  modelPool,
  rankForShortlist,
  routableModels,
  supportedModels,
  toolCallingVerdict,
} from '../localBuiltin';
import { applyFilters } from '../../settings/local-ai/LocalAIFilterBar';
import { makeView, runtimeIdOf } from './localModelsFixture';

describe('localBuiltin — what this machine can honestly run', () => {
  it('keeps only models whose stated minimum fits the reported RAM', () => {
    const small = fittingModels(makeView({ totalRamGB: 8 }), 'chat').map((m) => m.id);
    expect(small.sort()).toEqual(['gemma-3-4b-it', 'qwen3-4b']);

    const big = fittingModels(makeView({ totalRamGB: 64 }), 'chat').map((m) => m.id);
    expect(big).toHaveLength(supportedModels(makeView({ totalRamGB: 64 }), 'chat').length);
  });

  it('falls back to every supported model when nothing fits, flagging that none do', () => {
    const pool = modelPool(makeView({ totalRamGB: 4 }), 'chat');
    expect(pool.noneFit).toBe(true);
    expect(pool.models.length).toBeGreaterThan(0);
  });

  it('does not flag noneFit when something fits', () => {
    expect(modelPool(makeView({ totalRamGB: 8 }), 'chat').noneFit).toBe(false);
  });
});

describe('localBuiltin — shortlist ordering', () => {
  it('puts the tier recommendation first, then tool-callers, then the larger models', () => {
    const view = makeView({ totalRamGB: 32 });
    const recommended = new Set(view.tier.recommendedModelIds);
    const ranked = modelPool(view, 'chat').models.slice().sort(rankForShortlist(recommended));

    expect(ranked[0].id).toBe('mistral-small-3.2-24b'); // the tier's own pick at 32 GB
    // Every tool-caller precedes every model that cannot call tools.
    const lastToolCaller = ranked.map((m) => m.toolCalling).lastIndexOf(true);
    const firstNonToolCaller = ranked.map((m) => m.toolCalling).indexOf(false);
    expect(lastToolCaller).toBeLessThan(firstNonToolCaller);
  });

  it('surfaces a tool-caller inside the un-expanded shortlist on a small machine', () => {
    const view = makeView({ totalRamGB: 8 });
    const recommended = new Set(view.tier.recommendedModelIds);
    const shown = modelPool(view, 'chat').models.slice().sort(rankForShortlist(recommended)).slice(0, SHORTLIST_SIZE);
    expect(shown.some((m) => m.toolCalling)).toBe(true);
  });
});

describe('localBuiltin — the low-RAM / non-Chinese / tool-calling collision', () => {
  const view = makeView({ totalRamGB: 8 });
  const pool = modelPool(view, 'chat').models;

  it('reports "ok" unfiltered — a small machine can still get tool calling', () => {
    expect(toolCallingVerdict(pool, pool)).toEqual({ kind: 'ok' });
  });

  it('names the excluded tool-caller when an origin policy filters it out', () => {
    const visible = applyFilters(pool, { origin: 'US', license: '' });
    const verdict = toolCallingVerdict(pool, visible);

    expect(verdict.kind).toBe('filtered-out');
    // The honest fact the wizard must not paper over: at 8 GB the ONLY built-in
    // model that can drive Digital Twin actions is Chinese-origin.
    expect(verdict.kind === 'filtered-out' && verdict.excluded.map((m) => m.id)).toEqual(['qwen3-4b']);
    expect(verdict.kind === 'filtered-out' && verdict.excluded[0].originCountry).toBe('CN');
    // …and what is left chats but cannot act.
    expect(visible.every((m) => !m.toolCalling)).toBe(true);
  });

  it('a 16 GB machine has a non-Chinese tool-caller, so no steer is needed', () => {
    const bigger = modelPool(makeView({ totalRamGB: 16 }), 'chat').models;
    const visible = applyFilters(bigger, { origin: 'US', license: '' });
    expect(toolCallingVerdict(bigger, visible)).toEqual({ kind: 'ok' });
    expect(visible.filter((m) => m.toolCalling).map((m) => m.id)).toEqual(['llama-3.1-8b']);
  });

  it('reports "none" when the pool itself has no tool-caller', () => {
    expect(toolCallingVerdict([], [])).toEqual({ kind: 'none' });
  });
});

describe('localBuiltin — only downloaded files are routable', () => {
  it('offers nothing while nothing is on disk', () => {
    expect(routableModels(makeView(), 'chat')).toEqual([]);
    expect(routableModels(makeView(), 'embedding')).toEqual([]);
  });

  it('offers a downloaded file under its shared-helper runtime id, with its tool verdict', () => {
    const view = makeView({ downloaded: ['qwen3-4b', 'embeddinggemma-300m'] });

    expect(routableModels(view, 'chat')).toEqual([
      { id: runtimeIdOf('qwen3-4b'), label: 'Qwen3 4B (Q4_K_M)', toolCalling: true },
    ]);
    expect(routableModels(view, 'embedding')).toEqual([
      { id: runtimeIdOf('embeddinggemma-300m'), label: 'EmbeddingGemma 300M (Q8_0)', toolCalling: false },
    ]);
  });
});

describe('localBuiltin — the ai.taskModels patch', () => {
  it('writes only live_assistant and embedding (the rest inherit or fall back)', () => {
    const patch = builtinTaskModelPatch('provider-1', {
      chatModelId: runtimeIdOf('qwen3-4b'),
      embeddingModelId: runtimeIdOf('embeddinggemma-300m'),
    });

    expect(patch).toEqual({
      live_assistant: { providerId: 'provider-1', model: 'Qwen3-4B-Q4_K_M' },
      embedding: { providerId: 'provider-1', model: 'embeddinggemma-300M-Q8_0' },
    });
  });

  it('omits embedding entirely when no embedding model was downloaded', () => {
    const patch = builtinTaskModelPatch('provider-1', { chatModelId: runtimeIdOf('qwen3-14b') });
    expect(patch).toEqual({ live_assistant: { providerId: 'provider-1', model: 'Qwen3-14B-Q4_K_M' } });
    expect('embedding' in patch).toBe(false);
  });
});
