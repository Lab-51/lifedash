// === FILE PURPOSE ===
// Tests the V3.4 post-session dispatcher seam contract: fire-and-forget,
// error-isolated, registration-ordered. These guarantees are load-bearing — a
// brief must never be affected by a failing/slow learning hook.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

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
