// === FILE PURPOSE ===
// TWIN-LOOP.2 Task 6: runTwinModelCall bounds one twin model call by a timeout and an
// optional caller cancel. The timeout is passed in (50 ms) so nothing waits the real 180 s.
// Contract: a timeout rejects with the typed, user-readable TwinModelTimeoutError; a cancel
// rejects with the caller's AbortError; BOTH hold even for a client that ignores the signal.

import { describe, it, expect } from 'vitest';
import { runTwinModelCall, TwinModelTimeoutError, TWIN_MODEL_CALL_TIMEOUT_MS, isTwinCallAbort } from '../twinModelCall';

const never = () => new Promise<never>(() => {});

describe('runTwinModelCall', () => {
  it('uses a generous default per-call timeout', () => {
    expect(TWIN_MODEL_CALL_TIMEOUT_MS).toBe(180_000);
  });

  it('returns the call result when it answers in time, with a live signal', async () => {
    let seen: AbortSignal | undefined;
    const value = await runTwinModelCall(
      async (signal) => {
        seen = signal;
        return 42;
      },
      undefined,
      50,
    );
    expect(value).toBe(42);
    expect(seen?.aborted).toBe(false);
  });

  it('a call that never resolves rejects with the typed timeout error and aborts its signal', async () => {
    let seen: AbortSignal | undefined;
    const err = await runTwinModelCall(
      (signal) => {
        seen = signal;
        return never(); // ignores the signal entirely: the race still bounds it
      },
      undefined,
      50,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TwinModelTimeoutError);
    expect((err as Error).message).toMatch(/did not answer within/i);
    expect(isTwinCallAbort(err)).toBe(true);
    expect(seen?.aborted).toBe(true);
  });

  it('a caller cancel rejects with an AbortError (not a timeout) and aborts the call signal', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const run = runTwinModelCall(
      (signal) => {
        seen = signal;
        return never();
      },
      caller.signal,
      5_000,
    ).catch((e: unknown) => e);
    caller.abort();

    const err = await run;
    expect(err).not.toBeInstanceOf(TwinModelTimeoutError);
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(isTwinCallAbort(err)).toBe(true);
    expect(seen?.aborted).toBe(true);
  });

  it('an already-cancelled caller never starts the call', async () => {
    const caller = new AbortController();
    caller.abort();
    let started = false;
    await expect(
      runTwinModelCall(
        async () => {
          started = true;
        },
        caller.signal,
        5_000,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toBe(false);
  });

  it('a non-abort failure from the call passes through unchanged', async () => {
    await expect(
      runTwinModelCall(
        async () => {
          throw new Error('model offline');
        },
        undefined,
        50,
      ),
    ).rejects.toThrow('model offline');
  });
});
