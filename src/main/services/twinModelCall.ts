// === FILE PURPOSE ===
// One bounded way to run a twin (wizard) model call: a per-call timeout plus an
// optional caller cancel, so a hung local model can never leave the wizard spinning
// and a closed wizard can stop the work it started.
//
//   runTwinModelCall(call, callerSignal?) hands `call` ONE signal that aborts when the
//   caller cancels OR TWIN_MODEL_CALL_TIMEOUT_MS passes. The call is also raced against
//   that signal, so even a model client that ignores the signal cannot outlast it.
//   - timeout  -> rejects with TwinModelTimeoutError (user-readable message)
//   - cancel   -> rejects with the caller's own abort reason (an AbortError)
//   Both reject; neither is ever turned into an empty success or retried.
//
// AbortSignal.any / AbortSignal.timeout need Node >= 20.3; the bundled Electron 40
// runs Node 24 (checked with ELECTRON_RUN_AS_NODE), so they are used directly.
//
// The wizard's callers (draft, deep interview, history mining, web research) use this;
// the background learning passes (twinMemoryService) deliberately do not: a slow local
// model there is legitimate and nobody is waiting on it.

/** How long one twin model call may take before it is abandoned. Generous: a local
 *  model on modest hardware can need minutes for a long answer. */
export const TWIN_MODEL_CALL_TIMEOUT_MS = 180_000;

/** The model did not answer within the per-call limit. Message is shown/logged as-is. */
export class TwinModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The model did not answer within ${Math.round(timeoutMs / 1000)} seconds, so the request was stopped.`);
    this.name = 'TwinModelTimeoutError';
  }
}

/** True when the error is a cancel/timeout produced by {@link runTwinModelCall}. */
export function isTwinCallAbort(err: unknown): boolean {
  return err instanceof TwinModelTimeoutError || (err instanceof Error && err.name === 'AbortError');
}

/**
 * Run `call` with a signal that aborts on `caller` abort or after `timeoutMs`.
 * `timeoutMs` is a parameter only so tests can shorten it; production passes nothing.
 */
export async function runTwinModelCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal,
  timeoutMs: number = TWIN_MODEL_CALL_TIMEOUT_MS,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;

  // A caller cancel wins over a simultaneous timeout; only a timeout alone is a timeout.
  const abortError = (): Error =>
    caller?.aborted || !timeout.aborted
      ? signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The model call was cancelled.', 'AbortError')
      : new TwinModelTimeoutError(timeoutMs);

  if (signal.aborted) throw abortError();

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([call(signal), aborted]);
  } catch (err) {
    // The SDK's own abort rejection is replaced by the typed one.
    if (signal.aborted) throw abortError();
    throw err;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
