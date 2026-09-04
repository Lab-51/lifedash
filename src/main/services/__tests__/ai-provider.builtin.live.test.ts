// === FILE PURPOSE ===
// LIVE end-to-end confirmation of the `builtin` provider against a REAL bundled
// llama-server sidecar (LOCAL-RT.1 Task 2). Exercises the shipped seams — the
// llamaRuntimeService supervisor, the createFactory `builtin` case, embed() and
// streamGenerate() — with the AI SDK and the OpenAI adapter fully REAL. Only
// getDb / secure-storage / logger / electron are mocked.
//
// Also guards the `--reasoning off` chat flag (llamaRuntimeConfig.ts, BRIEF-QUAL.1)
// with a raw /chat/completions call (SPEAKER.1 Task 5) — the AI SDK's chat-completions
// parser never surfaces `reasoning_content`, so this is the only place a regression
// in that flag's default would be observable.
//
// SKIPPED BY DEFAULT so `npm test` stays green without a binary or models present.
// Run it explicitly (mirrors ai-provider.embed.live.test.ts):
//
//   BUILTIN_LIVE=1 \
//   LIFEDASH_LLAMA_BIN=<...>/llama-bin/cpu/llama-server.exe \
//   LIFEDASH_LLAMA_MODELS_DIR=<...>/models \
//   npx vitest run ai-provider.builtin.live
//
// LIFEDASH_LLAMA_BIN_DIR (a directory holding vulkan/ and cpu/ subfolders) works
// too and additionally exercises the backend fallback chain.

import { describe, it, expect, vi, afterAll } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../secure-storage', () => ({ decryptString: vi.fn((b: string) => b) }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getLogDirectory: () => process.env.LIFEDASH_LLAMA_LOG_DIR || process.cwd(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key' },
  aiProviders: { __table: 'aiProviders', id: 'id', enabled: 'enabled' },
  aiUsage: { __table: 'aiUsage' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

import { embed, streamGenerate, testConnection, clearProviderCache } from '../ai-provider';
import { status, stop, listAvailableModels, ensureRunning } from '../llamaRuntimeService';
import { getDb } from '../../db/connection';

const LIVE = process.env.BUILTIN_LIVE === '1';
const PROVIDER_ID = 'builtin-live';

interface FakeTable {
  __table: string;
}

/** DB stub routing the embedding task to the built-in provider with the `default`
 *  sentinel model — which also exercises the model-id retarget (the response must
 *  echo the REAL model, never `default`). */
function liveDb() {
  return {
    select: () => ({
      from: (table: FakeTable) => {
        const rows =
          table.__table === 'settings'
            ? [
                {
                  key: 'ai.taskModels',
                  value: JSON.stringify({ embedding: { providerId: PROVIDER_ID, model: 'default' } }),
                },
              ]
            : table.__table === 'aiProviders'
              ? [{ id: PROVIDER_ID, name: 'builtin', apiKeyEncrypted: null, baseUrl: null, enabled: true }]
              : [];
        return { where: () => Promise.resolve(rows), limit: () => Promise.resolve(rows) };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

afterAll(async () => {
  if (LIVE) await stop();
});

describe.runIf(LIVE)('builtin provider — LIVE sidecar round-trip', () => {
  it('starts ONLY the embedding process and returns 768-dim vectors with real provenance', async () => {
    (getDb as Mock).mockReturnValue(liveDb());
    clearProviderCache();
    expect(status().running).toBe(false); // nothing has spawned yet

    const result = await embed(['Guten Morgen, wie war das gestrige Meeting?', 'zweite Notiz'], 'embedding');

    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(768);
    expect(result.embeddings[1]).toHaveLength(768);
    // Provenance: the echoed id must be the real model, not the `default` sentinel.
    expect(result.model).not.toBe('default');
    expect(result.model.toLowerCase()).toContain('embed');

    // Role isolation: embedding is up, chat was never started.
    expect(status().embedding.running).toBe(true);
    expect(status().chat.running).toBe(false);
  }, 300_000);

  it('testConnection("builtin") lazily starts the chat process and succeeds', async () => {
    (getDb as Mock).mockReturnValue(liveDb());
    const chatModel = listAvailableModels().find((m) => !/embed/i.test(m.id));
    expect(chatModel).toBeDefined();

    const result = await testConnection('builtin', null, null);

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(status().chat.running).toBe(true);
    expect(status().chat.modelId).toBe(chatModel!.id);
    expect(['vulkan', 'cpu', 'metal']).toContain(status().backend);
    expect(status().loadedModels).toHaveLength(2); // both roles resident, independently
  }, 300_000);

  it('streams a chat completion through the shared AI SDK path', async () => {
    (getDb as Mock).mockReturnValue(liveDb());
    const chatModel = listAvailableModels().find((m) => !/embed/i.test(m.id))!;

    const stream = streamGenerate({
      providerId: PROVIDER_ID,
      providerName: 'builtin',
      apiKeyEncrypted: null,
      baseUrl: null,
      model: chatModel.id,
      messages: [{ role: 'user', content: 'Count from 1 to 5, space separated. Answer with nothing else.' }],
      maxTokens: 64,
    });

    let chunks = 0;
    let text = '';
    for await (const chunk of stream.textStream) {
      chunks += 1;
      text += chunk;
    }
    expect(chunks).toBeGreaterThan(1); // real token-by-token streaming, not one blob
    expect(text.trim().length).toBeGreaterThan(0);
    expect(await stream.finishReason).toBe('stop');
  }, 300_000);

  it('regression guard: --reasoning off never lets hidden thinking eat the whole token budget (SPEAKER.1 Task 5)', async () => {
    (getDb as Mock).mockReturnValue(liveDb());
    const chatModel = listAvailableModels().find((m) => !/embed/i.test(m.id))!;
    const endpoint = await ensureRunning('chat', chatModel.id);

    // Deliberately a RAW fetch against the sidecar's own /chat/completions, bypassing
    // the AI SDK: @ai-sdk/openai's chat-completions parser hardcodes `reasoning: void 0`
    // for every response (verified: no @ai-sdk package in node_modules parses a
    // `reasoning_content` field at all), so a check through generate()/streamGenerate()
    // could never observe this regression — it would pass whether the flag is on or off.
    // A SMALL max_tokens reproduces the exact failure mode measured 2026-08-21 on
    // Qwen3-4B-Q4_K_M with the default (reasoning-on) flags: finish_reason 'length',
    // 48/48 tokens spent in reasoning_content, content ''.
    const resp = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({
        model: endpoint.modelId,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        max_tokens: 32,
        stream: false,
      }),
    });
    expect(resp.ok).toBe(true);
    const body = (await resp.json()) as {
      choices: Array<{ finish_reason: string; message: { content: string; reasoning_content?: string } }>;
    };
    const choice = body.choices[0];

    expect(choice.message.content.trim().length).toBeGreaterThan(0);
    expect(choice.finish_reason).not.toBe('length');
    // "no reasoning_content in the response": llama-server may omit the field
    // entirely or emit it empty once reasoning is off; either reads as falsy here.
    // A future binary bump that flips the flag's default would return real
    // chain-of-thought text in this field and this line would catch it.
    expect(choice.message.reasoning_content ?? '').toBe('');
  }, 300_000);

  it('stop() terminates every sidecar process', async () => {
    await stop();
    expect(status().running).toBe(false);
    expect(status().loadedModels).toEqual([]);
  }, 60_000);
});
