// === FILE PURPOSE ===
// Recording <-> built-in runtime wiring: while a recording is running, hold the chat
// role on the model the live assistant actually uses, so a different-model request
// landing between two cadence calls cannot swap the session's model out from under it.
//
// Deliberately its OWN module rather than part of llamaRuntimeService: the runtime stays
// task-ignorant (it knows nothing about tasks, providers or recordings), which is what
// keeps the import direction one-way and free of the
// meetingService -> audioProcessor -> transcriptionService style cycle. Everything here
// imports downward; nothing imports back.
//
// === DEPENDENCIES ===
// ./ai-provider (resolveTaskModel), ./llamaRuntimeService (setChatModelPin),
// ./llamaRuntimeConfig (resolveModel), ./logger
//
// === LIMITATIONS ===
// - Only the `builtin` provider is ever pinned. A cloud or LM Studio live assistant
//   leaves the runtime unpinned: neither has the one-process-per-role constraint the
//   pin exists for (AI-RESIL.2 scope decision).

import { resolveTaskModel } from './ai-provider';
import { setChatModelPin } from './llamaRuntimeService';
import { resolveModel } from './llamaRuntimeConfig';
import { createLogger } from './logger';

const log = createLogger('llama');

/** ai-provider's "whatever built-in model suits this role" sentinel. Mirrors its private
 *  BUILTIN_DEFAULT_MODEL; an explicit model id is pinned verbatim. */
const BUILTIN_DEFAULT_MODEL = 'default';

/**
 * Pin the chat role to this recording's live-assistant model.
 *
 * The sentinel is resolved to a concrete model id HERE, with the same resolver
 * ensureRunning() uses, so a `default` live assistant and a `default` request agree on
 * one model instead of comparing a placeholder against a filename.
 *
 * NEVER throws and never blocks a recording: no provider configured, a cloud live
 * assistant, or a model that is not downloaded all mean exactly one thing — no pin. An
 * AI-configuration problem must not be able to fail a recording.
 */
export async function pinChatModelForRecording(): Promise<void> {
  try {
    const provider = await resolveTaskModel('live_assistant');
    if (!provider || provider.providerName !== 'builtin') return;
    const requested = provider.model === BUILTIN_DEFAULT_MODEL ? undefined : provider.model;
    setChatModelPin(resolveModel('chat', requested).modelId);
  } catch (err) {
    log.warn('could not pin the chat model for this recording:', (err as Error).message);
  }
}

/**
 * Release the recording pin. Idempotent and never throws — call it from a `finally`.
 * A leaked pin would starve every other local AI task for the rest of the session,
 * which is strictly worse than the model thrash the pin exists to prevent.
 */
export function releaseChatModelPin(): void {
  setChatModelPin(null);
}
