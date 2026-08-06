// === FILE PURPOSE ===
// Tests the V3.4 post-session dispatcher seam contract: fire-and-forget,
// error-isolated, registration-ordered. These guarantees are load-bearing — a
// brief must never be affected by a failing/slow learning hook.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the mock factory (itself hoisted above imports by Vitest) can close
// over ONE shared log-mock instance — needed to assert on log.info/log.error
// call content for the MEET-DEL.1 FK-violation classification tests below.
const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));

import {
  registerPostSessionHook,
  dispatchPostSession,
  _resetPostSessionHooks,
  type PostSessionContext,
} from '../postSessionDispatcher';
import type { MeetingBrief } from '../../../shared/types';

const brief: MeetingBrief = { id: 'b1', meetingId: 'm1', summary: 's', createdAt: new Date().toISOString() };
const ctx: PostSessionContext = { meetingId: 'm1', brief };

/** Let the detached hook chain (a microtask queue) drain. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetPostSessionHooks();
  vi.clearAllMocks();
});

describe('postSessionDispatcher', () => {
  it('runs registered hooks with the session context', async () => {
    const hook = vi.fn();
    registerPostSessionHook(hook);

    dispatchPostSession(ctx);
    await flush();

    expect(hook).toHaveBeenCalledWith(ctx);
  });

  it('returns synchronously (fire-and-forget) before async hooks resolve', async () => {
    const order: string[] = [];
    registerPostSessionHook(async () => {
      await Promise.resolve();
      order.push('hook');
    });

    dispatchPostSession(ctx);
    order.push('after-dispatch');
    await flush();

    // dispatch returned before the async hook pushed — proves it did not await.
    expect(order).toEqual(['after-dispatch', 'hook']);
  });

  it('isolates a throwing hook so later hooks still run', async () => {
    const later = vi.fn();
    registerPostSessionHook(() => {
      throw new Error('boom');
    });
    registerPostSessionHook(later);

    // Must not throw out of dispatch.
    expect(() => dispatchPostSession(ctx)).not.toThrow();
    await flush();

    expect(later).toHaveBeenCalledWith(ctx);
  });

  it('isolates a rejecting async hook so later hooks still run', async () => {
    const later = vi.fn();
    registerPostSessionHook(async () => {
      throw new Error('async boom');
    });
    registerPostSessionHook(later);

    dispatchPostSession(ctx);
    await flush();

    expect(later).toHaveBeenCalledWith(ctx);
  });

  it('runs hooks in registration order (facts before entities)', async () => {
    const order: string[] = [];
    registerPostSessionHook(async () => {
      await Promise.resolve();
      order.push('first');
    });
    registerPostSessionHook(async () => {
      order.push('second');
    });

    dispatchPostSession(ctx);
    await flush();

    expect(order).toEqual(['first', 'second']);
  });

  it('is a no-op when nothing is registered', () => {
    expect(() => dispatchPostSession(ctx)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MEET-DEL.1 — deleted-meeting race, orchestration-level defense-in-depth.
// twinMemoryService / entityFactService already absorb this race themselves
// (existence recheck + FK catch around their own insert — see those services'
// own tests), so in practice a hook never throws for this race. These tests
// cover the DISPATCHER's own last-resort behavior: if a hook's rejection IS
// shaped like a foreign-key violation (any future hook that doesn't defend
// itself), it must be classified as an expected no-op (info, "discarded"),
// never logged as an error — while a genuine bug still logs at error, so this
// classification never masks a real failure.
// ---------------------------------------------------------------------------

describe('postSessionDispatcher — MEET-DEL.1 FK-violation classification', () => {
  it('classifies a hook rejecting with an FK-violation-shaped error as a benign no-op (info, not error)', async () => {
    const later = vi.fn();
    // Mirrors PGlite's DatabaseError shape (extends Error, carries the Postgres
    // SQLSTATE on `.code`) — the exact shape isForeignKeyViolation() checks for.
    const fkError = Object.assign(new Error('insert into twin_facts violates foreign key constraint'), {
      code: '23503',
    });
    registerPostSessionHook(() => {
      throw fkError;
    });
    registerPostSessionHook(later);

    expect(() => dispatchPostSession(ctx)).not.toThrow();
    await flush();

    // Later hooks still run — error isolation held.
    expect(later).toHaveBeenCalledWith(ctx);
    // Classified as benign — logged once, at info, never at error.
    expect(logMock.error).not.toHaveBeenCalled();
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('m1'));
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
  });

  it('still logs a genuine (non-FK) hook failure at error — classification never masks a real bug', async () => {
    registerPostSessionHook(() => {
      throw new Error('a real bug, unrelated to any deleted meeting');
    });

    dispatchPostSession(ctx);
    await flush();

    expect(logMock.error).toHaveBeenCalledTimes(1);
    expect(logMock.info).not.toHaveBeenCalled();
  });
});
