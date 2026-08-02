// === FILE PURPOSE ===
// Pure resolution layer for the bundled llama.cpp sidecar: where the binaries and
// GGUFs live, which backend to try, which flags each role gets, and how to obtain
// a free port. No process state and no side effects beyond reading the filesystem,
// so it stays trivially testable and safe to call from detection IPC.
// The supervisor that actually spawns anything is llamaRuntimeService.ts.
//
// === DEPENDENCIES ===
// node:fs, node:path, node:net, electron (app)
//
// === VERIFICATION STATUS ===
// - Flags verified against `llama-server.exe --help` (llama.cpp b10219) AND by
//   running the binary: -m, --host, --port, --alias, --embeddings, --ctx-size,
//   --parallel, --ubatch-size, --api-key, --cors-origins, --no-webui, --jinja,
//   --fit-target. No flag here is assumed.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { app } from 'electron';
import type { LlamaBackend, LlamaRole } from '../../shared/types/ai';

export type { LlamaBackend, LlamaRole };

export const LLAMA_HOST = '127.0.0.1';

// Chat context sizing is a VRAM decision, not a convenience. llama.cpp b10219 has
// `-fit` ON by default: it grows UNSET params (context, slots) until only ~1GiB of
// device memory is left — the Task 1 spike measured 10,931/12,282 MiB consumed for
// ~5.3GB of weights because it auto-picked n_slots=4 x n_ctx_slot=131072. Whisper
// shares this GPU, so both values are set explicitly to bound the KV cache, and the
// fit margin is raised so transcription still has room.
const CHAT_CTX_SIZE = 16384;
const CHAT_PARALLEL_SLOTS = 1;
const CHAT_FIT_TARGET_MIB = 2048;

// Embedding models pool over the whole input, so an input longer than n_ubatch is
// rejected. llama-server logs "embeddings enabled with n_batch (2048) > n_ubatch
// (512) / setting n_batch = n_ubatch = 512" and clamps to 512 tokens; raising
// n_ubatch to 2048 keeps both at 2048 and lets a full-context chunk embed.
const EMBED_UBATCH = 2048;

/** Filename heuristic for telling embedding GGUFs from chat GGUFs. Mirrors the
 *  `!id.includes('embed')` filter ai-provider.ts already uses for LM Studio. */
const EMBEDDING_NAME_PATTERN = /embed/i;

// --- Binary resolution ---------------------------------------------------------------

function binaryName(): string {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

/** Backend chain per platform. Windows/Linux: Vulkan (covers NVIDIA/AMD/Intel) then CPU. */
function backendChain(): LlamaBackend[] {
  if (process.platform === 'darwin') return ['metal'];
  return ['vulkan', 'cpu'];
}

/**
 * Root directory holding `<backend>/llama-server`. Packaged builds read it from
 * `process.resourcesPath` (forge `extraResource`, same shape as ./drizzle); dev
 * reads `<appPath>/resources/llama` unless LIFEDASH_LLAMA_BIN_DIR overrides it.
 */
export function getBinaryDir(): string {
  const override = process.env.LIFEDASH_LLAMA_BIN_DIR;
  if (override) return override;
  return app.isPackaged ? path.join(process.resourcesPath, 'llama') : path.join(app.getAppPath(), 'resources', 'llama');
}

/** Installed binaries, best backend first. LIFEDASH_LLAMA_BIN pins one exact binary. */
export function binaryCandidates(): { backend: LlamaBackend; binPath: string }[] {
  const pinned = process.env.LIFEDASH_LLAMA_BIN;
  if (pinned) {
    const backend = backendChain().find((b) => pinned.replace(/\\/g, '/').includes(`/${b}/`)) ?? backendChain()[0];
    return fs.existsSync(pinned) ? [{ backend, binPath: pinned }] : [];
  }
  const root = getBinaryDir();
  return backendChain()
    .map((backend) => ({ backend, binPath: path.join(root, backend, binaryName()) }))
    .filter((c) => fs.existsSync(c.binPath));
}

/** True when at least one sidecar binary is installed. Cheap — no spawn. */
export function isBinaryAvailable(): boolean {
  return binaryCandidates().length > 0;
}

// --- Model resolution ----------------------------------------------------------------

/** Where downloaded GGUFs live. Plain files, user-visible, deletable (no blob store). */
export function getModelsDir(): string {
  return process.env.LIFEDASH_LLAMA_MODELS_DIR || path.join(app.getPath('userData'), 'llm-models');
}

/** Downloaded models as `{ id, file }`; the id is the filename stem (llama.cpp's own convention). */
export function listAvailableModels(): { id: string; file: string }[] {
  const dir = getModelsDir();
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
      .sort()
      .map((f) => ({ id: f.slice(0, -'.gguf'.length), file: path.join(dir, f) }));
  } catch {
    return []; // directory absent until the first download — not an error
  }
}

/**
 * Pick the GGUF for a role. An explicit id wins; otherwise the first downloaded
 * model whose filename matches (embedding) or does not match (chat) the embedding
 * pattern. Throws a user-actionable error rather than spawning something wrong.
 */
export function resolveModel(role: LlamaRole, modelId?: string): { modelId: string; modelPath: string } {
  const models = listAvailableModels();
  if (modelId) {
    const hit = models.find((m) => m.id.toLowerCase() === modelId.toLowerCase());
    if (!hit) {
      throw new Error(`Built-in AI model "${modelId}" is not downloaded. Add it in Settings → Local AI.`);
    }
    return { modelId: hit.id, modelPath: hit.file };
  }
  const wantEmbedding = role === 'embedding';
  const hit = models.find((m) => EMBEDDING_NAME_PATTERN.test(m.id) === wantEmbedding);
  if (!hit) {
    throw new Error(`No built-in ${role} model is downloaded. Download one in Settings → Local AI.`);
  }
  return { modelId: hit.id, modelPath: hit.file };
}

// --- Spawn arguments -------------------------------------------------------------------

function chatCtxSize(): number {
  const override = Number(process.env.LIFEDASH_LLAMA_CTX);
  return Number.isFinite(override) && override > 0 ? override : CHAT_CTX_SIZE;
}

/**
 * Role-specific llama-server arguments. Every flag is verified against b10219's
 * `--help` and by running the binary; see the file header.
 *
 * `--device` is deliberately NOT passed: b10219 fits params to device memory and
 * picks a device itself (observed: with an NVIDIA dGPU as Vulkan0 and an AMD iGPU
 * as Vulkan1 reporting 4x more "free" memory, it selected the dGPU and offloaded
 * every layer there). Hardcoding `Vulkan0` — the spike's convenience — would pin
 * users whose device 0 is a weak iGPU to that iGPU. Its own selection is better.
 */
export function buildArgs(role: LlamaRole, modelPath: string, modelId: string, port: number, apiKey: string): string[] {
  const common = [
    '-m',
    modelPath,
    '--host',
    LLAMA_HOST,
    '--port',
    String(port),
    '--alias',
    modelId, // response `model` echoes this — keeps ai-provider's echoed-model check honest
    '--api-key',
    apiKey, // llama-server itself warns when a loopback server has no key set
    '--cors-origins',
    'localhost', // defense in depth: a web page's Origin is never reflected
    '--no-webui', // nothing consumes the bundled UI; don't serve it
  ];
  if (role === 'embedding') {
    // Exactly the Task-1-verified embedding flag set, plus the ubatch fix.
    return [...common, '--embeddings', '--ubatch-size', String(EMBED_UBATCH)];
  }
  return [
    ...common,
    '--ctx-size',
    String(chatCtxSize()),
    '--parallel',
    String(CHAT_PARALLEL_SLOTS),
    '--fit-target',
    String(CHAT_FIT_TARGET_MIB),
    '--jinja', // already the b10219 default; explicit so a future default flip can't break tool calling
  ];
}

// --- Port probe --------------------------------------------------------------------------

/** Ask the OS for a free loopback port (bind :0, read it back, release). */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, LLAMA_HOST, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('Could not obtain a free port'))));
    });
  });
}
